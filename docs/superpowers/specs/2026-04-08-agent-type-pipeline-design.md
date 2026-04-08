# Agent-Type Pipeline Overhaul — Design Spec

**Date:** 2026-04-08
**Version:** Quoth v3.3.0 → v3.4.0
**Scope:** Batch JUDGE activation, agent-type tagging, filtered injection, cost tracking, type unification

## Problem

Patterns have no agent-type awareness. A "coder" subagent might receive a "reviewer" pattern because injection is pure semantic search with no domain filtering. The JUDGE pipeline stage exists but is disabled (was too expensive per-entry). Three disconnected type systems cause confusion.

## Solution

1. **Batch JUDGE**: Accumulate tool_use entries → judge every 30 as a single LLM call → only effective entries reach DISTILL
2. **Agent-type tags**: JUDGE returns `domain` per entry (8 routing types) → daemon appends `agent:<type>` tag at pattern insert
3. **Filtered injection**: subagent-start and route pass `tags: ["agent:<type>"]` to query server → db filters by tag
4. **Cost tracking**: New `pipeline_costs` SQLite table, `llm.js` records tokens+cost per call
5. **Type unification**: routing.js 8 types = canonical enum; delete dead agent YAMLs

## Architecture

### Pipeline Flow (Before vs After)

**Before:**
```
tool_use entries → mark processed immediately → session_summary → distill-batch → consolidate → insert
```

**After:**
```
tool_use entries → accumulate in pendingJudge[]
  → 30 entries OR session-end → batch-judge (1 LLM call, gemini-2.5-flash)
    → effective entries → judgedEffective[] buffer
    → ineffective → mark processed
  → session_summary → distill-batch (gemini-2.5-flash-lite, only judged-effective entries)
    → consolidate → insert with agent:<type> tags
```

### Model Strategy

| Stage | Model | Cost | Rationale |
|-------|-------|------|-----------|
| Batch JUDGE | `google/gemini-2.5-flash` | $0.30/$2.50 per MTok | Quality-critical evaluation |
| DISTILL | `google/gemini-2.5-flash-lite` | $0.10/$0.40 per MTok | Bulk pattern extraction |
| CONSOLIDATE | `claude-haiku-4-5` (via CLI) | N/A (CLI) | Existing, unchanged |

### Canonical Agent Types (8)

```
coder, tester, reviewer, researcher, architect, backend-dev, frontend-dev, devops
```

Source of truth: `routing.js:AGENT_CAPABILITIES`. Used by JUDGE prompt, pattern tags, injection filters.

### Tag Format

```json
["agent:coder", "project:quoth", "batch-distilled", "debugging", "testing"]
//  ^ from JUDGE   ^ existing      ^ existing          ^ LLM-generated
```

### Injection Filtering

- `subagent-start`: passes `["agent:<agentType>"]` to queryDaemon
- `route` (UserPromptSubmit): passes `["agent:<routedAgent>"]` after routing decision
- `session-restore`: no filter (session hasn't started, domain unknown)
- **Fallback**: if <2 results with tag filter → retry without tags

### Cost Tracking Schema

```sql
CREATE TABLE IF NOT EXISTS pipeline_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd REAL,
  batch_size INTEGER,
  session_id TEXT,
  project TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
```

### Files Changed

| File | Change |
|------|--------|
| `daemon/pipeline/batch-judge.js` | **NEW** — batch JUDGE with domain classification |
| `daemon/lib/llm.js` | Add `callLLMWithUsage()`, `recordCost()`, cost tracking |
| `daemon/daemon.js` | Add pendingJudge queue, wire batch-judge before distill |
| `daemon/db.js` | Add `pipeline_costs` table, `recordPipelineCost()`, `getCostSummary()` |
| `daemon/lib/query-server.js` | Accept `tags` param, pass to injection |
| `hooks/hook-dispatch.js` | subagent-start + route: pass tags to queryDaemon |
| `mcp/lib/routing.js` | Add canonical type enum export + JSDoc |
| `agents/*.yaml` | **DELETE** (5 files) |
| `tests/batch-judge.test.js` | **NEW** — batch judge tests |
| `tests/cost-tracking.test.js` | **NEW** — cost recording tests |
| `tests/injection-tags.test.js` | **NEW** — tag filtering tests |
