-- ==============================================
-- Migration 024: Drift Detection Schema
-- Purpose: Track documentation drift events with severity
-- ==============================================

BEGIN;

-- Drift events table for timeline visualization
CREATE TABLE IF NOT EXISTS drift_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,

  -- Drift details
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  drift_type TEXT NOT NULL CHECK (drift_type IN (
    'code_diverged',       -- Code doesn't match documented pattern
    'missing_doc',         -- Code exists without documentation
    'stale_doc',           -- Document hasn't been updated
    'pattern_violation'    -- Code violates documented pattern
  )),

  -- Context
  file_path TEXT NOT NULL,          -- Code file that triggered drift
  doc_path TEXT,                    -- Related document path
  description TEXT NOT NULL,        -- Human-readable description
  expected_pattern TEXT,            -- What doc says
  actual_code TEXT,                 -- What code does

  -- Resolution
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id),
  resolution_note TEXT,

  -- Timestamps
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for timeline queries
CREATE INDEX idx_drift_events_project_detected ON drift_events(project_id, detected_at DESC);
CREATE INDEX idx_drift_events_severity ON drift_events(project_id, severity);
CREATE INDEX idx_drift_events_unresolved ON drift_events(project_id, resolved) WHERE resolved = false;

-- RLS policies
ALTER TABLE drift_events ENABLE ROW LEVEL SECURITY;

-- Users can view drift events for their projects
CREATE POLICY "Users can view drift events for their projects"
  ON drift_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = drift_events.project_id
        AND pm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = drift_events.project_id
        AND p.is_public = true
    )
  );

-- Editors and admins can insert/update drift events
CREATE POLICY "Editors can manage drift events"
  ON drift_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = drift_events.project_id
        AND pm.user_id = auth.uid()
        AND pm.role IN ('admin', 'editor')
    )
  );

-- Service role can insert (for plugin hooks)
CREATE POLICY "Service role can insert drift events"
  ON drift_events FOR INSERT
  WITH CHECK (true);

GRANT SELECT ON drift_events TO authenticated;
GRANT INSERT, UPDATE ON drift_events TO authenticated;

COMMENT ON TABLE drift_events IS 'Tracks documentation drift events for timeline visualization';

COMMIT;
