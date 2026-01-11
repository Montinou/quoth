-- Quoth Proposal System Schema
-- Run this in Supabase SQL Editor to set up the proposal workflow

-- 1. Document Proposals Table (The Shadow Log)
create table if not exists document_proposals (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id),
  project_id uuid references projects(id) not null,

  -- File paths
  file_path text not null,

  -- Content versions (for diff viewing)
  original_content text, -- Snapshot before change
  proposed_content text not null, -- New version

  -- Audit metadata
  reasoning text not null,
  evidence_snippet text,

  -- Status workflow: pending → approved/rejected → applied/error
  status text check (status in ('pending', 'approved', 'rejected', 'applied', 'error')) default 'pending',
  rejection_reason text,

  -- GitHub integration
  commit_sha text,
  commit_url text,

  -- AI governance (Phase 2 prep - optional for now)
  risk_score int default 0 check (risk_score >= 0 and risk_score <= 100),
  ai_verdict jsonb,
  auto_approved boolean default false,

  -- Timestamps
  created_at timestamp with time zone default timezone('utc'::text, now()),
  reviewed_at timestamp with time zone,
  reviewed_by text, -- Reviewer email
  applied_at timestamp with time zone
);

-- 2. Indexes for dashboard queries
create index if not exists idx_proposals_status on document_proposals(status);
create index if not exists idx_proposals_project on document_proposals(project_id);
create index if not exists idx_proposals_created on document_proposals(created_at desc);

-- 3. RPC function for dashboard with document details
-- Avoids N+1 queries when fetching proposals with their document info
create or replace function get_proposals_with_details(
  filter_status text default null,
  limit_count int default 50
)
returns table (
  id uuid,
  file_path text,
  reasoning text,
  status text,
  created_at timestamp with time zone,
  document_title text
)
language plpgsql stable
as $$
begin
  return query
  select
    dp.id,
    dp.file_path,
    dp.reasoning,
    dp.status,
    dp.created_at,
    d.title as document_title
  from document_proposals dp
  left join documents d on dp.document_id = d.id
  where (filter_status is null or dp.status = filter_status)
  order by dp.created_at desc
  limit limit_count;
end;
$$;

-- 4. Comments
comment on table document_proposals is 'Shadow log for AI-proposed documentation updates requiring human approval';
comment on column document_proposals.original_content is 'Snapshot of document content before proposed change';
comment on column document_proposals.proposed_content is 'New content proposed by AI agent';
comment on column document_proposals.reasoning is 'AI explanation of why the update is needed';
comment on column document_proposals.evidence_snippet is 'Code snippet or commit reference supporting the change';
comment on column document_proposals.status is 'Workflow status: pending (new), approved (human approved), rejected (human rejected), applied (committed to GitHub), error (commit failed)';
comment on column document_proposals.risk_score is 'AI-calculated risk score 0-100 (Phase 2 - not used yet)';
comment on column document_proposals.ai_verdict is 'AI Gatekeeper analysis (Phase 2 - not used yet)';
comment on column document_proposals.auto_approved is 'Whether AI auto-approved without human review (Phase 2 - not used yet)';
