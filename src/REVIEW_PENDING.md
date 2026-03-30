# Deferred Review Issues

Issues identified during code review that were intentionally deferred. Track these for future sprints.

## L-02: search.logs missing FK constraints

**File:** `src/db/schema.ts` (searchLogs table), `src/db/migrations/001_multi_schema.sql`
**What:** The `user_id` and `agent_id` columns in `search.logs` lack foreign key constraints to `users` and `agents.registry`.
**Why deferred:** Intentional for analytics performance. FKs on high-write logging tables add overhead and complicate bulk inserts. The columns are used for grouping/filtering only.

## L-03: coverage_snapshots index missing created_at DESC

**File:** `src/db/schema.ts` (coverageSnapshots table)
**What:** The `idx_coverage_project` index is on `(project_id)` but queries typically order by `created_at DESC`. The SQL migration already has `(project_id, created_at DESC)` but the Drizzle schema lacks the second column.
**Why deferred:** The SQL migration already has the correct index. Drizzle schema indexes are declarative hints; the actual index is managed by migrations.

## L-04: agent-keys fire-and-forget swallows errors

**File:** `src/lib/auth/agent-keys.ts` (verifyAgentApiKey, `last_used_at` update)
**What:** The fire-and-forget `void db.update(...)` for `last_used_at` swallows all errors silently.
**Why deferred:** This is intentional -- `last_used_at` is a non-critical analytics field. Failing to update it should never block authentication. A future improvement could add lightweight error logging.

## L-06: tracker model cost table will become stale

**File:** `src/lib/generations/tracker.ts` (MODEL_COSTS)
**What:** The hardcoded `MODEL_COSTS` map will become stale as providers change pricing or new models are added.
**Why deferred:** Moving costs to DB or config adds complexity. Current approach works for the initial model set. Plan to externalize to a config file or DB table when model count exceeds ~20.

## M-01: Index name divergences between schema.ts and migration

**File:** `src/db/schema.ts`, `src/db/migrations/001_multi_schema.sql`
**What:** Some index names in Drizzle schema don't match the SQL migration (e.g., Drizzle auto-generates names that differ from explicit migration names).
**Why deferred:** Drizzle schema index names are used only for push/generate commands. Actual production indexes are managed by the SQL migration. No runtime impact.

## M-03: search_memory() returns subset of columns used by rowToEntry()

**File:** `src/lib/memory/service.ts` (rowToEntry), `src/db/migrations/003_memory_fixes.sql` (search_memory)
**What:** `search_memory()` returns 14 columns but `rowToEntry()` maps 17 fields (also `last_accessed_at`, `decay_rate`, `expires_at`, `embedding_model`, `project_id`). When called from `searchMemory()`, those 5 fields fall back to defaults (current date, 0.05, null, "text-embedding-3-small", null) which are reasonable but not the actual stored values.
**Why deferred:** The defaults in `rowToEntry()` are safe fallbacks and match the DB column defaults. Adding these 5 columns to `search_memory()` RETURNS TABLE would fix it but the function signature would need another DROP+RECREATE migration. Low priority since search results primarily need similarity, key, value, and tags.

## M-04: EMBEDDING_DIMS constant exported but unused

**File:** `src/lib/embeddings/gateway.ts`
**What:** `EMBEDDING_DIMS` is exported but not imported by any other module.
**Why deferred:** It is now used internally for zero-vector generation in the batch function (M-03 fix). External consumers may need it in the future for validation.
