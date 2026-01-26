-- Migration: 025_add_document_type_column.sql
-- Purpose: Add doc_type column to documents table for meaningful coverage calculation
--
-- Problem: Coverage shows 100% with "5/5 documented" but this is meaningless -
-- the system was counting existing documents as both numerator AND denominator.
-- The document type was buried in YAML frontmatter, not queryable.
--
-- Solution: Add queryable doc_type column and backfill from file_path patterns.

BEGIN;

-- 1. Add doc_type column with check constraint for valid types
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS doc_type TEXT;

-- Add check constraint for valid document types
-- These map to Genesis phases and Quoth documentation categories
ALTER TABLE documents
ADD CONSTRAINT documents_doc_type_check
CHECK (doc_type IS NULL OR doc_type IN (
  'testing-pattern',  -- Testing patterns, conventions (Phase 3)
  'architecture',     -- Project overview, tech stack, repo structure (Phase 1-2)
  'contract',         -- API schemas, database models, shared types (Phase 4)
  'meta',             -- Validation logs, proposals
  'template'          -- Document templates
));

-- 2. Create index for fast coverage queries by project and type
CREATE INDEX IF NOT EXISTS idx_documents_project_doc_type
ON documents(project_id, doc_type);

-- 3. Backfill existing documents based on file_path patterns
-- Priority: file_path pattern inference (frontmatter extraction happens during sync)

-- Architecture documents (Phase 1-2)
UPDATE documents SET doc_type = 'architecture'
WHERE doc_type IS NULL
AND (
  file_path ILIKE '%project-overview%'
  OR file_path ILIKE '%tech-stack%'
  OR file_path ILIKE '%repo-structure%'
  OR file_path ILIKE '%/architecture/%'
  OR file_path ILIKE 'architecture/%'
);

-- Testing patterns (Phase 3)
UPDATE documents SET doc_type = 'testing-pattern'
WHERE doc_type IS NULL
AND (
  file_path ILIKE '%testing-pattern%'
  OR file_path ILIKE '%coding-conventions%'
  OR file_path ILIKE '%/patterns/%'
  OR file_path ILIKE 'patterns/%'
);

-- Contracts (Phase 4)
UPDATE documents SET doc_type = 'contract'
WHERE doc_type IS NULL
AND (
  file_path ILIKE '%api-schemas%'
  OR file_path ILIKE '%database-models%'
  OR file_path ILIKE '%shared-types%'
  OR file_path ILIKE '%/contracts/%'
  OR file_path ILIKE 'contracts/%'
);

-- Meta documents
UPDATE documents SET doc_type = 'meta'
WHERE doc_type IS NULL
AND (
  file_path ILIKE '%/meta/%'
  OR file_path ILIKE 'meta/%'
  OR file_path ILIKE '%validation-log%'
);

-- Templates
UPDATE documents SET doc_type = 'template'
WHERE doc_type IS NULL
AND (
  file_path ILIKE '%/templates/%'
  OR file_path ILIKE 'templates/%'
);

-- 4. Update coverage_snapshot breakdown schema comment
-- The new breakdown structure will be:
-- {
--   "architecture": {"documented": N, "expected": 3},
--   "testing_pattern": {"documented": N, "expected": 2},
--   "contract": {"documented": N, "expected": 3},
--   "meta": {"documented": N, "expected": 0}
-- }

COMMENT ON COLUMN documents.doc_type IS
'Document type for coverage calculation. Values: testing-pattern, architecture, contract, meta, template. Extracted from frontmatter type field or inferred from file_path.';

COMMIT;
