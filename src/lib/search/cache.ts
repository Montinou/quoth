/**
 * Persistent Query Cache
 * QUOTH-06: Uses search.query_cache table on Neon instead of in-memory LRU.
 *
 * Lookup by SHA-256 hash of (projectId + query + model).
 * Cache is checked BEFORE running the search pipeline.
 */

import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db/connection';
import type { CachedSearchEntry } from './types';
import { SEARCH_CONFIG } from './types';

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Create a deterministic SHA-256 hash for cache lookup.
 * Normalizes whitespace to increase hit rate.
 */
export function hashQuery(projectId: string, query: string, model: string): string {
  const normalized = `${projectId}:${query.trim().replace(/\s+/g, ' ')}:${model}`;
  return createHash('sha256').update(normalized).digest('hex');
}

// ---------------------------------------------------------------------------
// Cache Operations
// ---------------------------------------------------------------------------

/**
 * Look up cached search results for a given project + query + model.
 * Returns null if not found or expired.
 */
export async function getCachedResults(
  projectId: string,
  query: string,
  model: string = SEARCH_CONFIG.EMBEDDING_MODEL,
): Promise<CachedSearchEntry | null> {
  const db = getDb();
  const queryHash = hashQuery(projectId, query, model);

  try {
    const rows = await db.execute<{
      result_ids: string[];
      result_scores: number[];
      reranked: boolean;
    }>(sql`
      SELECT result_ids, result_scores, reranked
      FROM search.query_cache
      WHERE project_id = ${projectId}
        AND query_hash = ${queryHash}
        AND embedding_model = ${model}
        AND expires_at > now()
      LIMIT 1
    `);

    if (!rows.rows || rows.rows.length === 0) {
      return null;
    }

    const row = rows.rows[0];
    return {
      resultIds: row.result_ids,
      resultScores: row.result_scores,
      reranked: row.reranked,
    };
  } catch (error) {
    console.warn('[SEARCH_CACHE] Lookup failed:', error);
    return null;
  }
}

/**
 * Store search results in the persistent cache.
 * Uses INSERT ... ON CONFLICT to upsert (same project + hash + model).
 */
export async function setCachedResults(
  projectId: string,
  query: string,
  model: string = SEARCH_CONFIG.EMBEDDING_MODEL,
  chunkIds: string[],
  scores: number[],
  reranked: boolean = false,
  ttlMinutes: number = SEARCH_CONFIG.CACHE_TTL_MINUTES,
): Promise<void> {
  const db = getDb();
  const queryHash = hashQuery(projectId, query, model);

  try {
    await db.execute(sql`
      INSERT INTO search.query_cache
        (project_id, query_hash, query_text, embedding_model, result_ids, result_scores, reranked, expires_at)
      VALUES (
        ${projectId},
        ${queryHash},
        ${query},
        ${model},
        ${chunkIds},
        ${scores},
        ${reranked},
        now() + ${sql.raw(`INTERVAL '${Math.max(1, Math.floor(ttlMinutes))} minutes'`)}
      )
      ON CONFLICT (project_id, query_hash, embedding_model)
      DO UPDATE SET
        query_text = EXCLUDED.query_text,
        result_ids = EXCLUDED.result_ids,
        result_scores = EXCLUDED.result_scores,
        reranked = EXCLUDED.reranked,
        expires_at = EXCLUDED.expires_at,
        created_at = now()
    `);
  } catch (error) {
    console.warn('[SEARCH_CACHE] Set failed:', error);
  }
}

/**
 * Invalidate all cached results for a project.
 * Call this when documents are created, updated, or deleted.
 */
export async function invalidateProjectCache(projectId: string): Promise<void> {
  const db = getDb();

  try {
    await db.execute(sql`
      DELETE FROM search.query_cache
      WHERE project_id = ${projectId}
    `);
  } catch (error) {
    console.warn('[SEARCH_CACHE] Invalidation failed:', error);
  }
}
