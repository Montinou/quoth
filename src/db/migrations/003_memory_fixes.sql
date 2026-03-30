-- =============================================================
-- Migration 003: Memory system fixes
-- Created: 2026-03-29
-- Description: Fix search_memory() function to return all needed
--   columns, add memory event types to analytics.activity CHECK
--   constraint, add composite index for tier + relevance queries.
-- =============================================================

-- 1. Drop existing search_memory() (return type changed, CREATE OR REPLACE can't do that)
DROP FUNCTION IF EXISTS agents.search_memory(uuid, vector, text, text, int, float);

-- Recreate search_memory() with all needed output columns
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
  agent_id uuid,
  key text,
  value text,
  namespace text,
  tier text,
  similarity float,
  relevance_score float,
  access_count int,
  source text,
  tags text[],
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.id, m.agent_id, m.key, m.value, m.namespace, m.tier,
    1 - (m.embedding <=> p_query_embedding) AS similarity,
    m.relevance_score, m.access_count, m.source,
    m.tags, m.metadata, m.created_at, m.updated_at
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

-- 2. Add memory event types to analytics.activity CHECK constraint
-- Drop and recreate the constraint (can't ALTER CHECK constraints)
ALTER TABLE analytics.activity DROP CONSTRAINT IF EXISTS activity_event_type_check;
ALTER TABLE analytics.activity ADD CONSTRAINT activity_event_type_check CHECK (event_type IN (
  'search', 'read', 'read_chunks', 'propose', 'genesis',
  'pattern_match', 'pattern_inject', 'drift_detected', 'coverage_scan',
  'project_create', 'project_update', 'project_delete',
  'agent_register', 'agent_update', 'agent_remove',
  'agent_assign_project', 'agent_unassign_project',
  'agent_message_sent', 'agent_inbox_read',
  'reindex', 'agent_task_created', 'agent_task_updated',
  'token_generate', 'agent_provision',
  'webhook_delivery', 'channel_publish',
  -- New memory + worker event types
  'memory_store', 'memory_search', 'memory_list', 'memory_forget',
  'consolidation', 'cache_cleanup'
));

-- 3. Add composite index for tier + relevance queries
CREATE INDEX IF NOT EXISTS idx_memory_agent_tier_relevance
  ON agents.memory(agent_id, tier, relevance_score DESC);
