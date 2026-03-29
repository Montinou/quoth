/**
 * Self-triggering consolidation for free-tier deployments.
 *
 * Instead of relying on Vercel Cron or QStash, this module checks a Redis
 * timestamp and runs consolidation directly if >1 hour has elapsed.
 *
 * Usage: call `maybeRunConsolidation()` as a fire-and-forget side-effect
 * in the search pipeline.
 */

import { Redis } from "@upstash/redis";
import { getDb } from "@/db/connection";
import { sql } from "drizzle-orm";

const LAST_CONSOLIDATION_KEY = "quoth:last_consolidation";
const CONSOLIDATION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

/**
 * Run consolidation if more than 1 hour has passed since the last run.
 *
 * This is designed to be called fire-and-forget — it does not throw.
 * It uses a Redis timestamp to coordinate across serverless instances.
 */
export async function maybeRunConsolidation(): Promise<void> {
  try {
    const client = getRedis();
    if (!client) return;

    const lastRun = await client.get<number>(LAST_CONSOLIDATION_KEY);
    const now = Date.now();

    if (lastRun && now - lastRun < CONSOLIDATION_INTERVAL_MS) {
      return; // Too soon, skip
    }

    // Attempt to claim the run via atomic SET NX with a short TTL.
    // This prevents multiple concurrent instances from running consolidation.
    const lockKey = "quoth:consolidation_lock";
    const acquired = await client.set(lockKey, "1", { nx: true, ex: 120 });
    if (!acquired) return; // Another instance is already running

    console.log("[worker/trigger] Starting self-triggered consolidation");
    const db = getDb();

    // Run the same 3 core tasks as the cron route
    try {
      await db.execute(sql`SELECT agents.apply_memory_decay() AS affected`);
    } catch (err) {
      console.error("[worker/trigger] Temporal decay failed:", err);
    }

    try {
      await db.execute(sql`SELECT agents.consolidate_memory() AS affected`);
    } catch (err) {
      console.error("[worker/trigger] Consolidation failed:", err);
    }

    try {
      await db.execute(sql`SELECT agents.cleanup_memory() AS affected`);
    } catch (err) {
      console.error("[worker/trigger] Cleanup failed:", err);
    }

    // Update the timestamp after success
    await client.set(LAST_CONSOLIDATION_KEY, now);
    await client.del(lockKey);

    console.log("[worker/trigger] Self-triggered consolidation complete");
  } catch (err) {
    // Fire-and-forget: never let this crash the caller
    console.error("[worker/trigger] maybeRunConsolidation error:", err);
  }
}
