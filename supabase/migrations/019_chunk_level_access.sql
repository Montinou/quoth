-- Chunk-Level Access Migration
-- Adds RPC functions for fetching specific chunks by ID
-- Enables token-efficient document access for AI agents

-- 1. Drop existing match_documents to update return type
DROP FUNCTION IF EXISTS match_documents(vector(512), float, int, uuid);

-- 2. Recreate match_documents to include metadata
-- This allows search results to return chunk metadata for positioning
CREATE OR REPLACE FUNCTION match_documents (
  query_embedding vector(512),
  match_threshold float,
  match_count int,
  filter_project_id uuid
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content_chunk text,
  similarity float,
  file_path text,
  title text,
  metadata jsonb
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    de.id,
    de.document_id,
    de.content_chunk,
    1 - (de.embedding <=> query_embedding) as similarity,
    d.file_path,
    d.title,
    de.metadata
  FROM document_embeddings de
  JOIN documents d ON de.document_id = d.id
  WHERE d.project_id = filter_project_id
  AND 1 - (de.embedding <=> query_embedding) > match_threshold
  ORDER BY de.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 3. Create function to fetch chunks by IDs
-- Supports batch retrieval for efficient chunk loading
CREATE OR REPLACE FUNCTION get_chunks_by_ids(
  chunk_ids uuid[],
  filter_project_id uuid
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  document_path text,
  content_chunk text,
  chunk_index int,
  metadata jsonb,
  total_chunks int
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    de.id as chunk_id,
    de.document_id,
    d.title as document_title,
    d.file_path as document_path,
    de.content_chunk,
    COALESCE((de.metadata->>'chunk_index')::int, 0) as chunk_index,
    de.metadata,
    (SELECT COUNT(*)::int FROM document_embeddings WHERE document_id = de.document_id) as total_chunks
  FROM document_embeddings de
  JOIN documents d ON de.document_id = d.id
  WHERE de.id = ANY(chunk_ids)
    AND d.project_id = filter_project_id
  ORDER BY d.file_path, COALESCE((de.metadata->>'chunk_index')::int, 0);
END;
$$;

-- 4. Grant execute permissions
GRANT EXECUTE ON FUNCTION match_documents TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_chunks_by_ids TO authenticated, service_role;

-- 5. Add index for faster chunk lookup by ID (if not exists)
CREATE INDEX IF NOT EXISTS idx_document_embeddings_id_lookup
  ON document_embeddings(id);

COMMENT ON FUNCTION get_chunks_by_ids IS
  'Fetches specific chunks by their UUIDs with multi-tenant isolation.
   Used by quoth_read_chunks MCP tool for token-efficient document access.';
