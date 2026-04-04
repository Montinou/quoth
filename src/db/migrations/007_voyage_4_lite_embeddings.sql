-- =============================================================
-- Migration 007: Switch to voyage/voyage-4-lite (1024d)
-- Created: 2026-04-04
-- Description: Downgrades from text-embedding-3-large (2000d) to
--   voyage/voyage-4-lite (1024d) via Vercel AI Gateway.
--   6.5x cheaper ($0.02 vs $0.13/MTok), excellent code quality.
--   Tables are empty — no data to re-embed.
-- =============================================================

-- Step 1: Drop HNSW indexes
DROP INDEX IF EXISTS agents.idx_memory_embedding;
DROP INDEX IF EXISTS docs.idx_chunks_embedding;

-- Step 2: Alter vector columns from 2000 to 1024 dimensions
ALTER TABLE agents.memory
  ALTER COLUMN embedding TYPE vector(1024);

ALTER TABLE docs.chunks
  ALTER COLUMN embedding TYPE vector(1024);

-- Step 3: Update default embedding model references
ALTER TABLE agents.memory
  ALTER COLUMN embedding_model SET DEFAULT 'voyage/voyage-4-lite';

ALTER TABLE docs.chunks
  ALTER COLUMN embedding_model SET DEFAULT 'voyage/voyage-4-lite';

-- Step 4: Rebuild HNSW indexes with 1024d vectors
CREATE INDEX idx_memory_embedding ON agents.memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200)
  WHERE embedding IS NOT NULL;

CREATE INDEX idx_chunks_embedding ON docs.chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200)
  WHERE embedding_model = 'voyage/voyage-4-lite';

-- Step 5: Update search function signature to 1024d
CREATE OR REPLACE FUNCTION agents.search_memory(
  p_agent_id UUID,
  p_query_embedding vector(1024),
  p_namespace TEXT DEFAULT NULL,
  p_tier TEXT DEFAULT NULL,
  p_limit INT DEFAULT 10,
  p_threshold FLOAT DEFAULT 0.3
)
RETURNS TABLE(
  id UUID,
  key TEXT,
  value TEXT,
  namespace TEXT,
  similarity FLOAT,
  relevance_score FLOAT,
  tags TEXT[],
  metadata JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.key, m.value, m.namespace,
    (1 - (m.embedding <=> p_query_embedding))::FLOAT AS similarity,
    m.relevance_score::FLOAT,
    m.tags, m.metadata, m.created_at, m.updated_at
  FROM agents.memory m
  WHERE m.agent_id = p_agent_id
    AND m.embedding IS NOT NULL
    AND (p_namespace IS NULL OR m.namespace = p_namespace)
    AND (p_tier IS NULL OR m.tier = p_tier)
    AND (m.expires_at IS NULL OR m.expires_at > NOW())
    AND 1 - (m.embedding <=> p_query_embedding) > p_threshold
  ORDER BY
    (1 - (m.embedding <=> p_query_embedding)) * m.relevance_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Step 6: Invalidate search cache
TRUNCATE TABLE search.query_cache;
