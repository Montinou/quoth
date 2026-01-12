-- Migration 011: Fix cascade delete for projects when user is deleted
-- Problem: Projects become orphaned when owner is deleted (ON DELETE SET NULL)
-- Solution: Delete owned projects when owner profile is deleted

-- 1. Create trigger function to delete projects owned by a user
CREATE OR REPLACE FUNCTION public.handle_profile_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete all projects owned by this user
  -- This cascades to project_members, documents, etc.
  DELETE FROM public.projects WHERE owner_id = OLD.id;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.handle_profile_deletion IS
  'Deletes all projects owned by a user when their profile is deleted. Prevents orphaned projects.';

-- 2. Create trigger BEFORE delete on profiles
DROP TRIGGER IF EXISTS on_profile_deleted ON public.profiles;
CREATE TRIGGER on_profile_deleted
  BEFORE DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profile_deletion();
