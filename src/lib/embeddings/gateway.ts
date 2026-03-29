/**
 * Vercel AI Gateway Embeddings
 * QUOTH-03: Unified embedding via OpenAI text-embedding-3-small (1536d)
 * Replaces dual Jina text/code model approach with single gateway model.
 *
 * Uses AI_GATEWAY_API_KEY env var for Vercel AI Gateway routing.
 */

import { embed, embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;

/** Maximum inputs per embedMany call (OpenAI limit) */
const BATCH_SIZE = 2048;

/**
 * Generate a single embedding vector via Vercel AI Gateway.
 *
 * @param text - Text to embed (query or passage)
 * @returns 1536-dimensional embedding vector
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
 * @returns Array of 1536-dimensional embedding vectors (same order as input)
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
 * Requires OPENAI_API_KEY or AI_GATEWAY_API_KEY in env.
 */
export function isGatewayConfigured(): boolean {
  return !!(process.env.AI_GATEWAY_API_KEY || process.env.OPENAI_API_KEY);
}

/** Exported constants for use in search/indexing modules */
export { EMBEDDING_MODEL, EMBEDDING_DIMS };
