-- =============================================================
-- Migration 006: Upgrade embeddings to text-embedding-3-large (2000d)
-- Created: 2026-04-04
-- Description: Upgrades from text-embedding-3-small (1536d) to
--   text-embedding-3-large with Matryoshka truncation at 2000d
--   (maximum supported by Neon pgvector 0.8.0 HNSW indexes).
--   Quality: MTEB 64.6 (large) vs 62.3 (small).
-- =============================================================

-- Step 1: Drop existing HNSW indexes (cannot ALTER vector dimension in-place)
DROP INDEX IF EXISTS agents.idx_memory_embedding;
DROP INDEX IF EXISTS docs.idx_chunks_embedding;

-- Step 2: Alter vector columns from 1536 to 2000 dimensions
ALTER TABLE agents.memory
  ALTER COLUMN embedding TYPE vector(2000);

ALTER TABLE docs.chunks
  ALTER COLUMN embedding TYPE vector(2000);

-- Step 3: Update default embedding model references
ALTER TABLE agents.memory
  ALTER COLUMN embedding_model SET DEFAULT 'text-embedding-3-large';

ALTER TABLE docs.chunks
  ALTER COLUMN embedding_model SET DEFAULT 'text-embedding-3-large';

-- Step 4: Invalidate existing embeddings (they're 1536d, incompatible with 2000d)
-- Set to NULL so they get re-generated on next access/indexing
UPDATE agents.memory SET embedding = NULL
  WHERE embedding_model = 'text-embedding-3-small';

UPDATE docs.chunks SET embedding = NULL
  WHERE embedding_model = 'text-embedding-3-small';

-- Step 5: Update embedding_model tag for rows that will be re-generated
UPDATE agents.memory SET embedding_model = 'text-embedding-3-large'
  WHERE embedding_model = 'text-embedding-3-small';

UPDATE docs.chunks SET embedding_model = 'text-embedding-3-large'
  WHERE embedding_model = 'text-embedding-3-small';

-- Step 6: Rebuild HNSW indexes with 2000d vectors
-- m=16: bidirectional links per node
-- ef_construction=200: build-time search depth
CREATE INDEX idx_memory_embedding ON agents.memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200)
  WHERE embedding IS NOT NULL;

CREATE INDEX idx_chunks_embedding ON docs.chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200)
  WHERE embedding_model = 'text-embedding-3-large';

-- Step 7: Update search functions to use 2000d parameter
CREATE OR REPLACE FUNCTION agents.search_memory(
  p_agent_id UUID,
  p_query_embedding vector(2000),
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

-- Step 8: Cleanup old hybrid_search function if it uses 1536d signature
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hybrid_search' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'search')) THEN
    DROP FUNCTION IF EXISTS search.hybrid_search(UUID, vector(1536), TEXT, FLOAT, INT);
  END IF;
END $$;

-- Step 9: Invalidate search cache (old embeddings cached)
TRUNCATE TABLE search.query_cache;
