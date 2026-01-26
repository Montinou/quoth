-- ==============================================
-- Migration 031: Fix Critical RLS Policy Bugs
-- ==============================================
--
-- Bug 1: projects_select_policy - Wrong Column Reference
-- Symptom: Both users see the same project "attorneyshare"
-- Root Cause: Migration 028 used `pm.project_id = id` but PostgreSQL
-- resolved `id` to `project_members.id` (not `projects.id`) because
-- both tables have an `id` column.
--
-- Bug 2: embeddings_select_policy - Incorrectly Dropped
-- Symptom: Documents not loading (embeddings inaccessible)
-- Root Cause: Migration 030 dropped `embeddings_select_policy` which
-- allowed viewers to read embeddings via `has_project_access()`. Now
-- only "Editors can manage embeddings" remains, which requires
-- `can_edit_project()` (editor/admin only) - blocking viewer access.
-- ==============================================

BEGIN;

-- =============================================
-- FIX 1: projects_select_policy - explicit table reference
-- =============================================

DROP POLICY IF EXISTS "projects_select_policy" ON projects;

CREATE POLICY "projects_select_policy" ON projects
  FOR SELECT
  USING (
    is_public = true
    OR EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = projects.id  -- Explicit reference to projects.id
        AND pm.user_id = (select auth.uid())
    )
  );

COMMENT ON POLICY "projects_select_policy" ON projects IS
  'Consolidated: public projects OR member projects (fixed column reference)';

-- =============================================
-- FIX 2: Re-create embeddings_select_policy for viewers
-- =============================================

CREATE POLICY "embeddings_select_policy" ON document_embeddings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = document_embeddings.document_id
        AND public.has_project_access(d.project_id)
    )
  );

COMMENT ON POLICY "embeddings_select_policy" ON document_embeddings IS
  'Viewers can read embeddings for accessible project documents';

COMMIT;

-- ==============================================
-- Verification queries (run after migration):
--
-- 1. Check projects_select_policy uses correct reference:
-- SELECT policyname, qual FROM pg_policies
-- WHERE tablename = 'projects' AND policyname = 'projects_select_policy';
-- Should show: (pm.project_id = projects.id)
--
-- 2. Check embeddings_select_policy exists:
-- SELECT policyname, qual FROM pg_policies
-- WHERE tablename = 'document_embeddings' AND policyname = 'embeddings_select_policy';
-- Should return a row
--
-- 3. Test project isolation:
-- Login as different users and verify they see their own projects only
-- ==============================================
