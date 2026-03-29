/**
 * Search Module Barrel Export
 * QUOTH-06: Unified search pipeline with hybrid search, caching, and shared docs.
 */

// Main pipeline
export { searchDocuments } from './pipeline';

// Persistent query cache
export {
  getCachedResults,
  setCachedResults,
  invalidateProjectCache,
  hashQuery,
} from './cache';

// Cross-project shared doc search
export { searchSharedDocs } from './shared';

// Types and config
export type {
  SearchOptions,
  SearchResult,
  CachedSearchEntry,
} from './types';

export {
  SEARCH_CONFIG,
  getAdaptiveFetchCount,
} from './types';
