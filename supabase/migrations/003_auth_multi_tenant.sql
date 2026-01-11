-- ==============================================
-- Migration 003: Multi-Tenant Authentication
-- Implements Supabase Auth + Row Level Security
-- ==============================================

-- A. Profiles table (synced with auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  username text UNIQUE NOT NULL,
  full_name text,
  avatar_url text,
  default_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_default_project ON public.profiles(default_project_id);

-- B. Project members (user-project-role relationship)
CREATE TABLE IF NOT EXISTS public.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  role text CHECK (role IN ('admin', 'editor', 'viewer')) DEFAULT 'viewer' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE(project_id, user_id)
);

-- Create indexes for fast permission checks
CREATE INDEX IF NOT EXISTS idx_project_members_user ON public.project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON public.project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_role ON public.project_members(project_id, role);

-- C. API keys for MCP (JWT tokens)
CREATE TABLE IF NOT EXISTS public.project_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  label text,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Create indexes for API key validation (performance critical)
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.project_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_project ON public.project_api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_expiration ON public.project_api_keys(expires_at)
  WHERE expires_at IS NOT NULL;

-- D. Extend projects table
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Mark existing project as public demo
UPDATE public.projects
SET is_public = true
WHERE slug = 'quoth-knowledge-base';

-- Create index for public project queries
CREATE INDEX IF NOT EXISTS idx_projects_public ON public.projects(is_public) WHERE is_public = true;

-- E. Enable RLS on all tables
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_api_keys ENABLE ROW LEVEL SECURITY;

-- F. Helper function: Check project access
CREATE OR REPLACE FUNCTION public.has_project_access(target_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  -- Public projects accessible to all (authenticated or not)
  IF EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = target_project_id AND is_public = true
  ) THEN
    RETURN true;
  END IF;

  -- Private projects require membership
  RETURN EXISTS (
    SELECT 1 FROM public.project_members
    WHERE user_id = auth.uid() AND project_id = target_project_id
  );
END;
$$;

COMMENT ON FUNCTION public.has_project_access IS
  'Check if current user can access a project (public or member). Used by RLS policies.';

-- G. Helper function: Check if user is admin
CREATE OR REPLACE FUNCTION public.is_project_admin(target_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.project_members
    WHERE user_id = auth.uid()
      AND project_id = target_project_id
      AND role = 'admin'
  );
END;
$$;

-- H. Helper function: Check if user can edit
CREATE OR REPLACE FUNCTION public.can_edit_project(target_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.project_members
    WHERE user_id = auth.uid()
      AND project_id = target_project_id
      AND role IN ('admin', 'editor')
  );
END;
$$;

-- I. RLS Policies for PROFILES
-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Users can view profiles of members in their projects (for collaboration)
CREATE POLICY "Users can view project members profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm1
      INNER JOIN public.project_members pm2
        ON pm1.project_id = pm2.project_id
      WHERE pm1.user_id = auth.uid()
        AND pm2.user_id = public.profiles.id
    )
  );

-- J. RLS Policies for PROJECTS
-- Everyone can view public projects
CREATE POLICY "Anyone can view public projects"
  ON public.projects FOR SELECT
  USING (is_public = true);

-- Users can view their member projects
CREATE POLICY "Users can view their projects"
  ON public.projects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members
      WHERE user_id = auth.uid()
        AND project_id = public.projects.id
    )
  );

-- Admins can update their projects
CREATE POLICY "Admins can update projects"
  ON public.projects FOR UPDATE
  USING (public.is_project_admin(id))
  WITH CHECK (public.is_project_admin(id));

-- Authenticated users can create projects
CREATE POLICY "Authenticated users can create projects"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- K. RLS Policies for DOCUMENTS
-- Public project documents are readable by anyone
CREATE POLICY "Public project documents readable"
  ON public.documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = public.documents.project_id AND is_public = true
    )
  );

-- Users can view documents in their projects
CREATE POLICY "Users can view their project documents"
  ON public.documents FOR SELECT
  USING (public.has_project_access(project_id));

-- Editors can insert documents
CREATE POLICY "Editors can insert documents"
  ON public.documents FOR INSERT
  WITH CHECK (public.can_edit_project(project_id));

-- Editors can update documents
CREATE POLICY "Editors can update documents"
  ON public.documents FOR UPDATE
  USING (public.can_edit_project(project_id))
  WITH CHECK (public.can_edit_project(project_id));

-- Admins can delete documents
CREATE POLICY "Admins can delete documents"
  ON public.documents FOR DELETE
  USING (public.is_project_admin(project_id));

-- L. RLS Policies for DOCUMENT_EMBEDDINGS
-- Embeddings follow document permissions (read-only for users)
CREATE POLICY "Embeddings inherit document read permissions"
  ON public.document_embeddings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = public.document_embeddings.document_id
        AND public.has_project_access(d.project_id)
    )
  );

-- M. RLS Policies for DOCUMENT_PROPOSALS
-- Users can view proposals in their projects
CREATE POLICY "Users can view project proposals"
  ON public.document_proposals FOR SELECT
  USING (public.has_project_access(project_id));

-- Editors can create proposals
CREATE POLICY "Editors can create proposals"
  ON public.document_proposals FOR INSERT
  WITH CHECK (public.can_edit_project(project_id));

-- Admins can update/approve proposals
CREATE POLICY "Admins can manage proposals"
  ON public.document_proposals FOR UPDATE
  USING (public.is_project_admin(project_id))
  WITH CHECK (public.is_project_admin(project_id));

-- N. RLS Policies for PROJECT_MEMBERS
-- Users can view members of their projects
CREATE POLICY "Users can view project members"
  ON public.project_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
        AND pm.project_id = public.project_members.project_id
    )
  );

-- Admins can add members
CREATE POLICY "Admins can add members"
  ON public.project_members FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

-- Admins can update members
CREATE POLICY "Admins can update members"
  ON public.project_members FOR UPDATE
  USING (public.is_project_admin(project_id))
  WITH CHECK (public.is_project_admin(project_id));

-- Admins can remove members
CREATE POLICY "Admins can remove members"
  ON public.project_members FOR DELETE
  USING (public.is_project_admin(project_id));

-- Users can leave projects (delete own membership)
CREATE POLICY "Users can leave projects"
  ON public.project_members FOR DELETE
  USING (user_id = auth.uid());

-- O. RLS Policies for API_KEYS
-- Admins can view their project's API keys
CREATE POLICY "Admins can view project API keys"
  ON public.project_api_keys FOR SELECT
  USING (public.is_project_admin(project_id));

-- Admins can create API keys
CREATE POLICY "Admins can create API keys"
  ON public.project_api_keys FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

-- Admins can update API keys (for revocation)
CREATE POLICY "Admins can update API keys"
  ON public.project_api_keys FOR UPDATE
  USING (public.is_project_admin(project_id))
  WITH CHECK (public.is_project_admin(project_id));

-- P. Auto-create profile trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_project_id uuid;
  project_slug text;
  project_name text;
BEGIN
  -- Extract username from metadata
  project_name := NEW.raw_user_meta_data->>'username';

  -- Create profile
  INSERT INTO public.profiles (id, email, username, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    project_name,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );

  -- Create default project
  project_slug := project_name || '-knowledge-base';

  INSERT INTO public.projects (slug, github_repo, is_public, owner_id, created_by)
  VALUES (project_slug, '', false, NEW.id, NEW.id)
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

-- Attach trigger to auth.users table
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Q. Update timestamp trigger for profiles
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- R. Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT ON public.projects TO authenticated, anon;
GRANT SELECT, INSERT ON public.project_members TO authenticated;
GRANT SELECT, INSERT ON public.documents TO authenticated;
GRANT SELECT ON public.document_embeddings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.document_proposals TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.project_api_keys TO authenticated;

-- ==============================================
-- Migration complete
-- ==============================================
