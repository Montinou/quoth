/**
 * Genesis MCP Tool — QUOTH-08
 *
 * 1 tool:
 *   - quoth_genesis — bootstrap documentation for a project
 *
 * Chunks content, generates embeddings via the gateway module,
 * and stores documents + chunks in the docs schema.
 */

import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '@/db/connection';
import { documents, chunks } from '@/db/schema';
import { generateEmbeddingsBatch, EMBEDDING_MODEL } from '@/lib/embeddings/gateway';
import type { AuthContext } from '@/lib/auth/types';

// ─── Zod schemas ────────────────────────────────────────────────────────────

const GenesisInput = z.object({
  title: z.string().min(1).max(256).describe('Document title'),
  file_path: z.string().min(1).max(512).describe('Logical file path (e.g. docs/architecture.md)'),
  content: z.string().min(1).max(500_000).describe('Full document content'),
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
    .default('reference')
    .describe('Document type classification'),
  tags: z.array(z.string()).default([]).describe('Searchable tags'),
  chunk_size: z
    .number()
    .int()
    .min(100)
    .max(8000)
    .default(1500)
    .describe('Target chunk size in characters'),
  chunk_overlap: z
    .number()
    .int()
    .min(0)
    .max(1000)
    .default(200)
    .describe('Overlap between adjacent chunks'),
});

// ─── Chunking ───────────────────────────────────────────────────────────────

interface ChunkResult {
  content: string;
  index: number;
}

/**
 * Split text into overlapping chunks at paragraph boundaries when possible.
 */
function chunkText(
  text: string,
  chunkSize: number,
  overlap: number,
): ChunkResult[] {
  const results: ChunkResult[] = [];
  const paragraphs = text.split(/\n{2,}/);

  let buffer = '';
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (buffer.length + trimmed.length + 2 > chunkSize && buffer.length > 0) {
      results.push({ content: buffer.trim(), index: chunkIndex++ });
      // Keep overlap from end of current buffer
      if (overlap > 0 && buffer.length > overlap) {
        buffer = buffer.slice(-overlap);
      } else {
        buffer = '';
      }
    }

    buffer += (buffer ? '\n\n' : '') + trimmed;
  }

  if (buffer.trim()) {
    results.push({ content: buffer.trim(), index: chunkIndex });
  }

  // Handle edge case: single chunk that's very large — force split
  const final: ChunkResult[] = [];
  for (const chunk of results) {
    if (chunk.content.length <= chunkSize * 1.5) {
      final.push({ content: chunk.content, index: final.length });
    } else {
      // Force split at chunkSize boundaries
      let start = 0;
      while (start < chunk.content.length) {
        const end = Math.min(start + chunkSize, chunk.content.length);
        final.push({ content: chunk.content.slice(start, end).trim(), index: final.length });
        start = end - overlap;
        if (start >= chunk.content.length) break;
      }
    }
  }

  return final;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.includes('relation') || err.message.includes('column')) {
      return 'A database error occurred. Please try again later.';
    }
    return err.message;
  }
  return 'An unexpected error occurred.';
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerGenesisTools(server: McpServer, authContext: AuthContext) {
  server.registerTool(
    'quoth_genesis',
    {
      description:
        'Bootstrap documentation for a project. Chunks the content, generates embeddings, ' +
        'and stores everything in the docs schema. If a document with the same file_path exists, ' +
        'it is updated (versioned) and re-indexed.',
      inputSchema: GenesisInput,
    },
    async (args) => {
      try {
        if (authContext.role !== 'admin' && authContext.role !== 'owner' && authContext.role !== 'editor') {
          return {
            content: [{ type: 'text' as const, text: 'Insufficient permissions. Requires editor, admin, or owner role.' }],
            isError: true,
          };
        }

        const input = GenesisInput.parse(args);
        const db = getDb();
        const projectId = authContext.projectId;

        if (!projectId) {
          return {
            content: [{ type: 'text' as const, text: 'No project selected.' }],
            isError: true,
          };
        }

        const contentChecksum = sha256(input.content);

        // Check for existing document
        const [existing] = await db
          .select({
            id: documents.id,
            checksum: documents.checksum,
            version: documents.version,
          })
          .from(documents)
          .where(
            and(
              eq(documents.projectId, projectId),
              eq(documents.filePath, input.file_path),
            ),
          )
          .limit(1);

        // Skip if content unchanged
        if (existing && existing.checksum === contentChecksum) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    status: 'unchanged',
                    document_id: existing.id,
                    message: 'Document content has not changed. Skipping re-index.',
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        let documentId: string;
        let version: number;

        if (existing) {
          // Update existing document
          version = (existing.version ?? 1) + 1;
          const [updated] = await db
            .update(documents)
            .set({
              title: input.title,
              content: input.content,
              checksum: contentChecksum,
              docType: input.doc_type,
              tags: input.tags.length > 0 ? input.tags : null,
              indexingStatus: 'indexing',
              version,
              agentId: authContext.isAgent ? authContext.agentId : null,
              updatedAt: new Date(),
            })
            .where(eq(documents.id, existing.id))
            .returning({ id: documents.id });

          documentId = updated!.id;

          // Delete old chunks
          await db.delete(chunks).where(eq(chunks.documentId, documentId));
        } else {
          // Create new document
          version = 1;
          const [created] = await db
            .insert(documents)
            .values({
              projectId,
              orgId: authContext.orgId,
              filePath: input.file_path,
              title: input.title,
              content: input.content,
              checksum: contentChecksum,
              docType: input.doc_type,
              visibility: 'project',
              tags: input.tags.length > 0 ? input.tags : null,
              agentId: authContext.isAgent ? authContext.agentId : null,
              indexingStatus: 'indexing',
              version,
            })
            .returning({ id: documents.id });

          if (!created) {
            return {
              content: [{ type: 'text' as const, text: 'Failed to create document.' }],
              isError: true,
            };
          }
          documentId = created.id;
        }

        // Chunk the content
        const textChunks = chunkText(input.content, input.chunk_size, input.chunk_overlap);

        if (textChunks.length === 0) {
          // Mark as indexed even with no chunks
          await db
            .update(documents)
            .set({ indexingStatus: 'indexed', updatedAt: new Date() })
            .where(eq(documents.id, documentId));

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    status: 'indexed',
                    document_id: documentId,
                    version,
                    chunks_created: 0,
                    message: 'Document stored but no chunks were generated (content too short?).',
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Generate embeddings in batch
        const embeddings = await generateEmbeddingsBatch(
          textChunks.map((c) => c.content),
        );

        // Insert chunks
        const chunkValues = textChunks.map((chunk, i) => ({
          documentId,
          projectId,
          content: chunk.content,
          chunkHash: sha256(chunk.content),
          chunkIndex: chunk.index,
          embedding: embeddings[i],
          embeddingModel: EMBEDDING_MODEL,
          metadata: {},
          title: input.title,
          filePath: input.file_path,
        }));

        await db.insert(chunks).values(chunkValues);

        // Mark document as indexed
        await db
          .update(documents)
          .set({ indexingStatus: 'indexed', updatedAt: new Date() })
          .where(eq(documents.id, documentId));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  status: 'indexed',
                  document_id: documentId,
                  version,
                  chunks_created: textChunks.length,
                  embedding_model: EMBEDDING_MODEL,
                  file_path: input.file_path,
                  title: input.title,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Genesis failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );
}
