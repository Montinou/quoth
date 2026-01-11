-- Fix Function Search Path Security
-- Sets search_path = '' to prevent search_path hijacking attacks
-- This ensures functions always use fully-qualified table references

-- =============================================================================
-- CRITICAL: RLS Helper Functions (SECURITY DEFINER)
-- These are used in RLS policies and are the highest security priority
-- =============================================================================

ALTER FUNCTION public.has_project_access(uuid) SET search_path = '';
ALTER FUNCTION public.is_project_admin(uuid) SET search_path = '';
ALTER FUNCTION public.can_edit_project(uuid) SET search_path = '';

-- =============================================================================
-- Trigger Functions
-- =============================================================================

ALTER FUNCTION public.handle_new_user() SET search_path = '';
ALTER FUNCTION public.update_updated_at_column() SET search_path = '';

-- =============================================================================
-- Data Query Functions
-- =============================================================================

ALTER FUNCTION public.match_documents(vector(768), float, int, uuid) SET search_path = '';
ALTER FUNCTION public.get_document_by_path(uuid, text) SET search_path = '';
ALTER FUNCTION public.get_proposals_with_details(text, int) SET search_path = '';

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON FUNCTION public.has_project_access(uuid) IS 'RLS helper: Check if current user has access to project. search_path secured.';
COMMENT ON FUNCTION public.is_project_admin(uuid) IS 'RLS helper: Check if current user is admin of project. search_path secured.';
COMMENT ON FUNCTION public.can_edit_project(uuid) IS 'RLS helper: Check if current user can edit project (admin or editor). search_path secured.';
