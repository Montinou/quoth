/**
 * GET /api/v1/health — Health check endpoint (no auth required).
 */

import { createApiHandler } from '@/lib/api/handler';
import { getDb } from '@/db/connection';
import { sql } from 'drizzle-orm';

export const GET = createApiHandler(
  { auth: 'none' },
  async () => {
    let dbOk = false;
    let dbLatencyMs = -1;

    try {
      const start = Date.now();
      await getDb().execute(sql`SELECT 1`);
      dbLatencyMs = Date.now() - start;
      dbOk = true;
    } catch {
      // DB unreachable — report but don't crash
    }

    const status = dbOk ? 'healthy' : 'degraded';

    return Response.json(
      {
        status,
        version: 'v1',
        timestamp: new Date().toISOString(),
        checks: {
          database: { ok: dbOk, latencyMs: dbLatencyMs },
        },
      },
      { status: dbOk ? 200 : 503 },
    );
  },
);
