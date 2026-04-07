/**
 * GET/POST /api/v1/patterns/shared
 * Cross-org pattern sharing endpoint. Enables opt-in anonymous pattern
 * exchange between organizations -- patterns that proved valuable in one
 * org can be discovered by others.
 *
 * GET:  Public read (auth optional). Returns anonymized shared patterns.
 * POST: Agent-only (auth required). Share a high-confidence broad pattern.
 */

import { z } from 'zod';
import { eq, and, sql, desc, gte, like } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';
import { getDb } from '@/db/connection';
import { getSecureDb } from '@/db/connection';
import { documents, chunks, projects } from '@/db/schema';
import { generateEmbedding } from '@/lib/embeddings/gateway';
import { forbidden, badRequest } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHARED_PATH_PREFIX = 'shared/patterns/';
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const DEFAULT_MIN_CONFIDENCE = 0.8;

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const sharePatternBody = z.object({
  pattern_id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  condition: z.string().min(1).max(500),
  action: z.string().min(1).max(1000),
  confidence: z.number().min(0.8).max(1.0),
  tags: z.array(z.string().max(64)).max(20).default([]),
  applicability: z.enum(['broad', 'narrow']),
});

const sharedQueryParams = z.object({
  tags: z.string().optional(),
  min_confidence: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  since: z.coerce.number().int().optional(),
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

function buildPatternContent(body: z.infer<typeof sharePatternBody>): string {
  return [
    `# ${body.name}`,
    '',
    `**Condition:** ${body.condition}`,
    '',
    `**Action:** ${body.action}`,
    '',
    `**Confidence:** ${body.confidence.toFixed(2)}`,
    `**Applicability:** ${body.applicability}`,
    `**Tags:** ${body.tags.join(', ') || 'none'}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// GET /api/v1/patterns/shared
// ---------------------------------------------------------------------------

export const GET = createApiHandler(
  {
    auth: 'optional',
    rateLimit: { rpm: 30 },
    validate: { query: sharedQueryParams },
  },
  async (req) => {
    const query = req.validatedQuery as z.infer<typeof sharedQueryParams>;
    const minConfidence = query.min_confidence ?? DEFAULT_MIN_CONFIDENCE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const tagFilter = query.tags
      ? query.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : null;

    const db = getDb();

    // Query documents with visibility='shared' and filePath prefix
    // Join chunks for metadata (confidence, use_count)
    const conditions = [
      eq(documents.visibility, 'shared'),
      eq(documents.docType, 'patterns'),
      like(documents.filePath, `${SHARED_PATH_PREFIX}%`),
    ];

    if (query.since) {
      const sinceDate = new Date(query.since * 1000);
      conditions.push(gte(documents.updatedAt, sinceDate));
    }

    const rows = await db
      .select({
        docId: documents.id,
        filePath: documents.filePath,
        title: documents.title,
        content: documents.content,
        tags: documents.tags,
        updatedAt: documents.updatedAt,
        chunkMetadata: chunks.metadata,
      })
      .from(documents)
      .leftJoin(chunks, eq(chunks.documentId, documents.id))
      .where(and(...conditions))
      .orderBy(desc(documents.updatedAt))
      .limit(limit * 2); // Over-fetch to account for post-filters

    // Post-filter and shape response
    interface SharedPattern {
      id: string;
      name: string;
      action: string;
      confidence: number;
      tags: string[];
      applicability: 'broad' | 'narrow';
      shared_at: string;
      use_count: number;
    }

    const seen = new Set<string>();
    const patterns: SharedPattern[] = [];

    for (const row of rows) {
      // Deduplicate by document (may have multiple chunks)
      if (seen.has(row.docId)) continue;
      seen.add(row.docId);

      const meta = (row.chunkMetadata ?? {}) as Record<string, unknown>;
      const confidence = typeof meta.confidence === 'number' ? meta.confidence : 0;
      const applicability = meta.applicability === 'narrow' ? 'narrow' : 'broad';
      const useCount = typeof meta.use_count === 'number' ? meta.use_count : 0;

      // Filter by confidence threshold
      if (confidence < minConfidence) continue;

      // Filter by tags if specified
      const docTags = row.tags ?? [];
      if (tagFilter && tagFilter.length > 0) {
        const hasMatch = tagFilter.some((t) => docTags.includes(t));
        if (!hasMatch) continue;
      }

      // Extract pattern_id from filePath
      const patternId = row.filePath.replace(SHARED_PATH_PREFIX, '');

      // Extract action from content (between **Action:** and next **)
      const actionMatch = row.content.match(/\*\*Action:\*\*\s*(.+?)(?:\n|$)/);
      const action = actionMatch?.[1]?.trim() ?? row.content.slice(0, 200);

      patterns.push({
        id: patternId,
        name: row.title,
        action,
        confidence,
        tags: docTags,
        applicability,
        shared_at: row.updatedAt?.toISOString() ?? new Date().toISOString(),
        use_count: useCount,
      });

      if (patterns.length >= limit) break;
    }

    // Sort by confidence DESC, then shared_at DESC
    patterns.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.shared_at.localeCompare(a.shared_at);
    });

    return Response.json({
      patterns,
      total: patterns.length,
    });
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/patterns/shared
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 10 },
    validate: { body: sharePatternBody },
  },
  async (req, ctx) => {
    // Agents only
    if (!ctx!.isAgent) {
      throw forbidden('Sharing patterns is only available to agent API keys.');
    }

    const body = req.validatedBody as z.infer<typeof sharePatternBody>;

    // Only broad patterns can be shared cross-org
    if (body.applicability !== 'broad') {
      throw badRequest(
        'Only broadly applicable patterns can be shared cross-org. Set applicability to "broad".',
      );
    }

    const db = await getSecureDb(ctx!.orgId, ctx!.userId);

    // Resolve a project to store the shared pattern under.
    // Use the caller's project, or fall back to first project in org.
    let projectId = ctx!.projectId;
    if (!projectId || projectId === '') {
      const [first] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.orgId, ctx!.orgId))
        .limit(1);
      if (first) projectId = first.id;

      if (!projectId || projectId === '') {
        throw forbidden('No project found in organization.');
      }
    }

    const filePath = `${SHARED_PATH_PREFIX}${body.pattern_id}`;
    const content = buildPatternContent(body);
    const hash = await sha256(content);

    // Check for existing shared pattern with same filePath in this project
    const [existing] = await db
      .select({
        id: documents.id,
        version: documents.version,
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

    // Content unchanged -- skip
    if (existing && existing.checksum === hash) {
      return Response.json({
        shared_id: body.pattern_id,
        status: 'duplicate' as const,
      });
    }

    // Upsert document
    const [doc] = await db
      .insert(documents)
      .values({
        projectId,
        orgId: ctx!.orgId,
        filePath,
        title: body.name,
        content,
        checksum: hash,
        docType: 'patterns',
        visibility: 'shared',
        tags: body.tags,
        agentId: ctx!.agentId ?? null,
        indexingStatus: 'indexing',
        version: 1,
      })
      .onConflictDoUpdate({
        target: [documents.projectId, documents.filePath],
        set: {
          title: body.name,
          content,
          checksum: hash,
          visibility: 'shared',
          tags: body.tags,
          indexingStatus: 'indexing',
          version: sql`${documents.version} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning();

    const isUpdate = (doc.version ?? 1) > 1;

    // Replace chunks -- delete old, insert new with embedding
    await db.delete(chunks).where(eq(chunks.documentId, doc.id));

    let embedding: number[] | null = null;
    try {
      embedding = await generateEmbedding(body.action);
    } catch {
      // Non-fatal -- chunk still created, falls back to FTS-only search
    }

    const chunkHash = await sha256(content);
    await db.insert(chunks).values({
      documentId: doc.id,
      projectId,
      content,
      chunkHash,
      chunkIndex: 0,
      embedding,
      embeddingModel: 'voyage/voyage-4-lite',
      metadata: {
        confidence: body.confidence,
        applicability: body.applicability,
        condition: body.condition,
        use_count: 0,
        shared_at: new Date().toISOString(),
      },
      title: body.name,
      filePath,
    });

    // Mark document as indexed
    await db
      .update(documents)
      .set({ indexingStatus: 'indexed' })
      .where(eq(documents.id, doc.id));

    return Response.json(
      {
        shared_id: body.pattern_id,
        status: isUpdate ? ('updated' as const) : ('created' as const),
      },
      { status: isUpdate ? 200 : 201 },
    );
  },
);
