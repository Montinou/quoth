/**
 * Cross-Project Shared Document Search
 * QUOTH-06: Searches shared/public docs across an entire organization.
 *
 * Uses docs.match_shared_chunks() Postgres function for org-scoped vector search.
 * Separate from project search for clear authorization scoping.
 */

import { sql } from 'drizzle-orm';
import { getDb } from '@/db/connection';
import { generateEmbedding } from '@/lib/embeddings/gateway';
import type { AuthContext } from '@/lib/auth/types';
import type { SearchResult } from './types';
import { SEARCH_CONFIG, getAdaptiveFetchCount } from './types';

// ---------------------------------------------------------------------------
// Shared Doc Search
// ---------------------------------------------------------------------------

/**
 * Search shared/public documents across all projects in an organization.
 *
 * @param query - Natural language search query
 * @param orgId - Organization UUID to scope the search
 * @param tags - Optional tag filter (matches any via &&)
 * @param context - AuthContext for tier-based limits
 * @returns Array of SearchResult from shared docs
 */
export async function searchSharedDocs(
  query: string,
  orgId: string,
  tags?: string[],
  context?: AuthContext,
): Promise<SearchResult[]> {
  const db = getDb();
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  // Generate embedding for the query
  const queryEmbedding = await generateEmbedding(trimmedQuery);

  // Determine fetch count
  const limit = getAdaptiveFetchCount(trimmedQuery);

  // Build the embedding literal for Postgres
  const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

  // Call docs.match_shared_chunks() with parameterized inputs
  const rows = await db.execute<{
    id: string;
    document_id: string;
    content: string;
    similarity: number;
    title: string;
    file_path: string;
    project_id: string;
    agent_id: string | null;
    tags: string[] | null;
  }>(sql`
    SELECT *
    FROM docs.match_shared_chunks(
      ${embeddingLiteral}::vector,
      ${SEARCH_CONFIG.DEFAULT_THRESHOLD},
      ${orgId},
      ${limit},
      ${tags ?? null},
      ${SEARCH_CONFIG.EMBEDDING_MODEL}
    )
  `);

  if (!rows.rows || rows.rows.length === 0) {
    return [];
  }

  return rows.rows.map((row) => ({
    chunkId: row.id,
    documentId: row.document_id,
    content: row.content,
    filePath: row.file_path,
    title: row.title,
    similarity: row.similarity,
    source: 'vector' as const,
    projectId: row.project_id,
    agentId: row.agent_id ?? undefined,
    tags: row.tags ?? undefined,
  }));
}
