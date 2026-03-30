/**
 * /api/v1/documents
 *   GET  — List documents in the caller's project.
 *   POST — Create or sync a document.
 */

import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';
import { getDb } from '@/db/connection';
import { documents } from '@/db/schema';
import { forbidden } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listDocsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  docType: z
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
    .optional(),
  indexingStatus: z
    .enum(['pending', 'indexing', 'indexed', 'failed'])
    .optional(),
});

const createDocBody = z.object({
  filePath: z.string().min(1).max(512),
  title: z.string().min(1).max(256),
  content: z.string().min(1),
  docType: z
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
    .optional(),
  visibility: z.enum(['project', 'shared', 'public']).optional().default('project'),
  tags: z.array(z.string().max(64)).max(20).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 checksum for content deduplication.
 */
async function checksum(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// GET /api/v1/documents
// ---------------------------------------------------------------------------

export const GET = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 120 },
    validate: { query: listDocsQuery },
  },
  async (req, ctx) => {
    const db = getDb();
    const { limit, offset, docType, indexingStatus } = req.validatedQuery as z.infer<
      typeof listDocsQuery
    >;

    // Build where conditions dynamically
    const conditions = [eq(documents.projectId, ctx!.projectId)];
    if (docType) conditions.push(eq(documents.docType, docType));
    if (indexingStatus) conditions.push(eq(documents.indexingStatus, indexingStatus));

    const rows = await db
      .select({
        id: documents.id,
        filePath: documents.filePath,
        title: documents.title,
        docType: documents.docType,
        visibility: documents.visibility,
        tags: documents.tags,
        indexingStatus: documents.indexingStatus,
        version: documents.version,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);

    return Response.json({ data: rows, limit, offset });
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/documents
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 30 },
    validate: { body: createDocBody },
  },
  async (req, ctx) => {
    if (ctx!.role === 'viewer') {
      throw forbidden('Viewers cannot create documents.');
    }

    const db = getDb();
    const body = req.validatedBody as z.infer<typeof createDocBody>;
    const hash = await checksum(body.content);

    // Upsert: if a document with the same project + filePath exists, update it
    const [doc] = await db
      .insert(documents)
      .values({
        projectId: ctx!.projectId,
        orgId: ctx!.orgId,
        filePath: body.filePath,
        title: body.title,
        content: body.content,
        checksum: hash,
        docType: body.docType,
        visibility: body.visibility,
        tags: body.tags,
        agentId: ctx!.isAgent ? ctx!.agentId : null,
        indexingStatus: 'pending',
      })
      .onConflictDoUpdate({
        target: [documents.projectId, documents.filePath],
        set: {
          title: body.title,
          content: body.content,
          checksum: hash,
          docType: body.docType,
          visibility: body.visibility,
          tags: body.tags,
          indexingStatus: 'pending',
          version: sql`${documents.version} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning();

    const isUpdate = (doc.version ?? 1) > 1;

    return Response.json(
      { data: doc },
      { status: isUpdate ? 200 : 201 },
    );
  },
);
