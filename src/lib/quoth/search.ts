/**
 * Quoth Search Module
 * Advanced RAG pipeline: Jina Embeddings (512d) -> Supabase Vector Search -> Cohere Rerank
 * Enforces multi-tenant isolation via projectId parameter
 */

import { supabase, isSupabaseConfigured, type MatchResult, type ChunkByIdResult } from '../supabase';
// AI module imported dynamically in search functions
import type { DocumentReference, QuothDocument, ChunkReference, ChunkData, ChunkMetadata } from './types';

import { CohereClient } from "cohere-ai";

// Initialize Cohere client if key is present
const cohere = process.env.COHERE_API_KEY 
  ? new CohereClient({ token: process.env.COHERE_API_KEY }) 
  : null;

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
 */
export async function searchDocuments(
  query: string,
  projectId: string
): Promise<DocumentReference[]> {
  // Validate configuration
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured.');
  }

  // Generate embedding (now uses Jina or Gemini based on ai.ts config)
  // Logic in ai.ts handles generating the right dimension (512 for Jina)
  // Note: search_query task_type is handled inside generateQueryEmbedding if using Jina
  const queryEmbedding = await import('../ai').then(m => m.generateQueryEmbedding ? m.generateQueryEmbedding(query) : m.generateEmbedding(query));

  // 1. Initial Retrieval (Vector Search)
  const { data: candidates, error } = await supabase.rpc('match_documents', {
    query_embedding: queryEmbedding, 
    match_threshold: 0.1, // Low threshold to get maximum recall for reranker
    match_count: SEARCH_CONFIG.initialFetchCount,
    filter_project_id: projectId,
  });

  if (error) throw new Error(`Search failed: ${error.message}`);
  if (!candidates || candidates.length === 0) return [];

  // If Cohere is not configured, return vector results directly (fallback)
  if (!cohere) {
    console.warn("Cohere API key not found. Skipping rerank step.");
    return (candidates as MatchResult[])
      .slice(0, 10)
      .map(match => transformMatchToDocRef(match));
  }

  // 2. Reranking using Cohere
  const docsForRerank = (candidates as MatchResult[]).map(doc => ({
    id: doc.id.toString(), // assuming id is unique per chunk or record
    text: doc.content_chunk || "",
    // Pass metadata to preserve context if needed
  }));

  try {
    const rerankResponse = await cohere.rerank({
      model: "rerank-english-v3.0",
      query: query,
      documents: docsForRerank,
      topN: SEARCH_CONFIG.maxMatchCount, // Fetch up to max, then filter dynamically
    });

    // 3. Transform and Filter with dynamic cutoff
    const rerankedResults: DocumentReference[] = [];

    for (const result of rerankResponse.results) {
      if (result.relevanceScore < SEARCH_CONFIG.minRerankScore) continue;

      const originalDoc = candidates[result.index];
      rerankedResults.push(transformMatchToDocRef(originalDoc, result.relevanceScore));

      // Dynamic cutoff: stop after minMatchCount if relevance drops below threshold
      if (rerankedResults.length >= SEARCH_CONFIG.minMatchCount &&
          result.relevanceScore < SEARCH_CONFIG.highRelevanceThreshold) {
        break;
      }
    }

    return rerankedResults;

  } catch (err) {
    console.error("Reranking failed, falling back to vector results:", err);
    return (candidates as MatchResult[])
      .slice(0, 10)
      .map(match => transformMatchToDocRef(match));
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
 *
 * @param query - Search query
 * @param projectId - UUID of the project (enforces multi-tenant isolation)
 */
export async function searchChunks(
  query: string,
  projectId: string
): Promise<ChunkReference[]> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured.');
  }

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

  // If Cohere is not configured, return vector results directly
  if (!cohere) {
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

      // Dynamic cutoff: stop after minMatchCount if relevance drops below threshold
      if (rerankedResults.length >= SEARCH_CONFIG.minMatchCount &&
          result.relevanceScore < SEARCH_CONFIG.highRelevanceThreshold) {
        break;
      }
    }

    return rerankedResults;
  } catch (err) {
    console.error("Reranking failed, falling back to vector results:", err);
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
