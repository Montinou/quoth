-- ==============================================
-- Migration 022: Activity Logging for Quoth Insights
-- Purpose: Track all MCP interactions for usage analytics
-- ==============================================

BEGIN;

-- Activity logging table
CREATE TABLE IF NOT EXISTS quoth_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('search', 'read', 'propose', 'genesis', 'pattern_match')),
  query TEXT,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  patterns_matched TEXT[],
  result_count INTEGER,
  response_time_ms INTEGER,
  context JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_quoth_activity_project_id ON quoth_activity(project_id);
CREATE INDEX idx_quoth_activity_created_at ON quoth_activity(created_at DESC);
CREATE INDEX idx_quoth_activity_event_type ON quoth_activity(event_type);
CREATE INDEX idx_quoth_activity_project_created ON quoth_activity(project_id, created_at DESC);

-- RLS policies
ALTER TABLE quoth_activity ENABLE ROW LEVEL SECURITY;

-- Users can view activity for projects they have access to
CREATE POLICY "Users can view activity for their projects"
  ON quoth_activity FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = quoth_activity.project_id
        AND pm.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = quoth_activity.project_id
        AND p.is_public = true
    )
  );

-- Service role can insert (MCP server uses service role)
CREATE POLICY "Service role can insert activity"
  ON quoth_activity FOR INSERT
  WITH CHECK (true);

-- Grant permissions
GRANT SELECT ON quoth_activity TO authenticated;
GRANT INSERT ON quoth_activity TO authenticated;

COMMIT;
