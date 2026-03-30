-- =============================================================
-- Migration 004: A2A Communication System Fixes
-- Created: 2026-03-29
-- Description: Add webhook retry + task lifecycle event types
--   to analytics CHECK, add auto-fail overdue tasks function,
--   add project access check function.
-- =============================================================

-- 1. Add webhook retry event type to analytics CHECK
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
  'memory_store', 'memory_search', 'memory_list', 'memory_forget',
  'consolidation', 'cache_cleanup',
  'webhook_retry', 'task_auto_failed', 'task_reassigned'
));

-- 2. Function: auto-fail overdue tasks
CREATE OR REPLACE FUNCTION comms.auto_fail_overdue_tasks()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE comms.tasks
  SET status = 'failed',
      result = '{"error": "Task exceeded deadline and was auto-failed"}'::jsonb,
      completed_at = now(),
      updated_at = now()
  WHERE status = 'in_progress'
    AND deadline IS NOT NULL
    AND deadline < now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- 3. Function: check if agent has project membership
CREATE OR REPLACE FUNCTION agents.has_project_access(
  p_agent_id uuid,
  p_project_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM agents.agent_projects
    WHERE agent_id = p_agent_id AND project_id = p_project_id
  );
$$;
