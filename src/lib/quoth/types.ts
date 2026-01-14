/**
 * Quoth MCP Server Types
 * Core type definitions for the Quoth Knowledge Base system
 */

import { z } from 'zod';

// ============ Document Types ============

/**
 * YAML frontmatter schema for documentation files
 */
export const DocumentFrontmatterSchema = z.object({
  id: z.string(),
  type: z.enum(['testing-pattern', 'architecture', 'contract', 'meta', 'template']),
  related_stack: z.array(z.string()).optional(),
  last_verified_commit: z.string().optional(),
  last_updated_date: z.string(),
  status: z.enum(['active', 'deprecated', 'draft']),
  // Embedding optimization fields
  keywords: z.array(z.string()).optional().describe('Search keywords for embedding optimization'),
  common_queries: z.array(z.string()).optional().describe('FAQ-style questions this doc answers'),
  // Template-specific fields
  category: z.enum(['architecture', 'patterns', 'contracts']).optional().describe('Template category'),
  target_type: z.enum(['testing-pattern', 'architecture', 'contract', 'meta']).optional().describe('Document type this template produces'),
});

export type DocumentFrontmatter = z.infer<typeof DocumentFrontmatterSchema>;

/**
 * Full document with parsed frontmatter and content
 */
export interface QuothDocument {
  id: string;
  title: string;
  type: DocumentFrontmatter['type'];
  path: string;
  frontmatter: DocumentFrontmatter;
  content: string;
}

/**
 * Lightweight document reference for search results
 */
export interface DocumentReference {
  id: string;
  title: string;
  type: DocumentFrontmatter['type'];
  path: string;
  relevance: number;
}

// ============ Tool Input Schemas ============

export const SearchIndexInputSchema = z.object({
  query: z.string().describe('Search query, e.g. "auth flow", "vitest mocks"'),
});

export const ReadDocInputSchema = z.object({
  doc_id: z.string().describe('The document ID, e.g. "pattern-backend-unit"'),
});

export const ProposeUpdateInputSchema = z.object({
  doc_id: z.string().describe('The document ID to update'),
  new_content: z.string().describe('The proposed new content'),
  evidence_snippet: z.string().describe('Code snippet or commit reference as evidence'),
  reasoning: z.string().describe('Explanation of why this update is needed'),
});

// ============ Search Index Types ============

export interface SearchIndex {
  documents: DocumentReference[];
  lastUpdated: string;
}

// ============ Update Proposal Types ============

export interface UpdateProposal {
  id: string;
  doc_id: string;
  new_content: string;
  evidence_snippet: string;
  reasoning: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

// ============ Prompt Types ============

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text';
    text: string;
  };
}

// ============ Configuration Types ============

export interface QuothConfig {
  knowledgeBasePath: string;
  cacheRevalidateSeconds: number;
}

export const DEFAULT_CONFIG: QuothConfig = {
  knowledgeBasePath: './quoth-knowledge-base',
  cacheRevalidateSeconds: 3600,
};

// ============ Chunk-Level Access Types ============

/**
 * Metadata associated with a chunk
 */
export interface ChunkMetadata {
  chunk_index?: number;
  language?: string;
  filePath?: string;
  parentContext?: string;
  startLine?: number;
  endLine?: number;
  source?: string;
}

/**
 * Lightweight chunk reference returned in search results
 * Contains truncated preview for AI to decide which chunks to fetch
 */
export interface ChunkReference {
  chunk_id: string;           // UUID of the chunk
  document_id: string;        // UUID of the parent document
  document_title: string;     // Human-readable document title
  document_path: string;      // File path (e.g., "patterns/vitest.md")
  document_type: DocumentFrontmatter['type'];
  chunk_index: number;        // Position within document (0-based)
  preview: string;            // Truncated preview (200 chars)
  relevance: number;          // Rerank score (0-1)
  metadata: ChunkMetadata;    // Additional context
}

/**
 * Full chunk data returned by quoth_read_chunks
 * Contains complete chunk content
 */
export interface ChunkData {
  chunk_id: string;
  document_id: string;
  document_title: string;
  document_path: string;
  document_type: DocumentFrontmatter['type'];
  chunk_index: number;
  content: string;            // FULL chunk content
  total_chunks: number;       // Total chunks in parent document
  metadata: ChunkMetadata;
}

/**
 * Input schema for quoth_read_chunks tool
 */
export const ReadChunksInputSchema = z.object({
  chunk_ids: z.array(z.string())
    .min(1).max(20)
    .describe('Array of chunk IDs from search results (1-20 chunks)'),
});
