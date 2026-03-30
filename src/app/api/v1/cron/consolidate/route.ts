/**
 * POST /api/v1/cron/consolidate — Hourly memory consolidation cron.
 *
 * QStash calls this every hour. Runs 4 sequential tasks:
 *   1. Temporal decay — working memories lose 5% relevance per cycle
 *   2. Consolidate — promote qualifying working memories to persistent
 *   3. Cleanup — delete expired + low-relevance working memories
 *   4. Drift detection — flag documents updated in the last hour
 *
 * Auth: QStash signature verification (Upstash-Signature header).
 */

import { getDb } from "@/db/connection";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/worker/verify";
import { autoFailOverdueTasks } from "@/lib/comms/tasks";

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
    overdueFailed: number;
    durationMs: number;
    errors: string[];
  } = {
    decayed: 0,
    consolidated: 0,
    cleaned: 0,
    driftEvents: 0,
    overdueFailed: 0,
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
    // Batch query: find recently updated docs that have chunks referencing them
    const driftCandidates = await db.execute(sql`
      SELECT d.id, d.project_id, d.file_path, d.title,
             COUNT(c.id)::int as ref_count
      FROM docs.documents d
      LEFT JOIN docs.chunks c ON c.file_path = d.file_path AND c.project_id = d.project_id
      WHERE d.updated_at > now() - interval '1 hour'
      GROUP BY d.id, d.project_id, d.file_path, d.title
      HAVING COUNT(c.id) > 0
    `);

    for (const doc of driftCandidates.rows) {
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
          ${"Document updated; " + doc.ref_count + " chunk(s) may reference stale content: " + doc.title},
          false
        )
      `);
      results.driftEvents++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/consolidate] Drift detection failed:", msg);
    results.errors.push(`drift: ${msg}`);
  }

  // ── Task 5: Auto-fail overdue tasks ────────────────────────────
  try {
    results.overdueFailed = await autoFailOverdueTasks();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/consolidate] Auto-fail overdue tasks failed:", msg);
    results.errors.push(`overdueFailed: ${msg}`);
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
        'consolidation',
        ${JSON.stringify({
          cron: "consolidate",
          decayed: results.decayed,
          consolidated: results.consolidated,
          cleaned: results.cleaned,
          driftEvents: results.driftEvents,
          overdueFailed: results.overdueFailed,
          errors: results.errors,
        })}::jsonb,
        ${results.durationMs}
      FROM (SELECT NULL::uuid AS id, NULL::uuid AS org_id) AS p
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
