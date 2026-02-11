-- ============================================================
-- Quoth v3.0 Phase 1: Organizations, Agents & Shared Knowledge
-- ============================================================
-- Dependencies: None (foundation phase)
-- Safe: All CREATE TABLE, ALTER ADD COLUMN IF NOT EXISTS, no destructive ops

-- ============================================================
-- 1. Organizations table (top-level container)
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  owner_user_id UUID REFERENCES auth.users(id),

  CHECK (slug ~ '^[a-z0-9-]+$')
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_user_id);

COMMENT ON TABLE organizations IS
  'Top-level container for agents and projects. Multi-tenant boundary for v3.0.';

-- ============================================================
-- 2. Agents table (registered agents in an organization)
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,

  -- Identity
  agent_name TEXT NOT NULL,
  display_name TEXT,

  -- Runtime info
  instance TEXT NOT NULL,
  model TEXT,
  role TEXT,

  -- Metadata
  capabilities JSONB,
  metadata JSONB,

  -- Lifecycle
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ,

  UNIQUE(organization_id, agent_name)
);

CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(organization_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_agents_instance ON agents(instance, status);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_agent_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agents_updated_at ON agents;
CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_timestamp();

COMMENT ON TABLE agents IS
  'Registered agents in an organization. Agents belong to orgs (NOT projects). Project assignment is optional via agent_projects.';
COMMENT ON COLUMN agents.organization_id IS
  'Organization this agent belongs to (mandatory). Agents are org-scoped, not project-scoped.';
COMMENT ON COLUMN agents.agent_name IS
  'Unique within organization. Used for lookup and messaging.';
COMMENT ON COLUMN agents.capabilities IS
  'JSON object describing agent capabilities, e.g., {"gpu": true, "max_ram_gb": 32}';

-- ============================================================
-- 3. Agent-Project assignment (optional many-to-many)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_projects (
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  role TEXT DEFAULT 'contributor' CHECK (role IN ('owner', 'contributor', 'readonly')),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  assigned_by TEXT,

  PRIMARY KEY (agent_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_projects_agent ON agent_projects(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_projects_project ON agent_projects(project_id);

COMMENT ON TABLE agent_projects IS
  'Optional many-to-many: assign agents to projects for filtering/permissions. Agents always belong to org; this adds project-level access control.';

-- ============================================================
-- 4. Extend projects table with organization_id
-- ============================================================
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);

COMMENT ON COLUMN projects.organization_id IS
  'Organization this project belongs to. NULL for legacy projects pending migration.';

-- ============================================================
-- 5. Extend documents table
-- ============================================================
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id),
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'project',
  ADD COLUMN IF NOT EXISTS tags TEXT[];

-- Add CHECK constraint separately (can't do in ADD COLUMN IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_visibility_check'
  ) THEN
    ALTER TABLE documents ADD CONSTRAINT documents_visibility_check
      CHECK (visibility IN ('project', 'shared'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_visibility
  ON documents(visibility, project_id) WHERE visibility = 'shared';
CREATE INDEX IF NOT EXISTS idx_documents_tags
  ON documents USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_documents_agent
  ON documents(agent_id) WHERE agent_id IS NOT NULL;

COMMENT ON COLUMN documents.agent_id IS
  'UUID reference to agents table. NULL for human-created or legacy docs.';
COMMENT ON COLUMN documents.visibility IS
  'project = visible only in this project, shared = visible across all projects in the organization';
COMMENT ON COLUMN documents.tags IS
  'Array of tags for organization and filtering, e.g., ["architecture", "embeddings"]';

-- ============================================================
-- 6. Extend document_proposals for agent tracking
-- ============================================================
ALTER TABLE document_proposals
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id),
  ADD COLUMN IF NOT EXISTS source_instance TEXT;

COMMENT ON COLUMN document_proposals.agent_id IS
  'Agent who proposed this change (e.g., curator agent)';
COMMENT ON COLUMN document_proposals.source_instance IS
  'Instance where proposal originated (e.g., "aws", "mac")';

-- ============================================================
-- 7. Curator log table
-- ============================================================
CREATE TABLE IF NOT EXISTS curator_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  curator_agent_id UUID REFERENCES agents(id) NOT NULL,
  instance TEXT NOT NULL,
  run_at TIMESTAMPTZ DEFAULT now(),

  agents_reviewed UUID[],
  documents_scanned INT DEFAULT 0,
  documents_proposed INT DEFAULT 0,
  documents_approved INT DEFAULT 0,
  proposals_made INT DEFAULT 0,

  summary TEXT,
  last_document_id UUID,
  last_memory_dates JSONB
);

CREATE INDEX IF NOT EXISTS idx_curator_log_org ON curator_log(organization_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_curator_log_agent ON curator_log(curator_agent_id, run_at DESC);

COMMENT ON TABLE curator_log IS
  'Activity log for curator agents. Each run creates one entry.';

-- ============================================================
-- 8. Backward compatibility migration (v2.0 → v3.0)
-- ============================================================

-- 8a. Create organization for each existing project that doesn't have one
INSERT INTO organizations (slug, name, owner_user_id)
SELECT DISTINCT ON (p.slug)
  p.slug || '-org' AS slug,
  p.slug || ' Organization' AS name,
  pm.user_id AS owner_user_id
FROM projects p
LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.role = 'admin'
WHERE p.organization_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM organizations WHERE slug = p.slug || '-org')
ORDER BY p.slug, p.created_at;

-- 8b. Link projects to their organizations
UPDATE projects p
SET organization_id = o.id
FROM organizations o
WHERE p.slug || '-org' = o.slug
  AND p.organization_id IS NULL;

-- 8c. Create a default "human" agent for each organization
INSERT INTO agents (organization_id, agent_name, display_name, instance, role, status)
SELECT
  o.id,
  'human',
  'Human User',
  'web',
  'admin',
  'active'
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM agents
  WHERE organization_id = o.id
    AND agent_name = 'human'
);

-- ============================================================
-- 9. RPC: Search shared documents within an organization
-- ============================================================
CREATE OR REPLACE FUNCTION match_shared_documents(
  query_embedding vector(512),
  p_organization_id UUID,
  match_count INT,
  filter_tags TEXT[] DEFAULT NULL,
  filter_agent_id UUID DEFAULT NULL
)
RETURNS TABLE (
  document_id UUID,
  content_chunk TEXT,
  similarity FLOAT,
  title TEXT,
  project_slug TEXT,
  agent_id UUID,
  agent_name TEXT,
  tags TEXT[]
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    de.document_id,
    de.content_chunk,
    1 - (de.embedding <=> query_embedding) AS similarity,
    d.title,
    p.slug AS project_slug,
    d.agent_id,
    a.agent_name,
    d.tags
  FROM document_embeddings de
  JOIN documents d ON de.document_id = d.id
  JOIN projects p ON d.project_id = p.id
  LEFT JOIN agents a ON d.agent_id = a.id
  WHERE d.visibility = 'shared'
    AND p.organization_id = p_organization_id
    AND (filter_tags IS NULL OR d.tags && filter_tags)
    AND (filter_agent_id IS NULL OR d.agent_id = filter_agent_id)
  ORDER BY de.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_shared_documents IS
  'Search shared documents within an organization. Respects visibility=shared filter.';

-- ============================================================
-- 10. RLS Policies for new tables
-- ============================================================

-- 10a. Helper: Check if user has access to an organization
-- (user is owner OR is member of any project in that org)
CREATE OR REPLACE FUNCTION public.has_org_access(target_org_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  -- User is org owner
  IF EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = target_org_id AND owner_user_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  -- User is member of any project in this org
  RETURN EXISTS (
    SELECT 1 FROM public.project_members pm
    JOIN public.projects p ON pm.project_id = p.id
    WHERE pm.user_id = auth.uid()
      AND p.organization_id = target_org_id
  );
END;
$$;

COMMENT ON FUNCTION public.has_org_access IS
  'Check if current user can access an organization (owner or member of any project in it).';

-- 10b. Helper: Check if user is org admin (owner or admin of any project)
CREATE OR REPLACE FUNCTION public.is_org_admin(target_org_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  -- User is org owner
  IF EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = target_org_id AND owner_user_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  -- User is admin of any project in this org
  RETURN EXISTS (
    SELECT 1 FROM public.project_members pm
    JOIN public.projects p ON pm.project_id = p.id
    WHERE pm.user_id = auth.uid()
      AND p.organization_id = target_org_id
      AND pm.role = 'admin'
  );
END;
$$;

COMMENT ON FUNCTION public.is_org_admin IS
  'Check if current user is an organization admin (owner or admin of any project in it).';

-- ---- ORGANIZATIONS RLS ----
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view orgs they belong to"
  ON public.organizations FOR SELECT
  USING (public.has_org_access(id));

CREATE POLICY "Users can create organizations"
  ON public.organizations FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Org owners can update their org"
  ON public.organizations FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Org owners can delete their org"
  ON public.organizations FOR DELETE
  USING (owner_user_id = auth.uid());

CREATE POLICY "Service role full access to organizations"
  ON public.organizations FOR ALL
  USING (auth.role() = 'service_role');

-- ---- AGENTS RLS ----
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view agents in their orgs"
  ON public.agents FOR SELECT
  USING (public.has_org_access(organization_id));

CREATE POLICY "Org admins can manage agents"
  ON public.agents FOR INSERT
  WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "Org admins can update agents"
  ON public.agents FOR UPDATE
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "Org admins can delete agents"
  ON public.agents FOR DELETE
  USING (public.is_org_admin(organization_id));

CREATE POLICY "Service role full access to agents"
  ON public.agents FOR ALL
  USING (auth.role() = 'service_role');

-- ---- AGENT_PROJECTS RLS ----
ALTER TABLE public.agent_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view agent assignments in their orgs"
  ON public.agent_projects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = agent_projects.agent_id
        AND public.has_org_access(a.organization_id)
    )
  );

CREATE POLICY "Org admins can manage agent assignments"
  ON public.agent_projects FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = agent_projects.agent_id
        AND public.is_org_admin(a.organization_id)
    )
  );

CREATE POLICY "Service role full access to agent_projects"
  ON public.agent_projects FOR ALL
  USING (auth.role() = 'service_role');

-- ---- CURATOR_LOG RLS ----
ALTER TABLE public.curator_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view curator logs in their orgs"
  ON public.curator_log FOR SELECT
  USING (public.has_org_access(organization_id));

CREATE POLICY "Service role full access to curator_log"
  ON public.curator_log FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- 11. Verify migration
-- ============================================================
DO $$
DECLARE
  org_count INT;
  agent_count INT;
  linked_projects INT;
BEGIN
  SELECT COUNT(*) INTO org_count FROM organizations;
  SELECT COUNT(*) INTO agent_count FROM agents;
  SELECT COUNT(*) INTO linked_projects FROM projects WHERE organization_id IS NOT NULL;

  RAISE NOTICE 'Phase 1 migration complete:';
  RAISE NOTICE '  Organizations: %', org_count;
  RAISE NOTICE '  Agents: %', agent_count;
  RAISE NOTICE '  Projects linked to orgs: %', linked_projects;
END $$;
