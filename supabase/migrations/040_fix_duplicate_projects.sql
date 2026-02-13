-- ============================================================
-- Migration 040: Fix Duplicate Project Creation Issue
-- ============================================================
-- Problem: handle_new_user() doesn't handle slug conflicts
-- All users with same username end up sharing one project
-- Fix: Make slugs unique by appending user ID suffix
-- ============================================================

-- 1. Fix the handle_new_user function to guarantee unique slugs
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_project_id uuid;
  project_slug text;
  project_name text;
  unique_slug text;
  slug_exists boolean;
BEGIN
  -- Extract username from metadata
  project_name := COALESCE(NEW.raw_user_meta_data->>'username', 'user');

  -- Create profile
  INSERT INTO public.profiles (id, email, username, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    project_name,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (email) DO NOTHING; -- Prevent duplicate profile creation

  -- Generate unique slug with user ID suffix to avoid conflicts
  unique_slug := project_name || '-' || substring(NEW.id::text from 1 for 8) || '-kb';

  -- Safety check: if slug still exists (very unlikely), append random suffix
  SELECT EXISTS(SELECT 1 FROM public.projects WHERE slug = unique_slug) INTO slug_exists;
  IF slug_exists THEN
    unique_slug := project_name || '-' || substring(NEW.id::text from 1 for 12) || '-kb';
  END IF;

  -- Create default project with unique slug
  INSERT INTO public.projects (slug, github_repo, is_public, owner_id, created_by)
  VALUES (unique_slug, '', false, NEW.id, NEW.id)
  RETURNING id INTO new_project_id;

  -- Add user as admin
  INSERT INTO public.project_members (project_id, user_id, role)
  VALUES (new_project_id, NEW.id, 'admin');

  -- Set as default project
  UPDATE public.profiles
  SET default_project_id = new_project_id
  WHERE id = NEW.id;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't block user creation
    RAISE WARNING 'Failed to create default project for user %: %', NEW.email, SQLERRM;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user IS
  'Auto-creates profile and default project for new users. Uses UUID suffix to guarantee unique project slugs.';

-- 2. Fix existing users who are sharing projects
-- Find users without their own project and create one for them
DO $$
DECLARE
  user_record RECORD;
  new_project_id uuid;
  unique_slug text;
BEGIN
  -- Find users who don't own any project or whose default project they don't admin
  FOR user_record IN
    SELECT p.id, p.email, p.username, p.default_project_id
    FROM public.profiles p
    WHERE p.default_project_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.project_members pm
         WHERE pm.user_id = p.id
           AND pm.project_id = p.default_project_id
           AND pm.role = 'admin'
       )
  LOOP
    -- Generate unique slug for this user
    unique_slug := COALESCE(user_record.username, 'user') || '-' || 
                   substring(user_record.id::text from 1 for 8) || '-kb';

    -- Check if project already exists
    IF NOT EXISTS (SELECT 1 FROM public.projects WHERE slug = unique_slug) THEN
      -- Create new project
      INSERT INTO public.projects (slug, github_repo, is_public, owner_id, created_by)
      VALUES (unique_slug, '', false, user_record.id, user_record.id)
      RETURNING id INTO new_project_id;

      -- Add user as admin
      INSERT INTO public.project_members (project_id, user_id, role)
      VALUES (new_project_id, user_record.id, 'admin');

      -- Set as default project
      UPDATE public.profiles
      SET default_project_id = new_project_id
      WHERE id = user_record.id;

      RAISE NOTICE 'Created project % for user %', unique_slug, user_record.email;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- Migration complete
-- Users now get unique projects based on username + UUID prefix
-- Existing affected users have been given their own projects
-- ============================================================
