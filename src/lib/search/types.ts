/**
 * Search Pipeline Types
 * QUOTH-06: Type definitions for hybrid search, caching, and shared doc search.
 */

// ---------------------------------------------------------------------------
// Search Options
// ---------------------------------------------------------------------------

export interface SearchOptions {
  /** Maximum number of results to return (default: adaptive based on query) */
  limit?: number;
  /** Minimum similarity threshold (default: 0.5) */
  threshold?: number;
  /** Whether to apply reranking (default: auto based on tier) */
  rerank?: boolean;
  /** Weight for vector vs FTS in RRF fusion: 0 = FTS only, 1 = vector only (default: 0.6) */
  hybridWeight?: number;
  /** Search scope: project-only or include shared docs */
  scope?: 'project' | 'shared' | 'all';
}

// ---------------------------------------------------------------------------
// Search Results
// ---------------------------------------------------------------------------

export interface SearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  filePath: string;
  title: string;
  similarity: number;
  source: 'vector' | 'fts' | 'reranked';
  /** Chunk metadata (JSON from docs.chunks.metadata) */
  metadata?: Record<string, unknown>;
  /** Only present for shared doc results */
  projectId?: string;
  /** Only present for shared doc results */
  agentId?: string;
  /** Only present for shared doc results */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Cache Entry (matches search.query_cache table shape)
// ---------------------------------------------------------------------------

export interface CachedSearchEntry {
  resultIds: string[];
  resultScores: number[];
  reranked: boolean;
}

// ---------------------------------------------------------------------------
// Search Config Constants
// ---------------------------------------------------------------------------

export const SEARCH_CONFIG = {
  /** Default embedding model */
  EMBEDDING_MODEL: 'text-embedding-3-large' as const,

  /** RRF constant k — controls how much rank position matters */
  RRF_K: 60,

  /** Default similarity threshold for vector search */
  DEFAULT_THRESHOLD: 0.5,

  /** Default hybrid weight (0.6 = slightly favor vector) */
  DEFAULT_HYBRID_WEIGHT: 0.6,

  /** HNSW ef_search parameter set per query for recall quality */
  HNSW_EF_SEARCH: 100,

  /** Adaptive fetch counts based on query complexity */
  FETCH_COUNT: {
    SIMPLE: 10,   // < 5 words
    MEDIUM: 20,   // 5-12 words
    COMPLEX: 30,  // > 12 words
  } as const,

  /** Query complexity word thresholds */
  COMPLEXITY: {
    SIMPLE_MAX_WORDS: 4,
    MEDIUM_MAX_WORDS: 12,
  } as const,

  /** Default cache TTL in minutes */
  CACHE_TTL_MINUTES: 60,

  /** Tiers that are allowed to use reranking */
  RERANK_TIERS: ['pro', 'team', 'enterprise'] as const,
} as const;

/** Determine adaptive fetch count based on query word count */
export function getAdaptiveFetchCount(query: string): number {
  const wordCount = query.trim().split(/\s+/).length;
  if (wordCount <= SEARCH_CONFIG.COMPLEXITY.SIMPLE_MAX_WORDS) {
    return SEARCH_CONFIG.FETCH_COUNT.SIMPLE;
  }
  if (wordCount <= SEARCH_CONFIG.COMPLEXITY.MEDIUM_MAX_WORDS) {
    return SEARCH_CONFIG.FETCH_COUNT.MEDIUM;
  }
  return SEARCH_CONFIG.FETCH_COUNT.COMPLEX;
}
