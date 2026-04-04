/**
 * POST /api/v1/patterns/promote
 * Receives high-confidence patterns from local daemon, indexes into Quoth cloud.
 * Agent API key only -- Clerk JWT rejected with 403.
 */

import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';
import { getSecureDb } from '@/db/connection';
import { documents, chunks, documentHistory } from '@/db/schema';
import { generateEmbedding } from '@/lib/embeddings/gateway';
import { forbidden } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const promotePatternBody = z.object({
  patternId: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  condition: z.string().min(1),
  action: z.string().min(1),
  content: z.string().min(1),
  confidence: z.number().min(0.8).max(1.0),
  successCount: z.number().int().min(0),
  failureCount: z.number().int().min(0),
  tags: z.array(z.string().max(64)).max(20).default([]),
  applicability: z.enum(['broad', 'narrow']),
  /** Daemon's embedding — same model (voyage/voyage-4-lite, 1024d) as cloud. */
  embedding: z.array(z.number()).optional(),
  /** Project slug to promote to (optional — resolved from tags or defaults to first project) */
  projectSlug: z.string().min(1).max(64).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sha256(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// POST /api/v1/patterns/promote
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 30 },
    validate: { body: promotePatternBody },
    maxDuration: 60_000,
  },
  async (req, ctx) => {
    // Agents only
    if (!ctx!.isAgent) {
      throw forbidden('Pattern promotion is only available to agent API keys.');
    }

    const db = await getSecureDb(ctx!.orgId, ctx!.userId);
    const body = req.validatedBody as z.infer<typeof promotePatternBody>;

    // Resolve projectId: from body.projectSlug, tags, ctx, or first project in org
    let projectId = projectId;
    if (!projectId || projectId === '') {
      const { projects } = await import('@/db/schema');
      const slug = body.projectSlug
        || body.tags.find(t => t.startsWith('project:'))?.replace('project:', '')
        || null;

      if (slug) {
        const [proj] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.orgId, ctx!.orgId), eq(projects.slug, slug)))
          .limit(1);
        if (proj) projectId = proj.id;
      }

      // Fallback: first project in org
      if (!projectId || projectId === '') {
        const [first] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.orgId, ctx!.orgId))
          .limit(1);
        if (first) projectId = first.id;
      }

      if (!projectId || projectId === '') {
        throw forbidden('No project found in organization.');
      }
    }

    const filePath = `system/patterns/${body.patternId}`;
    const visibility = body.applicability === 'broad' ? 'shared' : 'project';
    const hash = await sha256(body.content);

    // 1. Check for existing document
    const [existing] = await db
      .select({
        id: documents.id,
        version: documents.version,
        content: documents.content,
        checksum: documents.checksum,
      })
      .from(documents)
      .where(
        and(
          eq(documents.projectId, projectId),
          eq(documents.filePath, filePath),
        ),
      )
      .limit(1);

    // Skip if content unchanged
    if (existing && existing.checksum === hash) {
      return Response.json({
        documentId: existing.id,
        version: existing.version,
        status: 'skipped',
        filePath,
      });
    }

    // 2. Write current version to history BEFORE overwriting
    if (existing) {
      await db.insert(documentHistory).values({
        documentId: existing.id,
        version: existing.version ?? 1,
        content: existing.content,
        checksum: existing.checksum,
        changedBy: null,
        changeType: 'update',
      });
    }

    // 3. Upsert document
    const [doc] = await db
      .insert(documents)
      .values({
        projectId: projectId,
        orgId: ctx!.orgId,
        filePath,
        title: body.name,
        content: body.content,
        checksum: hash,
        docType: 'patterns',
        visibility,
        tags: body.tags,
        agentId: ctx!.agentId ?? null,
        indexingStatus: 'indexing',
        version: 1,
      })
      .onConflictDoUpdate({
        target: [documents.projectId, documents.filePath],
        set: {
          title: body.name,
          content: body.content,
          checksum: hash,
          visibility,
          tags: body.tags,
          indexingStatus: 'indexing',
          version: sql`${documents.version} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning();

    const status = (doc.version ?? 1) > 1 ? 'updated' : 'created';

    // 4. Delete old chunks, create fresh chunk with server-side embedding
    await db.delete(chunks).where(eq(chunks.documentId, doc.id));

    let embedding: number[] | null = null;
    try {
      embedding = await generateEmbedding(body.action);
    } catch {
      // Non-fatal -- chunk still created, falls back to FTS-only search
    }

    const chunkHash = await sha256(body.content);
    await db.insert(chunks).values({
      documentId: doc.id,
      projectId: projectId,
      content: body.content,
      chunkHash,
      chunkIndex: 0,
      embedding,
      embeddingModel: 'voyage/voyage-4-lite',
      metadata: {
        confidence: body.confidence,
        successCount: body.successCount,
        failureCount: body.failureCount,
        applicability: body.applicability,
        promotedAt: new Date().toISOString(),
      },
      title: body.name,
      filePath,
    });

    // 5. Mark document as indexed
    await db
      .update(documents)
      .set({ indexingStatus: 'indexed' })
      .where(eq(documents.id, doc.id));

    return Response.json(
      { documentId: doc.id, version: doc.version, status, filePath },
      { status: status === 'created' ? 201 : 200 },
    );
  },
);
