/**
 * GET /api/analytics/usage
 *
 * Returns MCP usage statistics for a project over a given period.
 * Query params: project_id (required), period (7d|30d|90d, default 7d)
 */

import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';

const QuerySchema = z.object({
  project_id: z.string().uuid(),
  period: z.enum(['7d', '30d', '90d']).default('7d'),
});

export const GET = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 30 },
    validate: { query: QuerySchema },
  },
  async (req, ctx) => {
    const { project_id, period } = req.validatedQuery as z.infer<typeof QuerySchema>;

    // Verify user has access to this project via RLS context
    if (!ctx) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const days = period === '90d' ? 90 : period === '30d' ? 30 : 7;

    // Import getSecureDb to use RLS
    const { getSecureDb } = await import('@/db/connection');
    const db = await getSecureDb(ctx.orgId, ctx.userId);

    // Run all queries in parallel
    const [totalsResult, byEventResult, perDayResult, topSearchesResult, avgResultsResult] =
      await Promise.all([
        // Total queries
        db.execute<{ count: number }>(sql`
          SELECT COUNT(*)::int AS count
          FROM analytics.activity
          WHERE project_id = ${project_id}::uuid
            AND created_at >= now() - ${days} * interval '1 day'
        `),

        // Queries by event type
        db.execute<{ event_type: string; count: number }>(sql`
          SELECT event_type, COUNT(*)::int AS count
          FROM analytics.activity
          WHERE project_id = ${project_id}::uuid
            AND created_at >= now() - ${days} * interval '1 day'
          GROUP BY event_type
          ORDER BY count DESC
        `),

        // Queries per day
        db.execute<{ day: string; count: number }>(sql`
          SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
          FROM analytics.activity
          WHERE project_id = ${project_id}::uuid
            AND created_at >= now() - ${days} * interval '1 day'
          GROUP BY day
          ORDER BY day
        `),

        // Top search queries
        db.execute<{ query: string; count: number }>(sql`
          SELECT query, COUNT(*)::int AS count
          FROM analytics.activity
          WHERE project_id = ${project_id}::uuid
            AND event_type = 'search'
            AND query IS NOT NULL
            AND created_at >= now() - ${days} * interval '1 day'
          GROUP BY query
          ORDER BY count DESC
          LIMIT 10
        `),

        // Average results per search
        db.execute<{ avg: number }>(sql`
          SELECT COALESCE(AVG(result_count), 0)::int AS avg
          FROM analytics.activity
          WHERE project_id = ${project_id}::uuid
            AND event_type = 'search'
            AND result_count IS NOT NULL
            AND created_at >= now() - ${days} * interval '1 day'
        `),
      ]);

    const totalQueries = (totalsResult.rows[0] as { count: number } | undefined)?.count ?? 0;

    const byEventType: Record<string, number> = {};
    for (const row of byEventResult.rows as Array<{ event_type: string; count: number }>) {
      byEventType[row.event_type] = row.count;
    }

    const queriesPerDay: Record<string, number> = {};
    for (const row of perDayResult.rows as Array<{ day: string; count: number }>) {
      queriesPerDay[row.day] = row.count;
    }

    const topSearches = (topSearchesResult.rows as Array<{ query: string; count: number }>).map(
      (r) => ({ query: r.query, count: r.count }),
    );

    const avgResultsPerSearch = (avgResultsResult.rows[0] as { avg: number } | undefined)?.avg ?? 0;

    return Response.json({
      totalQueries,
      byEventType,
      queriesPerDay,
      topSearches,
      avgResultsPerSearch,
    });
  },
);
