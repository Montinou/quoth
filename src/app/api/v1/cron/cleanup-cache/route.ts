/**
 * POST /api/v1/cron/cleanup-cache — Daily cache and old generation cleanup.
 *
 * QStash calls this at 03:00 UTC daily.
 *   1. Delete expired entries from search.query_cache
 *   2. Delete old completed generations (> 30 days)
 *
 * Auth: QStash signature verification (Upstash-Signature header).
 */

import { getDb } from "@/db/connection";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/worker/verify";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // ── Auth (CRON_SECRET or QStash signature) ────────────────────────
  const authError = await verifyCronAuth(req);
  if (authError) return authError;

  const start = Date.now();
  const db = getDb();

  const results: {
    cacheDeleted: number;
    generationsDeleted: number;
    errors: string[];
  } = {
    cacheDeleted: 0,
    generationsDeleted: 0,
    errors: [],
  };

  // ── Task 1: Delete expired query cache entries ──────────────────
  try {
    const cacheResult = await db.execute(sql`
      DELETE FROM search.query_cache
      WHERE expires_at < now()
    `);
    results.cacheDeleted = Number(cacheResult.rowCount ?? 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/cleanup-cache] Cache cleanup failed:", msg);
    results.errors.push(`cache: ${msg}`);
  }

  // ── Task 2: Delete old completed generations (> 30 days) ────────
  try {
    const genResult = await db.execute(sql`
      DELETE FROM analytics.generations
      WHERE status = 'complete'
        AND created_at < now() - interval '30 days'
    `);
    results.generationsDeleted = Number(genResult.rowCount ?? 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/cleanup-cache] Generation cleanup failed:", msg);
    results.errors.push(`generations: ${msg}`);
  }

  // ── Log to analytics ────────────────────────────────────────────
  const durationMs = Date.now() - start;

  try {
    await db.execute(sql`
      INSERT INTO analytics.activity (
        project_id, org_id, event_type, context, response_time_ms
      )
      SELECT
        p.id,
        p.org_id,
        'cache_cleanup',
        ${JSON.stringify({
          cron: "cleanup-cache",
          cacheDeleted: results.cacheDeleted,
          generationsDeleted: results.generationsDeleted,
          errors: results.errors,
        })}::jsonb,
        ${durationMs}
      FROM projects p
      LIMIT 1
    `);
  } catch (err) {
    console.error(
      "[cron/cleanup-cache] Activity logging failed:",
      err instanceof Error ? err.message : err,
    );
  }

  return Response.json(results, {
    status: results.errors.length > 0 ? 207 : 200,
  });
}
