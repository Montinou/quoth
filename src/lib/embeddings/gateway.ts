/**
 * Cloud Embeddings — Venice.ai BGE-M3 (primary) / Vercel AI Gateway (fallback)
 * QUOTH-03: Unified embedding via text-embedding-bge-m3 (1024d)
 * Venice BGE-M3: $0.02/MTok — cheapest option, OpenAI-compatible API.
 * Falls back to Vercel AI Gateway (voyage/voyage-4-lite) if VENICE_API_KEY not set.
 * Same dimensionality used by local daemon (quoth-plugin) for SQLite HNSW.
 *
 * Primary: https://api.venice.ai/api/v1 (VENICE_API_KEY)
 * Fallback: https://ai-gateway.vercel.sh/v1 (AI_GATEWAY_API_KEY / OPENAI_API_KEY)
 */

import { embed, embedMany } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

// Primary: Venice.ai (cheapest)
// Fallback: Vercel AI Gateway (if VENICE_API_KEY not set)
const VENICE_BASE_URL = 'https://api.venice.ai/api/v1';
const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

const EMBEDDING_MODEL = process.env.VENICE_API_KEY ? 'text-embedding-bge-m3' : 'voyage/voyage-4-lite';
const EMBEDDING_DIMS = 1024;

/**
 * OpenAI-compatible provider — routes to Venice.ai when VENICE_API_KEY is set,
 * otherwise falls back to Vercel AI Gateway.
 */
const openai = createOpenAI({
  apiKey: process.env.VENICE_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.VENICE_API_KEY ? VENICE_BASE_URL : GATEWAY_BASE_URL,
});

/** Maximum inputs per embedMany call (OpenAI limit) */
const BATCH_SIZE = 2048;

/**
 * Generate a single embedding vector via Venice.ai (or AI Gateway fallback).
 *
 * @param text - Text to embed (query or passage)
 * @returns 1024-dimensional embedding vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const cleanText = text.replace(/\n+/g, ' ').trim();
  if (!cleanText) {
    throw new Error('Cannot generate embedding for empty text');
  }

  const { embedding } = await embed({
    model: openai.embedding(EMBEDDING_MODEL),
    value: cleanText,
  });

  return embedding;
}

/**
 * Generate embeddings for multiple texts in batches.
 * Batches up to 2048 inputs per API call (OpenAI limit).
 *
 * @param texts - Array of texts to embed
 * @returns Array of 1024-dimensional embedding vectors (same order as input)
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const cleanTexts = texts.map(t => t.replace(/\n+/g, ' ').trim());

  // Track which indices have valid (non-empty) text
  const validIndices: number[] = [];
  const validTexts: string[] = [];
  for (let i = 0; i < cleanTexts.length; i++) {
    if (cleanTexts[i].length > 0) {
      validIndices.push(i);
      validTexts.push(cleanTexts[i]);
    }
  }

  // If all texts are empty, return zero vectors
  if (validTexts.length === 0) {
    return texts.map(() => new Array(EMBEDDING_DIMS).fill(0));
  }

  // Embed only non-empty texts
  const embeddingResults: number[][] = [];
  for (let i = 0; i < validTexts.length; i += BATCH_SIZE) {
    const batch = validTexts.slice(i, i + BATCH_SIZE);

    const { embeddings } = await embedMany({
      model: openai.embedding(EMBEDDING_MODEL),
      values: batch,
    });

    embeddingResults.push(...embeddings);
  }

  // Map results back to original indices, zero vector for empty strings
  const zeroVector = new Array(EMBEDDING_DIMS).fill(0);
  const results: number[][] = new Array(texts.length);
  let embIdx = 0;
  for (let i = 0; i < texts.length; i++) {
    if (embIdx < validIndices.length && validIndices[embIdx] === i) {
      results[i] = embeddingResults[embIdx];
      embIdx++;
    } else {
      results[i] = zeroVector;
    }
  }

  return results;
}

/**
 * Check if cloud embeddings are configured.
 * Prefers VENICE_API_KEY (Venice.ai); falls back to AI_GATEWAY_API_KEY or OPENAI_API_KEY.
 */
export function isGatewayConfigured(): boolean {
  return !!(process.env.VENICE_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.OPENAI_API_KEY);
}

/** Exported constants for use in search/indexing modules */
export { EMBEDDING_MODEL, EMBEDDING_DIMS };
