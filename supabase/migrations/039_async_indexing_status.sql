-- Migration: Add indexing_status column for async background indexing
-- Tracks the lifecycle: pending → indexing → indexed | failed
-- Existing rows default to 'indexed' (assumed already indexed)
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS indexing_status text DEFAULT 'indexed';

-- Optional index for filtering docs that need attention
CREATE INDEX IF NOT EXISTS idx_documents_indexing_status
  ON documents (indexing_status)
  WHERE indexing_status IN ('pending', 'indexing', 'failed');
