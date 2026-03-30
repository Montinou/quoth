/**
 * POST /api/v1/cron/webhook-retry — Retry failed webhook deliveries.
 *
 * Runs every 5 minutes via QStash. Picks up deliveries
 * with status='retrying' whose next_retry_at has passed, and re-delivers
 * them via deliverWebhook().
 *
 * Auth: QStash signature verification (Upstash-Signature header).
 */

import { getDb } from "@/db/connection";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/worker/verify";
import { deliverWebhook } from "@/lib/comms/webhooks";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // -- Auth (CRON_SECRET or QStash signature) --------------------------------
  const authError = await verifyCronAuth(req);
  if (authError) return authError;

  const start = Date.now();
  const db = getDb();

  // -- Fetch retryable deliveries --------------------------------------------
  const pending = await db.execute(sql`
    SELECT
      d.id,
      d.subscription_id,
      d.message_id,
      d.request_body,
      d.attempt
    FROM comms.webhook_deliveries d
    WHERE d.status = 'retrying'
      AND d.next_retry_at <= now()
    ORDER BY d.next_retry_at ASC
    LIMIT 20
  `);

  let retriedCount = 0;
  let successCount = 0;
  let failedCount = 0;

  // -- Iterate and deliver ---------------------------------------------------
  for (const row of pending.rows) {
    retriedCount++;

    try {
      const body = row.request_body as Record<string, unknown>;
      const event = (body.event as string) ?? "unknown";

      const result = await deliverWebhook(
        row.subscription_id as string,
        event,
        body,
        (row.message_id as string) ?? undefined,
      );

      if (result.status === "success") {
        successCount++;
      } else {
        failedCount++;
      }
    } catch (err) {
      failedCount++;
      console.error(
        "[cron/webhook-retry] Delivery failed for",
        row.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // -- Log to analytics ------------------------------------------------------
  const durationMs = Date.now() - start;

  try {
    await db.execute(sql`
      INSERT INTO analytics.activity (
        project_id, org_id, event_type, context, response_time_ms
      )
      SELECT
        p.id,
        p.org_id,
        'webhook_retry',
        ${JSON.stringify({
          cron: "webhook-retry",
          retriedCount,
          successCount,
          failedCount,
        })}::jsonb,
        ${durationMs}
      FROM (SELECT NULL::uuid AS id, NULL::uuid AS org_id) AS p
    `);
  } catch (err) {
    // Non-fatal -- cron still succeeded even if logging fails
    console.error(
      "[cron/webhook-retry] Activity logging failed:",
      err instanceof Error ? err.message : err,
    );
  }

  return Response.json(
    { retriedCount, successCount, failedCount, durationMs },
    { status: 200 },
  );
}
