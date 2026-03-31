/**
 * POST /api/projects/:projectId/coverage
 *
 * Scans documentation coverage: counts docs, embeddings, chunks, and
 * doc_type distribution. Saves a snapshot to analytics.coverage_snapshots.
 * Used by the CoverageCard component.
 */

import { sql } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';

export const POST = createApiHandler(
  { auth: 'required', rateLimit: { rpm: 10 } },
  async (_req, ctx, params) => {
    const projectId = params.projectId;
    if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { getSecureDb } = await import('@/db/connection');
    const db = await getSecureDb(ctx.orgId, ctx.userId);

    const [docStats, chunkStats, typeBreakdown] = await Promise.all([
      // Total docs + docs with embeddings (via chunks that have embeddings)
      db.execute<{ total: number; with_embeddings: number }>(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(DISTINCT c.document_id)::int AS with_embeddings
        FROM docs.documents d
        LEFT JOIN docs.chunks c ON c.document_id = d.id AND c.embedding IS NOT NULL
        WHERE d.project_id = ${projectId}::uuid
      `),

      // Total chunks
      db.execute<{ count: number }>(sql`
        SELECT COUNT(*)::int AS count
        FROM docs.chunks
        WHERE project_id = ${projectId}::uuid
      `),

      // Doc type breakdown
      db.execute<{ doc_type: string | null; count: number }>(sql`
        SELECT COALESCE(doc_type, 'uncategorized') AS doc_type, COUNT(*)::int AS count
        FROM docs.documents
        WHERE project_id = ${projectId}::uuid
        GROUP BY doc_type
        ORDER BY count DESC
      `),
    ]);

    const stats = (docStats.rows as Array<{ total: number; with_embeddings: number }>)[0];
    const totalDocuments = stats?.total ?? 0;
    const docsWithEmbeddings = stats?.with_embeddings ?? 0;
    const totalChunks = (chunkStats.rows as Array<{ count: number }>)[0]?.count ?? 0;

    const coveragePercentage = totalDocuments > 0
      ? Math.round((docsWithEmbeddings / totalDocuments) * 100)
      : 0;

    const breakdown: Record<string, { count: number }> = {};
    let categorizedDocuments = 0;
    for (const row of typeBreakdown.rows as Array<{ doc_type: string; count: number }>) {
      breakdown[row.doc_type] = { count: row.count };
      if (row.doc_type !== 'uncategorized') {
        categorizedDocuments += row.count;
      }
    }

    // Save snapshot (fire-and-forget)
    void db.execute(sql`
      INSERT INTO analytics.coverage_snapshots
        (project_id, total_documents, docs_with_embeddings, total_chunks, breakdown, scan_type)
      VALUES (
        ${projectId}::uuid,
        ${totalDocuments},
        ${docsWithEmbeddings},
        ${totalChunks},
        ${JSON.stringify(breakdown)}::jsonb,
        'manual'
      )
    `).catch(() => {});

    return Response.json({
      coverage: {
        coveragePercentage,
        totalDocuments,
        docsWithEmbeddings,
        totalChunks,
        categorizedDocuments,
        breakdown,
      },
    });
  },
);
