-- Fix for Recursive RLS Policy on Profiles table
-- This migration breaks the infinite loop caused by policies referencing tables that reference themselves via other policies.

-- 1. Create a SECURITY DEFINER function to check shared project membership.
-- SECURITY DEFINER forces the function to run with the privileges of the creator (superuser),
-- effectively bypassing RLS on the tables queried INSIDE the function.
CREATE OR REPLACE FUNCTION public.has_shared_project(target_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  -- Check if the current user (auth.uid()) shares any project with the target user
  RETURN EXISTS (
    SELECT 1 
    FROM public.project_members pm1
    JOIN public.project_members pm2 ON pm1.project_id = pm2.project_id
    WHERE pm1.user_id = auth.uid()
      AND pm2.user_id = target_user_id
  );
END;
$$;

COMMENT ON FUNCTION public.has_shared_project IS 'Checks if auth user and target user share a project. Bypasses RLS to prevent recursion.';

-- 2. Drop the problematic recursive policy
DROP POLICY IF EXISTS "Users can view project members profiles" ON public.profiles;

-- 3. Create the new safe policy using the function
CREATE POLICY "Users can view project members profiles"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id -- Can view own profile
    OR
    public.has_shared_project(id) -- Can view profiles of shared project members
  );

-- Note: We combine "own profile" and "shared project" for clarity, 
-- though "Users can view own profile" policy might already exist. 
-- If it exists, this OR condition covers it redundantly but safely.
