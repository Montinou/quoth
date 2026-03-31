/**
 * POST /api/v1/admin/setup-schedules — One-time QStash schedule setup.
 *
 * Creates QStash schedules for memory consolidation and cache cleanup.
 * Call once after deployment. QStash signs its own requests — no CRON_SECRET needed.
 *
 * Auth: Clerk (must be authenticated user).
 *
 * Body: { "baseUrl": "https://quoth.example.com" }
 *
 * DELETE — Remove all QStash schedules.
 */

import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  setupQstashSchedules,
  removeQstashSchedules,
} from "@/lib/worker/qstash";


async function authorize(): Promise<Response | null> {
  const { userId, orgRole } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Only org admins/owners can manage QStash schedules
  if (orgRole !== 'org:admin' && orgRole !== 'org:owner') {
    return Response.json({ error: "Forbidden: admin role required" }, { status: 403 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const authError = await authorize();
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
    console.error("[admin/setup-schedules] Failed:", err);
    return Response.json({ error: "Failed to create schedules" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest) {
  const authError = await authorize();
  if (authError) return authError;

  try {
    await removeQstashSchedules();
    return Response.json({
      ok: true,
      message: "All QStash schedules removed.",
    });
  } catch (err) {
    console.error("[admin/setup-schedules] Remove failed:", err);
    return Response.json({ error: "Failed to remove schedules" }, { status: 500 });
  }
}
