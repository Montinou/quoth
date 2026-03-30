/**
 * Channel management for the Quoth communication bus.
 *
 * 4 channel patterns:
 *   - agent-inbox: auto-created per agent (direct messages)
 *   - topic: broadcast channels for pub/sub
 *   - direct: 1:1 conversation channels
 *   - project: project-scoped channels (auto-bound to project_id)
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "@/db/connection";
import {
  channels,
  channelSubscriptions,
  agentRegistry,
} from "@/db/schema";
import { verifyProjectAccess } from "./utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChannelType = "topic" | "direct" | "project";

export interface CreateChannelInput {
  orgId: string;
  name: string;
  type: ChannelType;
  description?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelRow {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  channelType: string;
  projectId: string | null;
  metadata: unknown;
  createdAt: Date | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Canonical inbox channel name for an agent. */
export function inboxChannelName(agentName: string): string {
  return `inbox.${agentName}`;
}

// ---------------------------------------------------------------------------
// Channel CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new channel.
 *
 * - For `project` channels, `projectId` is required.
 * - Channel names must be unique within an org (enforced by DB).
 */
export async function createChannel(
  input: CreateChannelInput,
): Promise<ChannelRow> {
  const db = getDb();

  if (input.type === "project" && !input.projectId) {
    throw new Error("projectId is required for project channels");
  }

  const [row] = await db
    .insert(channels)
    .values({
      orgId: input.orgId,
      name: input.name,
      channelType: input.type,
      description: input.description ?? null,
      projectId: input.projectId ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();

  return row as ChannelRow;
}

/**
 * Ensure an agent-inbox channel exists for the given agent.
 * Creates the channel + subscribes the agent if it doesn't exist yet.
 * Returns the channel row.
 */
export async function ensureAgentInbox(
  orgId: string,
  agentId: string,
  agentName: string,
): Promise<ChannelRow> {
  const db = getDb();
  const name = inboxChannelName(agentName);

  // Try to find existing
  const existing = await db
    .select()
    .from(channels)
    .where(and(eq(channels.orgId, orgId), eq(channels.name, name)))
    .limit(1);

  if (existing.length > 0) {
    return existing[0] as ChannelRow;
  }

  // Create inbox channel
  const channel = await createChannel({
    orgId,
    name,
    type: "direct",
    description: `Auto-created inbox for agent ${agentName}`,
  });

  // Auto-subscribe the agent
  await subscribeAgent(channel.id, agentId);

  return channel;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * Subscribe an agent to a channel (idempotent — ignores duplicate).
 */
export async function subscribeAgent(
  channelId: string,
  agentId: string,
): Promise<void> {
  const db = getDb();

  // Cross-project isolation: if channel has a project_id, verify agent access.
  const [ch] = await db
    .select({ projectId: channels.projectId })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  if (ch) {
    await verifyProjectAccess(agentId, ch.projectId);
  }

  await db
    .insert(channelSubscriptions)
    .values({ channelId, agentId })
    .onConflictDoNothing();
}

/**
 * Unsubscribe an agent from a channel.
 */
export async function unsubscribeAgent(
  channelId: string,
  agentId: string,
): Promise<void> {
  const db = getDb();

  await db
    .delete(channelSubscriptions)
    .where(
      and(
        eq(channelSubscriptions.channelId, channelId),
        eq(channelSubscriptions.agentId, agentId),
      ),
    );
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * List channels for an organization, optionally filtered by projectId.
 */
export async function listChannels(
  orgId: string,
  projectId?: string,
  limit: number = 100,
): Promise<ChannelRow[]> {
  const db = getDb();

  const conditions = [eq(channels.orgId, orgId)];
  if (projectId) {
    conditions.push(eq(channels.projectId, projectId));
  }

  const rows = await db
    .select()
    .from(channels)
    .where(and(...conditions))
    .orderBy(channels.name)
    .limit(Math.min(limit, 200));

  return rows as ChannelRow[];
}

/**
 * Get a single channel by ID (within org scope).
 */
export async function getChannel(
  channelId: string,
  orgId: string,
): Promise<ChannelRow | null> {
  const db = getDb();

  const rows = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.orgId, orgId)))
    .limit(1);

  return (rows[0] as ChannelRow) ?? null;
}
