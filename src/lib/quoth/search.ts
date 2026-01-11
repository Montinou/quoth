/**
 * Quoth Search Module
 * Vector-based semantic search using Supabase + Gemini embeddings
 * Enforces multi-tenant isolation via projectId parameter
 */

import { supabase, isSupabaseConfigured, type MatchResult } from '../supabase';
import { generateEmbedding, isAIConfigured } from '../ai';
import type { DocumentReference, QuothDocument } from './types';

// Default search configuration
const SEARCH_CONFIG = {
  matchThreshold: 0.65, // Minimum similarity score (0-1)
  matchCount: 10, // Max results to return
};

/**
 * Search documents using vector similarity
 * Converts query to embedding, then uses Supabase RPC for cosine similarity search
 *
 * @param query - Natural language search query
 * @param projectId - UUID of the project to search within (enforces multi-tenant isolation)
 */
export async function searchDocuments(
  query: string,
  projectId: string
): Promise<DocumentReference[]> {
  // Validate configuration
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }

  if (!isAIConfigured()) {
    throw new Error('Gemini AI not configured. Set GEMINIAI_API_KEY or GOOGLE_API_KEY');
  }

  // Validate projectId
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('Invalid projectId provided');
  }

  // Generate embedding for the search query
  const queryEmbedding = await generateEmbedding(query);

  // Call Supabase RPC function for vector similarity search
  // projectId enforces multi-tenant isolation at the database level
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: queryEmbedding,
    match_threshold: SEARCH_CONFIG.matchThreshold,
    match_count: SEARCH_CONFIG.matchCount,
    filter_project_id: projectId,
  });

  if (error) {
    throw new Error(`Search failed: ${error.message}`);
  }

  // Transform results to DocumentReference format
  const results: DocumentReference[] = (data as MatchResult[]).map((match) => ({
    id: match.title, // Use title as the document ID for display
    title: match.title,
    type: inferDocumentType(match.file_path),
    path: match.file_path,
    relevance: match.similarity,
    snippet: truncateSnippet(match.content_chunk, 200),
  }));

  return results;
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
