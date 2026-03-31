/**
 * GET  /api/projects/:projectId/drift — List drift events with summary
 * POST /api/projects/:projectId/drift — Resolve a drift event
 *
 * Query params (GET): includeResolved (boolean, default false)
 * Body (POST): { action: 'resolve', driftId: string }
 *
 * Used by the DriftTimeline component.
 */

import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';

export const GET = createApiHandler(
  { auth: 'required', rateLimit: { rpm: 30 } },
  async (req, ctx, params) => {
    const projectId = params.projectId;
    if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(req.url);
    const includeResolved = url.searchParams.get('includeResolved') === 'true';

    const { getSecureDb } = await import('@/db/connection');
    const db = await getSecureDb(ctx.orgId, ctx.userId);

    const resolvedFilter = includeResolved
      ? sql`true`
      : sql`resolved = false`;

    const [eventsResult, summaryResult] = await Promise.all([
      db.execute(sql`
        SELECT
          id, project_id, document_id, severity, drift_type,
          file_path, doc_path, description, expected_pattern,
          actual_code, resolved, resolved_at::text, detected_at::text
        FROM search.drift_events
        WHERE project_id = ${projectId}::uuid AND ${resolvedFilter}
        ORDER BY
          CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
          detected_at DESC
        LIMIT 50
      `),

      db.execute<{ total: number; critical: number; warning: number; info: number; unresolved: number }>(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE severity = 'critical')::int AS critical,
          COUNT(*) FILTER (WHERE severity = 'warning')::int AS warning,
          COUNT(*) FILTER (WHERE severity = 'info')::int AS info,
          COUNT(*) FILTER (WHERE resolved = false)::int AS unresolved
        FROM search.drift_events
        WHERE project_id = ${projectId}::uuid
      `),
    ]);

    const timeline = (eventsResult.rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id,
      projectId: r.project_id,
      documentId: r.document_id ?? undefined,
      severity: r.severity,
      driftType: r.drift_type,
      filePath: r.file_path,
      docPath: r.doc_path ?? undefined,
      description: r.description,
      expectedPattern: r.expected_pattern ?? undefined,
      actualCode: r.actual_code ?? undefined,
      resolved: r.resolved,
      resolvedAt: r.resolved_at ?? undefined,
      detectedAt: r.detected_at,
    }));

    const sumRow = (summaryResult.rows as Array<{ total: number; critical: number; warning: number; info: number; unresolved: number }>)[0];

    return Response.json({
      timeline,
      summary: sumRow ? {
        total: sumRow.total,
        critical: sumRow.critical,
        warning: sumRow.warning,
        info: sumRow.info,
        unresolvedCount: sumRow.unresolved,
      } : null,
    });
  },
);

const ResolveBody = z.object({
  action: z.literal('resolve'),
  driftId: z.string().uuid(),
});

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 20 },
    validate: { body: ResolveBody },
  },
  async (req, ctx, params) => {
    const projectId = params.projectId;
    if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { driftId } = req.validatedBody as z.infer<typeof ResolveBody>;

    const { getSecureDb } = await import('@/db/connection');
    const db = await getSecureDb(ctx.orgId, ctx.userId);

    const result = await db.execute(sql`
      UPDATE search.drift_events
      SET resolved = true,
          resolved_at = now(),
          resolved_by = ${ctx.userId}::uuid
      WHERE id = ${driftId}::uuid
        AND project_id = ${projectId}::uuid
        AND resolved = false
    `);

    const rowCount = (result as unknown as { rowCount?: number }).rowCount ?? 0;

    if (rowCount === 0) {
      return Response.json({ error: 'Drift event not found or already resolved' }, { status: 404 });
    }

    return Response.json({ ok: true });
  },
);
