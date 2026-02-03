/**
 * Quoth Search Module
 * Advanced RAG pipeline: Jina Embeddings (512d) -> Supabase Vector Search -> Cohere Rerank
 * Enforces multi-tenant isolation via projectId parameter
 */

import { supabase, isSupabaseConfigured, type MatchResult, type ChunkByIdResult } from '../supabase';
// AI module imported dynamically in search functions
import type { DocumentReference, QuothDocument, ChunkReference, ChunkData, ChunkMetadata } from './types';
import {
  checkUsageLimit,
  incrementUsage,
  getTierForProject,
  shouldRerank,
  formatUsageFooter,
  type UsageCheckResult,
} from './tier';

import { CohereClient } from "cohere-ai";

// Debug logging - only in development with explicit flag
const DEBUG_SEARCH = process.env.NODE_ENV === 'development' && process.env.DEBUG_SEARCH === 'true';

function debugLog(...args: unknown[]) {
  if (DEBUG_SEARCH) {
    console.log('[SEARCH]', ...args);
  }
}

// Initialize Cohere client if key is present
const cohere = process.env.COHERE_API_KEY 
  ? new CohereClient({ token: process.env.COHERE_API_KEY }) 
  : null;

/**
 * Optional context for search operations (tier gating, genesis mode, etc.)
 */
export interface SearchContext {
  isGenesis?: boolean;
}

/**
 * Extended search result with tier metadata
 */
export interface SearchResultWithMeta {
  results: DocumentReference[];
  tierMessage?: string;       // Upgrade/limit message (shown once in footer)
  usageInfo?: UsageCheckResult;
  usedFallback?: boolean;     // True if keyword fallback was used
}

// Default search configuration
const SEARCH_CONFIG = {
  initialFetchCount: 50,    // Fetch more for reranking
  minMatchCount: 15,        // Return at least 15
  maxMatchCount: 30,        // But no more than 30
  highRelevanceThreshold: 0.65, // Keep returning if above 65% (MEDIUM+)
  minRerankScore: 0.5,      // Minimum threshold for any result
  matchThreshold: 0.5,      // Fallback vector threshold
};

/**
 * Search documents using vector similarity + Cohere Rerank
 * Respects tier limits: free tier falls back to keyword search when limit reached,
 * and skips reranking unless in genesis mode.
 */
export async function searchDocuments(
  query: string,
  projectId: string,
  context: SearchContext = {}
): Promise<DocumentReference[]> {
  const meta = await searchDocumentsWithMeta(query, projectId, context);
  return meta.results;
}

/**
 * Search documents with tier metadata (usage info, fallback status, messages).
 * Used by tools that want to show usage footers.
 */
export async function searchDocumentsWithMeta(
  query: string,
  projectId: string,
  context: SearchContext = {}
): Promise<SearchResultWithMeta> {
  debugLog('Starting search - Query:', query.slice(0, 100), 'ProjectID:', projectId);

  // Validate configuration
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured.');
  }

  // Check tier usage limit for semantic search
  const usageCheck = await checkUsageLimit(projectId, 'semantic_search');

  if (!usageCheck.allowed) {
    debugLog('Semantic search limit reached, falling back to keyword search');
    const fallbackResults = await keywordFallbackSearch(query, projectId);
    return {
      results: fallbackResults,
      tierMessage: `🔒 Daily semantic search limit reached (${usageCheck.limit}/${usageCheck.limit}). Upgrade to Pro for unlimited searches. Using keyword fallback...`,
      usageInfo: usageCheck,
      usedFallback: true,
    };
  }

  // Increment usage counter (semantic search is about to be used)
  incrementUsage(projectId, 'semantic_search');

  // Re-check for accurate remaining count after increment
  const updatedUsage = await checkUsageLimit(projectId, 'semantic_search');

  // Generate embedding (now uses Jina or Gemini based on ai.ts config)
  const queryEmbedding = await import('../ai').then(m => m.generateQueryEmbedding ? m.generateQueryEmbedding(query) : m.generateEmbedding(query));
  debugLog('Embedding generated:', queryEmbedding ? `${queryEmbedding.length} dimensions` : 'FAILED');

  // 1. Initial Retrieval (Vector Search)
  const { data: candidates, error } = await supabase.rpc('match_documents', {
    query_embedding: queryEmbedding,
    match_threshold: 0.1,
    match_count: SEARCH_CONFIG.initialFetchCount,
    filter_project_id: projectId,
  });

  debugLog('RPC match_documents returned:', candidates?.length || 0, 'candidates', error ? `Error: ${error.message}` : '');

  if (error) throw new Error(`Search failed: ${error.message}`);
  if (!candidates || candidates.length === 0) {
    debugLog('No candidates found - returning empty results');
    return { results: [], usageInfo: updatedUsage };
  }

  // Check if reranking should be used (tier + genesis context)
  const useRerank = await shouldRerank(projectId, context.isGenesis);

  // If Cohere is not configured or reranking is disabled for this tier, return vector results
  if (!cohere || !useRerank) {
    debugLog(
      !cohere
        ? 'Cohere API key not found. Skipping rerank step.'
        : 'Reranking disabled for this tier. Returning vector results.'
    );
    return {
      results: (candidates as MatchResult[])
        .slice(0, 10)
        .map(match => transformMatchToDocRef(match)),
      usageInfo: updatedUsage,
    };
  }

  // 2. Reranking using Cohere
  const docsForRerank = (candidates as MatchResult[]).map(doc => ({
    id: doc.id.toString(),
    text: doc.content_chunk || "",
  }));

  debugLog('Reranking', candidates.length, 'candidates with Cohere (model: rerank-english-v3.0)');

  try {
    const rerankResponse = await cohere.rerank({
      model: "rerank-english-v3.0",
      query: query,
      documents: docsForRerank,
      topN: SEARCH_CONFIG.maxMatchCount,
    });

    debugLog('Cohere rerank returned', rerankResponse.results.length, 'results');

    // 3. Transform and Filter with dynamic cutoff
    const rerankedResults: DocumentReference[] = [];

    for (const result of rerankResponse.results) {
      if (result.relevanceScore < SEARCH_CONFIG.minRerankScore) {
        debugLog('Filtering out result with score', result.relevanceScore, '(below min:', SEARCH_CONFIG.minRerankScore, ')');
        continue;
      }

      const originalDoc = candidates[result.index];
      rerankedResults.push(transformMatchToDocRef(originalDoc, result.relevanceScore));

      if (rerankedResults.length >= SEARCH_CONFIG.minMatchCount &&
          result.relevanceScore < SEARCH_CONFIG.highRelevanceThreshold) {
        debugLog('Dynamic cutoff reached at', rerankedResults.length, 'results (score:', result.relevanceScore, ')');
        break;
      }
    }

    debugLog('Returning', rerankedResults.length, 'reranked results');
    return {
      results: rerankedResults,
      usageInfo: updatedUsage,
    };

  } catch (err) {
    console.error("[SEARCH] Reranking failed, falling back to vector results:", err);
    return {
      results: (candidates as MatchResult[])
        .slice(0, 10)
        .map(match => transformMatchToDocRef(match)),
      usageInfo: updatedUsage,
    };
  }
}

function transformMatchToDocRef(match: MatchResult, score?: number): DocumentReference {
  return {
    id: match.title,
    title: match.title,
    type: inferDocumentType(match.file_path),
    path: match.file_path,
    relevance: score ?? match.similarity,
    snippet: truncateSnippet(match.content_chunk, 400),
    chunk_id: match.id, // UUID for quoth_read_chunks
    chunk_index: (match.metadata as ChunkMetadata)?.chunk_index ?? 0,
  };
}

/**
 * Read a full document by file path or document ID
 *
 * @param docId - Document identifier (file_path or title)
 * @param projectId - UUID of the project (enforces multi-tenant isolation)
 */
export async function readDocument(
  docId: string,
  projectId: string
): Promise<QuothDocument | null> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  // Validate projectId
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('Invalid projectId provided');
  }

  // Try to find by file_path or title
  // projectId ensures we only access documents from the authenticated project
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('project_id', projectId)
    .or(`file_path.eq.${docId},title.eq.${docId}`)
    .single();

  if (error || !data) {
    // Try partial match on title
    const { data: partialMatch } = await supabase
      .from('documents')
      .select('*')
      .eq('project_id', projectId)
      .ilike('title', `%${docId}%`)
      .limit(1)
      .single();

    if (!partialMatch) {
      return null;
    }

    return transformToQuothDocument(partialMatch);
  }

  return transformToQuothDocument(data);
}

/**
 * Get all documents in the project
 *
 * @param projectId - UUID of the project (enforces multi-tenant isolation)
 */
export async function getAllDocuments(
  projectId: string
): Promise<QuothDocument[]> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  // Validate projectId
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('Invalid projectId provided');
  }

  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('project_id', projectId)
    .order('file_path');

  if (error || !data) {
    return [];
  }

  return data.map(transformToQuothDocument);
}

/**
 * Build search index - returns document list for compatibility
 * In the new architecture, index is pre-built in Supabase
 *
 * @param projectId - UUID of the project (enforces multi-tenant isolation)
 */
export async function buildSearchIndex(projectId: string) {
  const docs = await getAllDocuments(projectId);

  return {
    documents: docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      type: doc.type,
      path: doc.path,
      relevance: 1.0,
    })),
    lastUpdated: new Date().toISOString(),
  };
}

// ============================================
// Chunk-Level Access Functions
// ============================================

/**
 * Search for chunks with IDs and truncated previews
 * Allows AI to decide which chunks to fetch fully
 * Respects tier limits (same as searchDocuments).
 *
 * @param query - Search query
 * @param projectId - UUID of the project (enforces multi-tenant isolation)
 * @param context - Optional search context (genesis mode, etc.)
 */
export async function searchChunks(
  query: string,
  projectId: string,
  context: SearchContext = {}
): Promise<ChunkReference[]> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured.');
  }

  // Check tier usage limit for semantic search
  const usageCheck = await checkUsageLimit(projectId, 'semantic_search');
  if (!usageCheck.allowed) {
    debugLog('Semantic search limit reached for chunk search, returning empty (keyword fallback not supported for chunks)');
    // For chunk search, we can't easily do keyword fallback (different return type),
    // so return empty with a log. The document-level search handles fallback.
    return [];
  }

  // Increment usage
  incrementUsage(projectId, 'semantic_search');

  // Generate embedding
  const queryEmbedding = await import('../ai').then(m =>
    m.generateQueryEmbedding ? m.generateQueryEmbedding(query) : m.generateEmbedding(query)
  );

  // Vector search
  const { data: candidates, error } = await supabase.rpc('match_documents', {
    query_embedding: queryEmbedding,
    match_threshold: 0.1,
    match_count: SEARCH_CONFIG.initialFetchCount,
    filter_project_id: projectId,
  });

  if (error) throw new Error(`Search failed: ${error.message}`);
  if (!candidates || candidates.length === 0) return [];

  // Check if reranking should be used
  const useRerank = await shouldRerank(projectId, context.isGenesis);

  if (!cohere || !useRerank) {
    return (candidates as MatchResult[])
      .slice(0, 15)
      .map(match => transformMatchToChunkRef(match));
  }

  // Rerank using Cohere
  const docsForRerank = (candidates as MatchResult[]).map(doc => ({
    id: doc.id.toString(),
    text: doc.content_chunk || "",
  }));

  try {
    const rerankResponse = await cohere.rerank({
      model: "rerank-english-v3.0",
      query: query,
      documents: docsForRerank,
      topN: SEARCH_CONFIG.maxMatchCount,
    });

    const rerankedResults: ChunkReference[] = [];

    for (const result of rerankResponse.results) {
      if (result.relevanceScore < SEARCH_CONFIG.minRerankScore) continue;

      const originalDoc = candidates[result.index];
      rerankedResults.push(transformMatchToChunkRef(originalDoc, result.relevanceScore));

      if (rerankedResults.length >= SEARCH_CONFIG.minMatchCount &&
          result.relevanceScore < SEARCH_CONFIG.highRelevanceThreshold) {
        break;
      }
    }

    return rerankedResults;
  } catch (err) {
    console.error("[SEARCH] Chunk reranking failed, falling back to vector results:", err);
    return (candidates as MatchResult[])
      .slice(0, 15)
      .map(match => transformMatchToChunkRef(match));
  }
}

/**
 * Transform a match result to a chunk reference with truncated preview
 */
function transformMatchToChunkRef(match: MatchResult, score?: number): ChunkReference {
  const metadata = (match.metadata || {}) as ChunkMetadata;

  return {
    chunk_id: match.id,
    document_id: match.document_id,
    document_title: match.title,
    document_path: match.file_path,
    document_type: inferDocumentType(match.file_path),
    chunk_index: metadata.chunk_index ?? 0,
    preview: truncateSnippet(match.content_chunk, 200), // Shorter for chunk view
    relevance: score ?? match.similarity,
    metadata: {
      chunk_index: metadata.chunk_index,
      language: metadata.language,
      filePath: metadata.filePath,
      parentContext: metadata.parentContext,
      startLine: metadata.startLine,
      endLine: metadata.endLine,
      source: metadata.source,
    },
  };
}

/**
 * Read specific chunks by their IDs
 *
 * @param chunkIds - Array of chunk UUIDs
 * @param projectId - UUID of the project (enforces multi-tenant isolation)
 */
export async function readChunks(
  chunkIds: string[],
  projectId: string
): Promise<ChunkData[]> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  if (!projectId || !chunkIds.length) {
    throw new Error('Invalid parameters');
  }

  // Limit to prevent abuse
  const limitedIds = chunkIds.slice(0, 20);

  const { data, error } = await supabase.rpc('get_chunks_by_ids', {
    chunk_ids: limitedIds,
    filter_project_id: projectId,
  });

  if (error) {
    throw new Error(`Failed to fetch chunks: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  return (data as ChunkByIdResult[]).map((row) => ({
    chunk_id: row.chunk_id,
    document_id: row.document_id,
    document_title: row.document_title,
    document_path: row.document_path,
    document_type: inferDocumentType(row.document_path),
    chunk_index: row.chunk_index ?? 0,
    content: row.content_chunk,
    total_chunks: row.total_chunks,
    metadata: row.metadata as ChunkMetadata,
  }));
}

// ============================================
// Keyword Fallback Search (Free Tier)
// ============================================

/**
 * Simple keyword-based search without embeddings or reranking.
 * Used as fallback when semantic search limit is reached on free tier.
 */
async function keywordFallbackSearch(
  query: string,
  projectId: string
): Promise<DocumentReference[]> {
  debugLog('Keyword fallback search for:', query);

  const terms = query
    .split(/\s+/)
    .filter(t => t.length > 2)
    .map(t => t.replace(/[^a-zA-Z0-9]/g, '')); // strip special chars for tsquery

  if (terms.length === 0) return [];

  try {
    // Use Postgres full-text search on content_chunk
    const tsQuery = terms.join(' & ');
    const { data, error } = await supabase
      .from('document_chunks')
      .select('id, document_id, title, file_path, content_chunk, metadata')
      .eq('project_id', projectId)
      .textSearch('content_chunk', tsQuery)
      .limit(10);

    if (error) {
      debugLog('Full-text search failed, trying ilike fallback:', error.message);
      // Fallback to ilike if textSearch isn't available
      const { data: ilikeData } = await supabase
        .from('document_chunks')
        .select('id, document_id, title, file_path, content_chunk, metadata')
        .eq('project_id', projectId)
        .ilike('content_chunk', `%${terms[0]}%`)
        .limit(10);

      if (!ilikeData || ilikeData.length === 0) return [];

      return ilikeData.map((row: Record<string, unknown>) =>
        transformKeywordResultToDocRef(row)
      );
    }

    if (!data || data.length === 0) return [];

    return data.map((row: Record<string, unknown>) =>
      transformKeywordResultToDocRef(row)
    );
  } catch (err) {
    console.error('[SEARCH] Keyword fallback search failed:', err);
    return [];
  }
}

/**
 * Transform a keyword search result row to DocumentReference
 */
function transformKeywordResultToDocRef(row: Record<string, unknown>): DocumentReference {
  const filePath = (row.file_path as string) || '';
  const title = (row.title as string) || '';
  const content = (row.content_chunk as string) || '';
  const metadata = (row.metadata || {}) as ChunkMetadata;

  return {
    id: title,
    title,
    type: inferDocumentType(filePath),
    path: filePath,
    relevance: 0.5, // Fixed relevance for keyword results (no real score)
    snippet: truncateSnippet(content, 400),
    chunk_id: row.id as string,
    chunk_index: metadata.chunk_index ?? 0,
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Infer document type from file path
 */
function inferDocumentType(filePath: string): 'testing-pattern' | 'architecture' | 'contract' | 'meta' | 'template' {
  if (filePath.startsWith('templates/')) return 'template';
  if (filePath.startsWith('patterns/')) return 'testing-pattern';
  if (filePath.startsWith('architecture/')) return 'architecture';
  if (filePath.startsWith('contracts/')) return 'contract';
  if (filePath.startsWith('meta/')) return 'meta';
  return 'architecture'; // default
}

/**
 * Truncate content chunk to create a snippet
 */
function truncateSnippet(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}

/**
 * Transform Supabase document row to QuothDocument
 */
function transformToQuothDocument(row: Record<string, unknown>): QuothDocument {
  const filePath = row.file_path as string;
  const title = row.title as string;

  return {
    id: title,
    title,
    type: inferDocumentType(filePath),
    path: filePath,
    frontmatter: {
      id: title,
      type: inferDocumentType(filePath),
      status: 'active' as const,
      last_updated_date: (row.last_updated as string) || new Date().toISOString(),
    },
    content: row.content as string,
  };
}

// Extended DocumentReference with chunk fields
declare module './types' {
  interface DocumentReference {
    snippet?: string;
    chunk_id?: string;    // UUID for quoth_read_chunks
    chunk_index?: number; // Position within document
  }
}
