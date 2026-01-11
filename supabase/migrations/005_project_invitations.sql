-- ==============================================
-- Migration 005: Project Invitations
-- Enables team member invitations via email
-- ==============================================

-- A. Invitations table for pending invites
CREATE TABLE IF NOT EXISTS public.project_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  email text NOT NULL,
  role text CHECK (role IN ('admin', 'editor', 'viewer')) DEFAULT 'viewer' NOT NULL,
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  token text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(project_id, email)
);

-- B. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_invitations_project ON public.project_invitations(project_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.project_invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.project_invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_expiration ON public.project_invitations(expires_at);

-- C. Enable RLS
ALTER TABLE public.project_invitations ENABLE ROW LEVEL SECURITY;

-- D. RLS Policies for INVITATIONS

-- Project admins can view invitations for their projects
CREATE POLICY "Admins can view project invitations"
  ON public.project_invitations FOR SELECT
  USING (public.is_project_admin(project_id));

-- Anyone can view invitations sent to their email (for acceptance)
CREATE POLICY "Users can view their own invitations"
  ON public.project_invitations FOR SELECT
  USING (
    email = (
      SELECT email FROM public.profiles
      WHERE id = auth.uid()
    )
  );

-- Project admins can create invitations
CREATE POLICY "Admins can create invitations"
  ON public.project_invitations FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

-- Project admins can cancel/delete invitations
CREATE POLICY "Admins can cancel invitations"
  ON public.project_invitations FOR DELETE
  USING (public.is_project_admin(project_id));

-- Users can decline their own pending invitations
CREATE POLICY "Users can decline their invitations"
  ON public.project_invitations FOR DELETE
  USING (
    email = (
      SELECT email FROM public.profiles
      WHERE id = auth.uid()
    )
  );

-- E. Grant permissions
GRANT SELECT, INSERT, DELETE ON public.project_invitations TO authenticated;

-- F. Function to clean up expired invitations (optional cron job)
CREATE OR REPLACE FUNCTION public.cleanup_expired_invitations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.project_invitations
  WHERE expires_at < now();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.cleanup_expired_invitations IS
  'Removes expired invitations. Can be called via cron or manually.';

-- ==============================================
-- Migration complete
-- ==============================================
