/**
 * GET /api/analytics/miss-rate
 *
 * Returns search miss rate trends and top missed queries.
 * Query params: project_id (required), period (7d|30d|90d, default 7d)
 * Used by the MissRateChart component.
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
    if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const days = period === '90d' ? 90 : period === '30d' ? 30 : 7;

    const { getSecureDb } = await import('@/db/connection');
    const db = await getSecureDb(ctx.orgId, ctx.userId);

    const [dailyResult, topMissedResult] = await Promise.all([
      // Daily miss rates
      db.execute<{ day: string; total: number; misses: number }>(sql`
        SELECT
          to_char(created_at, 'YYYY-MM-DD') AS day,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE result_count = 0)::int AS misses
        FROM search.logs
        WHERE project_id = ${project_id}::uuid
          AND created_at >= now() - ${days} * interval '1 day'
        GROUP BY day
        ORDER BY day
      `),

      // Top missed queries
      db.execute<{ query: string; miss_count: number; last_missed: string }>(sql`
        SELECT
          query,
          COUNT(*)::int AS miss_count,
          MAX(created_at)::text AS last_missed
        FROM search.logs
        WHERE project_id = ${project_id}::uuid
          AND result_count = 0
          AND created_at >= now() - ${days} * interval '1 day'
        GROUP BY query
        ORDER BY miss_count DESC
        LIMIT 5
      `),
    ]);

    const dailyRows = dailyResult.rows as Array<{ day: string; total: number; misses: number }>;

    const dailyMissRates = dailyRows.map((r) => ({
      date: r.day,
      missRate: r.total > 0 ? Math.round((r.misses / r.total) * 100) : 0,
      searchCount: r.total,
    }));

    // Calculate overall average and trend
    const totalSearches = dailyRows.reduce((s, r) => s + r.total, 0);
    const totalMisses = dailyRows.reduce((s, r) => s + r.misses, 0);
    const averageMissRate = totalSearches > 0 ? Math.round((totalMisses / totalSearches) * 100) : 0;

    // Trend: compare first half vs second half
    let trend: 'improving' | 'stable' | 'degrading' = 'stable';
    if (dailyMissRates.length >= 4) {
      const mid = Math.floor(dailyMissRates.length / 2);
      const firstHalf = dailyMissRates.slice(0, mid);
      const secondHalf = dailyMissRates.slice(mid);
      const avgFirst = firstHalf.reduce((s, r) => s + r.missRate, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((s, r) => s + r.missRate, 0) / secondHalf.length;
      if (avgSecond < avgFirst - 5) trend = 'improving';
      else if (avgSecond > avgFirst + 5) trend = 'degrading';
    }

    const topMissed = (topMissedResult.rows as Array<{ query: string; miss_count: number; last_missed: string }>).map(
      (r) => ({ query: r.query, missCount: r.miss_count, lastMissed: r.last_missed }),
    );

    return Response.json({
      trends: { dailyMissRates, averageMissRate, trend },
      topMissed,
    });
  },
);
