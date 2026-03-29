/**
 * Cron auth verification — accepts EITHER:
 *   1. Bearer CRON_SECRET header (Vercel Cron)
 *   2. QStash signature (Upstash-Signature header)
 *
 * Env vars for QStash verification:
 *   QSTASH_CURRENT_SIGNING_KEY
 *   QSTASH_NEXT_SIGNING_KEY
 */

import { NextRequest } from "next/server";
import { Receiver } from "@upstash/qstash";

let receiver: Receiver | null = null;

function getReceiver(): Receiver | null {
  if (receiver) return receiver;
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) return null;
  receiver = new Receiver({ currentSigningKey, nextSigningKey });
  return receiver;
}

/**
 * Verify cron request authentication.
 * Returns null if authorized, or a Response if unauthorized.
 */
export async function verifyCronAuth(
  req: NextRequest,
): Promise<Response | null> {
  // Method 1: Bearer CRON_SECRET
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return null; // Authorized via CRON_SECRET
  }

  // Method 2: QStash signature verification
  const signature = req.headers.get("upstash-signature");
  if (signature) {
    const recv = getReceiver();
    if (recv) {
      try {
        const body = await req.text();
        const isValid = await recv.verify({
          signature,
          body,
        });
        if (isValid) return null; // Authorized via QStash signature
      } catch (err) {
        console.error(
          "[verifyCronAuth] QStash signature verification failed:",
          err,
        );
      }
    }
  }

  // Neither method succeeded
  if (!cronSecret) {
    return Response.json(
      { error: "CRON_SECRET not configured and no valid QStash signature" },
      { status: 500 },
    );
  }

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
