-- Migration: 023_coverage_tracking.sql
-- Purpose: Track documentation coverage snapshots for dashboard

BEGIN;

-- Coverage snapshots table
CREATE TABLE IF NOT EXISTS coverage_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Coverage metrics
  total_documentable INTEGER NOT NULL DEFAULT 0,
  total_documented INTEGER NOT NULL DEFAULT 0,
  coverage_percentage NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE
      WHEN total_documentable > 0
      THEN ROUND((total_documented::NUMERIC / total_documentable) * 100, 2)
      ELSE 0
    END
  ) STORED,

  -- Breakdown by category (convention-based)
  breakdown JSONB DEFAULT '{
    "api_endpoints": {"documented": 0, "total": 0},
    "components": {"documented": 0, "total": 0},
    "testing_patterns": {"documented": 0, "total": 0},
    "database_models": {"documented": 0, "total": 0},
    "architecture": {"documented": 0, "total": 0}
  }'::jsonb,

  -- Undocumented items list
  undocumented_items JSONB DEFAULT '[]'::jsonb,

  -- Metadata
  scan_type TEXT DEFAULT 'manual' CHECK (scan_type IN ('manual', 'scheduled', 'genesis')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fetching latest snapshot
CREATE INDEX idx_coverage_snapshot_project_latest
  ON coverage_snapshot(project_id, created_at DESC);

-- RLS policies
ALTER TABLE coverage_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view project coverage"
  ON coverage_snapshot FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage coverage"
  ON coverage_snapshot FOR ALL
  WITH CHECK (true);

COMMENT ON TABLE coverage_snapshot IS 'Stores point-in-time documentation coverage metrics';

COMMIT;
