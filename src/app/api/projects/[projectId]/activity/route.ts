/**
 * GET /api/projects/:projectId/activity
 *
 * Returns usage activity summary for the last 7 days.
 * Used by the ActivityCard dashboard component.
 */

import { sql } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';

export const GET = createApiHandler(
  { auth: 'required', rateLimit: { rpm: 30 } },
  async (_req, ctx, params) => {
    const projectId = params.projectId;
    if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { getSecureDb } = await import('@/db/connection');
    const db = await getSecureDb(ctx.orgId, ctx.userId);

    const [countResult, topSearchResult, missResult] = await Promise.all([
      // Event type counts (last 7 days)
      db.execute<{ event_type: string; count: number }>(sql`
        SELECT event_type, COUNT(*)::int AS count
        FROM analytics.activity
        WHERE project_id = ${projectId}::uuid
          AND created_at >= now() - interval '7 days'
        GROUP BY event_type
      `),

      // Top search terms
      db.execute<{ query: string; count: number }>(sql`
        SELECT query, COUNT(*)::int AS count
        FROM analytics.activity
        WHERE project_id = ${projectId}::uuid
          AND event_type = 'search'
          AND query IS NOT NULL
          AND created_at >= now() - interval '7 days'
        GROUP BY query
        ORDER BY count DESC
        LIMIT 5
      `),

      // Miss rate from search logs
      db.execute<{ total: number; misses: number }>(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE result_count = 0)::int AS misses
        FROM search.logs
        WHERE project_id = ${projectId}::uuid
          AND created_at >= now() - interval '7 days'
      `),
    ]);

    const byType: Record<string, number> = {};
    let totalQueries = 0;
    for (const row of countResult.rows as Array<{ event_type: string; count: number }>) {
      byType[row.event_type] = row.count;
      totalQueries += row.count;
    }

    const missRow = (missResult.rows as Array<{ total: number; misses: number }>)[0];
    const missRate = missRow && missRow.total > 0
      ? Math.round((missRow.misses / missRow.total) * 100)
      : 0;

    return Response.json({
      activity: {
        totalQueries,
        searchCount: byType['search'] ?? 0,
        readCount: (byType['read'] ?? 0) + (byType['read_chunks'] ?? 0),
        proposeCount: byType['propose'] ?? 0,
        topSearchTerms: (topSearchResult.rows as Array<{ query: string; count: number }>).map(
          r => ({ query: r.query, count: r.count }),
        ),
        missRate,
      },
    });
  },
);
