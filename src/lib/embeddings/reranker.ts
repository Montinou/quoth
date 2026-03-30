/**
 * Reranker Module
 * QUOTH-03: Cohere primary, Jina fallback reranking with timeout + dynamic cutoff.
 *
 * Both providers have a 10s timeout. If Cohere fails, falls back to Jina.
 * Dynamic cutoff: keep >= 10 results above 0.5, stop below 0.65 after 10.
 */

import { CohereClient } from 'cohere-ai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RerankDocument {
  id: string;
  text: string;
}

export interface RerankResult {
  index: number;
  relevanceScore: number;
}

export interface RerankResponse {
  results: RerankResult[];
  provider: 'cohere' | 'jina';
}

export interface RerankOptions {
  /** Maximum number of results to return from the reranker */
  topN?: number;
  /** Minimum relevance score to include (default 0.5) */
  minScore?: number;
  /** Minimum results to keep before applying high-relevance cutoff (default 10) */
  minResults?: number;
  /** Score threshold after minResults — stop returning below this (default 0.65) */
  highRelevanceThreshold?: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 10_000;

const cohereClient = process.env.COHERE_API_KEY
  ? new CohereClient({ token: process.env.COHERE_API_KEY })
  : null;

const jinaApiKey = process.env.JINA_API_KEY;

// ---------------------------------------------------------------------------
// Cohere Reranker (primary) — H-01: timeout via Promise.race
// ---------------------------------------------------------------------------

async function rerankWithCohere(
  query: string,
  documents: RerankDocument[],
  topN: number,
): Promise<RerankResult[]> {
  if (!cohereClient) {
    throw new Error('Cohere API key not configured');
  }

  const response = await Promise.race([
    cohereClient.rerank({
      model: 'rerank-english-v3.0',
      query,
      documents: documents.map(d => ({ id: d.id, text: d.text })),
      topN,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Cohere rerank timeout')), TIMEOUT_MS),
    ),
  ]);

  return response.results.map(r => ({
    index: r.index,
    relevanceScore: r.relevanceScore,
  }));
}

// ---------------------------------------------------------------------------
// Jina Reranker (fallback) — uses AbortController for fetch timeout
// ---------------------------------------------------------------------------

async function rerankWithJina(
  query: string,
  documents: RerankDocument[],
  topN: number,
): Promise<RerankResult[]> {
  if (!jinaApiKey) {
    throw new Error('Jina API key not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch('https://api.jina.ai/v1/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jinaApiKey}`,
      },
      body: JSON.stringify({
        model: 'jina-reranker-v2-base-multilingual',
        query,
        documents: documents.map(d => d.text),
        top_n: topN,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jina Rerank API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    return (data.results as Array<{ index: number; relevance_score: number }>).map(r => ({
      index: r.index,
      relevanceScore: r.relevance_score,
    }));
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rerank documents with Cohere (primary) or Jina (fallback).
 * Applies dynamic cutoff: keep >= minResults above minScore, stop below
 * highRelevanceThreshold after minResults.
 *
 * @param query - Search query
 * @param documents - Candidate documents with id + text
 * @param options - Reranking options
 * @returns Reranked results with provider info
 */
export async function rerank(
  query: string,
  documents: RerankDocument[],
  options: RerankOptions = {},
): Promise<RerankResponse> {
  const {
    topN = 30,
    minScore = 0.5,
    minResults = 10,
    highRelevanceThreshold = 0.65,
  } = options;

  if (documents.length === 0) {
    return { results: [], provider: 'cohere' };
  }

  let rawResults: RerankResult[];
  let provider: 'cohere' | 'jina';

  // Try Cohere first, fall back to Jina
  try {
    rawResults = await rerankWithCohere(query, documents, topN);
    provider = 'cohere';
  } catch (cohereError) {
    console.warn('[RERANKER] Cohere failed, falling back to Jina:', cohereError);

    try {
      rawResults = await rerankWithJina(query, documents, topN);
      provider = 'jina';
    } catch (jinaError) {
      console.error('[RERANKER] Both Cohere and Jina failed:', jinaError);
      throw new Error('All reranking providers failed');
    }
  }

  // Apply dynamic cutoff — H-08: check threshold BEFORE pushing
  const filtered: RerankResult[] = [];

  for (const result of rawResults) {
    // Skip anything below absolute minimum
    if (result.relevanceScore < minScore) {
      continue;
    }

    // After collecting minResults, stop if score drops below high threshold
    if (
      filtered.length >= minResults &&
      result.relevanceScore < highRelevanceThreshold
    ) {
      break;
    }

    filtered.push(result);
  }

  return { results: filtered, provider };
}

/**
 * Check if any reranking provider is configured.
 */
export function isRerankerConfigured(): boolean {
  return !!cohereClient || !!jinaApiKey;
}
