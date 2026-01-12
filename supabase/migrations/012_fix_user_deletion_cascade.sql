-- Migration 012: Fix user deletion to properly cascade through all relationships
-- Problem: Deleting a user fails due to RLS policies or constraint issues
-- Solution: Use SECURITY DEFINER function to bypass RLS and handle all cascades

-- Drop the old trigger first
DROP TRIGGER IF EXISTS on_profile_deleted ON public.profiles;
DROP FUNCTION IF EXISTS public.handle_profile_deletion();

-- Create comprehensive cleanup function
CREATE OR REPLACE FUNCTION public.cascade_delete_user_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete projects owned by this user
  -- CASCADE will handle: project_members, project_api_keys, documents,
  -- document_embeddings, document_history, document_proposals
  DELETE FROM public.projects WHERE owner_id = OLD.id;

  -- Clean up any invitations sent by this user
  DELETE FROM public.project_invitations WHERE invited_by = OLD.id;

  -- Remove user from any project memberships (if not already cascaded)
  DELETE FROM public.project_members WHERE user_id = OLD.id;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.cascade_delete_user_data IS
  'Cascades user deletion through projects and memberships. Runs with SECURITY DEFINER to bypass RLS.';

-- Create trigger on profiles table
CREATE TRIGGER cascade_delete_user_data_trigger
  BEFORE DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_delete_user_data();

COMMENT ON TRIGGER cascade_delete_user_data_trigger ON public.profiles IS
  'Automatically cleans up user data when profile is deleted';
