/**
 * Optimized Search Pipeline
 * QUOTH-06: Hybrid vector + FTS search with RRF fusion, reranking, and caching.
 *
 * Flow:
 * 1. Check persistent cache (search.query_cache)
 * 2. Generate query embedding
 * 3. Run vector search + FTS in parallel (Promise.all)
 * 4. Merge via Reciprocal Rank Fusion (RRF)
 * 5. Apply reranker for pro/team/enterprise tiers
 * 6. Cache results
 * 7. Return typed SearchResult[]
 */

import { sql } from 'drizzle-orm';
import { getDb } from '@/db/connection';
import { generateEmbedding } from '@/lib/embeddings/gateway';
import { rerank, isRerankerConfigured } from '@/lib/embeddings/reranker';
import type { AuthContext } from '@/lib/auth/types';
import type { SearchOptions, SearchResult } from './types';
import { SEARCH_CONFIG, getAdaptiveFetchCount } from './types';
import { getCachedResults, setCachedResults } from './cache';
import { searchSharedDocs } from './shared';

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

interface VectorRow extends Record<string, unknown> {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
  similarity: number;
  file_path: string;
  title: string;
  metadata: Record<string, unknown> | null;
}

interface FtsRow extends Record<string, unknown> {
  id: string;
  document_id: string;
  content: string;
  file_path: string;
  title: string;
  rank: number;
}

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion
// ---------------------------------------------------------------------------

interface RRFCandidate {
  chunkId: string;
  documentId: string;
  content: string;
  filePath: string;
  title: string;
  metadata?: Record<string, unknown> | null;
  rrfScore: number;
  bestSource: 'vector' | 'fts';
  vectorSimilarity?: number;
}

/**
 * Merge vector and FTS results using Reciprocal Rank Fusion.
 * score = sum(1 / (k + rank_i)) across both result lists.
 */
function reciprocalRankFusion(
  vectorResults: VectorRow[],
  ftsResults: FtsRow[],
  k: number = SEARCH_CONFIG.RRF_K,
  hybridWeight: number = SEARCH_CONFIG.DEFAULT_HYBRID_WEIGHT,
): RRFCandidate[] {
  const candidates = new Map<string, RRFCandidate>();

  // Score vector results (weighted)
  for (let rank = 0; rank < vectorResults.length; rank++) {
    const row = vectorResults[rank];
    const score = hybridWeight * (1 / (k + rank + 1));
    const existing = candidates.get(row.id);

    if (existing) {
      existing.rrfScore += score;
      existing.vectorSimilarity = row.similarity;
    } else {
      candidates.set(row.id, {
        chunkId: row.id,
        documentId: row.document_id,
        content: row.content,
        filePath: row.file_path,
        title: row.title,
        metadata: row.metadata,
        rrfScore: score,
        bestSource: 'vector',
        vectorSimilarity: row.similarity,
      });
    }
  }

  // Score FTS results (weighted by 1 - hybridWeight)
  const ftsWeight = 1 - hybridWeight;
  for (let rank = 0; rank < ftsResults.length; rank++) {
    const row = ftsResults[rank];
    const score = ftsWeight * (1 / (k + rank + 1));
    const existing = candidates.get(row.id);

    if (existing) {
      existing.rrfScore += score;
    } else {
      candidates.set(row.id, {
        chunkId: row.id,
        documentId: row.document_id,
        content: row.content,
        filePath: row.file_path,
        title: row.title,
        rrfScore: score,
        bestSource: 'fts',
      });
    }
  }

  // Sort by RRF score descending
  return Array.from(candidates.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

/**
 * Search documents using hybrid vector + FTS with RRF fusion.
 *
 * @param query - Natural language search query
 * @param context - AuthContext (provides projectId, orgId, tier)
 * @param options - Optional search configuration overrides
 * @returns Array of SearchResult sorted by relevance
 */
export async function searchDocuments(
  query: string,
  context: AuthContext,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const {
    threshold = SEARCH_CONFIG.DEFAULT_THRESHOLD,
    rerank: shouldRerank,
    hybridWeight = SEARCH_CONFIG.DEFAULT_HYBRID_WEIGHT,
    scope = 'project',
  } = options;

  const { projectId, orgId, tier } = context;

  // Determine fetch count (adaptive or explicit)
  const fetchCount = options.limit ?? getAdaptiveFetchCount(trimmedQuery);

  // ---------------------------------------------------------------------------
  // Step 1: Check persistent cache
  // ---------------------------------------------------------------------------
  const cached = await getCachedResults(projectId, trimmedQuery);
  if (cached) {
    // Reconstruct minimal SearchResult from cached IDs + scores.
    // Callers that need full content should re-fetch chunks by ID.
    return cached.resultIds.map((chunkId, i) => ({
      chunkId,
      documentId: '',  // Not stored in cache — caller re-fetches if needed
      content: '',
      filePath: '',
      title: '',
      similarity: cached.resultScores[i],
      source: cached.reranked ? 'reranked' as const : 'vector' as const,
    }));
  }

  // ---------------------------------------------------------------------------
  // Step 2: Generate query embedding
  // ---------------------------------------------------------------------------
  const queryEmbedding = await generateEmbedding(trimmedQuery);
  const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

  // ---------------------------------------------------------------------------
  // Step 3: Parallel vector + FTS search
  // ---------------------------------------------------------------------------
  const db = getDb();

  const [vectorRows, ftsRows] = await Promise.all([
    // Vector search via docs.match_chunks()
    db.execute<VectorRow>(sql`
      SELECT *
      FROM docs.match_chunks(
        ${embeddingLiteral}::vector,
        ${threshold},
        ${fetchCount},
        ${projectId},
        ${SEARCH_CONFIG.EMBEDDING_MODEL}
      )
    `).then(r => r.rows ?? []),

    // Full-text search via docs.keyword_search()
    db.execute<FtsRow>(sql`
      SELECT *
      FROM docs.keyword_search(
        ${trimmedQuery},
        ${projectId},
        ${fetchCount}
      )
    `).then(r => r.rows ?? []),
  ]);

  // ---------------------------------------------------------------------------
  // Step 4: Reciprocal Rank Fusion
  // ---------------------------------------------------------------------------
  const fused = reciprocalRankFusion(
    vectorRows,
    ftsRows,
    SEARCH_CONFIG.RRF_K,
    hybridWeight,
  );

  // Trim to requested limit
  const trimmed = fused.slice(0, fetchCount);

  if (trimmed.length === 0) {
    return [];
  }

  // ---------------------------------------------------------------------------
  // Step 5: Optional reranking (pro/team/enterprise)
  // ---------------------------------------------------------------------------
  const tierAllowsRerank = (SEARCH_CONFIG.RERANK_TIERS as readonly string[]).includes(tier);
  const applyRerank = shouldRerank ?? (tierAllowsRerank && isRerankerConfigured());

  let results: SearchResult[];

  if (applyRerank && trimmed.length > 1) {
    try {
      const rerankResponse = await rerank(
        trimmedQuery,
        trimmed.map(c => ({ id: c.chunkId, text: c.content })),
        { topN: fetchCount },
      );

      results = rerankResponse.results.map(r => {
        const original = trimmed[r.index];
        return {
          chunkId: original.chunkId,
          documentId: original.documentId,
          content: original.content,
          filePath: original.filePath,
          title: original.title,
          similarity: r.relevanceScore,
          source: 'reranked' as const,
          metadata: original.metadata ?? undefined,
        };
      });
    } catch (error) {
      console.warn('[SEARCH] Reranker failed, using RRF scores:', error);
      results = trimmed.map(c => ({
        chunkId: c.chunkId,
        documentId: c.documentId,
        content: c.content,
        filePath: c.filePath,
        title: c.title,
        similarity: c.vectorSimilarity ?? c.rrfScore,
        source: c.bestSource,
        metadata: c.metadata ?? undefined,
      }));
    }
  } else {
    results = trimmed.map(c => ({
      chunkId: c.chunkId,
      documentId: c.documentId,
      content: c.content,
      filePath: c.filePath,
      title: c.title,
      similarity: c.vectorSimilarity ?? c.rrfScore,
      source: c.bestSource,
      metadata: c.metadata ?? undefined,
    }));
  }

  // ---------------------------------------------------------------------------
  // Step 6: Cache results
  // ---------------------------------------------------------------------------
  const wasReranked = applyRerank && results.length > 0 && results[0].source === 'reranked';

  // Fire-and-forget cache write
  setCachedResults(
    projectId,
    trimmedQuery,
    SEARCH_CONFIG.EMBEDDING_MODEL,
    results.map(r => r.chunkId),
    results.map(r => r.similarity),
    wasReranked,
  ).catch(err => console.warn('[SEARCH] Cache write failed:', err));

  // ---------------------------------------------------------------------------
  // Step 7: Optionally merge shared docs
  // ---------------------------------------------------------------------------
  if (scope === 'shared' || scope === 'all') {
    try {
      const sharedResults = await searchSharedDocs(trimmedQuery, orgId, undefined, context);

      if (scope === 'shared') {
        return sharedResults;
      }

      // scope === 'all': merge shared into project results, deduplicate by chunkId
      const seen = new Set(results.map(r => r.chunkId));
      for (const sr of sharedResults) {
        if (!seen.has(sr.chunkId)) {
          results.push(sr);
          seen.add(sr.chunkId);
        }
      }
    } catch (error) {
      console.warn('[SEARCH] Shared doc search failed:', error);
    }
  }

  return results;
}
