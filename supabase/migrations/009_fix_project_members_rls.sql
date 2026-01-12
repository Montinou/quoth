-- Fix for Recursive RLS Policy on Project Members table
-- Similar to 008, the "Users can view project members" policy references the project_members table itself,
-- causing infinite recursion during Realtime checks or complex queries.

-- 1. Create a SECURITY DEFINER function to get the current user's project IDs.
-- This allows checking membership without triggering the RLS policy on the project_members table.
CREATE OR REPLACE FUNCTION public.get_user_project_ids()
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY SELECT project_id FROM public.project_members WHERE user_id = auth.uid();
END;
$$;

COMMENT ON FUNCTION public.get_user_project_ids IS 'Returns project IDs the restricted user is a member of. Bypasses RLS.';

-- 2. Drop the recursive policy
DROP POLICY IF EXISTS "Users can view project members" ON public.project_members;

-- 3. Create safe policy using the function
CREATE POLICY "Users can view project members"
  ON public.project_members FOR SELECT
  USING (
    project_id IN (SELECT public.get_user_project_ids())
  );
