-- Migration 010: Robust User Setup
-- Fixes issue where re-signup fails due to existing project slug from previous deleted account
-- Also handles username collisions gracefully

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_project_id uuid;
  base_slug text;
  final_slug text;
  slug_collision boolean;
  counter integer := 1;
  project_name text;
BEGIN
  -- Extract username from metadata (default to 'user' if missing)
  project_name := COALESCE(NEW.raw_user_meta_data->>'username', 'user');
  
  -- Create profile (upsert to handle potential race conditions or re-creation)
  INSERT INTO public.profiles (id, email, username, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    project_name,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    username = EXCLUDED.username,
    full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url;

  -- Generate base project slug
  base_slug := project_name || '-knowledge-base';
  final_slug := base_slug;
  
  -- Check for slug collision and append suffix if needed
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.projects WHERE slug = final_slug
    ) INTO slug_collision;
    
    EXIT WHEN NOT slug_collision;
    
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;

  -- Create project
  INSERT INTO public.projects (slug, github_repo, is_public, owner_id, created_by)
  VALUES (final_slug, '', false, NEW.id, NEW.id)
  RETURNING id INTO new_project_id;

  -- Add user as admin
  INSERT INTO public.project_members (project_id, user_id, role)
  VALUES (new_project_id, NEW.id, 'admin');

  -- Set as default project
  UPDATE public.profiles
  SET default_project_id = new_project_id
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;
