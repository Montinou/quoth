# Curator (Quoth) — Dogfooding & Fleet Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate Quoth v3.0 across the agent fleet, verify MCP tools work reliably, tune search relevance, and set up cross-instance sync between Montino Curator and AWS Mneme.

**Architecture:** Next.js 16 MCP server with Supabase (pgvector) backend. Dual Jina embeddings (text + code, 512d). Cohere reranking. JWT auth. Hook system for documentation enforcement. 15 core MCP tools + 6 agent tools. Deployed at quoth.triqual.dev.

**Tech Stack:** Next.js 16, Supabase (Postgres + pgvector), Jina Embeddings v3, Cohere Rerank, JWT (jose), Resend, Upstash Redis, MCP SDK, Vitest

---

## Current State

- ✅ MCP server deployed (quoth.triqual.dev)
- ✅ 15 core tools + 6 agent tools
- ✅ Dual embeddings (Jina text v3 + Jina code 1.5b)
- ✅ Cohere reranking
- ✅ JWT auth + multi-account support
- ✅ Hook system (gates, logging, knowledge promotion)
- ✅ Genesis v3.0 (document bootstrap)
- ✅ 38+ Supabase migrations
- ✅ Repo clean (no uncommitted changes)
- ⚠️ Behind origin/main by 1 commit (pull needed)
- ⚠️ Not actively used by most fleet agents
- ⚠️ No cross-instance sync (Montino ↔ AWS)

---

## Phase 1: Sync & Verify

### Task 1: Pull latest and verify build

- [ ] **Step 1: Pull latest**

```bash
cd /home/lord_montino/.openclaw/workspaces/curator/repo
git pull origin main
```

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

- [ ] **Step 3: Run tests**

```bash
npm run test:run
```

- [ ] **Step 4: Build**

```bash
npm run build
```

- [ ] **Step 5: Verify MCP server responds**

```bash
curl https://quoth.triqual.dev/api/health
# Expected: 200 OK with system metrics
```

---

### Task 2: Verify MCP tools work

- [ ] **Step 1: Test search**

```bash
# Using MCP client or curl
curl -X POST https://quoth.triqual.dev/api/mcp/public \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"quoth_search_index","arguments":{"query":"authentication","scope":"project"}}}'
```

- [ ] **Step 2: Test document read**

```bash
curl -X POST https://quoth.triqual.dev/api/mcp/public \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"quoth_read_doc","arguments":{"title":"architecture"}}}'
```

- [ ] **Step 3: Test genesis (on a test project)**

Create a test project, run genesis with depth "minimal" (3 docs).

- [ ] **Step 4: Test propose_update**

Propose a small doc update, verify it appears in proposals.

- [ ] **Step 5: Verify RAG pipeline**

```bash
npm run verify:rag
# Expected: Search returns relevant results, reranking improves order
```

---

## Phase 2: Fleet Onboarding

### Task 3: Configure Quoth for priority agents

Each agent workspace needs a `.mcp.json` entry for Quoth and optionally the quoth-plugin hooks.

- [ ] **Step 1: Create Quoth projects for key agents**

Create projects in Quoth for: echo, jardin, omnichannel, interviews, ads, portfolio.

- [ ] **Step 2: Generate API keys for each project**

Via Quoth dashboard or API:

```bash
# For each project
curl -X POST https://quoth.triqual.dev/api/mcp-token \
  -H "Authorization: Bearer $CURATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<project-id>","name":"agent-key"}'
```

- [ ] **Step 3: Add Quoth MCP to agent workspaces**

For each agent workspace, add to `.mcp.json` or config:

```json
{
  "mcpServers": {
    "quoth": {
      "url": "https://quoth.triqual.dev/api/mcp",
      "headers": {
        "Authorization": "Bearer <project-api-key>"
      }
    }
  }
}
```

- [ ] **Step 4: Test from one agent**

Pick Echo as first test — verify quoth_search_index returns relevant results from Echo's project docs.

- [ ] **Step 5: Document setup per agent**

---

### Task 4: Run genesis for each project

- [ ] **Step 1: For each priority agent, run genesis**

Genesis bootstraps initial documentation. Use "minimal" depth (3 docs: overview, patterns, contracts).

- [ ] **Step 2: Verify generated docs are relevant**

Read each generated doc, check it captures the project's key architecture.

- [ ] **Step 3: Manually add critical knowledge**

For each project, add 2-3 critical knowledge documents that genesis wouldn't generate (e.g., deployment gotchas, API quirks).

---

## Phase 3: Search Tuning

### Task 5: Test and tune search relevance

- [ ] **Step 1: Create test query set**

```
- "how does auth work" → should find Clerk middleware docs
- "database schema" → should find Drizzle/schema docs
- "deploy to vercel" → should find deployment docs
- "webhook handler" → should find API route docs
```

- [ ] **Step 2: Run queries, evaluate results**

For each query, check:
- Top 3 results relevant? (precision)
- Expected doc in top 5? (recall)
- Code queries use code embeddings?

- [ ] **Step 3: Adjust if needed**

If relevance is poor:
- Check chunk sizes (too large = noisy, too small = no context)
- Verify Cohere reranking is active (tier check)
- Test with/without code-specific embeddings

- [ ] **Step 4: Run reindex if chunks need regeneration**

```bash
npm run reindex
```

---

## Phase 4: Cross-Instance Sync

### Task 6: Plan Montino ↔ AWS sync

**Not full implementation — just planning and basic setup.**

- [ ] **Step 1: Identify what needs syncing**

- Shared knowledge docs (fleet-wide patterns, decisions)
- Agent registry (which agents exist on which node)
- NOT project-specific docs (those stay local)

- [ ] **Step 2: Design sync approach**

Options:
a) **Supabase Realtime**: Both instances connect to same Supabase project
b) **Periodic export/import**: Cron job exports shared docs → pushes to other instance
c) **Git-based**: Shared knowledge in a git repo, both instances pull

Recommendation: Option (a) — both already use same Supabase. Shared docs use `scope: 'org'` which is already cross-project.

- [ ] **Step 3: Verify org-level search works**

```bash
# Test org scope search
curl -X POST https://quoth.triqual.dev/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"method":"tools/call","params":{"name":"quoth_search_index","arguments":{"query":"fleet architecture","scope":"org"}}}'
```

- [ ] **Step 4: Document sync strategy**

Write a doc in Quoth itself about the chosen sync approach.

---

## Phase 5: Monitoring

### Task 7: Set up usage tracking

- [ ] **Step 1: Check activity logging**

Verify `document_activity` or similar table is populated after tool calls.

- [ ] **Step 2: Create usage report query**

```sql
SELECT
  date_trunc('day', created_at) as day,
  tool_name,
  COUNT(*) as calls,
  COUNT(DISTINCT user_id) as unique_users
FROM activity_log
GROUP BY day, tool_name
ORDER BY day DESC
LIMIT 30;
```

- [ ] **Step 3: Set up weekly summary**

Create a Lobster workflow or cron that runs the query weekly and sends results to Telegram.

---

## Execution Order

1. **Task 1** (Sync + build) — ensure everything works
2. **Task 2** (Verify tools) — test MCP endpoints
3. **Task 3-4** (Fleet onboarding) — configure agents
4. **Task 5** (Search tuning) — improve relevance
5. **Task 6** (Cross-instance) — plan + basic setup
6. **Task 7** (Monitoring) — usage tracking
