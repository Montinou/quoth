/**
 * Search MCP Tools — QUOTH-08
 *
 * 3 tools:
 *   - quoth_search_index  — semantic search via embedding pipeline
 *   - quoth_read_doc      — fetch full document by ID
 *   - quoth_read_chunks   — fetch chunks by document ID
 *
 * All queries run against the `docs` schema via Drizzle ORM.
 */

import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '@/db/connection';
import { documents, chunks } from '@/db/schema';
import { generateEmbedding } from '@/lib/embeddings/gateway';
import type { AuthContext } from '@/lib/auth/types';

// ─── Zod schemas ────────────────────────────────────────────────────────────

const SearchIndexInput = z.object({
  query: z.string().min(1).max(2000).describe('Natural-language search query'),
  limit: z.number().int().min(1).max(50).default(10).describe('Max results to return'),
  doc_type: z
    .enum([
      'architecture',
      'testing-pattern',
      'contract',
      'meta',
      'template',
      'rules',
      'patterns',
      'reference',
      'api',
      'guide',
    ])
    .optional()
    .describe('Filter by document type'),
  tags: z.array(z.string()).optional().describe('Filter by tags (AND logic)'),
});

const ReadDocInput = z.object({
  document_id: z.string().uuid().describe('UUID of the document to read'),
});

const ReadChunksInput = z.object({
  document_id: z.string().uuid().describe('UUID of the parent document'),
  limit: z.number().int().min(1).max(100).default(20).describe('Max chunks to return'),
  offset: z.number().int().min(0).default(0).describe('Offset for pagination'),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    // Strip internal details
    if (err.message.includes('relation') || err.message.includes('column')) {
      return 'A database error occurred. Please try again later.';
    }
    return err.message;
  }
  return 'An unexpected error occurred.';
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerSearchTools(server: McpServer, authContext: AuthContext) {
  // ── quoth_search_index ────────────────────────────────────────────────────
  server.registerTool(
    'quoth_search_index',
    {
      description:
        'Semantic search across project documentation. Returns the most relevant chunks ' +
        'ranked by cosine similarity. Use this before generating code to ensure patterns ' +
        'follow documented standards.',
      inputSchema: SearchIndexInput,
    },
    async (args) => {
      try {
        const { query, limit, doc_type, tags } = SearchIndexInput.parse(args);
        const db = getDb();
        const projectId = authContext.projectId;

        if (!projectId) {
          return { content: [{ type: 'text' as const, text: 'No project selected.' }] };
        }

        // Generate embedding for the query
        const queryEmbedding = await generateEmbedding(query);

        // Build the SQL for vector similarity search
        const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

        // Base conditions
        const conditions = [sql`${chunks.projectId} = ${projectId}`];

        // Optional doc_type filter (join through documents)
        if (doc_type) {
          conditions.push(
            sql`${chunks.documentId} IN (
              SELECT id FROM docs.documents
              WHERE project_id = ${projectId} AND doc_type = ${doc_type}
            )`,
          );
        }

        // Optional tags filter
        if (tags && tags.length > 0) {
          conditions.push(
            sql`${chunks.documentId} IN (
              SELECT id FROM docs.documents
              WHERE project_id = ${projectId} AND tags @> ${tags}
            )`,
          );
        }

        const whereClause = sql.join(conditions, sql` AND `);

        const results = await db
          .select({
            chunkId: chunks.id,
            documentId: chunks.documentId,
            content: chunks.content,
            title: chunks.title,
            filePath: chunks.filePath,
            chunkIndex: chunks.chunkIndex,
            score: sql<number>`1 - (${chunks.embedding} <=> ${embeddingLiteral}::vector)`.as('score'),
          })
          .from(chunks)
          .where(whereClause)
          .orderBy(sql`${chunks.embedding} <=> ${embeddingLiteral}::vector`)
          .limit(limit);

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No results found for: "${query}"`,
              },
            ],
          };
        }

        const formatted = results.map((r, i) => ({
          rank: i + 1,
          score: Number(r.score?.toFixed(4) ?? 0),
          title: r.title,
          file_path: r.filePath,
          document_id: r.documentId,
          chunk_index: r.chunkIndex,
          content: r.content,
        }));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { query, result_count: formatted.length, results: formatted },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Search failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── quoth_read_doc ────────────────────────────────────────────────────────
  server.registerTool(
    'quoth_read_doc',
    {
      description:
        'Fetch the full content of a document by its UUID. Returns title, file path, ' +
        'content, doc type, tags, and version info.',
      inputSchema: ReadDocInput,
    },
    async (args) => {
      try {
        const { document_id } = ReadDocInput.parse(args);
        const db = getDb();
        const projectId = authContext.projectId;

        const [doc] = await db
          .select({
            id: documents.id,
            title: documents.title,
            filePath: documents.filePath,
            content: documents.content,
            docType: documents.docType,
            tags: documents.tags,
            visibility: documents.visibility,
            version: documents.version,
            indexingStatus: documents.indexingStatus,
            createdAt: documents.createdAt,
            updatedAt: documents.updatedAt,
          })
          .from(documents)
          .where(
            and(
              eq(documents.id, document_id),
              eq(documents.projectId, projectId),
            ),
          )
          .limit(1);

        if (!doc) {
          return {
            content: [{ type: 'text' as const, text: 'Document not found.' }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  id: doc.id,
                  title: doc.title,
                  file_path: doc.filePath,
                  doc_type: doc.docType,
                  tags: doc.tags,
                  visibility: doc.visibility,
                  version: doc.version,
                  indexing_status: doc.indexingStatus,
                  created_at: doc.createdAt,
                  updated_at: doc.updatedAt,
                  content: doc.content,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Read failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── quoth_read_chunks ─────────────────────────────────────────────────────
  server.registerTool(
    'quoth_read_chunks',
    {
      description:
        'Fetch all chunks belonging to a document, ordered by chunk_index. ' +
        'Useful for reading the full indexed content with embeddings metadata.',
      inputSchema: ReadChunksInput,
    },
    async (args) => {
      try {
        const { document_id, limit, offset } = ReadChunksInput.parse(args);
        const db = getDb();
        const projectId = authContext.projectId;

        // Verify the document belongs to this project
        const [doc] = await db
          .select({ id: documents.id, title: documents.title })
          .from(documents)
          .where(
            and(
              eq(documents.id, document_id),
              eq(documents.projectId, projectId),
            ),
          )
          .limit(1);

        if (!doc) {
          return {
            content: [{ type: 'text' as const, text: 'Document not found.' }],
            isError: true,
          };
        }

        const chunkRows = await db
          .select({
            id: chunks.id,
            content: chunks.content,
            chunkIndex: chunks.chunkIndex,
            chunkHash: chunks.chunkHash,
            embeddingModel: chunks.embeddingModel,
            metadata: chunks.metadata,
            title: chunks.title,
            filePath: chunks.filePath,
            createdAt: chunks.createdAt,
          })
          .from(chunks)
          .where(eq(chunks.documentId, document_id))
          .orderBy(chunks.chunkIndex)
          .limit(limit)
          .offset(offset);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  document_id,
                  document_title: doc.title,
                  chunk_count: chunkRows.length,
                  offset,
                  chunks: chunkRows.map((c) => ({
                    id: c.id,
                    chunk_index: c.chunkIndex,
                    content: c.content,
                    embedding_model: c.embeddingModel,
                    metadata: c.metadata,
                    created_at: c.createdAt,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Read chunks failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );
}
