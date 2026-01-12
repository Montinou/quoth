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
  type: z.enum(['testing-pattern', 'architecture', 'contract', 'meta']),
  related_stack: z.array(z.string()).optional(),
  last_verified_commit: z.string().optional(),
  last_updated_date: z.string(),
  status: z.enum(['active', 'deprecated', 'draft']),
  // NEW: Embedding optimization fields
  keywords: z.array(z.string()).optional().describe('Search keywords for embedding optimization'),
  common_queries: z.array(z.string()).optional().describe('FAQ-style questions this doc answers'),
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
