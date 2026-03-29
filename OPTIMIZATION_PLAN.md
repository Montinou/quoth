# Quoth Optimization & Redesign Plan

**Version:** 1.1
**Date:** 2026-03-29
**Status:** Draft -- Updated: Vercel AI Gateway for embeddings, Jina/Cohere reranking only

> **v1.1 Changes:** Embedding provider switched from Jina to Vercel AI Gateway
> (`text-embedding-3-small`, 1536d). Jina and Cohere retained for reranking only.
> All DDL, functions, and code updated to reflect 1536d vectors.

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [New Multi-Schema Design](#2-new-multi-schema-design)
3. [Clerk Integration Plan](#3-clerk-integration-plan)
4. [Communication Bus Design](#4-communication-bus-design)
5. [RAG Pipeline Optimization](#5-rag-pipeline-optimization)
6. [Migration Strategy](#6-migration-strategy)
7. [API Route Redesign](#7-api-route-redesign)

---

## 1. Current State Analysis

### 1.1 Current Schema (Supabase, all in `public` schema)

| Table | Purpose | Status |
|-------|---------|--------|
| `projects` | Multi-tenant project container | Working. Has `organization_id`, `tier`, `is_public`, `owner_id` columns added over 39 migrations. |
| `organizations` | Org-level grouping (v3.0) | Working. Links to `auth.users` via `owner_user_id`. |
| `profiles` | User profiles synced from `auth.users` | Working. Has `default_project_id` for JWT hook. |
| `project_members` | User-project-role junction | Working. Roles: admin/editor/viewer. |
| `project_api_keys` | JWT token storage (hash + prefix) | Working but underused -- only 1 key in production. |
| `project_invitations` | Email invitations | Working. 0 rows in production. |
| `documents` | Markdown/code files with content | Working. 96 docs across 4 projects. Has `agent_id`, `visibility`, `tags`, `indexing_status`, `doc_type`. |
| `document_embeddings` | Vector chunks (512d) | Working. 836 rows. Has `embedding_model` column for dual model support. HNSW index (m=16, ef=64). |
| `document_history` | Version tracking | Working. 36 rows. |
| `document_proposals` | Change proposals with approval flow | Working. 0 rows. |
| `agents` | Agent registry (v3.0) | Working. Has `signing_key` (HMAC), `capabilities` JSONB, `status`. |
| `agent_projects` | Agent-to-project assignment (M2M) | Working. Roles: owner/contributor/readonly. |
| `agent_messages` | 1-to-1 agent messaging (v3.0 Phase 2) | Stubbed. Table exists with full schema (HMAC signature, priority, status lifecycle) but no real usage from MCP tools. Realtime enabled via `supabase_realtime` publication. |
| `agent_tasks` | Structured task queue | Stubbed. Table exists but minimal tool integration. |
| `curator_log` | Curator agent run history | Working. |
| `quoth_activity` | Activity/usage analytics | Working. 218 rows. |
| `coverage_snapshot` | Point-in-time coverage metrics | Working. 10 rows. |
| `drift_events` | Documentation drift detection | Working. |

**What works:**
- Core RAG pipeline (embed -> search -> rerank) is functional
- Embedding support (migrating from Jina to Vercel AI Gateway `text-embedding-3-small`)
- Multi-tenant isolation via `project_id` parameter in all queries
- Tier system (free/pro/team) with in-memory usage tracking
- AST-based chunking via Tree-Sitter WASM
- MCP tool registration with auth context
- HMAC message signing infrastructure

**What doesn't work or is problematic:**
1. **All tables in `public` schema** -- no logical separation, 39 migrations with accumulated cruft
2. **RLS policies are complex and slow** -- nested `EXISTS` subqueries on every row access, multiple overlapping policies per table (audit findings from migrations 026-031)
3. **Supabase Auth coupling** -- `auth.users`, `auth.uid()`, `auth.role()` baked into every RLS policy and trigger. Impossible to use outside Supabase.
4. **In-memory tier tracking** -- `usageMap` resets on every serverless cold start. Free tier limits are effectively unenforced in production.
5. **Agent communication is 90% stubbed** -- `agent_messages` and `agent_tasks` tables exist but only basic CRUD tools interact with them. No real-time delivery, no webhook dispatch, no LISTEN/NOTIFY.
6. **No search caching at DB level** -- LRU cache in `cache.ts` is per-instance, lost on cold start
7. **Batch embedding is sequential** -- `generateEmbeddingsBatch()` processes one at a time with 1s delay. `indexDocumentAsync()` uses 4.2s delay per chunk (Jina rate limit).
8. **IVFFlat was replaced by HNSW but parameters are not tuned** -- m=16, ef_construction=64 is conservative for 836 rows.
9. **56% of documents have NULL doc_type** -- auto-categorization in coverage.ts is a runtime hack, not a proper migration.
10. **Mixed embedding dimensions** -- migration 001 created 768d (Gemini), migration 018 truncated to 512d (Jina). Gemini fallback in `ai.ts` returns 768d, which would silently fail HNSW lookup.

### 1.2 Current Auth Flow

```
User signs up via Supabase Auth (email/password or OAuth)
  -> auth.users trigger fires handle_new_user()
    -> Creates profile in public.profiles
    -> Creates default project + project_members(admin)
    -> Sets default_project_id on profile

User logs in
  -> Supabase issues JWT
  -> Custom Access Token Hook (migration 020) injects project_id + mcp_role into JWT claims
  -> MCP client sends JWT as Bearer token

MCP Auth Middleware (mcp-auth.ts)
  -> Decodes JWT, checks issuer
  -> If Supabase: calls supabase.auth.getUser() to verify, then decodes JWT for hook claims
  -> If Custom JWT: verifies with jose/jwtVerify against JWT_SECRET
  -> Returns AuthContext { project_id, user_id, role, available_projects }
  -> All tool handlers receive AuthContext, pass project_id to queries
```

**Problems:**
- Supabase Auth is a black box -- token format, hook system, refresh flow all proprietary
- Custom JWT path still requires Supabase for available_projects lookup
- No M2M auth path -- agents must use human user tokens
- No API key rotation mechanism beyond manual DB operations
- SSE auth puts JWT in query params (logged in access logs, not ideal)

### 1.3 Current RAG Pipeline Flow

```
Query arrives at MCP tool (quoth_search_index or quoth_search_chunks)
  -> Check tier usage limit (in-memory counter)
  -> If limit exceeded: keyword fallback (Postgres FTS / ilike)
  -> Auto-detect code vs text query (regex keyword match)
  -> [CHANGING] Select embedding model: Vercel AI Gateway (text-embedding-3-small, 1536d)
  -> [CHANGING] Call Vercel AI Gateway: model=text-embedding-3-small, dimensions=1536
  -> Call Supabase RPC match_documents(embedding, threshold=0.1, count=50, project_id, model)
    -> HNSW index scan, cosine distance, filter by project + model
  -> If tier allows rerank (pro/team, or genesis mode):
    -> Cohere rerank-english-v3.0, topN=30
    -> Dynamic cutoff: keep >= 15 results above 0.5, stop below 0.65 after 15
  -> Else: return top 10 vector results
  -> Transform to DocumentReference or ChunkReference
  -> Log activity to quoth_activity (non-blocking)

For RAG answers (quoth_ask):
  -> Run search pipeline above
  -> If CF_RAG_WORKER_URL configured: POST to Cloudflare Worker (Mistral Small 3.1 24B)
  -> Else if Gemini API key: use Gemini 2.0 Flash
  -> Return { answer, sources, relatedQuestions }
```

**Problems:**
- 50 candidates fetched but threshold=0.1 is too low (noise)
- No query expansion or hybrid search (vector-only, no FTS fusion)
- Embedding model selection is regex-based, not learned
- No result caching at query level
- Reranking is all-or-nothing per tier (no partial rerank)

### 1.4 Current Agent Communication

**Working:**
- Agent CRUD (register, update, remove, list) via MCP tools
- Agent-to-project assignment
- HMAC signing key generation and verification
- Basic message send/receive via `quoth_agent_send_message` and `quoth_agent_inbox`
- Message status lifecycle (pending -> delivered -> read)

**Stubbed/Missing:**
- No real-time push (Supabase Realtime publication exists but no client subscription)
- No webhook delivery
- No broadcast/topic channels
- No cross-project message routing
- No retry/exponential backoff on delivery failure
- `agent_tasks` has no MCP tool for task creation or status updates
- No LISTEN/NOTIFY integration

---

## 2. New Multi-Schema Design

### 2.1 Schema Overview

```
NeonDB
  |-- public        App config, organizations, users (Clerk-managed)
  |-- agents        Agent registry, inbox, signing keys, webhooks, agent_projects
  |-- docs          Documents, chunks, embeddings, metadata, indexing state
  |-- search        HNSW indexes, query cache, search logs, drift detection
  |-- analytics     Activity logs, coverage snapshots, usage/billing
  |-- comms         Communication bus, channels, message routing
```

### 2.2 Schema: `public`

```sql
-- =============================================================
-- Schema: public -- App config, organizations, Clerk-managed users
-- =============================================================

-- Organizations (top-level tenant boundary)
CREATE TABLE public.organizations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_org_id TEXT UNIQUE,                      -- Clerk organization ID (org_xxx)
  slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'team', 'enterprise')),
  settings JSONB DEFAULT '{}'::jsonb,            -- Feature flags, limits overrides
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_orgs_clerk ON public.organizations(clerk_org_id) WHERE clerk_org_id IS NOT NULL;
CREATE INDEX idx_orgs_slug ON public.organizations(slug);
CREATE INDEX idx_orgs_tier ON public.organizations(tier);

-- Users (synced from Clerk webhooks, NOT auth.users)
CREATE TABLE public.users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_user_id TEXT UNIQUE NOT NULL,            -- Clerk user ID (user_xxx)
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  default_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  default_project_id UUID,                       -- FK added after projects table
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_users_clerk ON public.users(clerk_user_id);
CREATE INDEX idx_users_email ON public.users(email);

-- Organization memberships (synced from Clerk)
CREATE TABLE public.org_members (
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX idx_org_members_user ON public.org_members(user_id);

-- Projects (within organizations)
CREATE TABLE public.projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  name TEXT,
  description TEXT,
  is_public BOOLEAN DEFAULT false,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'team', 'enterprise')),
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, slug)
);

CREATE INDEX idx_projects_org ON public.projects(org_id);
CREATE INDEX idx_projects_slug ON public.projects(org_id, slug);
CREATE INDEX idx_projects_public ON public.projects(is_public) WHERE is_public = true;

-- Project members
CREATE TABLE public.project_members (
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX idx_project_members_user ON public.project_members(user_id);

-- Add FK for default_project_id now that projects exists
ALTER TABLE public.users
  ADD CONSTRAINT fk_users_default_project
  FOREIGN KEY (default_project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

-- Generic updated_at trigger
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
```

### 2.3 Schema: `agents`

```sql
-- =============================================================
-- Schema: agents -- Agent registry, messaging, keys, webhooks
-- =============================================================
CREATE SCHEMA IF NOT EXISTS agents;

-- Agent registry
CREATE TABLE agents.registry (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  agent_name TEXT NOT NULL CHECK (agent_name ~ '^[a-z0-9-]+$'),
  display_name TEXT,
  instance TEXT NOT NULL,                        -- aws, montino, mac, etc.
  model TEXT,                                    -- anthropic/claude-opus-4, etc.
  role TEXT CHECK (role IN ('orchestrator', 'specialist', 'curator', 'admin', 'agent')),
  capabilities JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  signing_key TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, agent_name)
);

CREATE INDEX idx_agents_org_status ON agents.registry(org_id, status);
CREATE INDEX idx_agents_instance ON agents.registry(instance, status);

-- Agent API keys (for M2M authentication)
CREATE TABLE agents.api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID REFERENCES agents.registry(id) ON DELETE CASCADE NOT NULL,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,                 -- SHA-256 of the full key
  key_prefix TEXT NOT NULL,                      -- First 8 chars for identification
  label TEXT,
  scopes TEXT[] DEFAULT ARRAY['read', 'write'],  -- Granular permissions
  project_ids UUID[],                            -- NULL = all projects in org
  rate_limit_rpm INTEGER DEFAULT 60,             -- Requests per minute
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES public.users(id)
);

CREATE INDEX idx_api_keys_hash ON agents.api_keys(key_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_agent ON agents.api_keys(agent_id);
CREATE INDEX idx_api_keys_org ON agents.api_keys(org_id);

-- Agent-to-project assignment
CREATE TABLE agents.agent_projects (
  agent_id UUID REFERENCES agents.registry(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  role TEXT DEFAULT 'contributor' CHECK (role IN ('owner', 'contributor', 'readonly')),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  assigned_by UUID,
  PRIMARY KEY (agent_id, project_id)
);

CREATE INDEX idx_agent_projects_project ON agents.agent_projects(project_id);

-- Webhook subscriptions for agents
CREATE TABLE agents.webhook_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID REFERENCES agents.registry(id) ON DELETE CASCADE NOT NULL,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL,                        -- ['message.received', 'task.assigned', 'document.updated']
  secret TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'failed')),
  failure_count INTEGER DEFAULT 0,
  last_delivery_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_webhooks_agent ON agents.webhook_subscriptions(agent_id, status);
CREATE INDEX idx_webhooks_events ON agents.webhook_subscriptions USING gin(events);

CREATE TRIGGER agents_registry_updated_at BEFORE UPDATE ON agents.registry
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
```

### 2.4 Schema: `docs`

```sql
-- =============================================================
-- Schema: docs -- Documents, chunks, embeddings, indexing state
-- =============================================================
CREATE SCHEMA IF NOT EXISTS docs;

-- Documents
CREATE TABLE docs.documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  file_path TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  checksum TEXT NOT NULL,                        -- MD5 of content
  doc_type TEXT CHECK (doc_type IN (
    'architecture', 'testing-pattern', 'contract', 'meta',
    'template', 'rules', 'patterns', 'reference', 'api', 'guide'
  )),
  visibility TEXT NOT NULL DEFAULT 'project' CHECK (visibility IN ('project', 'shared', 'public')),
  tags TEXT[],
  agent_id UUID REFERENCES agents.registry(id) ON DELETE SET NULL,
  indexing_status TEXT DEFAULT 'pending' CHECK (indexing_status IN ('pending', 'indexing', 'indexed', 'failed')),
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, file_path)
);

CREATE INDEX idx_docs_project ON docs.documents(project_id);
CREATE INDEX idx_docs_org ON docs.documents(org_id);
CREATE INDEX idx_docs_visibility ON docs.documents(visibility, org_id) WHERE visibility IN ('shared', 'public');
CREATE INDEX idx_docs_tags ON docs.documents USING gin(tags);
CREATE INDEX idx_docs_indexing ON docs.documents(indexing_status) WHERE indexing_status != 'indexed';
CREATE INDEX idx_docs_type ON docs.documents(project_id, doc_type);
CREATE INDEX idx_docs_agent ON docs.documents(agent_id) WHERE agent_id IS NOT NULL;

-- Chunks (denormalized for performance: includes title, file_path, project_id)
CREATE TABLE docs.chunks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID REFERENCES docs.documents(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  chunk_hash TEXT NOT NULL,                      -- MD5 of content (for incremental indexing)
  chunk_index INTEGER NOT NULL,
  embedding vector(1536),                        -- OpenAI text-embedding-3-small via Vercel AI Gateway
  embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  metadata JSONB DEFAULT '{}'::jsonb,            -- language, startLine, endLine, parentContext, etc.

  -- Denormalized for search performance (avoids JOIN on hot path)
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- HNSW index -- single unified embedding model via Vercel AI Gateway
CREATE INDEX idx_chunks_embedding ON docs.chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200)
  WHERE embedding_model = 'text-embedding-3-small';

-- Note: m=16 (not 24) for 1536d vectors — higher dimensions need fewer graph connections.
-- ef_construction=200 for high-quality index build (one-time cost).

CREATE INDEX idx_chunks_document ON docs.chunks(document_id);
CREATE INDEX idx_chunks_project_model ON docs.chunks(project_id, embedding_model);
CREATE INDEX idx_chunks_hash ON docs.chunks(document_id, chunk_hash);

-- Full-text search index on chunk content (for keyword fallback)
ALTER TABLE docs.chunks ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX idx_chunks_fts ON docs.chunks USING gin(content_tsv);

-- Document history (version tracking)
CREATE TABLE docs.document_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID REFERENCES docs.documents(id) ON DELETE CASCADE NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  checksum TEXT NOT NULL,
  changed_by UUID,                               -- user_id or agent_id
  change_type TEXT CHECK (change_type IN ('create', 'update', 'rollback')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_doc_history_doc ON docs.document_history(document_id, version DESC);

-- Document proposals
CREATE TABLE docs.proposals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  document_id UUID REFERENCES docs.documents(id) ON DELETE SET NULL,
  doc_id_ref TEXT NOT NULL,                      -- file_path or title
  new_content TEXT NOT NULL,
  evidence_snippet TEXT,
  reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  agent_id UUID REFERENCES agents.registry(id) ON DELETE SET NULL,
  source_instance TEXT,
  reviewed_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_proposals_project ON docs.proposals(project_id, status);

-- Search function: match chunks by embedding similarity
CREATE OR REPLACE FUNCTION docs.match_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_project_id uuid,
  filter_embedding_model text DEFAULT 'text-embedding-3-small'
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  chunk_index integer,
  similarity float,
  file_path text,
  title text,
  metadata jsonb
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.document_id,
    c.content,
    c.chunk_index,
    1 - (c.embedding <=> query_embedding) AS similarity,
    c.file_path,
    c.title,
    c.metadata
  FROM docs.chunks c
  WHERE c.project_id = filter_project_id
    AND c.embedding_model = filter_embedding_model
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Search function: match shared docs across organization
CREATE OR REPLACE FUNCTION docs.match_shared_chunks(
  query_embedding vector(1536),
  filter_org_id uuid,
  match_count int,
  filter_tags text[] DEFAULT NULL,
  filter_embedding_model text DEFAULT 'text-embedding-3-small'
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  similarity float,
  title text,
  file_path text,
  project_id uuid,
  agent_id uuid,
  tags text[]
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.document_id,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity,
    c.title,
    c.file_path,
    c.project_id,
    d.agent_id,
    d.tags
  FROM docs.chunks c
  JOIN docs.documents d ON c.document_id = d.id
  WHERE d.org_id = filter_org_id
    AND d.visibility IN ('shared', 'public')
    AND c.embedding_model = filter_embedding_model
    AND (filter_tags IS NULL OR d.tags && filter_tags)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Keyword search function (FTS fallback)
CREATE OR REPLACE FUNCTION docs.keyword_search(
  query_text text,
  filter_project_id uuid,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  file_path text,
  title text,
  rank float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.document_id,
    c.content,
    c.file_path,
    c.title,
    ts_rank(c.content_tsv, plainto_tsquery('english', query_text))::float AS rank
  FROM docs.chunks c
  WHERE c.project_id = filter_project_id
    AND c.content_tsv @@ plainto_tsquery('english', query_text)
  ORDER BY rank DESC
  LIMIT match_count;
$$;

CREATE TRIGGER docs_documents_updated_at BEFORE UPDATE ON docs.documents
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE TRIGGER docs_proposals_updated_at BEFORE UPDATE ON docs.proposals
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
```

### 2.5 Schema: `search`

```sql
-- =============================================================
-- Schema: search -- Query cache, search logs, drift detection
-- =============================================================
CREATE SCHEMA IF NOT EXISTS search;

-- Query cache (persistent, survives cold starts)
CREATE TABLE search.query_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  query_hash TEXT NOT NULL,                      -- SHA-256 of normalized query
  query_text TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  result_ids UUID[] NOT NULL,                    -- Ordered chunk IDs
  result_scores FLOAT[] NOT NULL,                -- Corresponding scores
  reranked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '1 hour',
  UNIQUE(project_id, query_hash, embedding_model)
);

CREATE INDEX idx_query_cache_lookup ON search.query_cache(project_id, query_hash, embedding_model)
  WHERE expires_at > now();
CREATE INDEX idx_query_cache_expire ON search.query_cache(expires_at);

-- Search logs (for analytics and drift detection)
CREATE TABLE search.logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id UUID,
  agent_id UUID,
  query TEXT NOT NULL,
  embedding_model TEXT,
  result_count INTEGER NOT NULL DEFAULT 0,
  top_score FLOAT,
  reranked BOOLEAN DEFAULT false,
  cache_hit BOOLEAN DEFAULT false,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_search_logs_project ON search.logs(project_id, created_at DESC);
CREATE INDEX idx_search_logs_misses ON search.logs(project_id, result_count)
  WHERE result_count = 0;

-- Drift events
CREATE TABLE search.drift_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  document_id UUID,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  drift_type TEXT NOT NULL CHECK (drift_type IN (
    'code_diverged', 'missing_doc', 'stale_doc', 'pattern_violation',
    'embedding_stale', 'search_quality_drop'
  )),
  file_path TEXT NOT NULL,
  doc_path TEXT,
  description TEXT NOT NULL,
  expected_pattern TEXT,
  actual_code TEXT,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolution_note TEXT,
  detected_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_drift_project ON search.drift_events(project_id, detected_at DESC);
CREATE INDEX idx_drift_unresolved ON search.drift_events(project_id)
  WHERE resolved = false;

-- Periodic job: clean expired cache
CREATE OR REPLACE FUNCTION search.cleanup_expired_cache()
RETURNS INTEGER
LANGUAGE sql
AS $$
  WITH deleted AS (
    DELETE FROM search.query_cache
    WHERE expires_at < now()
    RETURNING id
  )
  SELECT count(*)::integer FROM deleted;
$$;
```

### 2.6 Schema: `analytics`

```sql
-- =============================================================
-- Schema: analytics -- Activity logs, coverage, usage/billing
-- =============================================================
CREATE SCHEMA IF NOT EXISTS analytics;

-- Activity log (all tool invocations)
CREATE TABLE analytics.activity (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID,
  agent_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'search', 'read', 'read_chunks', 'propose', 'genesis',
    'pattern_match', 'pattern_inject', 'drift_detected', 'coverage_scan',
    'project_create', 'project_update', 'project_delete',
    'agent_register', 'agent_update', 'agent_remove',
    'agent_assign_project', 'agent_unassign_project',
    'agent_message_sent', 'agent_inbox_read',
    'reindex', 'agent_task_created', 'agent_task_updated',
    'token_generate', 'agent_provision',
    'webhook_delivery', 'channel_publish'
  )),
  query TEXT,
  document_id UUID,
  tool_name TEXT,
  file_path TEXT,
  result_count INTEGER,
  relevance_score NUMERIC(5,4),
  response_time_ms INTEGER,
  context JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Partitioned by month for efficient cleanup
-- (For initial deployment, single table is fine; add partitioning at scale)
CREATE INDEX idx_activity_project ON analytics.activity(project_id, created_at DESC);
CREATE INDEX idx_activity_event ON analytics.activity(project_id, event_type);
CREATE INDEX idx_activity_agent ON analytics.activity(agent_id, created_at DESC) WHERE agent_id IS NOT NULL;

-- Coverage snapshots
CREATE TABLE analytics.coverage_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  total_documents INTEGER NOT NULL DEFAULT 0,
  docs_with_embeddings INTEGER NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  coverage_percentage NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN total_documents > 0
    THEN ROUND((docs_with_embeddings::NUMERIC / total_documents) * 100, 2)
    ELSE 0 END
  ) STORED,
  breakdown JSONB DEFAULT '{}'::jsonb,
  scan_type TEXT DEFAULT 'manual' CHECK (scan_type IN ('manual', 'scheduled', 'genesis')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_coverage_project ON analytics.coverage_snapshots(project_id, created_at DESC);

-- Usage tracking (persistent, replaces in-memory usageMap)
CREATE TABLE analytics.usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  usage_type TEXT NOT NULL CHECK (usage_type IN (
    'semantic_search', 'rag_answer', 'embedding_generation',
    'rerank', 'webhook_delivery'
  )),
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(project_id, usage_type, usage_date)
);

CREATE INDEX idx_usage_lookup ON analytics.usage(project_id, usage_type, usage_date);

-- Upsert usage increment function
CREATE OR REPLACE FUNCTION analytics.increment_usage(
  p_project_id UUID,
  p_usage_type TEXT
)
RETURNS analytics.usage
LANGUAGE sql
AS $$
  INSERT INTO analytics.usage (project_id, usage_type, usage_date, count)
  VALUES (p_project_id, p_usage_type, CURRENT_DATE, 1)
  ON CONFLICT (project_id, usage_type, usage_date)
  DO UPDATE SET count = analytics.usage.count + 1
  RETURNING *;
$$;

-- Check usage limit function
CREATE OR REPLACE FUNCTION analytics.check_usage_limit(
  p_project_id UUID,
  p_usage_type TEXT,
  p_limit INTEGER                                -- -1 = unlimited
)
RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, current_count INTEGER)
LANGUAGE sql STABLE
AS $$
  SELECT
    CASE WHEN p_limit = -1 THEN true
         ELSE COALESCE(u.count, 0) < p_limit
    END AS allowed,
    CASE WHEN p_limit = -1 THEN -1
         ELSE GREATEST(0, p_limit - COALESCE(u.count, 0))
    END AS remaining,
    COALESCE(u.count, 0) AS current_count
  FROM (SELECT 1) AS dummy
  LEFT JOIN analytics.usage u
    ON u.project_id = p_project_id
    AND u.usage_type = p_usage_type
    AND u.usage_date = CURRENT_DATE;
$$;
```

### 2.7 Schema: `comms`

```sql
-- =============================================================
-- Schema: comms -- Communication bus, channels, message routing
-- =============================================================
CREATE SCHEMA IF NOT EXISTS comms;

-- Channels (topics for broadcast/group messaging)
CREATE TABLE comms.channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL CHECK (name ~ '^[a-z0-9._-]+$'),
  description TEXT,
  channel_type TEXT NOT NULL DEFAULT 'topic' CHECK (channel_type IN ('topic', 'direct', 'project')),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,  -- For project-scoped channels
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, name)
);

CREATE INDEX idx_channels_org ON comms.channels(org_id);
CREATE INDEX idx_channels_project ON comms.channels(project_id) WHERE project_id IS NOT NULL;

-- Channel subscriptions
CREATE TABLE comms.channel_subscriptions (
  channel_id UUID REFERENCES comms.channels(id) ON DELETE CASCADE NOT NULL,
  agent_id UUID REFERENCES agents.registry(id) ON DELETE CASCADE NOT NULL,
  subscribed_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (channel_id, agent_id)
);

CREATE INDEX idx_channel_subs_agent ON comms.channel_subscriptions(agent_id);

-- Messages (unified inbox: direct + channel)
CREATE TABLE comms.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  from_agent_id UUID REFERENCES agents.registry(id) NOT NULL,
  to_agent_id UUID REFERENCES agents.registry(id),           -- NULL for channel broadcasts
  channel_id UUID REFERENCES comms.channels(id) ON DELETE CASCADE,  -- NULL for direct messages
  reply_to UUID REFERENCES comms.messages(id),
  message_type TEXT NOT NULL DEFAULT 'message' CHECK (message_type IN (
    'message', 'task', 'result', 'alert', 'knowledge', 'curator', 'broadcast'
  )),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  payload JSONB NOT NULL,
  signature TEXT,                                -- HMAC-SHA256 of payload
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'read', 'failed', 'expired')),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '7 days',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  -- Constraint: must have either to_agent_id (direct) or channel_id (broadcast)
  CONSTRAINT msg_routing_check CHECK (
    (to_agent_id IS NOT NULL AND channel_id IS NULL) OR
    (to_agent_id IS NULL AND channel_id IS NOT NULL)
  )
);

CREATE INDEX idx_messages_inbox ON comms.messages(to_agent_id, status, created_at)
  WHERE to_agent_id IS NOT NULL;
CREATE INDEX idx_messages_channel ON comms.messages(channel_id, created_at)
  WHERE channel_id IS NOT NULL;
CREATE INDEX idx_messages_from ON comms.messages(from_agent_id, created_at);
CREATE INDEX idx_messages_pending ON comms.messages(to_agent_id, created_at)
  WHERE status = 'pending';
CREATE INDEX idx_messages_reply ON comms.messages(reply_to) WHERE reply_to IS NOT NULL;

-- Agent tasks (structured work queue)
CREATE TABLE comms.tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to UUID REFERENCES agents.registry(id) NOT NULL,
  created_by UUID REFERENCES agents.registry(id) NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'failed', 'cancelled')),
  priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  payload JSONB,
  result JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tasks_assigned ON comms.tasks(assigned_to, status);
CREATE INDEX idx_tasks_project ON comms.tasks(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_tasks_deadline ON comms.tasks(deadline) WHERE deadline IS NOT NULL AND status IN ('pending', 'in_progress');

-- Webhook delivery log
CREATE TABLE comms.webhook_deliveries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subscription_id UUID REFERENCES agents.webhook_subscriptions(id) ON DELETE CASCADE NOT NULL,
  message_id UUID REFERENCES comms.messages(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  request_body JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  next_retry_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'retrying')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_webhook_delivery_sub ON comms.webhook_deliveries(subscription_id, created_at DESC);
CREATE INDEX idx_webhook_delivery_retry ON comms.webhook_deliveries(next_retry_at)
  WHERE status = 'retrying';

-- Notify function: fires LISTEN/NOTIFY on new messages
CREATE OR REPLACE FUNCTION comms.notify_new_message()
RETURNS TRIGGER AS $$
BEGIN
  -- Direct message: notify specific agent channel
  IF NEW.to_agent_id IS NOT NULL THEN
    PERFORM pg_notify(
      'agent_inbox_' || REPLACE(NEW.to_agent_id::text, '-', ''),
      json_build_object(
        'message_id', NEW.id,
        'from_agent_id', NEW.from_agent_id,
        'message_type', NEW.message_type,
        'priority', NEW.priority
      )::text
    );
  END IF;

  -- Channel message: notify channel
  IF NEW.channel_id IS NOT NULL THEN
    PERFORM pg_notify(
      'channel_' || REPLACE(NEW.channel_id::text, '-', ''),
      json_build_object(
        'message_id', NEW.id,
        'from_agent_id', NEW.from_agent_id,
        'channel_id', NEW.channel_id,
        'message_type', NEW.message_type
      )::text
    );
  END IF;

  -- Org-level notification (for monitoring/dashboards)
  PERFORM pg_notify(
    'org_messages_' || REPLACE(NEW.org_id::text, '-', ''),
    json_build_object(
      'message_id', NEW.id,
      'from_agent_id', NEW.from_agent_id,
      'to_agent_id', NEW.to_agent_id,
      'channel_id', NEW.channel_id,
      'message_type', NEW.message_type
    )::text
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_notify
  AFTER INSERT ON comms.messages
  FOR EACH ROW
  EXECUTE FUNCTION comms.notify_new_message();

-- Notify on task assignment
CREATE OR REPLACE FUNCTION comms.notify_task_assigned()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'agent_tasks_' || REPLACE(NEW.assigned_to::text, '-', ''),
    json_build_object(
      'task_id', NEW.id,
      'title', NEW.title,
      'priority', NEW.priority,
      'created_by', NEW.created_by
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_notify
  AFTER INSERT ON comms.tasks
  FOR EACH ROW
  EXECUTE FUNCTION comms.notify_task_assigned();

CREATE TRIGGER messages_updated_at BEFORE UPDATE ON comms.messages
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON comms.tasks
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
```

### 2.8 RLS Strategy

With Neon + Clerk, RLS is simpler because Clerk JWTs carry `org_id` and `user_id` claims directly. Neon supports setting session variables from JWT claims.

```sql
-- =============================================================
-- RLS: Neon + Clerk JWT integration
-- =============================================================
-- Neon's @neondatabase/serverless driver can set session variables:
--   SET LOCAL request.jwt.claims = '{"org_id":"...","user_id":"...","role":"admin"}';
-- Then RLS policies read from current_setting('request.jwt.claims')::jsonb

-- Helper function to extract claim from JWT
CREATE OR REPLACE FUNCTION public.jwt_claim(claim TEXT)
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb ->> claim;
$$;

CREATE OR REPLACE FUNCTION public.jwt_org_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT (public.jwt_claim('org_id'))::UUID;
$$;

CREATE OR REPLACE FUNCTION public.jwt_user_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT (public.jwt_claim('user_id'))::UUID;
$$;

-- Example: Organizations RLS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_select" ON public.organizations FOR SELECT
  USING (
    id = public.jwt_org_id()
    OR EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id = public.organizations.id
        AND user_id = public.jwt_user_id()
    )
  );

-- Example: Projects RLS (simple org-based)
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_org_select" ON public.projects FOR SELECT
  USING (
    is_public = true
    OR org_id = public.jwt_org_id()
  );

-- Example: Docs RLS
ALTER TABLE docs.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "docs_project_select" ON docs.documents FOR SELECT
  USING (
    org_id = public.jwt_org_id()
    OR visibility = 'public'
  );

ALTER TABLE docs.chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chunks_project_select" ON docs.chunks FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE org_id = public.jwt_org_id()
    )
  );

-- Note: For the MCP server running with service role / connection pooler,
-- bypass RLS by using a role with BYPASSRLS privilege.
-- The application layer handles authorization via AuthContext.
```

---

## 3. Clerk Integration Plan

### 3.1 How Clerk Replaces Supabase Auth

| Supabase Auth | Clerk Replacement |
|---------------|-------------------|
| `auth.users` table | Clerk user store (external) |
| `auth.uid()` in RLS | `jwt_user_id()` from session variable |
| `auth.role()` in RLS | `jwt_claim('role')` from JWT |
| Custom Access Token Hook | Clerk JWT template (native) |
| `handle_new_user()` trigger | Clerk `user.created` webhook |
| Supabase OAuth (email/password/Google) | Clerk sign-in (all providers) |
| `supabase.auth.getUser(token)` | `clerkClient.verifyToken(token)` |
| Service role key | Neon connection string with direct role |

### 3.2 API Key Management for Agents

```typescript
// src/lib/auth/agent-keys.ts

import { createHash, randomBytes } from 'crypto';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

interface AgentApiKey {
  id: string;
  agent_id: string;
  key_prefix: string;
  label: string;
  scopes: string[];
  project_ids: string[] | null;
  rate_limit_rpm: number;
  expires_at: string | null;
}

/**
 * Generate a new API key for an agent
 * Returns the full key (only shown once) and the stored metadata
 */
export async function generateAgentApiKey(params: {
  agent_id: string;
  org_id: string;
  label: string;
  scopes?: string[];
  project_ids?: string[];
  rate_limit_rpm?: number;
  expires_days?: number;
  created_by?: string;
}): Promise<{ key: string; metadata: AgentApiKey }> {
  // Generate 32-byte random key
  const rawKey = randomBytes(32).toString('base64url');
  const fullKey = `qk_${rawKey}`;                // Prefix for identification
  const keyPrefix = fullKey.substring(0, 11);     // qk_XXXXXXXX
  const keyHash = createHash('sha256').update(fullKey).digest('hex');

  const expiresAt = params.expires_days
    ? new Date(Date.now() + params.expires_days * 86400000).toISOString()
    : null;

  const [row] = await sql`
    INSERT INTO agents.api_keys (
      agent_id, org_id, key_hash, key_prefix, label,
      scopes, project_ids, rate_limit_rpm, expires_at, created_by
    ) VALUES (
      ${params.agent_id}, ${params.org_id}, ${keyHash}, ${keyPrefix},
      ${params.label}, ${params.scopes || ['read', 'write']},
      ${params.project_ids || null}, ${params.rate_limit_rpm || 60},
      ${expiresAt}, ${params.created_by || null}
    )
    RETURNING id, agent_id, key_prefix, label, scopes, project_ids, rate_limit_rpm, expires_at
  `;

  return {
    key: fullKey,
    metadata: row as AgentApiKey,
  };
}

/**
 * Verify an agent API key and return auth context
 */
export async function verifyAgentApiKey(key: string): Promise<{
  agent_id: string;
  org_id: string;
  scopes: string[];
  project_ids: string[] | null;
  rate_limit_rpm: number;
} | null> {
  if (!key.startsWith('qk_')) return null;

  const keyHash = createHash('sha256').update(key).digest('hex');

  const [row] = await sql`
    SELECT ak.agent_id, ak.org_id, ak.scopes, ak.project_ids, ak.rate_limit_rpm,
           ar.status AS agent_status
    FROM agents.api_keys ak
    JOIN agents.registry ar ON ak.agent_id = ar.id
    WHERE ak.key_hash = ${keyHash}
      AND ak.revoked_at IS NULL
      AND (ak.expires_at IS NULL OR ak.expires_at > now())
      AND ar.status = 'active'
  `;

  if (!row) return null;

  // Update last_used_at (fire-and-forget)
  sql`UPDATE agents.api_keys SET last_used_at = now() WHERE key_hash = ${keyHash}`.catch(() => {});

  return {
    agent_id: row.agent_id,
    org_id: row.org_id,
    scopes: row.scopes,
    project_ids: row.project_ids,
    rate_limit_rpm: row.rate_limit_rpm,
  };
}

/**
 * Revoke an API key
 */
export async function revokeAgentApiKey(keyId: string, orgId: string): Promise<boolean> {
  const result = await sql`
    UPDATE agents.api_keys
    SET revoked_at = now()
    WHERE id = ${keyId} AND org_id = ${orgId} AND revoked_at IS NULL
  `;
  return result.length > 0;
}

/**
 * Rotate an API key (revoke old, generate new with same params)
 */
export async function rotateAgentApiKey(keyId: string, orgId: string): Promise<{
  key: string;
  metadata: AgentApiKey;
} | null> {
  const [existing] = await sql`
    SELECT agent_id, org_id, label, scopes, project_ids, rate_limit_rpm, created_by
    FROM agents.api_keys
    WHERE id = ${keyId} AND org_id = ${orgId} AND revoked_at IS NULL
  `;

  if (!existing) return null;

  // Revoke old key
  await sql`UPDATE agents.api_keys SET revoked_at = now() WHERE id = ${keyId}`;

  // Generate new key with same params
  return generateAgentApiKey({
    agent_id: existing.agent_id,
    org_id: existing.org_id,
    label: `${existing.label} (rotated)`,
    scopes: existing.scopes,
    project_ids: existing.project_ids,
    rate_limit_rpm: existing.rate_limit_rpm,
    created_by: existing.created_by,
  });
}
```

### 3.3 JWT Template Design

Clerk JWT template (configured in Clerk Dashboard under "JWT Templates"):

```json
{
  "name": "quoth-mcp",
  "claims": {
    "org_id": "{{org.id}}",
    "org_slug": "{{org.slug}}",
    "org_role": "{{org.membership.role}}",
    "user_id": "{{user.id}}",
    "email": "{{user.primary_email_address}}",
    "project_id": "{{user.public_metadata.default_project_id}}",
    "tier": "{{org.public_metadata.tier}}",
    "permissions": "{{org.membership.permissions}}"
  },
  "token_lifetime": 3600,
  "signing_algorithm": "RS256"
}
```

**Mapped claims:**

| Claim | Source | Usage |
|-------|--------|-------|
| `org_id` | Clerk organization | RLS policies, data isolation |
| `org_slug` | Clerk organization | Display, routing |
| `org_role` | Clerk membership | Authorization (owner/admin/member) |
| `user_id` | Clerk user | Audit trail, activity logging |
| `project_id` | User metadata | Default project context for MCP |
| `tier` | Org metadata | Rate limiting, feature gating |
| `permissions` | Org permissions | Granular access (search, write, admin) |

### 3.4 Clerk Webhook Events to Handle

```typescript
// src/app/api/clerk/webhook/route.ts

import { Webhook } from 'svix';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

type ClerkEvent =
  | 'user.created' | 'user.updated' | 'user.deleted'
  | 'organization.created' | 'organization.updated' | 'organization.deleted'
  | 'organizationMembership.created' | 'organizationMembership.updated' | 'organizationMembership.deleted';

const handlers: Record<ClerkEvent, (data: any) => Promise<void>> = {
  'user.created': async (data) => {
    await sql`
      INSERT INTO public.users (clerk_user_id, email, display_name, avatar_url)
      VALUES (${data.id}, ${data.email_addresses[0]?.email_address}, ${data.first_name}, ${data.image_url})
      ON CONFLICT (clerk_user_id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url
    `;
  },

  'user.updated': async (data) => {
    await sql`
      UPDATE public.users SET
        email = ${data.email_addresses[0]?.email_address},
        display_name = ${data.first_name},
        avatar_url = ${data.image_url}
      WHERE clerk_user_id = ${data.id}
    `;
  },

  'user.deleted': async (data) => {
    await sql`DELETE FROM public.users WHERE clerk_user_id = ${data.id}`;
  },

  'organization.created': async (data) => {
    await sql`
      INSERT INTO public.organizations (clerk_org_id, slug, name)
      VALUES (${data.id}, ${data.slug}, ${data.name})
      ON CONFLICT (clerk_org_id) DO NOTHING
    `;
  },

  'organization.updated': async (data) => {
    await sql`
      UPDATE public.organizations SET name = ${data.name}, slug = ${data.slug}
      WHERE clerk_org_id = ${data.id}
    `;
  },

  'organization.deleted': async (data) => {
    await sql`DELETE FROM public.organizations WHERE clerk_org_id = ${data.id}`;
  },

  'organizationMembership.created': async (data) => {
    const [org] = await sql`SELECT id FROM public.organizations WHERE clerk_org_id = ${data.organization.id}`;
    const [user] = await sql`SELECT id FROM public.users WHERE clerk_user_id = ${data.public_user_data.user_id}`;
    if (org && user) {
      await sql`
        INSERT INTO public.org_members (org_id, user_id, role)
        VALUES (${org.id}, ${user.id}, ${data.role})
        ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role
      `;
    }
  },

  'organizationMembership.updated': async (data) => {
    const [org] = await sql`SELECT id FROM public.organizations WHERE clerk_org_id = ${data.organization.id}`;
    const [user] = await sql`SELECT id FROM public.users WHERE clerk_user_id = ${data.public_user_data.user_id}`;
    if (org && user) {
      await sql`
        UPDATE public.org_members SET role = ${data.role}
        WHERE org_id = ${org.id} AND user_id = ${user.id}
      `;
    }
  },

  'organizationMembership.deleted': async (data) => {
    const [org] = await sql`SELECT id FROM public.organizations WHERE clerk_org_id = ${data.organization.id}`;
    const [user] = await sql`SELECT id FROM public.users WHERE clerk_user_id = ${data.public_user_data.user_id}`;
    if (org && user) {
      await sql`DELETE FROM public.org_members WHERE org_id = ${org.id} AND user_id = ${user.id}`;
    }
  },
};
```

### 3.5 How Clerk JWTs Feed into Neon RLS

```typescript
// src/lib/db.ts -- Neon client with Clerk JWT claims injection

import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = true;

/**
 * Get a Neon SQL client with JWT claims set for RLS
 * Use for user-facing queries where RLS should apply
 */
export function getAuthenticatedSql(claims: {
  org_id: string;
  user_id: string;
  role: string;
}) {
  const sql = neon(process.env.DATABASE_URL!, {
    // Set session variables that RLS policies read via current_setting()
    authToken: undefined, // We use SET LOCAL instead
  });

  // Wrapper that prepends SET LOCAL before each query
  return async (strings: TemplateStringsArray, ...values: any[]) => {
    const claimsJson = JSON.stringify(claims);
    // Execute in a transaction to scope the session variable
    return sql.transaction([
      sql`SELECT set_config('request.jwt.claims', ${claimsJson}, true)`,
      sql(strings, ...values),
    ]);
  };
}

/**
 * Get a Neon SQL client for service-level operations (bypasses RLS)
 * Use for background jobs, webhooks, MCP server internal queries
 */
export function getServiceSql() {
  return neon(process.env.DATABASE_URL_SERVICE!);  // Uses a role with BYPASSRLS
}
```

---

## 4. Communication Bus Design

### 4.1 LISTEN/NOTIFY Channels

| Channel Pattern | Trigger | Payload |
|----------------|---------|---------|
| `agent_inbox_{agentId}` | New direct message to agent | `{message_id, from_agent_id, message_type, priority}` |
| `channel_{channelId}` | New message in channel | `{message_id, from_agent_id, channel_id, message_type}` |
| `agent_tasks_{agentId}` | New task assigned to agent | `{task_id, title, priority, created_by}` |
| `org_messages_{orgId}` | Any message in org (monitoring) | `{message_id, from_agent_id, to_agent_id, channel_id, message_type}` |

Implemented via PostgreSQL triggers on `comms.messages` and `comms.tasks` (see Section 2.7 DDL).

### 4.2 Message Persistence

All messages are persisted in `comms.messages` with full lifecycle tracking:

```
pending -> delivered -> read     (success path)
pending -> failed                (delivery failure)
pending -> expired               (TTL exceeded, default 7 days)
```

Messages are never deleted -- they expire and can be archived via a cron job.

### 4.3 Webhook Delivery with Retry

```typescript
// src/lib/comms/webhook-dispatcher.ts

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL_SERVICE!);

const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 1000;

/**
 * Dispatch webhooks for a new message
 * Called by a background worker or Vercel Cron
 */
export async function dispatchWebhooks(messageId: string): Promise<void> {
  // Get message and matching subscriptions
  const [message] = await sql`
    SELECT m.*, ar.agent_name
    FROM comms.messages m
    JOIN agents.registry ar ON m.from_agent_id = ar.id
    WHERE m.id = ${messageId}
  `;

  if (!message) return;

  // Find subscriptions for the recipient agent
  const eventType = message.to_agent_id
    ? 'message.received'
    : 'channel.message';

  const subscriptions = await sql`
    SELECT ws.*
    FROM agents.webhook_subscriptions ws
    WHERE ws.status = 'active'
      AND ${eventType} = ANY(ws.events)
      AND (
        ws.agent_id = ${message.to_agent_id}
        OR ws.org_id = ${message.org_id}
      )
  `;

  for (const sub of subscriptions) {
    await deliverWebhook(sub, message);
  }
}

async function deliverWebhook(
  subscription: any,
  message: any,
  attempt: number = 1
): Promise<void> {
  const payload = {
    event: message.to_agent_id ? 'message.received' : 'channel.message',
    message_id: message.id,
    from_agent_id: message.from_agent_id,
    to_agent_id: message.to_agent_id,
    channel_id: message.channel_id,
    message_type: message.message_type,
    priority: message.priority,
    payload: message.payload,
    timestamp: message.created_at,
  };

  // Sign payload with subscription secret
  const crypto = await import('crypto');
  const signature = crypto
    .createHmac('sha256', subscription.secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  try {
    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Quoth-Signature': `sha256=${signature}`,
        'X-Quoth-Event': payload.event,
        'X-Quoth-Delivery': message.id,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    // Log delivery
    await sql`
      INSERT INTO comms.webhook_deliveries
        (subscription_id, message_id, url, request_body, response_status, status, attempt)
      VALUES (${subscription.id}, ${message.id}, ${subscription.url},
              ${JSON.stringify(payload)}, ${response.status},
              ${response.ok ? 'success' : 'failed'}, ${attempt})
    `;

    if (!response.ok && attempt < MAX_RETRIES) {
      const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      const nextRetry = new Date(Date.now() + backoffMs);

      await sql`
        UPDATE comms.webhook_deliveries
        SET status = 'retrying', next_retry_at = ${nextRetry.toISOString()}
        WHERE subscription_id = ${subscription.id} AND message_id = ${message.id}
      `;
    }

    // Update subscription failure count
    if (!response.ok) {
      await sql`
        UPDATE agents.webhook_subscriptions
        SET failure_count = failure_count + 1,
            status = CASE WHEN failure_count >= 10 THEN 'failed' ELSE status END
        WHERE id = ${subscription.id}
      `;
    } else {
      await sql`
        UPDATE agents.webhook_subscriptions
        SET failure_count = 0, last_delivery_at = now()
        WHERE id = ${subscription.id}
      `;
    }
  } catch (error) {
    await sql`
      INSERT INTO comms.webhook_deliveries
        (subscription_id, message_id, url, request_body, response_status, response_body, status, attempt)
      VALUES (${subscription.id}, ${message.id}, ${subscription.url},
              ${JSON.stringify(payload)}, 0, ${String(error)}, 'failed', ${attempt})
    `;
  }
}
```

### 4.4 Topic/Channel Model

**Channel types:**
- `topic` -- Org-wide broadcast channels (e.g., `alerts`, `knowledge-updates`)
- `direct` -- Auto-created 1:1 channels between agents (not stored, inferred from `to_agent_id`)
- `project` -- Project-scoped channels (e.g., `project:quoth:builds`)

**Subscription model:**
- Agents subscribe to channels via `comms.channel_subscriptions`
- Direct messages bypass channels entirely (routed by `to_agent_id`)
- Subscriptions are persistent -- survive agent restarts

### 4.5 Cross-Project Message Routing

Messages are org-scoped, not project-scoped. An agent in project A can message an agent in project B if they share the same org. The `org_id` on `comms.messages` enforces the boundary.

For cross-org messaging (future), a federation layer would be needed. Not in scope for this redesign.

---

## 5. RAG Pipeline Optimization

### 5.1 Embedding Model Decision

**CHANGE: Switch to Vercel AI Gateway → OpenAI `text-embedding-3-small` (1536d)**

**Rationale:**
- **Unified model**: Single embedding model for both text and code (no more dual Jina text/code split). `text-embedding-3-small` performs well on both.
- **Cost**: $0.02/M tokens — cheapest on the gateway, comparable to Jina.
- **Vercel AI Gateway benefits**: Automatic failover, usage tracking, provider-agnostic (can switch to `voyage-3.5-lite` or `google/text-embedding-005` without code changes).
- **1536d quality**: Higher fidelity than 512d for nuanced documentation retrieval. HNSW with m=16 handles 1536d efficiently.
- **Simplicity**: One model, one dimension, one index. No more model detection logic.

**Jina and Cohere roles (reranking only):**
- **Cohere `rerank-english-v3.0`**: Primary reranker for semantic re-scoring after vector search.
- **Jina Reranker** (optional fallback): If Cohere is unavailable, use Jina reranker as fallback.
- Jina embedding endpoints are **removed** from the pipeline.

**Available alternatives on Vercel AI Gateway** (if switching later):
| Model | Dims | Cost | Notes |
|-------|------|------|-------|
| `openai/text-embedding-3-small` | 1536 | $0.02/M | **Selected** — best value |
| `openai/text-embedding-3-large` | 3072 | $0.13/M | Higher quality, 6.5x cost |
| `voyage/voyage-3.5-lite` | - | $0.02/M | Same cost, good for code |
| `google/text-embedding-005` | - | $0.03/M | Google alternative |
| `cohere/embed-v4.0` | - | $0.12/M | High quality but 6x cost |

**Implementation (Vercel AI SDK):**
```typescript
import { embed, embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';

// Single query embedding
const { embedding } = await embed({
  model: openai.embedding('text-embedding-3-small'),
  value: queryText,
});

// Batch embedding (up to 2048 inputs)
const { embeddings } = await embedMany({
  model: openai.embedding('text-embedding-3-small'),
  values: chunkTexts,
});
```

**Environment:** Uses `AI_GATEWAY_API_KEY` for Vercel AI Gateway routing. The gateway proxies to OpenAI transparently.

### 5.2 HNSW vs IVFFlat

**Keep HNSW. Tune parameters up.**

Current: `m = 16, ef_construction = 64` (Supabase, 512d)
Proposed: `m = 16, ef_construction = 200` (Neon, 1536d)

| Parameter | Current | Proposed | Rationale |
|-----------|---------|----------|-----------|
| `m` | 16 | 16 | For 1536d vectors, m=16 is optimal. Higher m wastes memory without recall gain at this dimension. |
| `ef_construction` | 64 | 200 | More candidates during build. Higher quality graph for 1536d. One-time cost. |
| `ef_search` | default (40) | 100 (via SET) | Query-time parameter. Set per-query: `SET hnsw.ef_search = 100;` for better recall. |

**Single unified index** (see Section 2.4 DDL). No more dual text/code indexes. One model = one index = simpler operations.

IVFFlat is not recommended because:
- Requires manual tuning of `lists` parameter as data grows
- Worse recall at the same query latency
- HNSW is the standard for production pgvector workloads

### 5.3 Chunking Improvements

1. **Fix chunk size targeting.** Current AST chunker has no max-size enforcement. Add splitting for chunks > 400 tokens (roughly 300 words) to keep within embedding model's sweet spot.

2. **Add overlap for markdown chunks.** Currently splits on `## ` with no overlap. Add 1-sentence overlap between sections:

```typescript
// In ASTChunker.fallbackChunking for markdown
const OVERLAP_SENTENCES = 1;
// When creating chunk[i+1], prepend last sentence of chunk[i]
```

3. **Inject document-level context.** Already partially implemented (`extractFrontmatterContext`). Extend to inject title + doc_type into every chunk's metadata for better reranking context.

4. **Batch embedding via Vercel AI SDK.** Use `embedMany()` to embed all chunks of a document in one API call (up to 2048 inputs). This replaces the sequential 4.2s-per-chunk Jina calls.

### 5.4 Search Caching Strategy

Replace in-memory LRU cache with `search.query_cache` table (see Section 2.5 DDL).

```typescript
// src/lib/search/cache.ts

import { createHash } from 'crypto';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL_SERVICE!);

function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

function hashQuery(query: string, model: string): string {
  return createHash('sha256').update(`${model}:${normalizeQuery(query)}`).digest('hex');
}

export async function getCachedSearch(
  projectId: string,
  query: string,
  embeddingModel: string
): Promise<{ chunkIds: string[]; scores: number[] } | null> {
  const hash = hashQuery(query, embeddingModel);

  const [cached] = await sql`
    SELECT result_ids, result_scores
    FROM search.query_cache
    WHERE project_id = ${projectId}
      AND query_hash = ${hash}
      AND embedding_model = ${embeddingModel}
      AND expires_at > now()
  `;

  if (!cached) return null;

  return {
    chunkIds: cached.result_ids,
    scores: cached.result_scores,
  };
}

export async function setCachedSearch(
  projectId: string,
  query: string,
  embeddingModel: string,
  chunkIds: string[],
  scores: number[],
  reranked: boolean,
  ttlMinutes: number = 60
): Promise<void> {
  const hash = hashQuery(query, embeddingModel);

  await sql`
    INSERT INTO search.query_cache
      (project_id, query_hash, query_text, embedding_model, result_ids, result_scores, reranked, expires_at)
    VALUES (
      ${projectId}, ${hash}, ${normalizeQuery(query)}, ${embeddingModel},
      ${chunkIds}, ${scores}, ${reranked},
      now() + ${ttlMinutes + ' minutes'}::interval
    )
    ON CONFLICT (project_id, query_hash, embedding_model)
    DO UPDATE SET
      result_ids = EXCLUDED.result_ids,
      result_scores = EXCLUDED.result_scores,
      reranked = EXCLUDED.reranked,
      expires_at = EXCLUDED.expires_at,
      created_at = now()
  `;
}

// Cache invalidation: call when documents in a project are updated
export async function invalidateProjectCache(projectId: string): Promise<void> {
  await sql`DELETE FROM search.query_cache WHERE project_id = ${projectId}`;
}
```

### 5.5 Batch Embedding API Calls

Replace sequential per-chunk embedding with Jina's native batch API:

```typescript
// src/lib/ai/embeddings.ts

const JINA_BATCH_SIZE = 16;  // Jina supports up to 2048 inputs per request
const JINA_RATE_LIMIT_RPM = 500;  // Pro plan

export async function generateEmbeddingsBatch(
  texts: string[],
  model: string = 'text-embedding-3-small',
  task: string = 'retrieval.passage'
): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += JINA_BATCH_SIZE) {
    const batch = texts.slice(i, i + JINA_BATCH_SIZE);

    const response = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        task,
        dimensions: 512,
        input: batch,
      }),
    });

    if (!response.ok) {
      throw new Error(`Jina batch API error: ${response.status}`);
    }

    const data = await response.json();
    results.push(...data.data.map((d: any) => d.embedding));

    // Rate limit: if more batches to go, wait proportionally
    if (i + JINA_BATCH_SIZE < texts.length) {
      const waitMs = Math.ceil((60000 / JINA_RATE_LIMIT_RPM) * JINA_BATCH_SIZE);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  return results;
}
```

This replaces the current 4.2s-per-chunk sequential approach. For 20 chunks: **84 seconds (current) -> ~2 seconds (batched).**

### 5.6 WASM Bundle Optimization

Current: Tree-Sitter WASM files are resolved at runtime from multiple paths (public/wasm, .next/static, node_modules).

Improvements:
1. **Preload and cache WASM modules.** Load once at module init, not per-chunk.
2. **Lazy-load language grammars.** Only load TypeScript/JavaScript/Python when first requested.
3. **Remove unused languages.** If only TS/JS/Python are used, don't ship other grammars.
4. **Consider native Tree-Sitter.** On Vercel serverless (Node.js runtime), native `tree-sitter` (not WASM) is faster. WASM is only needed for Edge Runtime which Quoth doesn't use for MCP routes.

---

## 6. Migration Strategy

### 6.1 Data Migration Plan

**Phase 1: Provision NeonDB + Schema (Day 1)**
- Create NeonDB project with branching enabled
- Run all DDL from Section 2 on a dev branch
- Set up Clerk project, configure JWT template
- Configure Clerk webhooks pointing to staging

**Phase 2: Data Export from Supabase (Day 2-3)**

```bash
# Export core tables (use pg_dump for large tables)
pg_dump --host=db.xxx.supabase.co --dbname=postgres \
  --table=public.organizations \
  --table=public.projects \
  --table=public.profiles \
  --table=public.project_members \
  --table=public.agents \
  --table=public.agent_projects \
  --table=public.documents \
  --table=public.document_embeddings \
  --table=public.document_proposals \
  --table=public.document_history \
  --table=public.agent_messages \
  --table=public.agent_tasks \
  --table=public.quoth_activity \
  --table=public.coverage_snapshot \
  --table=public.drift_events \
  --table=public.curator_log \
  --data-only --format=custom \
  -f quoth_supabase_export.dump
```

**Phase 3: Transform and Load (Day 3-4)**

Transform script maps old schema to new schema:

```sql
-- 1. Organizations: direct copy
INSERT INTO public.organizations (id, slug, name, created_at)
SELECT id, slug, name, created_at FROM _import.organizations;

-- 2. Users: map from profiles (Clerk IDs assigned during Clerk import)
INSERT INTO public.users (id, email, display_name, default_project_id, created_at)
SELECT id, email, username, default_project_id, created_at
FROM _import.profiles;

-- 3. Org members: derive from project_members + organizations
INSERT INTO public.org_members (org_id, user_id, role)
SELECT DISTINCT p.organization_id, pm.user_id,
  CASE WHEN pm.role = 'admin' THEN 'admin' ELSE 'member' END
FROM _import.project_members pm
JOIN _import.projects p ON pm.project_id = p.id
WHERE p.organization_id IS NOT NULL;

-- 4. Projects: map org_id
INSERT INTO public.projects (id, org_id, slug, is_public, created_at)
SELECT id, organization_id, slug, is_public, created_at
FROM _import.projects
WHERE organization_id IS NOT NULL;

-- 5. Project members: direct copy
INSERT INTO public.project_members (project_id, user_id, role, created_at)
SELECT project_id, user_id, role, created_at
FROM _import.project_members;

-- 6. Agents -> agents.registry
INSERT INTO agents.registry (id, org_id, agent_name, display_name, instance, model, role,
                              capabilities, metadata, status, signing_key, last_seen_at, created_at)
SELECT id, organization_id, agent_name, display_name, instance, model, role,
       capabilities, metadata, status, signing_key, last_seen_at, created_at
FROM _import.agents;

-- 7. Agent projects -> agents.agent_projects
INSERT INTO agents.agent_projects (agent_id, project_id, role, assigned_at, assigned_by)
SELECT agent_id, project_id, role, assigned_at, assigned_by
FROM _import.agent_projects;

-- 8. Documents -> docs.documents
INSERT INTO docs.documents (id, project_id, org_id, file_path, title, content, checksum,
                             doc_type, visibility, tags, agent_id, indexing_status, created_at)
SELECT d.id, d.project_id, p.organization_id, d.file_path, d.title, d.content, d.checksum,
       d.doc_type, COALESCE(d.visibility, 'project'), d.tags, d.agent_id,
       COALESCE(d.indexing_status, 'indexed'), COALESCE(d.updated_at, d.last_updated, now())
FROM _import.documents d
JOIN _import.projects p ON d.project_id = p.id;

-- 9. Embeddings -> docs.chunks (denormalize title + file_path)
INSERT INTO docs.chunks (id, document_id, project_id, content, chunk_hash,
                          chunk_index, embedding, embedding_model, metadata, title, file_path)
SELECT de.id, de.document_id, d.project_id, de.content_chunk,
       COALESCE(de.chunk_hash, md5(de.content_chunk)),
       COALESCE((de.metadata->>'chunk_index')::int, 0),
       de.embedding, COALESCE(de.embedding_model, 'text-embedding-3-small'),
       de.metadata, d.title, d.file_path
FROM _import.document_embeddings de
JOIN _import.documents d ON de.document_id = d.id;

-- 10. Messages -> comms.messages
INSERT INTO comms.messages (id, org_id, from_agent_id, to_agent_id, message_type,
                             priority, payload, signature, status, delivered_at, read_at,
                             error_message, retry_count, expires_at, created_at)
SELECT id, organization_id, from_agent_id, to_agent_id, type,
       priority, payload, signature, status, delivered_at, read_at,
       error_message, retry_count, expires_at, created_at
FROM _import.agent_messages;

-- 11. Tasks -> comms.tasks
INSERT INTO comms.tasks (id, org_id, title, description, assigned_to, created_by,
                          status, priority, payload, result, started_at, completed_at,
                          deadline, created_at)
SELECT id, organization_id, title, description, assigned_to, created_by,
       status, priority, payload, result, started_at, completed_at,
       deadline, created_at
FROM _import.agent_tasks;

-- 12. Activity -> analytics.activity
INSERT INTO analytics.activity (id, project_id, org_id, user_id, event_type,
                                 query, document_id, tool_name, file_path,
                                 result_count, relevance_score, response_time_ms,
                                 context, created_at)
SELECT a.id, a.project_id, p.organization_id, a.user_id, a.event_type,
       a.query, a.document_id, a.tool_name, a.file_path,
       a.result_count, a.relevance_score, a.response_time_ms,
       a.context, a.created_at
FROM _import.quoth_activity a
JOIN _import.projects p ON a.project_id = p.id;

-- 13. Coverage -> analytics.coverage_snapshots
INSERT INTO analytics.coverage_snapshots (id, project_id, total_documents,
                                           docs_with_embeddings, breakdown,
                                           scan_type, created_at)
SELECT id, project_id, total_documentable, total_documented,
       breakdown, scan_type, created_at
FROM _import.coverage_snapshot;

-- 14. Drift -> search.drift_events
INSERT INTO search.drift_events (id, project_id, document_id, severity, drift_type,
                                  file_path, doc_path, description, expected_pattern,
                                  actual_code, resolved, resolved_at, resolved_by,
                                  resolution_note, detected_at)
SELECT id, project_id, document_id, severity, drift_type,
       file_path, doc_path, description, expected_pattern,
       actual_code, resolved, resolved_at, resolved_by,
       resolution_note, detected_at
FROM _import.drift_events;
```

**Phase 4: Clerk User Import (Day 4)**
- For each user in `public.users`, create corresponding Clerk user via API
- Store `clerk_user_id` mapping back
- Create Clerk organizations matching `public.organizations`
- Set up organization memberships

**Phase 5: Application Code Update (Day 5-7)**
- Replace `@supabase/supabase-js` with `@neondatabase/serverless`
- Replace auth middleware (Supabase -> Clerk)
- Update all query paths to use new schema-qualified table names
- Update MCP tool handlers to use new `AuthContext` format

### 6.2 Backward Compatibility During Transition

Run both databases in parallel for 1-2 weeks:
1. Writes go to both Supabase and Neon (dual-write mode)
2. Reads come from Neon (primary)
3. Feature flag to switch back to Supabase if issues arise
4. Monitor query latencies and error rates

### 6.3 Rollback Plan

1. **Database rollback:** NeonDB branching allows instant restore to any point. Create a named branch before each migration phase.
2. **Code rollback:** Git revert to pre-migration commit. Environment variables switch between Supabase and Neon connection strings.
3. **Auth rollback:** Keep Supabase Auth active (don't delete) until Clerk is verified for 2 weeks.
4. **Data sync:** If rollback needed after dual-write, Supabase has the complete dataset.

---

## 7. API Route Redesign

### 7.1 New Route Structure

```
/api/
  clerk/
    webhook/route.ts           -- Clerk webhook handler (user/org sync)
  mcp/
    [transport]/route.ts       -- MCP protocol handler (SSE + Streamable HTTP)
    public/route.ts            -- Public MCP endpoint (no auth, read-only)
  v1/
    projects/
      route.ts                 -- GET (list), POST (create)
      [projectId]/
        route.ts               -- GET, PUT, DELETE
        coverage/route.ts      -- GET coverage
        health/route.ts        -- GET health
        drift/route.ts         -- GET drift events
        activity/route.ts      -- GET activity
        team/
          route.ts             -- GET members, POST invite
          [memberId]/route.ts  -- PUT role, DELETE remove
    agents/
      route.ts                 -- GET (list), POST (register)
      [agentId]/
        route.ts               -- GET, PUT, DELETE
        keys/route.ts          -- GET (list), POST (generate)
        keys/[keyId]/route.ts  -- DELETE (revoke), POST (rotate)
    search/
      route.ts                 -- POST semantic search
      ask/route.ts             -- POST RAG answer
    documents/
      route.ts                 -- POST (sync)
      [docId]/route.ts         -- GET, PUT, DELETE
      [docId]/rollback/route.ts
    comms/
      messages/route.ts        -- POST (send), GET (inbox)
      channels/route.ts        -- GET (list), POST (create)
      channels/[channelId]/route.ts
      tasks/route.ts           -- GET (list), POST (create)
      tasks/[taskId]/route.ts  -- PUT (update status)
    analytics/
      usage/route.ts           -- GET usage stats
      miss-rate/route.ts       -- GET search miss rate
    tokens/
      route.ts                 -- POST (generate), GET (list)
  cron/
    weekly-health-report/route.ts
    cache-cleanup/route.ts
    webhook-retry/route.ts
  openapi.json/route.ts
```

### 7.2 Middleware Stack

```typescript
// src/middleware.ts

import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const isApiRoute = createRouteMatcher(['/api/v1/:path*', '/api/mcp/:path*']);
const isPublicRoute = createRouteMatcher([
  '/api/mcp/public/:path*',
  '/api/clerk/webhook',
  '/api/openapi.json',
  '/api/cron/:path*',
]);

export default clerkMiddleware(async (auth, req) => {
  // Public routes: no auth needed
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  // API routes: check for Clerk session OR agent API key
  if (isApiRoute(req)) {
    const authHeader = req.headers.get('authorization');

    // Agent API key (qk_xxx)
    if (authHeader?.startsWith('Bearer qk_')) {
      // Agent key verification happens in route handler
      return NextResponse.next();
    }

    // Clerk session (from cookie or Bearer token)
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/api/:path*'],
};
```

### 7.3 Route Handler Pattern

```typescript
// src/lib/api/handler.ts

import { auth } from '@clerk/nextjs/server';
import { verifyAgentApiKey } from '@/lib/auth/agent-keys';
import { getServiceSql } from '@/lib/db';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { z, ZodSchema } from 'zod';
import { NextRequest, NextResponse } from 'next/server';

export interface HandlerContext {
  user_id: string;
  org_id: string;
  project_id?: string;
  role: string;
  is_agent: boolean;
  agent_id?: string;
}

interface HandlerOptions {
  rateLimit?: { windowMs: number; maxRequests: number };
  requiredRole?: string;
  bodySchema?: ZodSchema;
}

export function createApiHandler(
  handler: (req: NextRequest, ctx: HandlerContext, body?: any) => Promise<Response>,
  options: HandlerOptions = {}
) {
  return async (req: NextRequest) => {
    try {
      // 1. Rate limiting
      if (options.rateLimit) {
        const ip = getClientIp(req);
        const result = checkRateLimit(ip, options.rateLimit);
        if (!result.allowed) {
          return NextResponse.json(
            { error: 'rate_limit_exceeded' },
            { status: 429, headers: { 'Retry-After': String(Math.ceil(result.resetIn / 1000)) } }
          );
        }
      }

      // 2. Authentication
      let ctx: HandlerContext;

      const authHeader = req.headers.get('authorization');
      if (authHeader?.startsWith('Bearer qk_')) {
        // Agent API key
        const key = authHeader.substring(7);
        const agentAuth = await verifyAgentApiKey(key);
        if (!agentAuth) {
          return NextResponse.json({ error: 'invalid_api_key' }, { status: 401 });
        }
        ctx = {
          user_id: agentAuth.agent_id,
          org_id: agentAuth.org_id,
          role: 'agent',
          is_agent: true,
          agent_id: agentAuth.agent_id,
        };
      } else {
        // Clerk session
        const { userId, orgId, orgRole } = await auth();
        if (!userId || !orgId) {
          return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
        }
        ctx = {
          user_id: userId,
          org_id: orgId,
          role: orgRole || 'member',
          is_agent: false,
        };
      }

      // 3. Role check
      if (options.requiredRole) {
        const roleHierarchy = ['viewer', 'member', 'editor', 'admin', 'owner', 'agent'];
        const requiredLevel = roleHierarchy.indexOf(options.requiredRole);
        const currentLevel = roleHierarchy.indexOf(ctx.role);
        if (currentLevel < requiredLevel) {
          return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        }
      }

      // 4. Body validation
      let body: any;
      if (options.bodySchema && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const raw = await req.json();
        const result = options.bodySchema.safeParse(raw);
        if (!result.success) {
          return NextResponse.json(
            { error: 'validation_error', details: result.error.flatten() },
            { status: 400 }
          );
        }
        body = result.data;
      }

      // 5. Execute handler
      return await handler(req, ctx, body);
    } catch (error) {
      console.error('API handler error:', error);
      return NextResponse.json(
        { error: 'internal_error', message: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }
  };
}
```

### 7.4 Error Handling Pattern

All API errors follow RFC 7807 (Problem Details):

```typescript
// src/lib/api/errors.ts

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorResponse(error: ApiError): Response {
  return Response.json(
    {
      type: `https://quoth.triqual.dev/errors/${error.code}`,
      status: error.status,
      title: error.code.replace(/_/g, ' '),
      detail: error.message,
      ...(error.details ? { errors: error.details } : {}),
    },
    { status: error.status, headers: { 'Content-Type': 'application/problem+json' } }
  );
}

// Pre-defined errors
export const Errors = {
  unauthorized: () => new ApiError(401, 'unauthorized', 'Authentication required'),
  forbidden: () => new ApiError(403, 'forbidden', 'Insufficient permissions'),
  notFound: (resource: string) => new ApiError(404, 'not_found', `${resource} not found`),
  rateLimited: () => new ApiError(429, 'rate_limited', 'Too many requests'),
  validation: (details: unknown) => new ApiError(400, 'validation_error', 'Invalid request', details),
  tierLimit: (limit: string) => new ApiError(402, 'tier_limit', `${limit} limit reached. Upgrade at triqual.dev/pro`),
};
```

---

## Implementation Priority

| Phase | Scope | Duration | Dependencies |
|-------|-------|----------|-------------|
| **Phase 1** | NeonDB setup + schema creation + data migration script | 2 days | NeonDB account |
| **Phase 2** | Clerk integration + webhook handler + auth middleware | 2 days | Clerk account |
| **Phase 3** | Replace Supabase client with Neon serverless driver | 2 days | Phase 1 |
| **Phase 4** | RAG pipeline optimization (batch embeddings, search cache, HNSW tuning) | 2 days | Phase 3 |
| **Phase 5** | Communication bus (LISTEN/NOTIFY, webhook delivery) | 2 days | Phase 3 |
| **Phase 6** | API route redesign + new middleware stack | 2 days | Phase 2 + 3 |
| **Phase 7** | Data migration execution + parallel run | 3 days | Phase 1-6 |
| **Phase 8** | Cutover + Supabase decommission | 1 day | Phase 7 verified |

**Total estimated duration: 16 days (3 weeks with buffer)**
