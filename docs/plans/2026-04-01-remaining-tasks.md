# Remaining Tasks — Post Autonomous Pipeline Session

**Date:** 2026-04-01
**Status:** Ready to execute in future sessions
**Context:** Pattern promotion pipeline + autonomous pipeline fully built and deployed. These are follow-up items.

---

## High Priority

### 1. Test Full `/test` Flow End-to-End in mvp_web

**What:** Open a new Claude Code session in `attorney_share_mvp_web`, run `/test {feature}`, and verify the entire autonomous loop works: daemon starts → context loads → agents run → test created → quality gates → auto-promote → skill extracted → patterns learned.

**Why:** Everything is wired but untested as a complete flow. First real run will surface any integration issues.

**How:**
```bash
cd /Users/agustinmontoya/Attorneyshare/attorney_share_mvp_web
# Start new Claude Code session — daemon auto-starts via session-start hook
# Then:
/test login
```

**Verify:**
- `[Quoth] Learning daemon active.` appears at session start
- `triqual_load_context` runs and creates `.triqual/context/login/`
- test-planner → test-generator → test-healer run autonomously
- On success: test auto-promotes from `.draft/` → `tests/` after quality gates
- `quoth_extract_skill` fires after promotion
- At session end: pattern-learner auto-dispatched

---

### 2. Set `QUOTH_API_KEY` Per Repo for Cloud Promotion

**What:** The token `qth_ec8e81eb...` was generated from the dashboard. It needs to be set in each repo so the daemon can promote patterns to Quoth cloud.

**Why:** Without it, local learning works but patterns don't sync to cloud (no cross-project sharing).

**How:** Add to each repo's environment (shell profile or `.env.local`):

```bash
# attorney_share_mvp_web
echo 'QUOTH_API_KEY=qth_ec8e81ebcbac73534dbbb53a610aae7b80fd58de3be9f715b170ed2506a0cd65' >> /Users/agustinmontoya/Attorneyshare/attorney_share_mvp_web/.env.local
echo 'QUOTH_PROJECT_ID=4091ec9b-8a25-40a3-aae2-ccce5dc2e27e' >> /Users/agustinmontoya/Attorneyshare/attorney_share_mvp_web/.env.local

# For other repos, create projects in Quoth dashboard first, then set their UUIDs
```

**Note:** The key expires Jun 30, 2026 (90 days). The daemon reads these from the environment at startup.

**IMPORTANT:** Do NOT commit `.env.local` to git. These files are gitignored.

---

## Medium Priority

### 3. Schema Migration: Clerk IDs as Primary Keys

**What:** The DB uses internal UUIDs for `organizations.id` and `users.id`, but Clerk provides string IDs (`org_xxx`, `user_xxx`). Currently we resolve Clerk → UUID on every auth request via a DB lookup. Migrating to use Clerk IDs natively would eliminate this overhead.

**Why:** Every authenticated request does an extra DB query to resolve `clerk_org_id` → `organizations.id`. At scale this adds latency. It also caused multiple bugs today (org ID mismatch, agent not found, etc.).

**Scope:** ~15 tables reference `org_id` as UUID with FK constraints. Migration requires:
1. Add `clerk_org_id` text column to all tables that reference orgs
2. Backfill from organizations table
3. Switch FKs and indexes
4. Drop old UUID columns
5. Update all Drizzle schema + queries

**Estimate:** Half-day dedicated session. Use Drizzle migration system.

**Alternative:** Keep the UUID system but cache the Clerk→UUID resolution per-request (currently uncached). This is simpler and probably sufficient.

---

### 4. Create Quoth Projects for All Repos

**What:** Currently only `mvp-web` exists as a project in Quoth. The other repos need their own projects for project-scoped pattern promotion.

**Why:** When patterns with `applicability: 'narrow'` are promoted, they're scoped to a specific project. Each repo should have its own project UUID.

**How:** Create via Quoth dashboard or API:
- `attorney_share_mvp` (backend) — slug: `mvp-backend`
- `vercel_serverless` (DirectShare) — slug: `directshare`
- `ad-pipeline` — slug: `ad-pipeline`
- `attorney_share_crons` — slug: `crons`

Then set `QUOTH_PROJECT_ID` in each repo's `.env.local`.

---

### 5. Assign `att-qa` Agent to `mvp-web` Project

**What:** The agent `att-qa` exists but has 0 project assignments. It should be assigned to `mvp-web` (and other projects as they're created).

**Why:** Agent-to-project assignment is used by the promote endpoint to scope patterns. Without it, the agent can't promote project-scoped patterns.

**How:** Use the Quoth dashboard graph view — drag from `att-qa` to `mvp-web`. This should work now that both are in the same org.

---

## Low Priority

### 6. Clean Up Old Orphaned Organization

**What:** Organization `f6add867-5cee-4cff-a4bf-4c864ace58aa` (slug: `attorneyshare`, no clerk_org_id) is empty but still in the DB.

**Why:** It was the pre-Clerk org. All data has been migrated to `a81c3c9d...`. Keeping it around risks confusion.

**How:**
```sql
-- Verify nothing references it
SELECT 'projects' as t, count(*) FROM projects WHERE org_id = 'f6add867-5cee-4cff-a4bf-4c864ace58aa'
UNION ALL SELECT 'agents', count(*) FROM agents.registry WHERE org_id = 'f6add867-5cee-4cff-a4bf-4c864ace58aa'
UNION ALL SELECT 'org_members', count(*) FROM org_members WHERE org_id = 'f6add867-5cee-4cff-a4bf-4c864ace58aa'
UNION ALL SELECT 'documents', count(*) FROM docs.documents WHERE org_id = 'f6add867-5cee-4cff-a4bf-4c864ace58aa';

-- If all zeros:
DELETE FROM organizations WHERE id = 'f6add867-5cee-4cff-a4bf-4c864ace58aa';
```

---

### 7. Replace `getSecureDb` with `getDb` Across All Routes

**What:** ~30 API routes use `getSecureDb(ctx.orgId, ctx.userId)` which sets RLS session vars. But there are NO RLS policies in the database — so `getSecureDb` is functionally identical to `getDb()` except it uses the unpooled connection (slower, no connection reuse).

**Why:** Unnecessary overhead. Every `getSecureDb` call opens an unpooled connection and runs 2 `SET LOCAL` queries that do nothing (no RLS policies to enforce).

**Options:**
- **A) Replace all `getSecureDb` with `getDb`** — Simple find-and-replace. All routes already filter by `orgId` in their WHERE clauses.
- **B) Implement actual RLS policies** — If you want row-level security, add policies and keep `getSecureDb`. But this requires careful design.

**Recommendation:** Option A unless you plan to add RLS policies. The WHERE clause filtering is already correct everywhere.

---

### 8. Triqual `knowledge.md` Initialization

**What:** The `.triqual/knowledge.md` file doesn't exist in `attorney_share_mvp_web`. The learning loop assumes it exists for writing project-specific patterns.

**Why:** The pattern-learner agent and run log LEARN stages try to read/write `knowledge.md`. Without it, learned patterns only go to run logs (not accumulated).

**How:** Run `/init` in mvp_web or create manually:
```bash
mkdir -p /Users/agustinmontoya/Attorneyshare/attorney_share_mvp_web/.triqual
cat > /Users/agustinmontoya/Attorneyshare/attorney_share_mvp_web/.triqual/knowledge.md << 'EOF'
# Project Knowledge — AttorneyShare MVP Web

## Selectors
<!-- Discovered selector patterns -->

## Waits
<!-- Discovered wait patterns -->

## Auth
<!-- Authentication patterns -->

## Gotchas
<!-- Unexpected behaviors -->

## Anti-Patterns
<!-- What NOT to do -->
EOF
```

---

## Reference: What Was Built Today

### Commits (Quoth — 40+ commits)
- Pattern promotion pipeline (daemon → cloud)
- Autonomous pipeline (Bayesian scoring, attribution, mutation testing, skills)
- Server endpoint: `POST /api/v1/patterns/promote`
- MCP tools: `quoth_propose_update`, `quoth_extract_skill`, `quoth_list_skills`, `quoth_search_patterns`
- Auth fixes: Clerk org ID → UUID resolution, webhook auto-linking
- Dashboard fixes: token expiry, null date display

### Commits (Triqual — 13 commits)
- test-healer autonomous promotion (quality gates replace human approval)
- pattern-learner autonomous Quoth promotion (no user confirmation)
- Auto-dispatch pattern-learner at session end
- Decision Attribution in subagent hooks
- Allow `.draft/` → `tests/` promotion writes
- Semantic pattern injection in agent context

### Plugins Installed
- `quoth@triqual` v2.0.0 → user scope, symlinked to local dev
- `triqual-plugin@triqual` v1.2.0 → user scope, symlinked to local dev
- Workspace `.mcp.json` at `/Attorneyshare/` for quoth-learning

### DB State
- Single org: `a81c3c9d-1547-4079-8527-c89f94b4990f` (clerk: `org_3Bgb...`)
- 2 agents: `att-qa`, `claude-code`
- 1 project: `mvp-web` (`4091ec9b...`)
- 1 API key: `qth_ec8e81eb...` (expires Jun 30, 2026)
