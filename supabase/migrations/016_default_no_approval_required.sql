-- Migration 016: Change require_approval default to false
-- Reason: Direct document creation/updates should be the default behavior
-- Document history is still preserved via the on_document_update trigger

BEGIN;

-- 1. Change the column default from true to false
ALTER TABLE public.projects
  ALTER COLUMN require_approval SET DEFAULT false;

-- 2. Update existing projects that have require_approval = true to false
-- (Only if they haven't explicitly set it - this updates all to the new default)
UPDATE public.projects
SET require_approval = false
WHERE require_approval = true;

COMMIT;

-- Verification
-- SELECT id, name, require_approval FROM projects;
