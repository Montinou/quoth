/**
 * Message sending and receiving for the Quoth communication bus.
 *
 * All messages are persisted in comms.messages with lifecycle:
 *   pending -> delivered -> read     (success)
 *   pending -> failed                (delivery failure)
 *   pending -> expired               (TTL, default 7 days)
 *
 * LISTEN/NOTIFY:
 *   PostgreSQL triggers (comms.notify_new_message) automatically fire
 *   NOTIFY on message insert. Channel names:
 *     - agent_inbox_{agentIdNoHyphens}  (direct messages)
 *     - channel_{channelIdNoHyphens}    (channel messages)
 *     - org_messages_{orgIdNoHyphens}   (all org messages, for dashboards)
 *
 *   To listen from a long-lived process (NOT Neon HTTP driver):
 *     const client = new pg.Client(process.env.DATABASE_URL_UNPOOLED);
 *     await client.connect();
 *     await client.query("LISTEN agent_inbox_<agentId without hyphens>");
 *     client.on('notification', (msg) => { ... });
 */

import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { getDb } from "@/db/connection";
import { messages, agentRegistry } from "@/db/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageType =
  | "message"
  | "task"
  | "result"
  | "alert"
  | "knowledge"
  | "curator"
  | "broadcast";

export type MessagePriority = "low" | "normal" | "high" | "urgent";
export type MessageStatus = "pending" | "delivered" | "read" | "failed" | "expired";

export interface SendMessageInput {
  toAgentId?: string;
  channelId?: string;
  content: unknown;
  messageType?: MessageType;
  priority?: MessagePriority;
  metadata?: Record<string, unknown>;
  replyTo?: string;
}

export interface InboxFilters {
  status?: MessageStatus | MessageStatus[];
  limit?: number;
  offset?: number;
}

export interface MessageRow {
  id: string;
  orgId: string;
  fromAgentId: string;
  toAgentId: string | null;
  channelId: string | null;
  replyTo: string | null;
  messageType: string;
  priority: string | null;
  payload: unknown;
  signature: string | null;
  status: string | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  errorMessage: string | null;
  retryCount: number | null;
  expiresAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

/**
 * Send a message from one agent to another agent (direct) or to a channel.
 * Exactly one of `toAgentId` or `channelId` must be provided (DB constraint).
 *
 * The NOTIFY trigger fires automatically on insert.
 */
export async function sendMessage(
  fromAgentId: string,
  orgId: string,
  input: SendMessageInput,
): Promise<MessageRow> {
  const db = getDb();

  if (!input.toAgentId && !input.channelId) {
    throw new Error("Either toAgentId or channelId must be provided");
  }
  if (input.toAgentId && input.channelId) {
    throw new Error("Cannot specify both toAgentId and channelId");
  }

  const [row] = await db
    .insert(messages)
    .values({
      orgId,
      fromAgentId,
      toAgentId: input.toAgentId ?? null,
      channelId: input.channelId ?? null,
      replyTo: input.replyTo ?? null,
      messageType: input.messageType ?? "message",
      priority: input.priority ?? "normal",
      payload: input.content,
      status: "pending",
    })
    .returning();

  return row as MessageRow;
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

/**
 * Retrieve inbox messages for an agent (direct messages sent to them).
 */
export async function getInbox(
  agentId: string,
  filters: InboxFilters = {},
): Promise<MessageRow[]> {
  const db = getDb();
  const { limit = 50, offset = 0 } = filters;

  const conditions = [eq(messages.toAgentId, agentId)];

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      conditions.push(inArray(messages.status, filters.status));
    } else {
      conditions.push(eq(messages.status, filters.status));
    }
  }

  const rows = await db
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .offset(offset);

  return rows as MessageRow[];
}

// ---------------------------------------------------------------------------
// Read / Deliver
// ---------------------------------------------------------------------------

/**
 * Mark a message as read by the receiving agent.
 * Only the intended recipient can mark it read.
 */
export async function markAsRead(
  messageId: string,
  agentId: string,
): Promise<MessageRow | null> {
  const db = getDb();

  const [row] = await db
    .update(messages)
    .set({
      status: "read",
      readAt: sql`now()`,
    })
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.toAgentId, agentId),
      ),
    )
    .returning();

  return (row as MessageRow) ?? null;
}

/**
 * Mark a message as delivered (for webhook or polling confirmation).
 */
export async function markAsDelivered(
  messageId: string,
): Promise<MessageRow | null> {
  const db = getDb();

  const [row] = await db
    .update(messages)
    .set({
      status: "delivered",
      deliveredAt: sql`now()`,
    })
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.status, "pending"),
      ),
    )
    .returning();

  return (row as MessageRow) ?? null;
}

// ---------------------------------------------------------------------------
// Reply
// ---------------------------------------------------------------------------

/**
 * Reply to an existing message. Inherits the routing (direct or channel)
 * from the original message.
 */
export async function replyToMessage(
  messageId: string,
  fromAgentId: string,
  orgId: string,
  content: unknown,
): Promise<MessageRow> {
  const db = getDb();

  // Fetch original to inherit routing
  const [original] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);

  if (!original) {
    throw new Error("Original message not found");
  }

  // For direct messages: reply back to the sender
  // For channel messages: post to the same channel
  const toAgentId = original.toAgentId
    ? original.fromAgentId
    : null;
  const channelId = original.channelId ?? null;

  return sendMessage(fromAgentId, orgId, {
    toAgentId: toAgentId ?? undefined,
    channelId: channelId ?? undefined,
    content,
    messageType: "message",
    replyTo: messageId,
  });
}

// ---------------------------------------------------------------------------
// Get single
// ---------------------------------------------------------------------------

/**
 * Fetch a single message by ID (org-scoped).
 */
export async function getMessage(
  messageId: string,
  orgId: string,
): Promise<MessageRow | null> {
  const db = getDb();

  const [row] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.orgId, orgId)))
    .limit(1);

  return (row as MessageRow) ?? null;
}
