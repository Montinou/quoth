# Agent Coordination

Documentation of the agent coordination system spanning both the local Quoth plugin (SQLite) and the cloud SaaS platform (Neon Postgres).

## Architecture Overview

Agent coordination operates at two levels:

1. **Local (Plugin)**: Lightweight coordination via SQLite `agent_registry` and `events` tables, designed for a single machine with multiple Claude Code sessions and OpenClaw agents.
2. **Cloud (SaaS)**: Full multi-org agent management via Neon Postgres across 6 schemas, with messaging, tasks, webhooks, and API key authentication.

## Local Coordination (Plugin)

Source: `quoth-plugin/mcp/handlers/agents.js` and `quoth-plugin/daemon/db.js`

### Agent Registry (SQLite)

Agents register via the `quoth_agent_register` MCP tool. Schema:

```sql
CREATE TABLE IF NOT EXISTS agent_registry (
  agent_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  project TEXT,
  platform TEXT,
  status TEXT DEFAULT 'online',
  capabilities TEXT DEFAULT '[]',   -- JSON array
  last_heartbeat INTEGER,
  registered_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  metadata TEXT DEFAULT '{}'        -- JSON object
);
```

Registration fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | Yes | Unique agent identifier |
| `name` | string | Yes | Human-readable name |
| `type` | enum | Yes | `claude-code`, `openclaw`, `daemon`, `worker` |
| `project` | string | No | Associated project namespace |
| `platform` | string | No | Execution platform identifier |
| `capabilities` | string[] | No | JSON array of capability strings |
| `metadata` | object | No | Arbitrary JSON metadata |

Registration is upsert-based -- calling `quoth_agent_register` with an existing `agentId` updates all fields.

On registration, an `agent.registered` event is emitted with `{ name, type, platform }` payload.

### Heartbeats

`quoth_agent_heartbeat(agentId, status?)` keeps an agent marked as alive:

- Updates `last_heartbeat` to `Date.now()`
- Optionally updates `status` (online, busy, idle)
- If status is not provided, the current status is preserved via `COALESCE(?, status)`

**Stale agent cleanup**: The daemon runs `db.cleanupStaleAgents(300000)` every 5 minutes. Agents whose `last_heartbeat` is older than 5 minutes (300,000ms) and currently marked `online` are set to `offline`:

```sql
UPDATE agent_registry SET status = 'offline'
WHERE status = 'online' AND last_heartbeat < ? AND last_heartbeat IS NOT NULL
```

### Agent Listing

`quoth_agent_list(project?, type?, status?, limit?)` queries agents with optional filters:

- Filters are applied additively (AND logic)
- Results sorted by `last_heartbeat DESC` (most recently active first)
- Default limit: 20
- Returns parsed `capabilities` (JSON array) and `metadata` (JSON object)
- Includes computed `heartbeatAge` (milliseconds since last heartbeat)

### Task Assignment

`quoth_assign_task(agentId, task, priority?, metadata?)` creates a task event:

- Looks up the target agent to get their project context
- Emits a `task.assigned` event to the events table
- Priority levels: `low`, `medium` (default), `high`, `critical`
- Returns the event ID (from `lastInsertRowid`) for tracking

### Event System

All coordination actions are tracked via event sourcing in the `events` table:

```sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  agent_id TEXT,
  project TEXT,
  payload TEXT NOT NULL,   -- JSON
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
```

Indexed on: `event_type`, `agent_id`, `created_at DESC`.

Event types used by the system:

| Event Type | Emitter | Description |
|------------|---------|-------------|
| `agent.registered` | `quoth_agent_register` | Agent registration or update |
| `task.assigned` | `quoth_assign_task` | Task assigned to an agent |
| `pattern.strengthened` | daemon | Pattern got Bayesian success update |
| `pattern.learned` | daemon | New pattern distilled from trajectory |
| `pattern.promoted` | daemon | Pattern promoted to cloud |

Events can be queried via `db.getEvents(filters)` with optional filters:
- `eventType`: filter by event type
- `agentId`: filter by agent
- `project`: filter by project
- `since`: filter by timestamp (created_at > since)
- `limit`: max results (default 50)

### Trajectory Ingestion

`quoth_ingest_trajectory(entries[])` batch-ingests trajectory data from external sources:

1. Writes entries as JSONL to `~/.quoth/trajectories/{source}-{date}.jsonl`
2. Each entry is normalized to include: `event`, `agent`, `project`, `session`, `task`, `outcome`, `pattern_used`, `source`, `timestamp`
3. Signals the daemon via `SIGUSR1` for immediate processing (if daemon is running)
4. Returns `{ ingested: count, trajectoryFile: path, daemonSignaled: boolean }`

Entry schema:

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `agent` | string | Yes | -- |
| `task` | string | Yes | -- |
| `outcome` | enum | Yes | `success` or `failure` |
| `event` | string | No | `tool_use` |
| `project` | string | No | `unknown` |
| `pattern_used` | string | No | `null` |
| `source` | string | No | `api` |

## Cloud Coordination (SaaS)

Source: `src/db/schema.ts` -- Drizzle ORM schema across 6 Postgres schemas.

### Agent Registry (agents.registry)

Full-featured agent management in Neon Postgres:

```typescript
agentsSchema.table("registry", {
  id: uuid().defaultRandom().primaryKey(),
  orgId: uuid().references(organizations.id).notNull(),
  agentName: text().notNull(),          // ^[a-z0-9-]+$ enforced
  displayName: text(),
  instance: text().notNull(),           // e.g. "montino", "aws"
  model: text(),                        // e.g. "claude-sonnet-4.6"
  role: text(),                         // orchestrator | specialist | curator | admin | agent
  capabilities: jsonb().default('{}'),
  metadata: jsonb().default('{}'),
  status: text().default('active'),     // active | inactive | archived
  signingKey: text().notNull(),         // For message signature verification
  lastSeenAt: timestamp(),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow(),
})
```

Indexes:
- Unique on `(orgId, agentName)` -- one agent name per org
- Composite on `(orgId, status)` for filtered listings
- Composite on `(instance, status)` for per-instance queries

### Agent Projects (agents.agent_projects)

Many-to-many relationship between agents and projects:

| Field | Description |
|-------|-------------|
| `agentId` | FK to agents.registry |
| `projectId` | FK to projects |
| `role` | `owner`, `contributor`, `readonly` |
| `assignedAt` | Timestamp |
| `assignedBy` | UUID of assigning user/agent |

### API Keys (agents.api_keys)

Agent authentication for API access:

| Field | Description |
|-------|-------------|
| `id` | UUID primary key |
| `agentId` | FK to agents.registry (cascade delete) |
| `orgId` | FK to organizations (cascade delete) |
| `keyHash` | SHA-256 hash of the raw key (unique, indexed where not revoked) |
| `keyPrefix` | First 12 chars of key (e.g. `qth_abcd1234`) for identification |
| `label` | Human-readable label |
| `scopes` | Text array, default `['read', 'write']` |
| `projectIds` | UUID array -- optional project restriction |
| `rateLimitRpm` | Integer, default 60 |
| `expiresAt` | Optional expiration timestamp |
| `lastUsedAt` | Updated on each successful verification (fire-and-forget) |
| `revokedAt` | Set to revoke; filtered index on `revoked_at IS NULL` |
| `createdBy` | FK to users table |

Key format: `qth_` prefix + 32 random bytes as hex = 68 characters total.

Key operations (from `src/lib/auth/agent-keys.ts`):
- **Generate**: `generateAgentApiKey()` -- returns raw key once, stores only hash
- **Verify**: `verifyAgentApiKey()` -- hashes input, looks up in DB, checks expiration and revocation
- **Revoke**: `revokeApiKey()` -- sets `revoked_at` timestamp
- **Rotate**: `rotateApiKey()` -- revokes old key, generates new one with same params

### Webhook Subscriptions (agents.webhook_subscriptions)

Agents subscribe to events for push-based notification:

| Field | Description |
|-------|-------------|
| `agentId` | Subscribing agent |
| `orgId` | Organization scope |
| `url` | HTTP endpoint for delivery |
| `events` | Text array of event types to subscribe to (GIN indexed) |
| `secret` | HMAC secret for signature verification |
| `status` | `active`, `paused`, `failed` |
| `failureCount` | Incremented on delivery failure |
| `lastDeliveryAt` | Timestamp of last successful delivery |

### Messaging System (comms schema)

#### Channels (comms.channels)

| Field | Description |
|-------|-------------|
| `orgId` | Organization scope |
| `name` | Unique per org, `^[a-z0-9._-]+$` enforced |
| `channelType` | `topic`, `direct`, `project` |
| `projectId` | Optional project scope |

Channel subscriptions link agents to channels via `comms.channel_subscriptions` (composite PK on channelId + agentId).

#### Messages (comms.messages)

Full message routing with either direct (agent-to-agent) or channel-based delivery:

| Field | Description |
|-------|-------------|
| `fromAgentId` | Sender (required) |
| `toAgentId` | Recipient (for direct messages) |
| `channelId` | Target channel (for broadcast) |
| `replyTo` | UUID for threading (self-referencing FK) |
| `messageType` | `message`, `task`, `result`, `alert`, `knowledge`, `curator`, `broadcast` |
| `priority` | `low`, `normal`, `high`, `urgent` |
| `payload` | JSONB content |
| `signature` | HMAC signature from sender's signing_key |
| `status` | `pending` -> `delivered` -> `read` (or `failed`, `expired`) |
| `expiresAt` | Default: `now() + 7 days` |
| `retryCount` | Delivery retry counter |

**Routing constraint**: Every message must have exactly one of `toAgentId` (direct) or `channelId` (channel), enforced by CHECK constraint:

```sql
CHECK (
  (to_agent_id IS NOT NULL AND channel_id IS NULL) OR
  (to_agent_id IS NULL AND channel_id IS NOT NULL)
)
```

Indexes optimized for:
- Inbox queries: `(toAgentId, status, createdAt)` where `to_agent_id IS NOT NULL`
- Channel history: `(channelId, createdAt)` where `channel_id IS NOT NULL`
- Pending delivery: `(toAgentId, createdAt)` where `status = 'pending'`
- Thread lookup: `(replyTo)` where `reply_to IS NOT NULL`

#### Tasks (comms.tasks)

Structured task management for agent-to-agent delegation:

| Field | Description |
|-------|-------------|
| `orgId` | Organization scope |
| `title` | Task title (required) |
| `description` | Detailed description |
| `assignedTo` | FK to agent registry (required) |
| `createdBy` | FK to agent registry (required) |
| `projectId` | Optional project scope |
| `status` | `pending` -> `in_progress` -> `done`/`failed`/`cancelled` |
| `priority` | Integer 1-10 (CHECK constraint, default 5) |
| `payload` | JSONB input data |
| `result` | JSONB output data |
| `startedAt` | When agent started work |
| `completedAt` | When task finished |
| `deadline` | Optional deadline timestamp |

Indexed for:
- Agent workload: `(assignedTo, status)`
- Project tasks: `(projectId)` where not null
- Overdue detection: `(deadline)` where deadline is set and status is pending/in_progress

### Webhook Delivery (comms.webhook_deliveries)

Tracks individual delivery attempts for webhook subscriptions:

| Field | Description |
|-------|-------------|
| `subscriptionId` | FK to webhook_subscriptions |
| `messageId` | FK to messages (nullable) |
| `url` | Target URL at time of delivery |
| `requestBody` | JSONB payload sent |
| `responseStatus` | HTTP status code received |
| `responseBody` | Response text |
| `attempt` | Attempt number (starting at 1) |
| `nextRetryAt` | When to retry (if status = 'retrying') |
| `status` | `pending`, `success`, `failed`, `retrying` |

Retry deliveries are picked up by the cron job at `/api/v1/cron/webhook-retry`.

### Agent Memory (agents.memory)

Per-agent key-value memory with vector embeddings:

| Field | Description |
|-------|-------------|
| `agentId` | Owning agent |
| `orgId` | Organization scope |
| `projectId` | Optional project scope |
| `key` | Memory key (unique per agent + namespace) |
| `value` | Memory content (text) |
| `namespace` | Namespace (default: `'default'`) |
| `embedding` | 1024-dimension vector (voyage-4-lite) |
| `tier` | `working` or `persistent` |
| `relevanceScore` | Decaying relevance (default 1.0) |
| `accessCount` | Read counter |
| `decayRate` | Per-agent decay rate (default 0.05) |
| `tags` | Text array (GIN indexed) |
| `expiresAt` | Optional TTL |

HNSW index on embeddings with `m=16, ef_construction=200` using `vector_cosine_ops`.

## Local vs Cloud Comparison

| Feature | Local (Plugin) | Cloud (SaaS) |
|---------|---------------|--------------|
| Database | SQLite (better-sqlite3) | Neon Postgres |
| Agent identity | Free-text agentId | UUID + org-scoped unique name |
| Authentication | None (local only) | API keys (SHA-256 hashed) + Clerk JWT |
| Messaging | Event sourcing only | Full channels + direct messages |
| Task management | Events table | Structured tasks with status workflow |
| Webhooks | Not supported | Full delivery + retry system |
| Multi-tenancy | Single user | org_id on all tables |
| Memory | Patterns + HNSW | Per-agent vector memory (1024d) |
| Heartbeats | 5-minute timeout | lastSeenAt timestamp |
