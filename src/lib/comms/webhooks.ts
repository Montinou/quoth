/**
 * Webhook registration and delivery for the Quoth communication bus.
 *
 * Webhooks are registered per-agent via agents.webhook_subscriptions and
 * deliveries are logged in comms.webhook_deliveries.
 *
 * Delivery uses exponential backoff: 5 retries at 1s, 5s, 25s, 125s, 625s.
 * Payloads are signed with HMAC-SHA256 using the subscription secret.
 */

import { eq, and, sql } from "drizzle-orm";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { getDb } from "@/db/connection";
import {
  webhookSubscriptions,
  webhookDeliveries,
} from "@/db/schema";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 5;
/** Backoff multiplier: attempt N waits BASE * 5^(N-1) seconds. */
const BACKOFF_DELAYS_MS = [1_000, 5_000, 25_000, 125_000, 625_000];
const DELIVERY_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisterWebhookInput {
  agentId: string;
  orgId: string;
  url: string;
  events: string[];
  secret?: string;
}

export interface WebhookSubscriptionRow {
  id: string;
  agentId: string;
  orgId: string;
  url: string;
  events: string[];
  secret: string;
  status: string | null;
  failureCount: number | null;
  lastDeliveryAt: Date | null;
  createdAt: Date | null;
}

export interface WebhookDeliveryRow {
  id: string;
  subscriptionId: string;
  messageId: string | null;
  url: string;
  requestBody: unknown;
  responseStatus: number | null;
  responseBody: string | null;
  attempt: number;
  nextRetryAt: Date | null;
  status: string | null;
  createdAt: Date | null;
}

export interface WebhookPayload {
  event: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register a webhook subscription for an agent.
 * If no secret is provided, the DB default (gen_random_bytes) is used.
 */
export async function registerWebhook(
  input: RegisterWebhookInput,
): Promise<WebhookSubscriptionRow> {
  const db = getDb();

  const values: Record<string, unknown> = {
    agentId: input.agentId,
    orgId: input.orgId,
    url: input.url,
    events: input.events,
    secret: input.secret || randomBytes(32).toString('hex'),
    status: "active",
  };

  const [row] = await db
    .insert(webhookSubscriptions)
    .values(values as typeof webhookSubscriptions.$inferInsert)
    .returning();

  return row as unknown as WebhookSubscriptionRow;
}

/**
 * List webhook subscriptions for an agent.
 */
export async function listWebhooks(
  agentId: string,
  limit: number = 50,
): Promise<WebhookSubscriptionRow[]> {
  const db = getDb();

  const rows = await db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.agentId, agentId))
    .limit(Math.min(limit, 100));

  return rows as unknown as WebhookSubscriptionRow[];
}

// ---------------------------------------------------------------------------
// HMAC Signing
// ---------------------------------------------------------------------------

/**
 * Sign a payload with HMAC-SHA256.
 * Returns the hex digest prefixed with "sha256=".
 */
export function signPayload(payload: unknown, secret: string): string {
  const body = JSON.stringify(payload);
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${digest}`;
}

/**
 * Verify an incoming webhook signature.
 */
export function verifySignature(
  payload: unknown,
  secret: string,
  signature: string,
): boolean {
  const expected = signPayload(payload, secret);
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * Deliver a webhook to a subscription endpoint with exponential backoff.
 *
 * Records each attempt in comms.webhook_deliveries.
 * On final failure, marks the subscription as failed.
 */
export async function deliverWebhook(
  subscriptionId: string,
  event: string,
  payload: Record<string, unknown>,
  messageId?: string,
): Promise<WebhookDeliveryRow> {
  const db = getDb();

  // Fetch subscription
  const [sub] = await db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.id, subscriptionId))
    .limit(1);

  if (!sub) {
    throw new Error(`Webhook subscription ${subscriptionId} not found`);
  }

  if (sub.status !== "active") {
    throw new Error(`Webhook subscription ${subscriptionId} is ${sub.status}`);
  }

  const fullPayload: WebhookPayload = {
    event,
    ...payload,
    timestamp: new Date().toISOString(),
  };

  return attemptDelivery(db, sub, fullPayload, messageId, 1);
}

/**
 * Internal recursive delivery with retry logic.
 */
async function attemptDelivery(
  db: ReturnType<typeof getDb>,
  sub: typeof webhookSubscriptions.$inferSelect,
  payload: WebhookPayload,
  messageId: string | undefined,
  attempt: number,
): Promise<WebhookDeliveryRow> {
  const signature = signPayload(payload, sub.secret);
  const body = JSON.stringify(payload);

  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let success = false;

  try {
    const response = await fetch(sub.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Quoth-Signature": signature,
        "X-Quoth-Event": payload.event,
        "X-Quoth-Delivery": messageId ?? "",
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    responseStatus = response.status;
    responseBody = await response.text().catch(() => null);
    success = response.ok;
  } catch (err) {
    responseStatus = 0;
    responseBody = err instanceof Error ? err.message : "Unknown error";
    success = false;
  }

  const isLastAttempt = attempt >= MAX_RETRIES;
  const deliveryStatus = success
    ? "success"
    : isLastAttempt
      ? "failed"
      : "retrying";

  const nextRetryAt =
    !success && !isLastAttempt
      ? new Date(Date.now() + BACKOFF_DELAYS_MS[attempt - 1])
      : null;

  // Record delivery attempt
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      subscriptionId: sub.id,
      messageId: messageId ?? null,
      url: sub.url,
      requestBody: payload,
      responseStatus,
      responseBody,
      attempt,
      nextRetryAt,
      status: deliveryStatus,
    })
    .returning();

  // Update subscription metadata
  if (success) {
    await db
      .update(webhookSubscriptions)
      .set({
        lastDeliveryAt: sql`now()`,
        failureCount: 0,
      })
      .where(eq(webhookSubscriptions.id, sub.id));
  } else {
    const newFailureCount = (sub.failureCount ?? 0) + 1;
    await db
      .update(webhookSubscriptions)
      .set({
        lastDeliveryAt: sql`now()`,
        failureCount: newFailureCount,
        // Mark subscription as failed after too many consecutive failures
        ...(newFailureCount >= MAX_RETRIES * 3 ? { status: "failed" } : {}),
      })
      .where(eq(webhookSubscriptions.id, sub.id));
  }

  return delivery as unknown as WebhookDeliveryRow;
}
