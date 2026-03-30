-- =============================================================
-- Migration 002: Agent Memory with Semantic Search + Temporal Decay
-- Created: 2026-03-29
-- Description: Adds agents.memory table for working/persistent
--   agent memory with vector embeddings, temporal decay,
--   consolidation, and cleanup functions.
-- =============================================================

-- Agent Memory with semantic search + temporal decay
CREATE TABLE agents.memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID REFERENCES agents.registry(id) ON DELETE CASCADE NOT NULL,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,

  key TEXT NOT NULL,
  value TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',

  -- Vector embedding for semantic search
  embedding vector(1536),
  embedding_model TEXT DEFAULT 'text-embedding-3-small',

  -- Memory tier: working (ephemeral) or persistent (consolidated)
  tier TEXT NOT NULL DEFAULT 'working' CHECK (tier IN ('working', 'persistent')),

  -- Temporal decay
  relevance_score FLOAT NOT NULL DEFAULT 1.0,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ DEFAULT now(),
  decay_rate FLOAT DEFAULT 0.05,

  -- Metadata
  tags TEXT[],
  metadata JSONB DEFAULT '{}'::jsonb,
  source TEXT, -- 'agent', 'sync', 'consolidation', 'user'

  -- TTL
  expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(agent_id, namespace, key)
);

-- HNSW index for semantic search
CREATE INDEX idx_memory_embedding ON agents.memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200)
  WHERE embedding IS NOT NULL;

-- Performance indexes
CREATE INDEX idx_memory_agent_ns ON agents.memory(agent_id, namespace);
CREATE INDEX idx_memory_agent_tier ON agents.memory(agent_id, tier);
CREATE INDEX idx_memory_relevance ON agents.memory(agent_id, relevance_score DESC);
CREATE INDEX idx_memory_tags ON agents.memory USING gin(tags);
CREATE INDEX idx_memory_expires ON agents.memory(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_memory_project ON agents.memory(project_id) WHERE project_id IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER memory_updated_at BEFORE UPDATE ON agents.memory
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- Function: semantic search agent memory
CREATE OR REPLACE FUNCTION agents.search_memory(
  p_agent_id uuid,
  p_query_embedding vector(1536),
  p_namespace text DEFAULT NULL,
  p_tier text DEFAULT NULL,
  p_limit int DEFAULT 10,
  p_threshold float DEFAULT 0.3
)
RETURNS TABLE (
  id uuid,
  key text,
  value text,
  namespace text,
  tier text,
  similarity float,
  relevance_score float,
  tags text[],
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.id, m.key, m.value, m.namespace, m.tier,
    1 - (m.embedding <=> p_query_embedding) AS similarity,
    m.relevance_score, m.tags, m.metadata, m.created_at
  FROM agents.memory m
  WHERE m.agent_id = p_agent_id
    AND m.embedding IS NOT NULL
    AND (p_namespace IS NULL OR m.namespace = p_namespace)
    AND (p_tier IS NULL OR m.tier = p_tier)
    AND (m.expires_at IS NULL OR m.expires_at > now())
    AND 1 - (m.embedding <=> p_query_embedding) > p_threshold
  ORDER BY
    (1 - (m.embedding <=> p_query_embedding)) * m.relevance_score DESC
  LIMIT p_limit;
$$;

-- Function: apply temporal decay to all agent memories
CREATE OR REPLACE FUNCTION agents.apply_memory_decay(
  p_agent_id uuid DEFAULT NULL,
  p_decay_factor float DEFAULT 0.95
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE agents.memory
  SET relevance_score = GREATEST(relevance_score * p_decay_factor, 0.01),
      updated_at = now()
  WHERE (p_agent_id IS NULL OR agent_id = p_agent_id)
    AND tier = 'working'
    AND relevance_score > 0.01;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Function: consolidate working memory to persistent
CREATE OR REPLACE FUNCTION agents.consolidate_memory(
  p_agent_id uuid DEFAULT NULL,
  p_min_access_count int DEFAULT 3,
  p_min_relevance float DEFAULT 0.5
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE agents.memory
  SET tier = 'persistent',
      updated_at = now()
  WHERE (p_agent_id IS NULL OR agent_id = p_agent_id)
    AND tier = 'working'
    AND access_count >= p_min_access_count
    AND relevance_score >= p_min_relevance;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Function: cleanup expired and low-relevance memories
CREATE OR REPLACE FUNCTION agents.cleanup_memory(
  p_min_relevance float DEFAULT 0.05
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected INTEGER;
BEGIN
  DELETE FROM agents.memory
  WHERE (expires_at IS NOT NULL AND expires_at < now())
    OR (tier = 'working' AND relevance_score < p_min_relevance);

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
