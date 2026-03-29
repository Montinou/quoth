/**
 * POST /api/v1/admin/setup-schedules — One-time QStash schedule setup.
 *
 * Creates QStash schedules that replace Vercel Cron (which requires Pro plan).
 * Call this once after deployment with the app's base URL.
 *
 * Auth: Bearer CRON_SECRET header (same as cron routes).
 *
 * Body: { "baseUrl": "https://quoth.example.com" }
 *
 * DELETE — Remove all QStash schedules.
 */

import { NextRequest } from "next/server";
import {
  setupQstashSchedules,
  removeQstashSchedules,
} from "@/lib/worker/qstash";

export const runtime = "nodejs";

function authorize(req: NextRequest): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const authError = authorize(req);
  if (authError) return authError;

  let body: { baseUrl?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const baseUrl = body.baseUrl?.replace(/\/+$/, "");
  if (!baseUrl) {
    return Response.json(
      { error: "baseUrl is required" },
      { status: 400 },
    );
  }

  try {
    const result = await setupQstashSchedules(baseUrl);
    return Response.json({
      ok: true,
      schedules: result,
      message:
        "QStash schedules created. Consolidation runs hourly, cache cleanup runs daily at 03:00 UTC.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[admin/setup-schedules] Failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authError = authorize(req);
  if (authError) return authError;

  try {
    await removeQstashSchedules();
    return Response.json({
      ok: true,
      message: "All QStash schedules removed.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[admin/setup-schedules] Remove failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
