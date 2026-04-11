# Cloud Database (Neon Postgres)

> Version: 1.0.4 | Last updated: 2026-04-11

The Quoth SaaS platform uses Neon Postgres (serverless) as its cloud database, with Drizzle ORM for schema management and query building. The schema spans 6 Postgres schemas with 26 tables total, supporting multi-tenant organizations, agent coordination, document RAG, search analytics, and inter-agent communication.

## Overview

- **Provider:** Neon Postgres (serverless, scale-to-zero)
- **ORM:** Drizzle ORM with `@neondatabase/serverless` driver
- **Vector Extension:** pgvector with 1024-dimensional vectors (voyage/voyage-4-lite)
- **Schema Definition:** `src/db/schema.ts`
- **Connection Management:** `src/db/connection.ts`
- **Schemas:** `public`, `agents`, `docs`, `search`, `analytics`, `comms`

## Connection Management (`src/db/connection.ts`)

Three connection factory functions; all use singleton pattern (one instance per runtime).

| Function | Connection Type | When to Use |
|----------|----------------|-------------|
| `getDb()` | Pooled (`DATABASE_URL`) | Default — all non-session queries |
| `getUnpooledDb()` | Direct (`DATABASE_URL_UNPOOLED`) | Migrations, `SET LOCAL` session vars, advisory locks |
| `getSecureDb(orgId, userId?)` | Unpooled + RLS | All authenticated API routes |

### `getSecureDb(orgId, userId?)`

Sets `app.org_id` (and optionally `app.user_id`) as session-local config vars before returning the connection. These vars drive Row-Level Security policies on all schemas.

```ts
// Authenticated API route usage
const db = await getSecureDb(orgId, clerkUserId);
```

Cron/webhook routes that run as table owner should use `getDb()` directly — the table owner bypasses RLS.

A convenience alias `db` re-exports `getDb` for backwards compatibility.

## Schema: public (5 tables)

Core multi-tenant entities: organizations, users, projects, and their membership relationships.

### organizations

Multi-tenant root entity. Every other resource belongs to an organization.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `clerk_org_id` | text | UNIQUE | Clerk integration ID |
| `slug` | text | UNIQUE, NOT NULL | Must match `^[a-z0-9-]+$` |
| `name` | text | NOT NULL | Display name |
| `tier` | text | NOT NULL, DEFAULT `'free'` | CHECK IN (`free`, `pro`, `team`, `enterprise`) |
| `settings` | jsonb | DEFAULT `'{}'` | Organization-level settings |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_orgs_clerk` (clerk_org_id), `idx_orgs_slug` (slug), `idx_orgs_tier` (tier)

### users

User accounts linked to Clerk authentication.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `clerk_user_id` | text | UNIQUE, NOT NULL | Clerk user identifier |
| `email` | text | NOT NULL | |
| `display_name` | text | | |
| `avatar_url` | text | | |
| `default_org_id` | uuid | FK -> organizations, ON DELETE SET NULL | |
| `default_project_id` | uuid | | Not FK-constrained in schema |
| `metadata` | jsonb | DEFAULT `'{}'` | |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_users_clerk` (clerk_user_id), `idx_users_email` (email)

### org_members

Organization membership with role-based access.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `org_id` | uuid | PK (composite), FK -> organizations, CASCADE | |
| `user_id` | uuid | PK (composite), FK -> users, CASCADE | |
| `role` | text | NOT NULL, DEFAULT `'member'` | CHECK IN (`owner`, `admin`, `member`) |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_org_members_user` (user_id)

### projects

Project-level grouping within organizations.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `org_id` | uuid | FK -> organizations, CASCADE, NOT NULL | |
| `slug` | text | NOT NULL | Must match `^[a-z0-9-]+$` |
| `name` | text | | |
| `description` | text | | |
| `is_public` | boolean | DEFAULT false | |
| `tier` | text | NOT NULL, DEFAULT `'free'` | CHECK IN (`free`, `pro`, `team`, `enterprise`) |
| `settings` | jsonb | DEFAULT `'{}'` | |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_projects_org_slug` (org_id, slug) UNIQUE, `idx_projects_org` (org_id), `idx_projects_slug` (org_id, slug), `idx_projects_public` (is_public) WHERE `is_public = true`

### project_members

Project-level membership with granular roles.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `project_id` | uuid | PK (composite), FK -> projects, CASCADE | |
| `user_id` | uuid | PK (composite), FK -> users, CASCADE | |
| `role` | text | NOT NULL, DEFAULT `'viewer'` | CHECK IN (`admin`, `editor`, `viewer`) |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_project_members_user` (user_id)

## Schema: agents (5 tables)

Agent registration, authentication, project assignment, webhooks, and agent-scoped memory with vector search.

### agents.registry

Central agent registry. Each agent belongs to an organization and runs on a named instance.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `org_id` | uuid | FK -> organizations, CASCADE, NOT NULL | |
| `agent_name` | text | NOT NULL | Must match `^[a-z0-9-]+$` |
| `display_name` | text | | Human-readable name |
| `instance` | text | NOT NULL | Deployment instance (e.g., `"montino"`, `"aws"`) |
| `model` | text | | LLM model identifier |
| `role` | text | | CHECK IN (`orchestrator`, `specialist`, `curator`, `admin`, `agent`) |
| `capabilities` | jsonb | DEFAULT `'{}'` | Structured capability map |
| `metadata` | jsonb | DEFAULT `'{}'` | Arbitrary agent metadata |
| `status` | text | NOT NULL, DEFAULT `'active'` | CHECK IN (`active`, `inactive`, `archived`) |
| `signing_key` | text | NOT NULL | HMAC key for message signing |
| `last_seen_at` | timestamptz | | Last heartbeat/activity |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_agents_org_name` (org_id, agent_name) UNIQUE, `idx_agents_org_status` (org_id, status), `idx_agents_instance` (instance, status)

### agents.api_keys

API key management for agent authentication. Keys are stored as SHA-256 hashes; the raw key is only shown once at creation.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `agent_id` | uuid | FK -> registry, CASCADE, NOT NULL | |
| `org_id` | uuid | FK -> organizations, CASCADE, NOT NULL | |
| `key_hash` | text | UNIQUE, NOT NULL | SHA-256 hash of the full key |
| `key_prefix` | text | NOT NULL | First 12 chars for identification (e.g., `"qth_abcd1234"`) |
| `label` | text | | Human-readable key label |
| `scopes` | text[] | DEFAULT `{read, write}` | Permission scopes array |
| `project_ids` | uuid[] | | Restrict key to specific projects |
| `rate_limit_rpm` | integer | DEFAULT 60 | Requests per minute limit |
| `expires_at` | timestamptz | | Optional expiration |
| `last_used_at` | timestamptz | | Tracks key usage |
| `revoked_at` | timestamptz | | Soft revocation timestamp |
| `created_at` | timestamptz | DEFAULT now() | |
| `created_by` | uuid | FK -> users | Key creator |

**Indexes:** `idx_api_keys_hash` (key_hash) WHERE `revoked_at IS NULL`, `idx_api_keys_agent` (agent_id), `idx_api_keys_org` (org_id)

### agents.agent_projects

Many-to-many relationship between agents and projects with role-based access.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `agent_id` | uuid | PK (composite), FK -> registry, CASCADE | |
| `project_id` | uuid | PK (composite), FK -> projects, CASCADE | |
| `role` | text | DEFAULT `'contributor'` | CHECK IN (`owner`, `contributor`, `readonly`) |
| `assigned_at` | timestamptz | DEFAULT now() | |
| `assigned_by` | uuid | | User who made the assignment |

**Indexes:** `idx_agent_projects_project` (project_id)

### agents.webhook_subscriptions

Event-driven webhook subscriptions for agents.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `agent_id` | uuid | FK -> registry, CASCADE, NOT NULL | |
| `org_id` | uuid | FK -> organizations, CASCADE, NOT NULL | |
| `url` | text | NOT NULL | Webhook delivery URL |
| `events` | text[] | NOT NULL | Event types to subscribe to |
| `secret` | text | NOT NULL | HMAC secret for payload signing |
| `status` | text | DEFAULT `'active'` | CHECK IN (`active`, `paused`, `failed`) |
| `failure_count` | integer | DEFAULT 0 | Consecutive failures |
| `last_delivery_at` | timestamptz | | |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_webhooks_agent` (agent_id, status), `idx_webhooks_events` (events) GIN

### agents.memory

Agent-scoped key-value memory with vector embeddings for semantic search. This is the cloud equivalent of the local `memory_entries` table, with richer features.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `agent_id` | uuid | FK -> registry, CASCADE, NOT NULL | |
| `org_id` | uuid | FK -> organizations, CASCADE, NOT NULL | |
| `project_id` | uuid | FK -> projects, ON DELETE SET NULL | Optional project scoping |
| `key` | text | NOT NULL | Lookup key |
| `value` | text | NOT NULL | Stored content |
| `namespace` | text | NOT NULL, DEFAULT `'default'` | Isolation namespace |
| `embedding` | vector(1024) | | pgvector column for semantic search |
| `embedding_model` | text | DEFAULT `'voyage/voyage-4-lite'` | Model that generated the embedding |
| `tier` | text | NOT NULL, DEFAULT `'working'` | CHECK IN (`working`, `persistent`) |
| `relevance_score` | double | NOT NULL, DEFAULT 1.0 | Decay-adjusted relevance |
| `access_count` | integer | NOT NULL, DEFAULT 0 | Read counter |
| `last_accessed_at` | timestamptz | DEFAULT now() | |
| `decay_rate` | double | DEFAULT 0.05 | Per-access decay rate |
| `tags` | text[] | | GIN-indexed tag array |
| `metadata` | jsonb | DEFAULT `'{}'` | |
| `source` | text | | Origin identifier |
| `expires_at` | timestamptz | | Optional TTL |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes:**
- `idx_memory_agent_ns_key` (agent_id, namespace, key) UNIQUE
- `idx_memory_embedding` HNSW (embedding vector_cosine_ops) WHERE `embedding IS NOT NULL`, m=16, ef_construction=200
- `idx_memory_agent_ns` (agent_id, namespace)
- `idx_memory_agent_tier` (agent_id, tier)
- `idx_memory_agent_tier_relevance` (agent_id, tier, relevance_score)
- `idx_memory_relevance` (agent_id, relevance_score)
- `idx_memory_tags` GIN (tags)
- `idx_memory_expires` (expires_at) WHERE `expires_at IS NOT NULL`
- `idx_memory_project` (project_id) WHERE `project_id IS NOT NULL`

## Schema: docs (4 tables)

Document management, chunking for RAG, version history, and agent-submitted change proposals.

### docs.documents

Master document records with full content and indexing status tracking.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `project_id` | uuid | FK -> projects, CASCADE, NOT NULL | |
| `org_id` | uuid | FK -> organizations, CASCADE, NOT NULL | |
| `file_path` | text | NOT NULL | Relative path within the project |
| `title` | text | NOT NULL | Document title |
| `content` | text | NOT NULL | Full document content |
| `checksum` | text | NOT NULL | Content hash for change detection |
| `doc_type` | text | | CHECK IN (`architecture`, `testing-pattern`, `contract`, `meta`, `template`, `rules`, `patterns`, `reference`, `api`, `guide`) |
| `visibility` | text | NOT NULL, DEFAULT `'project'` | CHECK IN (`project`, `shared`, `public`) |
| `tags` | text[] | | GIN-indexed classification tags |
| `agent_id` | uuid | FK -> registry, ON DELETE SET NULL | Authoring agent |
| `indexing_status` | text | DEFAULT `'pending'` | CHECK IN (`pending`, `indexing`, `indexed`, `failed`) |
| `version` | integer | DEFAULT 1 | Document version counter |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes:**
- `idx_docs_project_filepath` (project_id, file_path) UNIQUE
- `idx_docs_project` (project_id)
- `idx_docs_org` (org_id)
- `idx_docs_visibility` (visibility, org_id) WHERE `visibility IN ('shared', 'public')`
- `idx_docs_tags` GIN (tags)
- `idx_docs_indexing` (indexing_status) WHERE `indexing_status != 'indexed'`
- `idx_docs_type` (project_id, doc_type)
- `idx_docs_agent` (agent_id) WHERE `agent_id IS NOT NULL`

### docs.chunks

Document chunks for vector search and full-text search. Each chunk has an embedding and a generated `tsvector` column.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `document_id` | uuid | FK -> documents, CASCADE, NOT NULL | |
| `project_id` | uuid | FK -> projects, CASCADE, NOT NULL | Denormalized for efficient queries |
| `content` | text | NOT NULL | Chunk text |
| `chunk_hash` | text | NOT NULL | Content hash for dedup |
| `chunk_index` | integer | NOT NULL | Position within the document |
| `embedding` | vector(1024) | | pgvector column |
| `embedding_model` | text | NOT NULL, DEFAULT `'voyage/voyage-4-lite'` | |
| `metadata` | jsonb | DEFAULT `'{}'` | |
| `title` | text | NOT NULL | Inherited from document |
| `file_path` | text | NOT NULL | Inherited from document |
| `created_at` | timestamptz | DEFAULT now() | |
| `content_tsv` | tsvector | GENERATED ALWAYS | Full-text search vector (managed by Postgres) |

**Indexes:**
- `idx_chunks_embedding` HNSW (embedding vector_cosine_ops) WHERE `embedding_model = 'voyage/voyage-4-lite'`, m=16, ef_construction=200
- `idx_chunks_document` (document_id)
- `idx_chunks_project_model` (project_id, embedding_model)
- `idx_chunks_hash` (document_id, chunk_hash)
- `idx_chunks_fts` GIN (content_tsv) -- full-text search

Note: The `content_tsv` column is defined as `tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED` in the SQL migration. Drizzle maps it as `text` (read-only) because it lacks native tsvector support.

### docs.document_history

Version history for document edits and rollbacks.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `document_id` | uuid | FK -> documents, CASCADE, NOT NULL | |
| `version` | integer | NOT NULL | Version number |
| `content` | text | NOT NULL | Full content snapshot |
| `checksum` | text | NOT NULL | Content hash |
| `changed_by` | uuid | | User or agent who made the change |
| `change_type` | text | | CHECK IN (`create`, `update`, `rollback`) |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_doc_history_doc` (document_id)

### docs.proposals

Agent-submitted document change proposals with review workflow.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `project_id` | uuid | FK -> projects, CASCADE, NOT NULL | |
| `document_id` | uuid | FK -> documents, ON DELETE SET NULL | Existing document (if updating) |
| `doc_id_ref` | text | NOT NULL | Stable document reference |
| `new_content` | text | NOT NULL | Proposed content |
| `evidence_snippet` | text | | Supporting evidence |
| `reasoning` | text | | Agent's reasoning for the change |
| `status` | text | NOT NULL, DEFAULT `'pending'` | CHECK IN (`pending`, `approved`, `rejected`, `applied`) |
| `agent_id` | uuid | FK -> registry, ON DELETE SET NULL | Proposing agent |
| `source_instance` | text | | Instance the proposal originated from |
| `reviewed_by` | uuid | FK -> users | Human reviewer |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_proposals_project` (project_id, status)

## Schema: search (3 tables)

Search infrastructure: query caching, audit logging, and code-documentation drift detection.

### search.query_cache

Persistent query result cache with automatic 1-hour TTL.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `project_id` | uuid | FK -> projects, CASCADE, NOT NULL | |
| `query_hash` | text | NOT NULL | SHA-256 of normalized `{projectId}:{query}:{model}` |
| `query_text` | text | NOT NULL | Original query for debugging |
| `embedding_model` | text | NOT NULL | Model used for embedding |
| `result_ids` | uuid[] | NOT NULL | Ordered chunk IDs |
| `result_scores` | double[] | NOT NULL | Corresponding similarity/rerank scores |
| `reranked` | boolean | DEFAULT false | Whether results were reranked |
| `created_at` | timestamptz | DEFAULT now() | |
| `expires_at` | timestamptz | DEFAULT `now() + INTERVAL '1 hour'` | Cache expiration |

**Indexes:**
- `idx_query_cache_unique` (project_id, query_hash, embedding_model) UNIQUE
- `idx_query_cache_lookup` (project_id, query_hash, embedding_model)
- `idx_query_cache_expire` (expires_at) -- for TTL cleanup

### search.logs

Search audit log for analytics and quality monitoring.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `project_id` | uuid | FK -> projects, CASCADE, NOT NULL | |
| `user_id` | uuid | | Human searcher |
| `agent_id` | uuid | | Agent searcher |
| `query` | text | NOT NULL | Search query |
| `embedding_model` | text | | Model used |
| `result_count` | integer | NOT NULL, DEFAULT 0 | Number of results returned |
| `top_score` | real | | Highest similarity score |
| `reranked` | boolean | DEFAULT false | Whether reranking was applied |
| `cache_hit` | boolean | DEFAULT false | Whether result was served from cache |
| `response_time_ms` | integer | | End-to-end latency |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes:**
- `idx_search_logs_project` (project_id)
- `idx_search_logs_misses` (project_id, result_count) WHERE `result_count = 0` -- for zero-result monitoring

### search.drift_events

Code-documentation drift detection events. Tracks when code diverges from its documentation.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `project_id` | uuid | FK -> projects, CASCADE, NOT NULL | |
| `document_id` | uuid | | Related document |
| `severity` | text | NOT NULL | CHECK IN (`info`, `warning`, `critical`) |
| `drift_type` | text | NOT NULL | CHECK IN (`code_diverged`, `missing_doc`, `stale_doc`, `pattern_violation`, `embedding_stale`, `search_quality_drop`) |
| `file_path` | text | NOT NULL | Affected source file |
| `doc_path` | text | | Corresponding documentation path |
| `description` | text | NOT NULL | Human-readable drift description |
| `expected_pattern` | text | | What the documentation expected |
| `actual_code` | text | | What the code actually does |
| `resolved` | boolean | DEFAULT false | Resolution status |
| `resolved_at` | timestamptz | | |
| `resolved_by` | uuid | | |
| `resolution_note` | text | | |
| `detected_at` | timestamptz | DEFAULT now() | |

**Indexes:**
- `idx_drift_project` (project_id)
- `idx_drift_unresolved` (project_id) WHERE `resolved = false`

## Schema: analytics (4 tables)

Usage tracking, embedding coverage monitoring, LLM generation logging, and comprehensive activity audit trail.

### analytics.activity

Comprehensive event log covering all system actions. Used for audit trails and usage dashboards.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `project_id` | uuid | FK -> projects, CASCADE, NOT NULL | |
| `org_id` | uuid | FK -> organizations, CASCADE, NOT NULL | |
| `user_id` | uuid | | Human actor |
| `agent_id` | uuid | | Agent actor |
| `event_type` | text | NOT NULL | See event types below |
| `query` | text | | Search query (for search events) |
| `document_id` | uuid | | Related document |
| `tool_name` | text | | MCP tool name |
| `file_path` | text | | Affected file |
| `result_count` | integer | | |
| `relevance_score` | numeric(5,4) | | |
| `response_time_ms` | integer | | |
| `context` | jsonb | DEFAULT `'{}'` | Additional event context |
| `created_at` | timestamptz | DEFAULT now() | |

**Event Types (33):** `search`, `read`, `read_chunks`, `propose`, `genesis`, `pattern_match`, `pattern_inject`, `drift_detected`, `coverage_scan`, `project_create`, `project_update`, `project_delete`, `agent_register`, `agent_update`, `agent_remove`, `agent_assign_project`, `agent_unassign_project`, `agent_message_sent`, `agent_inbox_read`, `reindex`, `agent_task_created`, `agent_task_updated`, `token_generate`, `agent_provision`, `webhook_delivery`, `channel_publish`, `memory_store`, `memory_search`, `memory_list`, `memory_forget`, `consolidation`, `cache_cleanup`

**Indexes:** `idx_activity_project` (project_id), `idx_activity_event` (project_id, event_type), `idx_activity_agent` (agent_id) WHERE `agent_id IS NOT NULL`

### analytics.coverage_snapshots

Periodic snapshots of embedding coverage across project documents.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `project_id` | uuid | FK -> projects, CASCADE, NOT NULL | |
| `total_documents` | integer | NOT NULL, DEFAULT 0 | |
| `docs_with_embeddings` | integer | NOT NULL, DEFAULT 0 | |
| `total_chunks` | integer | NOT NULL, DEFAULT 0 | |
| `coverage_percentage` | numeric(5,2) | GENERATED | `docs_with_embeddings / total_documents * 100` |
| `breakdown` | jsonb | DEFAULT `'{}'` | Per-type coverage breakdown |
| `scan_type` | text | DEFAULT `'manual'` | CHECK IN (`manual`, `scheduled`, `genesis`) |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_coverage_project` (project_id)

### analytics.usage

Daily aggregated usage counters per project and usage type. Used for billing and quota enforcement.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `project_id` | uuid | FK -> projects, CASCADE, NOT NULL | |
| `usage_type` | text | NOT NULL | CHECK IN (`semantic_search`, `rag_answer`, `embedding_generation`, `rerank`, `webhook_delivery`) |
| `usage_date` | date | NOT NULL, DEFAULT now() | Day-level granularity |
| `count` | integer | NOT NULL, DEFAULT 0 | Aggregated count |

**Indexes:** `idx_usage_unique` (project_id, usage_type, usage_date) UNIQUE, `idx_usage_lookup` (project_id, usage_type, usage_date)

### analytics.generations

LLM generation tracking for cost monitoring and debugging.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | text | PK | nanoid-generated |
| `user_id` | uuid | FK -> users, ON DELETE SET NULL | |
| `agent_id` | uuid | FK -> registry, ON DELETE SET NULL | |
| `project_id` | uuid | FK -> projects, CASCADE, NOT NULL | |
| `model` | text | NOT NULL | LLM model identifier |
| `prompt` | text | NOT NULL | Input prompt |
| `result` | text | | Generated output |
| `token_usage` | jsonb | | `{prompt_tokens, completion_tokens, total_tokens}` |
| `estimated_cost_cents` | integer | | Cost estimate in cents |
| `status` | text | NOT NULL, DEFAULT `'pending'` | CHECK IN (`pending`, `streaming`, `complete`, `error`) |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_generations_project` (project_id), `idx_generations_user` (user_id) WHERE NOT NULL, `idx_generations_agent` (agent_id) WHERE NOT NULL, `idx_generations_status` (status) WHERE `status IN ('pending', 'streaming')`, `idx_generations_model` (project_id, model)

## Schema: comms (5 tables)

Inter-agent communication: channels, subscriptions, direct/broadcast messaging, task assignment, and webhook delivery.

### comms.channels

Communication channels scoped to an organization. Can be topic-based, direct, or project-scoped.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `org_id` | uuid | FK -> organizations, CASCADE, NOT NULL | |
| `name` | text | NOT NULL | Must match `^[a-z0-9._-]+$` |
| `description` | text | | |
| `channel_type` | text | NOT NULL, DEFAULT `'topic'` | CHECK IN (`topic`, `direct`, `project`) |
| `project_id` | uuid | FK -> projects, CASCADE | Required for `project` type channels |
| `metadata` | jsonb | DEFAULT `'{}'` | |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_channels_org_name` (org_id, name) UNIQUE, `idx_channels_org` (org_id), `idx_channels_project` (project_id) WHERE `project_id IS NOT NULL`

### comms.channel_subscriptions

Agent subscriptions to channels.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `channel_id` | uuid | PK (composite), FK -> channels, CASCADE | |
| `agent_id` | uuid | PK (composite), FK -> registry, CASCADE | |
| `subscribed_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_channel_subs_agent` (agent_id)

### comms.messages

Agent messaging system with routing constraint: each message goes to either a specific agent OR a channel, never both.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `org_id` | uuid | FK -> organizations, CASCADE, NOT NULL | |
| `from_agent_id` | uuid | FK -> registry, NOT NULL | Sender |
| `to_agent_id` | uuid | FK -> registry | Direct recipient (mutually exclusive with channel_id) |
| `channel_id` | uuid | FK -> channels, CASCADE | Broadcast channel (mutually exclusive with to_agent_id) |
| `reply_to` | uuid | | References messages(id) via SQL migration |
| `message_type` | text | NOT NULL, DEFAULT `'message'` | CHECK IN (`message`, `task`, `result`, `alert`, `knowledge`, `curator`, `broadcast`) |
| `priority` | text | DEFAULT `'normal'` | CHECK IN (`low`, `normal`, `high`, `urgent`) |
| `payload` | jsonb | NOT NULL | Message content |
| `signature` | text | | HMAC signature for verification |
| `status` | text | DEFAULT `'pending'` | CHECK IN (`pending`, `delivered`, `read`, `failed`, `expired`) |
| `delivered_at` | timestamptz | | |
| `read_at` | timestamptz | | |
| `error_message` | text | | Delivery error details |
| `retry_count` | integer | DEFAULT 0 | |
| `expires_at` | timestamptz | DEFAULT `now() + INTERVAL '7 days'` | Message TTL |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Routing Constraint:** `CHECK ((to_agent_id IS NOT NULL AND channel_id IS NULL) OR (to_agent_id IS NULL AND channel_id IS NOT NULL))`

**Indexes:**
- `idx_messages_inbox` (to_agent_id, status, created_at) WHERE `to_agent_id IS NOT NULL`
- `idx_messages_channel` (channel_id, created_at) WHERE `channel_id IS NOT NULL`
- `idx_messages_from` (from_agent_id, created_at)
- `idx_messages_pending` (to_agent_id, created_at) WHERE `status = 'pending'`
- `idx_messages_reply` (reply_to) WHERE `reply_to IS NOT NULL`

### comms.tasks

Task assignment and tracking between agents.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `org_id` | uuid | FK -> organizations, CASCADE, NOT NULL | |
| `title` | text | NOT NULL | |
| `description` | text | | |
| `assigned_to` | uuid | FK -> registry, NOT NULL | Assigned agent |
| `created_by` | uuid | FK -> registry, NOT NULL | Requesting agent |
| `project_id` | uuid | FK -> projects, ON DELETE SET NULL | |
| `status` | text | DEFAULT `'pending'` | CHECK IN (`pending`, `in_progress`, `done`, `failed`, `cancelled`) |
| `priority` | integer | DEFAULT 5 | CHECK BETWEEN 1 AND 10 |
| `payload` | jsonb | | Task input data |
| `result` | jsonb | | Task output data |
| `started_at` | timestamptz | | |
| `completed_at` | timestamptz | | |
| `deadline` | timestamptz | | |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_tasks_assigned` (assigned_to, status), `idx_tasks_project` (project_id) WHERE `project_id IS NOT NULL`, `idx_tasks_deadline` (deadline) WHERE `deadline IS NOT NULL AND status IN ('pending', 'in_progress')`

### comms.webhook_deliveries

Webhook delivery tracking with retry support.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom | |
| `subscription_id` | uuid | FK -> webhook_subscriptions, CASCADE, NOT NULL | |
| `message_id` | uuid | FK -> messages, ON DELETE SET NULL | Triggering message |
| `url` | text | NOT NULL | Delivery URL |
| `request_body` | jsonb | NOT NULL | Sent payload |
| `response_status` | integer | | HTTP response code |
| `response_body` | text | | Response content |
| `attempt` | integer | NOT NULL, DEFAULT 1 | Current attempt number |
| `next_retry_at` | timestamptz | | Scheduled retry time |
| `status` | text | DEFAULT `'pending'` | CHECK IN (`pending`, `success`, `failed`, `retrying`) |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes:** `idx_webhook_delivery_sub` (subscription_id), `idx_webhook_delivery_retry` (next_retry_at) WHERE `status = 'retrying'`
