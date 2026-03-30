/**
 * AI Generation Cache
 * QUOTH-04: Prompt deduplication via Upstash Redis (KV_REST_API_URL).
 *
 * Caches generation IDs by SHA-256 hash of (model + prompt) to avoid
 * re-running identical prompts within a TTL window.
 */

import { createHash } from 'crypto';
import { Redis } from '@upstash/redis';

// ---------------------------------------------------------------------------
// Redis client (lazy init)
// ---------------------------------------------------------------------------

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  redis = new Redis({ url, token });
  return redis;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

const CACHE_PREFIX = 'gen:dedup:';

/**
 * Create a SHA-256 hash of (model + prompt) for cache key.
 * Normalizes whitespace before hashing to increase hit rate.
 */
export function hashPrompt(model: string, prompt: string): string {
  const normalized = `${model}:${prompt.trim().replace(/\s+/g, ' ')}`;
  return createHash('sha256').update(normalized).digest('hex');
}

// ---------------------------------------------------------------------------
// Cache Operations
// ---------------------------------------------------------------------------

/**
 * Look up a cached generation ID for the given model + prompt.
 *
 * @param model - LLM model identifier
 * @param prompt - Input prompt
 * @returns Cached generation ID, or null if not found/expired
 */
export async function getCachedGeneration(
  model: string,
  prompt: string,
): Promise<string | null> {
  const client = getRedis();
  if (!client) return null;

  const key = CACHE_PREFIX + hashPrompt(model, prompt);

  try {
    const cached = await client.get<string>(key);
    return cached ?? null;
  } catch (error) {
    console.warn('[GEN_CACHE] Redis GET failed:', error);
    return null;
  }
}

/**
 * Cache a generation ID for the given model + prompt.
 *
 * @param model - LLM model identifier
 * @param prompt - Input prompt
 * @param generationId - Generation ID to cache
 * @param ttl - TTL in seconds (default 3600 = 1 hour)
 */
export async function setCachedGeneration(
  model: string,
  prompt: string,
  generationId: string,
  ttl: number = 3600,
): Promise<void> {
  const client = getRedis();
  if (!client) return;

  const key = CACHE_PREFIX + hashPrompt(model, prompt);

  try {
    await client.set(key, generationId, { ex: ttl });
  } catch (error) {
    console.warn('[GEN_CACHE] Redis SET failed:', error);
  }
}

/**
 * Invalidate a cached generation (e.g., if the generation failed).
 *
 * @param model - LLM model identifier
 * @param prompt - Input prompt
 */
export async function invalidateCachedGeneration(
  model: string,
  prompt: string,
): Promise<void> {
  const client = getRedis();
  if (!client) return;

  const key = CACHE_PREFIX + hashPrompt(model, prompt);

  try {
    await client.del(key);
  } catch (error) {
    console.warn('[GEN_CACHE] Redis DEL failed:', error);
  }
}

/**
 * Check if the Redis cache is configured and reachable.
 */
export function isCacheConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}
