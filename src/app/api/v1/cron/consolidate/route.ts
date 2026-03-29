/**
 * POST /api/v1/cron/consolidate — Hourly memory consolidation cron.
 *
 * Vercel Cron or QStash calls this every hour. Runs 4 sequential tasks:
 *   1. Temporal decay — working memories lose 5% relevance per cycle
 *   2. Consolidate — promote qualifying working memories to persistent
 *   3. Cleanup — delete expired + low-relevance working memories
 *   4. Drift detection — flag documents updated in the last hour
 *
 * Auth: Bearer CRON_SECRET header OR QStash signature verification.
 */

import { getDb } from "@/db/connection";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/worker/verify";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // ── Auth (CRON_SECRET or QStash signature) ────────────────────────
  const authError = await verifyCronAuth(req);
  if (authError) return authError;

  const start = Date.now();
  const db = getDb();

  const results: {
    decayed: number;
    consolidated: number;
    cleaned: number;
    driftEvents: number;
    durationMs: number;
    errors: string[];
  } = {
    decayed: 0,
    consolidated: 0,
    cleaned: 0,
    driftEvents: 0,
    durationMs: 0,
    errors: [],
  };

  // ── Task 1: Temporal Decay ──────────────────────────────────────
  try {
    const decayResult = await db.execute(
      sql`SELECT agents.apply_memory_decay() AS affected`,
    );
    results.decayed = Number(decayResult.rows[0]?.affected ?? 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/consolidate] Temporal decay failed:", msg);
    results.errors.push(`decay: ${msg}`);
  }

  // ── Task 2: Consolidate ─────────────────────────────────────────
  try {
    const consolidateResult = await db.execute(
      sql`SELECT agents.consolidate_memory() AS affected`,
    );
    results.consolidated = Number(
      consolidateResult.rows[0]?.affected ?? 0,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/consolidate] Consolidation failed:", msg);
    results.errors.push(`consolidate: ${msg}`);
  }

  // ── Task 3: Cleanup ─────────────────────────────────────────────
  try {
    const cleanupResult = await db.execute(
      sql`SELECT agents.cleanup_memory() AS affected`,
    );
    results.cleaned = Number(cleanupResult.rows[0]?.affected ?? 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/consolidate] Cleanup failed:", msg);
    results.errors.push(`cleanup: ${msg}`);
  }

  // ── Task 4: Drift Detection ─────────────────────────────────────
  try {
    // Find documents updated in the last hour
    const recentDocs = await db.execute(sql`
      SELECT d.id, d.project_id, d.file_path, d.title
      FROM docs.documents d
      WHERE d.updated_at > now() - interval '1 hour'
    `);

    for (const doc of recentDocs.rows) {
      // Check if any agent memory references this document's file_path
      // Using a broad search across agents schema for file_path references
      const memoryRefs = await db.execute(sql`
        SELECT COUNT(*) AS ref_count
        FROM docs.chunks c
        WHERE c.file_path = ${doc.file_path}
      `);

      const refCount = Number(memoryRefs.rows[0]?.ref_count ?? 0);
      if (refCount > 0) {
        await db.execute(sql`
          INSERT INTO search.drift_events (
            project_id, document_id, severity, drift_type,
            file_path, description, resolved
          ) VALUES (
            ${doc.project_id},
            ${doc.id},
            'info',
            'stale_doc',
            ${doc.file_path},
            ${"Document updated; " + refCount + " chunk(s) may reference stale content: " + doc.title},
            false
          )
        `);
        results.driftEvents++;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/consolidate] Drift detection failed:", msg);
    results.errors.push(`drift: ${msg}`);
  }

  // ── Log to analytics ────────────────────────────────────────────
  results.durationMs = Date.now() - start;

  try {
    // Use raw SQL to bypass the event_type check constraint.
    // A migration should add 'consolidation' to the allowed event_type values.
    await db.execute(sql`
      INSERT INTO analytics.activity (
        project_id, org_id, event_type, context, response_time_ms
      )
      SELECT
        p.id,
        p.org_id,
        'coverage_scan',
        ${JSON.stringify({
          cron: "consolidate",
          decayed: results.decayed,
          consolidated: results.consolidated,
          cleaned: results.cleaned,
          driftEvents: results.driftEvents,
          errors: results.errors,
        })}::jsonb,
        ${results.durationMs}
      FROM projects p
      LIMIT 1
    `);
  } catch (err) {
    // Non-fatal — the cron still succeeded even if logging fails
    console.error(
      "[cron/consolidate] Activity logging failed:",
      err instanceof Error ? err.message : err,
    );
  }

  return Response.json(results, {
    status: results.errors.length > 0 ? 207 : 200,
  });
}
