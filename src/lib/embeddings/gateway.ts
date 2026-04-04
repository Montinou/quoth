/**
 * Vercel AI Gateway Embeddings
 * QUOTH-03: Unified embedding via voyage/voyage-4-lite (1024d)
 * 6.5x cheaper than text-embedding-3-large ($0.02 vs $0.13/MTok).
 * Same model used by local daemon (quoth-plugin) for SQLite HNSW.
 *
 * Gateway URL: https://ai-gateway.vercel.sh/v1
 * Auth: AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN (auto on Vercel deploys)
 */

import { embed, embedMany } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const EMBEDDING_MODEL = 'voyage/voyage-4-lite';
const EMBEDDING_DIMS = 1024;

/**
 * OpenAI-compatible provider routed through Vercel AI Gateway.
 */
const openai = createOpenAI({
  apiKey: process.env.AI_GATEWAY_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: 'https://ai-gateway.vercel.sh/v1',
});

/** Maximum inputs per embedMany call (OpenAI limit) */
const BATCH_SIZE = 2048;

/**
 * Generate a single embedding vector via Vercel AI Gateway.
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
 * Check if gateway embeddings are configured.
 * Prefers AI_GATEWAY_API_KEY (Vercel AI Gateway); falls back to OPENAI_API_KEY.
 */
export function isGatewayConfigured(): boolean {
  return !!(process.env.AI_GATEWAY_API_KEY || process.env.OPENAI_API_KEY);
}

/** Exported constants for use in search/indexing modules */
export { EMBEDDING_MODEL, EMBEDDING_DIMS };
