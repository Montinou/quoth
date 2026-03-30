-- =============================================================
-- Migration 001: Multi-Schema Design for Quoth on Neon
-- Created: 2026-03-29
-- Description: Creates 6 schemas (public, agents, docs, search,
--   analytics, comms) with all tables, indexes, functions, and
--   triggers per OPTIMIZATION_PLAN.md sections 2.2-2.7.
-- =============================================================

-- Enable pgvector extension for embedding support
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================
-- Schema: public -- App config, organizations, Clerk-managed users
-- =============================================================

-- Organizations (top-level tenant boundary)
CREATE TABLE public.organizations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_org_id TEXT UNIQUE,
  slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'team', 'enterprise')),
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_orgs_clerk ON public.organizations(clerk_org_id) WHERE clerk_org_id IS NOT NULL;
CREATE INDEX idx_orgs_slug ON public.organizations(slug);
CREATE INDEX idx_orgs_tier ON public.organizations(tier);

-- Users (synced from Clerk webhooks, NOT auth.users)
CREATE TABLE public.users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_user_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  default_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  default_project_id UUID,  -- FK added after projects table
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
  instance TEXT NOT NULL,
  model TEXT,
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
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  label TEXT,
  scopes TEXT[] DEFAULT ARRAY['read', 'write'],
  project_ids UUID[],
  rate_limit_rpm INTEGER DEFAULT 60,
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
  events TEXT[] NOT NULL,
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
  checksum TEXT NOT NULL,
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
  chunk_hash TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding vector(1536),
  embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Denormalized for search performance (avoids JOIN on hot path)
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- HNSW index for vector similarity search
-- m=16, ef_construction=200 for high-quality index build
CREATE INDEX idx_chunks_embedding ON docs.chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200)
  WHERE embedding_model = 'text-embedding-3-small';

CREATE INDEX idx_chunks_document ON docs.chunks(document_id);
CREATE INDEX idx_chunks_project_model ON docs.chunks(project_id, embedding_model);
CREATE INDEX idx_chunks_hash ON docs.chunks(document_id, chunk_hash);

-- Full-text search column (maintained via trigger, not GENERATED — to_tsvector is STABLE not IMMUTABLE)
ALTER TABLE docs.chunks ADD COLUMN content_tsv tsvector;
CREATE INDEX idx_chunks_fts ON docs.chunks USING gin(content_tsv);

-- Trigger to auto-populate content_tsv on insert/update
CREATE OR REPLACE FUNCTION docs.chunks_update_tsv()
RETURNS TRIGGER AS $$
BEGIN
  NEW.content_tsv := to_tsvector('english', NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chunks_tsv_update BEFORE INSERT OR UPDATE OF content ON docs.chunks
  FOR EACH ROW EXECUTE FUNCTION docs.chunks_update_tsv();

-- Document history (version tracking)
CREATE TABLE docs.document_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID REFERENCES docs.documents(id) ON DELETE CASCADE NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  checksum TEXT NOT NULL,
  changed_by UUID,
  change_type TEXT CHECK (change_type IN ('create', 'update', 'rollback')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_doc_history_doc ON docs.document_history(document_id, version DESC);

-- Document proposals
CREATE TABLE docs.proposals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  document_id UUID REFERENCES docs.documents(id) ON DELETE SET NULL,
  doc_id_ref TEXT NOT NULL,
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
  match_threshold float,
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
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
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


-- =============================================================
-- Schema: search -- Query cache, search logs, drift detection
-- =============================================================
CREATE SCHEMA IF NOT EXISTS search;

-- Query cache (persistent, survives cold starts)
CREATE TABLE search.query_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  query_hash TEXT NOT NULL,
  query_text TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  result_ids UUID[] NOT NULL,
  result_scores FLOAT[] NOT NULL,
  reranked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '1 hour',
  UNIQUE(project_id, query_hash, embedding_model)
);

-- Note: Cannot use WHERE expires_at > now() in partial index (now() is not immutable).
-- Filter expired entries at query time instead.
CREATE INDEX idx_query_cache_lookup ON search.query_cache(project_id, query_hash, embedding_model);
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
  coverage_percentage NUMERIC(5,2) DEFAULT 0,
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
  p_limit INTEGER
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

-- AI Generation Persistence (tracks every LLM generation)
CREATE TABLE analytics.generations (
  id TEXT PRIMARY KEY,                               -- nanoid
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES agents.registry(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  result TEXT,
  token_usage JSONB,                                 -- {"prompt_tokens":X,"completion_tokens":Y,"total_tokens":Z}
  estimated_cost_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'streaming', 'complete', 'error')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_generations_project ON analytics.generations(project_id, created_at DESC);
CREATE INDEX idx_generations_user ON analytics.generations(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_generations_agent ON analytics.generations(agent_id, created_at DESC) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_generations_status ON analytics.generations(status) WHERE status IN ('pending', 'streaming');
CREATE INDEX idx_generations_model ON analytics.generations(project_id, model);


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
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
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
  to_agent_id UUID REFERENCES agents.registry(id),
  channel_id UUID REFERENCES comms.channels(id) ON DELETE CASCADE,
  reply_to UUID REFERENCES comms.messages(id),
  message_type TEXT NOT NULL DEFAULT 'message' CHECK (message_type IN (
    'message', 'task', 'result', 'alert', 'knowledge', 'curator', 'broadcast'
  )),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  payload JSONB NOT NULL,
  signature TEXT,
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
