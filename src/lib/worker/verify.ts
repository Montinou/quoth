/**
 * Cron auth verification via QStash signature (Upstash-Signature header).
 *
 * Env vars:
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
 * Verify cron request authentication via QStash signature.
 * Returns null if authorized, or a Response if unauthorized.
 */
export async function verifyCronAuth(
  req: NextRequest,
): Promise<Response | null> {
  const signature = req.headers.get("upstash-signature");
  if (!signature) {
    return Response.json(
      { error: "Missing Upstash-Signature header" },
      { status: 401 },
    );
  }

  const recv = getReceiver();
  if (!recv) {
    return Response.json(
      { error: "QStash signing keys not configured" },
      { status: 500 },
    );
  }

  try {
    const body = await req.text();
    const isValid = await recv.verify({ signature, body });
    if (isValid) return null;
  } catch (err) {
    console.error("[verifyCronAuth] QStash signature verification failed:", err);
  }

  return Response.json({ error: "Invalid QStash signature" }, { status: 401 });
}
