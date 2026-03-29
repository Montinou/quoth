/**
 * QStash Schedule Management
 *
 * Creates/removes QStash schedules as an alternative to Vercel Cron (Pro plan).
 * QStash calls our existing cron route handlers on a schedule.
 *
 * Env vars:
 *   QSTASH_TOKEN — from Upstash QStash dashboard
 */

import { Client } from "@upstash/qstash";

// Schedule IDs stored for removal
const SCHEDULE_PREFIX = "quoth";
const CONSOLIDATION_SCHEDULE_ID = `${SCHEDULE_PREFIX}_consolidate`;
const CLEANUP_SCHEDULE_ID = `${SCHEDULE_PREFIX}_cleanup_cache`;

function getClient(): Client {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error("QSTASH_TOKEN env var is not configured");
  }
  return new Client({ token });
}

export interface ScheduleResult {
  consolidation: { scheduleId: string };
  cleanup: { scheduleId: string };
}

/**
 * Create or update QStash schedules for both cron jobs.
 *
 * @param baseUrl - The app's public base URL (e.g. https://quoth.example.com)
 * @returns Created schedule IDs
 */
export async function setupQstashSchedules(
  baseUrl: string,
): Promise<ScheduleResult> {
  const client = getClient();
  const cronSecret = process.env.CRON_SECRET;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cronSecret) {
    headers["Authorization"] = `Bearer ${cronSecret}`;
  }

  // Remove existing schedules first (ignore errors if they don't exist)
  await removeQstashSchedules().catch(() => {});

  // Schedule 1: Consolidation — every hour
  const consolidation = await client.schedules.create({
    destination: `${baseUrl}/api/v1/cron/consolidate`,
    cron: "0 * * * *",
    headers,
    retries: 2,
  });

  // Schedule 2: Cache cleanup — daily at 3:00 UTC
  const cleanup = await client.schedules.create({
    destination: `${baseUrl}/api/v1/cron/cleanup-cache`,
    cron: "0 3 * * *",
    headers,
    retries: 2,
  });

  return {
    consolidation: { scheduleId: consolidation.scheduleId },
    cleanup: { scheduleId: cleanup.scheduleId },
  };
}

/**
 * Remove all QStash schedules created by this app.
 */
export async function removeQstashSchedules(): Promise<void> {
  const client = getClient();
  const schedules = await client.schedules.list();

  // Find and remove schedules that target our cron endpoints
  for (const schedule of schedules) {
    const dest = schedule.destination;
    if (
      typeof dest === "string" &&
      (dest.includes("/api/v1/cron/consolidate") ||
        dest.includes("/api/v1/cron/cleanup-cache"))
    ) {
      await client.schedules.delete(schedule.scheduleId);
    }
  }
}
