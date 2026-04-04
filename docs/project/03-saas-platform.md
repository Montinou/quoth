# Quoth SaaS Platform (quoth-mcp v3.0.0)

## Next.js App Router Structure

The SaaS is a Next.js 16 App Router application at `src/app/`. Routes use the file-system convention with route groups, dynamic segments, and catch-all segments.

### Authenticated App Pages — `src/app/(app)/`

The `(app)` route group wraps all authenticated pages behind Clerk middleware.

| Route | Purpose |
|-------|---------|
| `/dashboard` | Main dashboard — project overview, recent activity |
| `/dashboard/[projectSlug]` | Per-project dashboard with project-specific metrics |
| `/dashboard/analytics` | Usage analytics: searches, embeddings, generations, costs |
| `/dashboard/api-keys` | Manage agent API keys (generate, revoke, scope) |
| `/dashboard/settings` | Organization and project settings |
| `/dashboard/team` | Team management: invite members, assign roles |
| `/agents` | Agent registry: list, status, capabilities |
| `/agents/[name]` | Individual agent detail: memory, tasks, messages |
| `/agents/graph` | Visual agent relationship graph (uses @xyflow/react) |
| `/knowledge-base` | Document management: upload, index, search |
| `/knowledge-base/[id]` | Document detail: chunks, embeddings, version history |
| `/proposals` | Pending knowledge-base update proposals from agents |
| `/proposals/[id]` | Proposal detail: diff view, approve/reject |
| `/shared` | Shared patterns and knowledge across projects |

### Authentication Pages — `src/app/auth/`

| Route | Purpose |
|-------|---------|
| `/auth/login` | Clerk-powered login page |
| `/auth/signup` | Clerk-powered signup page |
| `/auth/verify-email` | Email verification flow |
| `/auth/cli` | CLI device authentication flow (for `quoth login` command) |
| `/auth/mcp-login` | MCP remote transport authentication |

### Public Pages

| Route | Purpose |
|-------|---------|
| `/` (`page.tsx`) | Root page (redirects or renders landing) |
| `/landing` | Marketing landing page |
| `/pricing` | Pricing tiers: free, pro, team, enterprise |
| `/docs/[...slug]` | Documentation pages (catch-all for nested docs) |
| `/blog` | Blog listing |
| `/blog/[slug]` | Individual blog post |
| `/changelog` | Product changelog |
| `/manifesto` | Product philosophy and manifesto |
| `/protocol` | Quoth protocol specification |
| `/terms` | Terms of service |
| `/guide` | Getting started guide |
| `/onboarding` | New user onboarding flow |
| `/invitations/accept` | Team invitation acceptance page |

### OAuth Pages

| Route | Purpose |
|-------|---------|
| `/oauth/consent` | OAuth consent screen for MCP connections |
| `/.well-known/oauth-authorization-server` | OAuth server metadata (RFC 8414) |
| `/.well-known/oauth-protected-resource` | Protected resource metadata |

---

## API Routes

### Versioned Public API — `/api/v1/`

These routes are used by the plugin daemon, agents, and external integrations. Agent API keys (`qth_*`) bypass Clerk middleware for authentication.

#### Agents

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/v1/agents` | List agents for the authenticated org |
| POST | `/api/v1/agents` | Register a new agent |
| GET | `/api/v1/agents/[id]` | Get agent detail |
| PATCH | `/api/v1/agents/[id]` | Update agent (status, capabilities, metadata) |
| DELETE | `/api/v1/agents/[id]` | Archive/remove agent |
| POST | `/api/v1/agents/[id]/keys` | Generate new API key for agent |
| GET | `/api/v1/agents/[id]/keys` | List API keys for agent |

#### Communications

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/v1/comms/channels` | List channels for org |
| POST | `/api/v1/comms/channels` | Create a new channel |
| POST | `/api/v1/comms/channels/[id]/subscribe` | Subscribe an agent to a channel |
| GET | `/api/v1/comms/messages` | List messages (inbox, channel, or outbox) |
| POST | `/api/v1/comms/messages` | Send a message (direct or channel broadcast) |
| GET | `/api/v1/comms/messages/[id]/thread` | Get message thread (replies) |
| GET | `/api/v1/comms/tasks` | List tasks assigned to agent |
| POST | `/api/v1/comms/tasks` | Create a new task for an agent |

#### Cron Jobs

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/v1/cron/cleanup-cache` | Clean expired query cache entries |
| GET | `/api/v1/cron/consolidate` | Run nightly pattern/memory consolidation |
| GET | `/api/v1/cron/webhook-retry` | Retry failed webhook deliveries |

#### Daemon Integration

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/v1/daemon/agents` | Bulk agent status update from daemon |
| POST | `/api/v1/daemon/events` | Ingest daemon events (heartbeats, alerts) |

#### Documents

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/v1/documents` | List documents for project |
| POST | `/api/v1/documents` | Create/index a document (with chunking + embedding) |

#### Generations

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/v1/generations/[id]` | Get generation status and result |

#### Health

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/v1/health` | Health check (DB connection, version) |

#### Memory

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/v1/memory` | List memory entries for agent (namespace filter) |
| POST | `/api/v1/memory` | Store a memory entry (key-value with optional embedding) |
| GET | `/api/v1/memory/[key]` | Get specific memory entry by key |
| DELETE | `/api/v1/memory/[key]` | Delete/forget a memory entry |
| POST | `/api/v1/memory/search` | Semantic search over agent memory (pgvector cosine similarity) |

#### Onboarding

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/v1/onboarding` | Create org + project + initial setup |

#### Patterns

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/v1/patterns/promote` | Receive promoted patterns from local daemon |

#### Profile

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/v1/profile` | Get current user/agent profile |

#### Projects

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/v1/projects` | List projects for org |
| POST | `/api/v1/projects` | Create a new project |
| GET | `/api/v1/projects/[id]` | Get project detail |
| PATCH | `/api/v1/projects/[id]` | Update project settings |

#### Search

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/v1/search` | Semantic search across project documents (pgvector + optional reranking) |

#### Trajectories

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/v1/trajectories/ingest` | Ingest trajectory data from daemon |

#### Admin

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/v1/admin/setup-schedules` | Initialize QStash cron schedules |

### Internal API Routes — `/api/`

These routes serve the web dashboard and internal operations. Authenticated via Clerk session.

#### Analytics

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/analytics/miss-rate` | Search miss rate analytics |
| GET | `/api/analytics/usage` | Usage breakdown by type and date |

#### Invitations

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/invitations/accept` | Accept a team/project invitation |

#### Knowledge Base

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/knowledge-base/[id]` | Get document detail (dashboard view) |
| PATCH | `/api/knowledge-base/[id]` | Update document metadata |
| DELETE | `/api/knowledge-base/[id]` | Delete document and chunks |
| POST | `/api/knowledge-base/[id]/rollback` | Rollback document to previous version |
| POST | `/api/knowledge-base/ask` | RAG question-answering over knowledge base |

#### MCP

| Method | Route | Purpose |
|--------|-------|---------|
| GET/POST | `/api/mcp/public` | Public MCP endpoint for discovery |
| GET/POST | `/api/[transport]` | MCP transport endpoint (SSE or streamable HTTP) |

#### MCP Tokens

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/mcp-token/generate` | Generate MCP access token |
| GET | `/api/mcp-token/list` | List active MCP tokens |

#### OAuth

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/oauth/authorize` | OAuth authorization endpoint |
| POST | `/api/oauth/register` | Dynamic client registration (RFC 7591) |
| POST | `/api/oauth/token` | Token exchange endpoint |

#### OpenAPI

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/openapi.json` | OpenAPI 3.0 specification |

#### Projects (Dashboard)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/projects/[projectId]/activity` | Recent project activity feed |
| GET | `/api/projects/[projectId]/agents` | Agents assigned to project |
| GET | `/api/projects/[projectId]/coverage` | Embedding coverage metrics |
| GET | `/api/projects/[projectId]/drift` | Documentation drift events |
| GET | `/api/projects/[projectId]/health` | Project health score |
| GET | `/api/projects/[projectId]/invitations` | Pending invitations |
| POST | `/api/projects/[projectId]/invitations` | Send invitation |
| DELETE | `/api/projects/[projectId]/invitations/[invitationId]` | Cancel invitation |
| GET | `/api/projects/[projectId]/team` | Team members |
| PATCH | `/api/projects/[projectId]/team/[memberId]` | Update member role |
| DELETE | `/api/projects/[projectId]/team/[memberId]` | Remove member |
| GET | `/api/projects/by-slug/[slug]` | Resolve project by slug |

#### Proposals

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/proposals` | List proposals for project |
| POST | `/api/proposals` | Create a new proposal |
| GET | `/api/proposals/[id]` | Get proposal detail |
| POST | `/api/proposals/[id]/approve` | Approve and apply proposal |
| POST | `/api/proposals/[id]/reject` | Reject proposal |

#### Webhooks

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/webhooks/clerk` | Clerk webhook receiver (user/org sync) |

---

## Database (6 Neon Postgres Schemas)

All schemas use UUIDs as primary keys (with `defaultRandom()`), timestamps with timezone, and JSONB for flexible metadata. Vector columns use 1024 dimensions with the `voyage/voyage-4-lite` embedding model.

### Schema: `public`

Core multi-tenant entities.

#### `organizations`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `clerk_org_id` | text UNIQUE | Clerk organization ID (nullable for agent-created orgs) |
| `slug` | text UNIQUE NOT NULL | URL-safe identifier, must match `^[a-z0-9-]+$` |
| `name` | text NOT NULL | Display name |
| `tier` | text NOT NULL | `free`, `pro`, `team`, or `enterprise` |
| `settings` | jsonb | Organization-level settings |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Indexes:** clerk_org_id, slug, tier

#### `users`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `clerk_user_id` | text UNIQUE NOT NULL | Clerk user identifier |
| `email` | text NOT NULL | |
| `display_name` | text | |
| `avatar_url` | text | |
| `default_org_id` | uuid FK → organizations | Set null on org delete |
| `default_project_id` | uuid | No FK constraint (soft reference) |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Indexes:** clerk_user_id, email

#### `org_members`
| Column | Type | Description |
|--------|------|-------------|
| `org_id` | uuid FK → organizations | Cascade delete |
| `user_id` | uuid FK → users | Cascade delete |
| `role` | text NOT NULL | `owner`, `admin`, or `member` |
| `created_at` | timestamptz | |

**Primary Key:** (org_id, user_id)

#### `projects`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `org_id` | uuid FK → organizations | Cascade delete |
| `slug` | text NOT NULL | Must match `^[a-z0-9-]+$` |
| `name` | text | Display name |
| `description` | text | |
| `is_public` | boolean | Default false |
| `tier` | text NOT NULL | Inherits org tier or overrides: `free`, `pro`, `team`, `enterprise` |
| `settings` | jsonb | Project-level config |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Indexes:** UNIQUE(org_id, slug), org_id, is_public (partial: where true)

#### `project_members`
| Column | Type | Description |
|--------|------|-------------|
| `project_id` | uuid FK → projects | Cascade delete |
| `user_id` | uuid FK → users | Cascade delete |
| `role` | text NOT NULL | `admin`, `editor`, or `viewer` |
| `created_at` | timestamptz | |

**Primary Key:** (project_id, user_id)

---

### Schema: `agents`

Agent identity, authentication, and memory.

#### `agents.registry`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `org_id` | uuid FK → organizations | Cascade delete |
| `agent_name` | text NOT NULL | Must match `^[a-z0-9-]+$` |
| `display_name` | text | Human-readable name |
| `instance` | text NOT NULL | Node identifier (e.g., "montino", "aws") |
| `model` | text | LLM model used (e.g., "claude-sonnet-4-6") |
| `role` | text | `orchestrator`, `specialist`, `curator`, `admin`, or `agent` |
| `capabilities` | jsonb | Structured capability declarations |
| `metadata` | jsonb | Freeform metadata |
| `status` | text NOT NULL | `active`, `inactive`, or `archived` |
| `signing_key` | text NOT NULL | Ed25519 public key for message verification |
| `last_seen_at` | timestamptz | Updated on heartbeat |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Indexes:** UNIQUE(org_id, agent_name), (org_id, status), (instance, status)

#### `agents.api_keys`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `agent_id` | uuid FK → registry | Cascade delete |
| `org_id` | uuid FK → organizations | Cascade delete |
| `key_hash` | text UNIQUE NOT NULL | SHA-256 hash of the full API key |
| `key_prefix` | text NOT NULL | First 8 chars of key for identification (e.g., "qth_abcd") |
| `label` | text | Human description |
| `scopes` | text[] | Default `{read, write}` |
| `project_ids` | uuid[] | Optional project scope restriction |
| `rate_limit_rpm` | integer | Default 60 requests per minute |
| `expires_at` | timestamptz | Null = never expires |
| `last_used_at` | timestamptz | |
| `revoked_at` | timestamptz | Null = active |
| `created_at` | timestamptz | |
| `created_by` | uuid FK → users | |

**Indexes:** key_hash (partial: where not revoked), agent_id, org_id

#### `agents.agent_projects`
| Column | Type | Description |
|--------|------|-------------|
| `agent_id` | uuid FK → registry | Cascade delete |
| `project_id` | uuid FK → projects | Cascade delete |
| `role` | text | `owner`, `contributor`, or `readonly` |
| `assigned_at` | timestamptz | |
| `assigned_by` | uuid | |

**Primary Key:** (agent_id, project_id)

#### `agents.webhook_subscriptions`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `agent_id` | uuid FK → registry | Cascade delete |
| `org_id` | uuid FK → organizations | Cascade delete |
| `url` | text NOT NULL | Webhook delivery URL |
| `events` | text[] NOT NULL | Event types to subscribe to (GIN indexed) |
| `secret` | text NOT NULL | HMAC signing secret |
| `status` | text | `active`, `paused`, or `failed` |
| `failure_count` | integer | Incremented on delivery failure |
| `last_delivery_at` | timestamptz | |
| `created_at` | timestamptz | |

**Indexes:** (agent_id, status), events (GIN)

#### `agents.memory`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `agent_id` | uuid FK → registry | Cascade delete |
| `org_id` | uuid FK → organizations | Cascade delete |
| `project_id` | uuid FK → projects | Set null on delete |
| `key` | text NOT NULL | Memory key |
| `value` | text NOT NULL | Memory content |
| `namespace` | text NOT NULL | Default "default" |
| `embedding` | vector(1024) | voyage-4-lite embedding |
| `embedding_model` | text | Default "voyage/voyage-4-lite" |
| `tier` | text NOT NULL | `working` or `persistent` |
| `relevance_score` | double precision | Default 1.0, decays over time |
| `access_count` | integer | Read counter |
| `last_accessed_at` | timestamptz | |
| `decay_rate` | double precision | Default 0.05 |
| `tags` | text[] | GIN indexed |
| `metadata` | jsonb | |
| `source` | text | Origin identifier |
| `expires_at` | timestamptz | Auto-eviction |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Indexes:** UNIQUE(agent_id, namespace, key), embedding (HNSW cosine_ops, m=16, ef_construction=200), (agent_id, namespace), (agent_id, tier), (agent_id, tier, relevance_score), (agent_id, relevance_score), tags (GIN), expires_at (partial), project_id (partial)

---

### Schema: `docs`

Knowledge base document management with vector search.

#### `docs.documents`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `project_id` | uuid FK → projects | Cascade delete |
| `org_id` | uuid FK → organizations | Cascade delete |
| `file_path` | text NOT NULL | Source file path |
| `title` | text NOT NULL | Document title |
| `content` | text NOT NULL | Full text content |
| `checksum` | text NOT NULL | Content hash for change detection |
| `doc_type` | text | `architecture`, `testing-pattern`, `contract`, `meta`, `template`, `rules`, `patterns`, `reference`, `api`, `guide` |
| `visibility` | text NOT NULL | `project`, `shared`, or `public` |
| `tags` | text[] | GIN indexed |
| `agent_id` | uuid FK → registry | Authoring agent (set null on delete) |
| `indexing_status` | text | `pending`, `indexing`, `indexed`, `failed` |
| `version` | integer | Default 1, incremented on update |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Indexes:** UNIQUE(project_id, file_path), project_id, org_id, (visibility, org_id) partial, tags (GIN), indexing_status (partial: where not indexed), (project_id, doc_type), agent_id (partial)

#### `docs.chunks`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `document_id` | uuid FK → documents | Cascade delete |
| `project_id` | uuid FK → projects | Cascade delete |
| `content` | text NOT NULL | Chunk text |
| `chunk_hash` | text NOT NULL | Content hash for deduplication |
| `chunk_index` | integer NOT NULL | Position within document |
| `embedding` | vector(1024) | voyage-4-lite embedding |
| `embedding_model` | text NOT NULL | Default "voyage/voyage-4-lite" |
| `metadata` | jsonb | Chunk-level metadata |
| `title` | text NOT NULL | Inherited from parent document |
| `file_path` | text NOT NULL | Inherited from parent document |
| `created_at` | timestamptz | |
| `content_tsv` | tsvector | GENERATED ALWAYS — full-text search (read-only in Drizzle) |

**Indexes:** embedding (HNSW cosine_ops, m=16, ef_construction=200, partial: where model = voyage-4-lite), document_id, (project_id, embedding_model), (document_id, chunk_hash), content_tsv (GIN for FTS)

#### `docs.document_history`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `document_id` | uuid FK → documents | Cascade delete |
| `version` | integer NOT NULL | Version number |
| `content` | text NOT NULL | Full content at this version |
| `checksum` | text NOT NULL | Content hash |
| `changed_by` | uuid | User or agent who made the change |
| `change_type` | text | `create`, `update`, or `rollback` |
| `created_at` | timestamptz | |

**Indexes:** document_id

#### `docs.proposals`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `project_id` | uuid FK → projects | Cascade delete |
| `document_id` | uuid FK → documents | Set null on delete |
| `doc_id_ref` | text NOT NULL | Stable reference to document |
| `new_content` | text NOT NULL | Proposed replacement content |
| `evidence_snippet` | text | Supporting evidence |
| `reasoning` | text | Why the change is needed |
| `status` | text NOT NULL | `pending`, `approved`, `rejected`, or `applied` |
| `agent_id` | uuid FK → registry | Proposing agent |
| `source_instance` | text | Node that generated the proposal |
| `reviewed_by` | uuid FK → users | Human reviewer |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Indexes:** (project_id, status)

---

### Schema: `search`

Query caching, search logging, and documentation drift detection.

#### `search.query_cache`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `project_id` | uuid FK → projects | Cascade delete |
| `query_hash` | text NOT NULL | SHA-256 of normalized query |
| `query_text` | text NOT NULL | Original query |
| `embedding_model` | text NOT NULL | Model used for embedding |
| `result_ids` | uuid[] NOT NULL | Ordered result document/chunk IDs |
| `result_scores` | double precision[] NOT NULL | Corresponding similarity scores |
| `reranked` | boolean | Default false |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | Default: now() + 1 hour |

**Indexes:** UNIQUE(project_id, query_hash, embedding_model), (project_id, query_hash, embedding_model), expires_at

#### `search.logs`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `project_id` | uuid FK → projects | Cascade delete |
| `user_id` | uuid | Who searched (null for agents) |
| `agent_id` | uuid | Which agent searched (null for users) |
| `query` | text NOT NULL | Search query |
| `embedding_model` | text | Model used |
| `result_count` | integer NOT NULL | Number of results returned |
| `top_score` | real | Highest similarity score |
| `reranked` | boolean | Default false |
| `cache_hit` | boolean | Default false |
| `response_time_ms` | integer | Latency |
| `created_at` | timestamptz | |

**Indexes:** project_id, (project_id, result_count) partial (where result_count = 0, for miss tracking)

#### `search.drift_events`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `project_id` | uuid FK → projects | Cascade delete |
| `document_id` | uuid | Affected document |
| `severity` | text NOT NULL | `info`, `warning`, or `critical` |
| `drift_type` | text NOT NULL | `code_diverged`, `missing_doc`, `stale_doc`, `pattern_violation`, `embedding_stale`, `search_quality_drop` |
| `file_path` | text NOT NULL | Source file that drifted |
| `doc_path` | text | Documentation file path |
| `description` | text NOT NULL | Human-readable drift description |
| `expected_pattern` | text | What was expected |
| `actual_code` | text | What was found |
| `resolved` | boolean | Default false |
| `resolved_at` | timestamptz | |
| `resolved_by` | uuid | |
| `resolution_note` | text | |
| `detected_at` | timestamptz | |

**Indexes:** project_id, project_id (partial: where not resolved)

---

### Schema: `analytics`

Usage tracking, coverage metrics, and generation history.

#### `analytics.activity`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `project_id` | uuid FK → projects | Cascade delete |
| `org_id` | uuid FK → organizations | Cascade delete |
| `user_id` | uuid | |
| `agent_id` | uuid | |
| `event_type` | text NOT NULL | One of 30+ event types (see below) |
| `query` | text | For search events |
| `document_id` | uuid | For document events |
| `tool_name` | text | MCP tool name |
| `file_path` | text | Affected file |
| `result_count` | integer | |
| `relevance_score` | numeric(5,4) | |
| `response_time_ms` | integer | |
| `context` | jsonb | Additional event context |
| `created_at` | timestamptz | |

**Event types:** `search`, `read`, `read_chunks`, `propose`, `genesis`, `pattern_match`, `pattern_inject`, `drift_detected`, `coverage_scan`, `project_create`, `project_update`, `project_delete`, `agent_register`, `agent_update`, `agent_remove`, `agent_assign_project`, `agent_unassign_project`, `agent_message_sent`, `agent_inbox_read`, `reindex`, `agent_task_created`, `agent_task_updated`, `token_generate`, `agent_provision`, `webhook_delivery`, `channel_publish`, `memory_store`, `memory_search`, `memory_list`, `memory_forget`, `consolidation`, `cache_cleanup`

**Indexes:** project_id, (project_id, event_type), agent_id (partial)

#### `analytics.coverage_snapshots`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `project_id` | uuid FK → projects | Cascade delete |
| `total_documents` | integer NOT NULL | |
| `docs_with_embeddings` | integer NOT NULL | |
| `total_chunks` | integer NOT NULL | |
| `coverage_percentage` | numeric(5,2) | GENERATED column in SQL |
| `breakdown` | jsonb | Per-doc-type coverage stats |
| `scan_type` | text | `manual`, `scheduled`, or `genesis` |
| `created_at` | timestamptz | |

**Indexes:** project_id

#### `analytics.usage`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `project_id` | uuid FK → projects | Cascade delete |
| `usage_type` | text NOT NULL | `semantic_search`, `rag_answer`, `embedding_generation`, `rerank`, `webhook_delivery` |
| `usage_date` | date NOT NULL | Daily bucket |
| `count` | integer NOT NULL | Daily count |

**Indexes:** UNIQUE(project_id, usage_type, usage_date), (project_id, usage_type, usage_date)

#### `analytics.generations`
| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | nanoid |
| `user_id` | uuid FK → users | Set null on delete |
| `agent_id` | uuid FK → registry | Set null on delete |
| `project_id` | uuid FK → projects | Cascade delete |
| `model` | text NOT NULL | LLM model used |
| `prompt` | text NOT NULL | Input prompt |
| `result` | text | Generated output |
| `token_usage` | jsonb | `{ input, output, total }` |
| `estimated_cost_cents` | integer | Estimated cost in cents |
| `status` | text NOT NULL | `pending`, `streaming`, `complete`, or `error` |
| `created_at` | timestamptz | |

**Indexes:** project_id, user_id (partial), agent_id (partial), status (partial: pending/streaming), (project_id, model)

---

### Schema: `comms`

Inter-agent messaging, channels, task management, and webhook delivery.

#### `comms.channels`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `org_id` | uuid FK → organizations | Cascade delete |
| `name` | text NOT NULL | Must match `^[a-z0-9._-]+$` |
| `description` | text | |
| `channel_type` | text NOT NULL | `topic`, `direct`, or `project` |
| `project_id` | uuid FK → projects | Cascade delete (for project channels) |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |

**Indexes:** UNIQUE(org_id, name), org_id, project_id (partial)

#### `comms.channel_subscriptions`
| Column | Type | Description |
|--------|------|-------------|
| `channel_id` | uuid FK → channels | Cascade delete |
| `agent_id` | uuid FK → registry | Cascade delete |
| `subscribed_at` | timestamptz | |

**Primary Key:** (channel_id, agent_id)
**Indexes:** agent_id

#### `comms.messages`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `org_id` | uuid FK → organizations | Cascade delete |
| `from_agent_id` | uuid FK → registry NOT NULL | Sender |
| `to_agent_id` | uuid FK → registry | Direct message recipient |
| `channel_id` | uuid FK → channels | Channel broadcast target |
| `reply_to` | uuid | Self-referencing FK (managed in migration SQL) |
| `message_type` | text NOT NULL | `message`, `task`, `result`, `alert`, `knowledge`, `curator`, `broadcast` |
| `priority` | text | `low`, `normal`, `high`, `urgent` |
| `payload` | jsonb NOT NULL | Message content (flexible structure) |
| `signature` | text | Ed25519 signature for verification |
| `status` | text | `pending`, `delivered`, `read`, `failed`, `expired` |
| `delivered_at` | timestamptz | |
| `read_at` | timestamptz | |
| `error_message` | text | Delivery error detail |
| `retry_count` | integer | Default 0 |
| `expires_at` | timestamptz | Default: now() + 7 days |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Routing constraint:** Either `to_agent_id` (direct) or `channel_id` (broadcast) must be set, but not both.
**Indexes:** (to_agent_id, status, created_at), (channel_id, created_at), (from_agent_id, created_at), (to_agent_id, created_at) where pending, reply_to (partial)

#### `comms.tasks`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `org_id` | uuid FK → organizations | Cascade delete |
| `title` | text NOT NULL | Task title |
| `description` | text | |
| `assigned_to` | uuid FK → registry NOT NULL | Target agent |
| `created_by` | uuid FK → registry NOT NULL | Requesting agent |
| `project_id` | uuid FK → projects | Set null on delete |
| `status` | text | `pending`, `in_progress`, `done`, `failed`, `cancelled` |
| `priority` | integer | 1-10 scale (default 5) |
| `payload` | jsonb | Task input data |
| `result` | jsonb | Task output data |
| `started_at` | timestamptz | |
| `completed_at` | timestamptz | |
| `deadline` | timestamptz | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Indexes:** (assigned_to, status), project_id (partial), deadline (partial: where pending/in_progress)

#### `comms.webhook_deliveries`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `subscription_id` | uuid FK → webhook_subscriptions | Cascade delete |
| `message_id` | uuid FK → messages | Set null on delete |
| `url` | text NOT NULL | Delivery URL |
| `request_body` | jsonb NOT NULL | Sent payload |
| `response_status` | integer | HTTP status code |
| `response_body` | text | Response content |
| `attempt` | integer NOT NULL | Default 1 |
| `next_retry_at` | timestamptz | For exponential backoff |
| `status` | text | `pending`, `success`, `failed`, `retrying` |
| `created_at` | timestamptz | |

**Indexes:** subscription_id, next_retry_at (partial: where retrying)

---

## Key Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| `next` | 16 | App Router framework, RSC, Server Actions |
| `drizzle-orm` | latest | Type-safe ORM with schema-as-code |
| `@neondatabase/serverless` | ^1.0.2 | Neon Postgres serverless driver (WebSocket-based) |
| `@clerk/nextjs` | ^7.0.7 | Authentication, user management, org management |
| `ai` | ^6.0.141 | Vercel AI SDK for LLM integration |
| `@ai-sdk/openai` | ^3.0.48 | OpenAI-compatible provider (used with Vercel AI Gateway) |
| `@modelcontextprotocol/sdk` | ^1.29.0 | MCP server/client implementation for remote transport |
| `@react-email/components` | ^1.0.4 | Email templating |
| `@upstash/qstash` | ^2.10.1 | Async job scheduling (cron, delayed tasks) |
| `@upstash/ratelimit` | ^2.0.8 | Token-bucket rate limiting |
| `@upstash/redis` | ^1.36.3 | Redis client for rate limiter backing store |
| `@xyflow/react` | ^12.10.0 | Interactive node graph visualization (agent graph) |
| `class-variance-authority` | ^0.7.1 | Variant-based component styling |
| `clsx` | ^2.1.1 | Conditional CSS class merging |
| `tailwindcss` | via postcss | Utility-first CSS framework |
| `autoprefixer` | ^10.4.23 | CSS vendor prefixing |
| `braintrust` | ^3.7.0 | LLM evaluation and logging |
| `@vercel/analytics` | ^2.0.1 | Web analytics |
| `@vercel/speed-insights` | ^2.0.0 | Core Web Vitals monitoring |
| `@vercel/otel` | ^2.1.1 | OpenTelemetry integration |
| `@aws-sdk/client-s3` | ^3.1020.0 | S3 storage (document uploads) |
| `@aws-sdk/s3-request-presigner` | ^3.1020.0 | Presigned URLs for S3 |
| `@google/generative-ai` | ^0.24.1 | Google Gemini provider |
| `@hookform/resolvers` | ^5.2.2 | Form validation resolvers |
| `@mdx-js/react` | ^3.1.1 | MDX rendering for docs/blog |

### Radix UI Primitives (via shadcn/ui)

All UI components are built on Radix primitives: accordion, alert-dialog, avatar, dialog, dropdown-menu, label, navigation-menu, popover, progress, scroll-area, select, separator, slot, switch, tabs, toggle, toggle-group, tooltip.
