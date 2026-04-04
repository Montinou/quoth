/**
 * Vitest global setup — mocks for DB, Clerk, Redis, and Next.js headers.
 */

import { vi } from 'vitest';

// ── Mock @clerk/nextjs/server ────────────────────────────────────────────────
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: null, orgId: null, sessionClaims: null }),
}));

// ── Mock next/headers ────────────────────────────────────────────────────────
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));

// ── Mock DB connection ───────────────────────────────────────────────────────
// Returns a chainable query-builder stub. Tests override per-case.
vi.mock('@/db/connection', () => ({
  getDb: vi.fn(),
}));

// ── Mock DB schema (just export column ref stubs) ────────────────────────────
vi.mock('@/db/schema', () => ({
  agentApiKeys: {
    id: 'id', agentId: 'agent_id', orgId: 'org_id', keyHash: 'key_hash',
    keyPrefix: 'key_prefix', label: 'label', scopes: 'scopes',
    projectIds: 'project_ids', rateLimitRpm: 'rate_limit_rpm',
    expiresAt: 'expires_at', lastUsedAt: 'last_used_at',
    revokedAt: 'revoked_at', createdAt: 'created_at', createdBy: 'created_by',
  },
  messages: {
    id: 'id', orgId: 'org_id', fromAgentId: 'from_agent_id',
    toAgentId: 'to_agent_id', channelId: 'channel_id', status: 'status',
    createdAt: 'created_at', replyTo: 'reply_to', messageType: 'message_type',
    priority: 'priority', payload: 'payload',
  },
  channels: {
    id: 'id', orgId: 'org_id', name: 'name', channelType: 'channel_type',
    projectId: 'project_id', description: 'description', metadata: 'metadata',
  },
  channelSubscriptions: { channelId: 'channel_id', agentId: 'agent_id' },
  agentRegistry: {},
  tasks: {
    id: 'id', orgId: 'org_id', title: 'title', assignedTo: 'assigned_to',
    createdBy: 'created_by', status: 'status', projectId: 'project_id',
    createdAt: 'created_at', priority: 'priority',
  },
}));

// ── Mock drizzle-orm operators ───────────────────────────────────────────────
const sqlTag = Object.assign(
  vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => ({ sql: true })),
  { raw: vi.fn((s: string) => ({ raw: s })) },
);
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ op: 'eq', val })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  or: vi.fn((...args: unknown[]) => ({ op: 'or', args })),
  isNull: vi.fn((col: unknown) => ({ op: 'isNull', col })),
  desc: vi.fn((col: unknown) => ({ op: 'desc', col })),
  asc: vi.fn((col: unknown) => ({ op: 'asc', col })),
  inArray: vi.fn((_col: unknown, vals: unknown) => ({ op: 'inArray', vals })),
  sql: sqlTag,
}));

// ── Mock AI SDK (embed / embedMany) ─────────────────────────────────────
vi.mock('ai', () => ({
  embed: vi.fn(),
  embedMany: vi.fn(),
}));

vi.mock('@ai-sdk/openai', () => {
  const embeddingFn = vi.fn((model: string) => ({ model }));
  return {
    openai: { embedding: embeddingFn },
    createOpenAI: vi.fn(() => ({ embedding: embeddingFn })),
  };
});

// ── Mock Upstash ─────────────────────────────────────────────────────────────
vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(),
}));
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: Object.assign(vi.fn(), {
    slidingWindow: vi.fn(),
  }),
}));
