-- =============================================================
-- Migration 005: Row Level Security (RLS)
-- Created: 2026-03-30
-- Description: Enables RLS on all tables with org_id isolation
--   policies. Table owner bypasses RLS for writes (no WITH CHECK
--   needed). All reads are filtered via session variables set by
--   the application before executing queries.
-- =============================================================

-- ─── Helper functions ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '');
$$ LANGUAGE sql STABLE;

-- =============================================================
-- Schema: public
-- =============================================================

-- organizations — tenant boundary itself
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON public.organizations
  USING (id = app_org_id());

-- users — own row or any member of calling org
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON public.users
  USING (
    clerk_user_id = app_user_id()
    OR id IN (
      SELECT user_id FROM public.org_members WHERE org_id = app_org_id()
    )
  );

-- org_members — rows belonging to calling org
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON public.org_members
  USING (org_id = app_org_id());

-- projects — direct org_id column
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON public.projects
  USING (org_id = app_org_id());

-- project_members — via project → org
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON public.project_members
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE org_id = app_org_id()
    )
  );

-- =============================================================
-- Schema: agents
-- =============================================================

-- registry — direct org_id column
ALTER TABLE agents.registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON agents.registry
  USING (org_id = app_org_id());

-- api_keys — direct org_id column
ALTER TABLE agents.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON agents.api_keys
  USING (org_id = app_org_id());

-- agent_projects — via project → org
ALTER TABLE agents.agent_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON agents.agent_projects
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE org_id = app_org_id()
    )
  );

-- webhook_subscriptions — direct org_id column
ALTER TABLE agents.webhook_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON agents.webhook_subscriptions
  USING (org_id = app_org_id());

-- =============================================================
-- Schema: docs
-- =============================================================

-- documents — has both org_id and project_id; use org_id directly
ALTER TABLE docs.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON docs.documents
  USING (org_id = app_org_id());

-- chunks — only project_id; subquery via projects
ALTER TABLE docs.chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON docs.chunks
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE org_id = app_org_id()
    )
  );

-- document_history — only document_id; subquery via documents
ALTER TABLE docs.document_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON docs.document_history
  USING (
    document_id IN (
      SELECT id FROM docs.documents WHERE org_id = app_org_id()
    )
  );

-- proposals — only project_id; subquery via projects
ALTER TABLE docs.proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON docs.proposals
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE org_id = app_org_id()
    )
  );

-- =============================================================
-- Schema: search
-- =============================================================

-- query_cache — only project_id; subquery via projects
ALTER TABLE search.query_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON search.query_cache
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE org_id = app_org_id()
    )
  );

-- logs — only project_id; subquery via projects
ALTER TABLE search.logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON search.logs
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE org_id = app_org_id()
    )
  );

-- drift_events — only project_id; subquery via projects
ALTER TABLE search.drift_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON search.drift_events
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE org_id = app_org_id()
    )
  );

-- =============================================================
-- Schema: analytics
-- =============================================================

-- activity — has both org_id and project_id; use org_id directly
ALTER TABLE analytics.activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON analytics.activity
  USING (org_id = app_org_id());

-- coverage_snapshots — only project_id; subquery via projects
ALTER TABLE analytics.coverage_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON analytics.coverage_snapshots
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE org_id = app_org_id()
    )
  );

-- usage — only project_id; subquery via projects
ALTER TABLE analytics.usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON analytics.usage
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE org_id = app_org_id()
    )
  );

-- generations — only project_id; subquery via projects
ALTER TABLE analytics.generations ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON analytics.generations
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE org_id = app_org_id()
    )
  );

-- =============================================================
-- Schema: comms
-- =============================================================

-- channels — direct org_id column
ALTER TABLE comms.channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON comms.channels
  USING (org_id = app_org_id());

-- channel_subscriptions — via channel → org
ALTER TABLE comms.channel_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON comms.channel_subscriptions
  USING (
    channel_id IN (
      SELECT id FROM comms.channels WHERE org_id = app_org_id()
    )
  );

-- messages — direct org_id column
ALTER TABLE comms.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON comms.messages
  USING (org_id = app_org_id());

-- tasks — direct org_id column
ALTER TABLE comms.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON comms.tasks
  USING (org_id = app_org_id());

-- webhook_deliveries — via webhook_subscriptions → org
ALTER TABLE comms.webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON comms.webhook_deliveries
  USING (
    subscription_id IN (
      SELECT id FROM agents.webhook_subscriptions WHERE org_id = app_org_id()
    )
  );
