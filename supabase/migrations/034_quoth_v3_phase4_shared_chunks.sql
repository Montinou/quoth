-- Quoth v3 Phase 4: Shared Chunks Cross-Project
-- Updates get_chunks_by_ids RPC to support shared documents across projects in the same organization
-- Allows agents to access chunks from org-shared documentation

-- Drop and recreate get_chunks_by_ids with org-shared support
DROP FUNCTION IF EXISTS get_chunks_by_ids(uuid[], uuid);

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
DECLARE
  org_id uuid;
BEGIN
  -- Get organization_id for the requesting project
  SELECT organization_id INTO org_id
  FROM projects
  WHERE id = filter_project_id;

  RETURN QUERY
  SELECT
    de.id as chunk_id,
    de.document_id,
    d.title as document_title,
    d.file_path as document_path,
    de.content_chunk,
    COALESCE((de.metadata->>'chunk_index')::int, 0) as chunk_index,
    de.metadata,
    (SELECT COUNT(*)::int FROM document_embeddings sub WHERE sub.document_id = de.document_id) as total_chunks
  FROM document_embeddings de
  JOIN documents d ON de.document_id = d.id
  JOIN projects p ON d.project_id = p.id
  WHERE de.id = ANY(chunk_ids)
    AND (
      -- Allow project-local documents
      d.project_id = filter_project_id
      OR
      -- Allow shared documents within the same organization
      (d.visibility = 'shared' AND p.organization_id = org_id)
    )
  ORDER BY d.file_path, COALESCE((de.metadata->>'chunk_index')::int, 0);
END;
$$;

-- Grant execute permissions (same as before)
GRANT EXECUTE ON FUNCTION get_chunks_by_ids TO authenticated, service_role;

COMMENT ON FUNCTION get_chunks_by_ids IS
  'Fetches specific chunks by their UUIDs with multi-tenant isolation.
   Supports project-local documents and org-shared documents (visibility=shared).
   Used by quoth_read_chunks MCP tool for token-efficient cross-project document access.';
