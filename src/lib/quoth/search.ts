/**
 * Quoth Search Module
 * Vector-based semantic search using Supabase + Gemini embeddings
 * Enforces multi-tenant isolation via projectId parameter
 */

import { supabase, isSupabaseConfigured, type MatchResult } from '../supabase';
import { generateEmbedding, isAIConfigured } from '../ai';
import type { DocumentReference, QuothDocument } from './types';

import { CohereClient } from "cohere-ai";

// Initialize Cohere client if key is present
const cohere = process.env.COHERE_API_KEY 
  ? new CohereClient({ token: process.env.COHERE_API_KEY }) 
  : null;

// Default search configuration
const SEARCH_CONFIG = {
  initialFetchCount: 50, // Fetch more for reranking
  finalMatchCount: 15,   // Return top 15 after rerank
  minRerankScore: 0.5,   // Threshold for relevant results
  matchThreshold: 0.5,   // Fallback vector threshold
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
      topN: SEARCH_CONFIG.finalMatchCount,
    });

    // 3. Transform and Filter
    const rerankedResults: DocumentReference[] = [];
    
    for (const result of rerankResponse.results) {
      if (result.relevanceScore < SEARCH_CONFIG.minRerankScore) continue;
      
      const originalDoc = candidates[result.index];
      rerankedResults.push(transformMatchToDocRef(originalDoc, result.relevanceScore));
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
    snippet: truncateSnippet(match.content_chunk, 300), // Slightly longer snippet
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
// Helper Functions
// ============================================

/**
 * Infer document type from file path
 */
function inferDocumentType(filePath: string): 'testing-pattern' | 'architecture' | 'contract' | 'meta' {
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

// Extended DocumentReference with snippet
declare module './types' {
  interface DocumentReference {
    snippet?: string;
  }
}
