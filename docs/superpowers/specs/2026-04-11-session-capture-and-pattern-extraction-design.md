# Session Capture & Pattern Extraction Redesign

**Date**: 2026-04-11
**Status**: Design (pending review)
**Author**: Claude (via brainstorming with Agustin)
**Supersedes**: `2026-04-10-extract-v2-tool-calling.md`, `2026-04-10-session-isolation.md`, `2026-04-10-unified-injection-design.md` (partially), `2026-04-08-agent-type-pipeline-design.md`

## Problem

The v3.5 capture pipeline only fires `trajectory-capture.js` for tools matching `Bash|Write|Edit|MultiEdit|Agent`. Sessions dominated by `Read`, `Grep`, `Glob`, `TodoWrite`, `Task`, and `Skill` calls are silently dropped — including high-value planning sessions. Even when capture fires, the extract pipeline produces only two entity kinds (`pattern`, `fact`), so the system can't represent the kinds of knowledge that most directly drive agent self-improvement: **decisions** (judgment calls the agent already made and learned from) and **anti-patterns** (dead ends that should not be repeated).

The injection layer compounds the limitation: `session-restore` injects up to 7 patterns plus 5 facts/namespace at session start, when the system has no idea what the user is about to ask. Per-prompt injection in the `route` hook is timing-fragile (`Daemon failed to start within 5s` warnings on every prompt) and only surfaces patterns ≥ 0.1 confidence.

CLAUDE.md is also stale: it describes a three-stage Gemini Flash pipeline (JUDGE → DISTILL → CONSOLIDATE) that no longer matches the code. The actual extract pipeline is a single Kimi K2.5 multi-turn tool-calling call in `daemon/pipeline/extract.js`.

## Goals

1. **Capture every tool call** (matcher-less PostToolUse) without blowing up file size or hook latency.
2. **Extract four entity kinds** — `pattern`, `decision`, `anti_pattern`, `fact` — into a polymorphic store with proper embeddings and semantic search.
3. **Inject relevant knowledge per prompt**, not per session, so context budget is spent on what the user is actually asking *right now*.
4. **Process multiple sessions concurrently** with explicit stage-level concurrency control and a serialized persist boundary.
5. **Surface every failure to the database** even when we don't surface it to the user (loud DB, quiet stderr).
6. **Strip every stale code path, env var, doc claim, and MCP tool** that doesn't match the new design. No coexistence.
7. **Stay within a daily LLM budget** so cost is bounded even at heavy session volume.
8. **Maintain strict per-project isolation** via a `scope` column threaded through capture, extract, persist, and inject.

## Non-Goals

- Migrating existing patterns/facts. **Greenfield reset** — drop the SQLite DB and HNSW index, start fresh.
- Skill extraction. The Quoth skills subsystem is removed entirely; future integration with the standalone `skill-registry` repo is described in §11 but not implemented here.
- Rewriting the agent coordination subsystem (`quoth_agent_register/heartbeat/list/assign_task`). It stays as-is.
- Cross-organization pattern sharing or cloud marketplace features.
- Event sourcing or audit-trail history. Considered and rejected as YAGNI.

## Design Decisions Locked During Brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Full loop: capture + extract + injection | Capture/extract changes don't show user-visible improvement unless injection actually surfaces the new signal |
| Data model | Patterns + facts + **decisions** + **anti-patterns** (4 kinds) | Decisions capture forward-looking judgment, anti-patterns capture failed approaches; together they directly address "agent stops repeating mistakes" and "agent makes the right call faster" |
| Storage cap | **None** | "If there are millions of relevant patterns, store them all" |
| Cost ceiling | Two-tier: cheap triage → conditional deep extract | Most sessions are routine; triage gate avoids paying Kimi tokens on sessions with no learning value |
| Extract model | **Always Kimi K2.5** | Model alone isn't the only factor — prompts, tools, parsing also affect quality and are tunable. Sonnet fallback only on Kimi failure. |
| Injection strategy | Hybrid: facts at session-start, patterns/decisions/anti-patterns at UserPromptSubmit time | Facts are project-stable and useful from line one; everything else is prompt-specific and should be retrieved at the moment a related prompt arrives |
| Concurrency | Worker pool + stage semaphores | Different pipeline stages have different parallelism characteristics |
| Schema shape | One polymorphic `knowledge_entities` table | Avoids smearing two abstractions into one table while keeping a single HNSW index |
| Plugin/SaaS rollout | Plugin first, SaaS follow-up using same spec | Gets visible improvement in the dev loop fastest; SaaS migration is the harder, riskier change |
| Cleanup | Remove or archive every stale code path, doc, env var, MCP tool | Force-fail CI if stale terms (`JUDGE`, `DISTILL`, `bandit-v2`, `voyage-4-lite`, etc.) appear outside `_archive/` |

## 1. Architecture Overview

The system is split into **three subsystems** that communicate through filesystem handoff and SQLite, never via in-memory function calls. Each subsystem can be restarted independently without losing data.

```
┌──────────────────────────────────────────────────────────────────┐
│  CAPTURE  (in-process, runs inside Claude Code's hook context)   │
│                                                                   │
│  PostToolUse hook (matcher-less)                                  │
│       │                                                           │
│       ▼                                                           │
│  trajectory-capture.js                                            │
│   • dedup vs previous entry                                       │
│   • sanitize secrets                                              │
│   • append to active/<sid>.jsonl                                  │
│   • update active/<sid>.meta.json                                 │
│                                                                   │
│  SessionEnd / PreCompact hook                                     │
│       │                                                           │
│       ▼                                                           │
│  hook-dispatch.js session-end                                     │
│   • atomic rename: active/<sid>.* → processing/<sid>.*            │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │ filesystem handoff (POSIX atomic rename)
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  EXTRACT  (background daemon, multi-worker)                       │
│                                                                   │
│  fs.watch(processing/) → claim queue                              │
│       │                                                           │
│       ▼                                                           │
│  Worker pool (QUOTH_CONCURRENCY=4)                                │
│       │                                                           │
│       ▼                                                           │
│  pipeline/triage.js     → Gemini 2.5 Flash Lite                   │
│       │   {productive, urgency, suspected_kinds}                  │
│       ▼                                                           │
│  pipeline/extract.js    → Kimi K2.5 multi-turn tool calling       │
│       │                   (urgency tunes prompt depth, not model) │
│       │   {patterns, decisions, anti_patterns, facts}             │
│       ▼                                                           │
│  pipeline/embed.js      → MiniLM-L6-v2 local, batched             │
│       │   384d Float32 per entity                                 │
│       ▼                                                           │
│  pipeline/persist.js    → single tx into knowledge_entities       │
│       │                   single HNSW index update                │
│       ▼                                                           │
│  archive: processing/<sid>.* → done|routine|empty|error/          │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │ SQLite + HNSW (read path)
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  INJECT  (in-process, queries daemon over Unix socket)            │
│                                                                   │
│  SessionStart hook                                                │
│       │                                                           │
│       ▼                                                           │
│  hook-dispatch.js session-restore                                 │
│   • inject top 5 facts (project + global namespaces)              │
│   • NO patterns/decisions/anti-patterns at session-start          │
│                                                                   │
│  UserPromptSubmit hook                                            │
│       │                                                           │
│       ▼                                                           │
│  hook-dispatch.js route                                           │
│   • POST /inject {prompt, project, kinds, limit}                  │
│   • daemon embeds prompt, HNSW search, scope-filter, re-rank      │
│   • inject top-K as additionalContext                             │
│                                                                   │
│  SubagentStart hook                                               │
│       │                                                           │
│       ▼                                                           │
│  hook-dispatch.js subagent-start                                  │
│   • POST /inject with agentType filter                            │
└──────────────────────────────────────────────────────────────────┘
```

### Three guarantees

1. **Capture never blocks Claude Code.** The hook does fs append + sidecar update only — no LLM, no network, no daemon spawn. Worst case <5ms per tool call.
2. **Extract never loses a session.** The atomic rename `active → processing` is the daemon's claim; once renamed, the daemon owns the file until it lands in a terminal bucket. A daemon crash mid-extract leaves the file in `processing/` to be retried on restart.
3. **Inject never blocks longer than 200 ms.** The route hook calls the daemon over a Unix socket; if the daemon is cold or down, the hook returns immediately with no injection rather than waiting 5 s. The "Daemon failed to start within 5s" warning gets fixed by removing the wait, not by speeding up startup.

## 2. Components

### 2.1 Capture layer

**`hooks/trajectory-capture.js`** (rewrite, ~200 LOC)

- PostToolUse matcher becomes `*` (matcher-less). Every tool fires this hook.
- New in-hook **dedup**: keep last entry's `{tool, JSON.stringify(tool_input)}` hash in a per-session `.dedup` sidecar file. If the new entry hashes to the same value as the previous, skip the append. Catches the TodoWrite / Read-same-file storms.
- Per-session entry cap: removed (per "no caps" decision). Dedup is enough to keep file size sane.
- Sanitization, sidecar update, atomic write semantics: unchanged from current implementation.
- **Constraint**: hook must exit in <5 ms even when matcher-less, because it now fires 5–10× more often.

**`hooks/hook-dispatch.js session-end`** (small change, ~30 LOC delta)

- Same atomic rename `active/<sid>.* → processing/<sid>.*`
- Also moves `<sid>.dedup` if it exists (so daemon can see it for diagnostics)

### 2.2 Extract layer (concurrent daemon)

This is where "process multiple sessions at the same time" lives. The design uses a **worker pool with stage-level concurrency control** so different stages can have different parallelism without blocking each other.

**`daemon/daemon.js`** (rewrites the main loop)

```
                    processing/  (filesystem queue)
                         │
                         ▼
                  ┌─────────────┐
                  │ FileWatcher │  fs.watch + 500ms debounce
                  └──────┬──────┘
                         │
                         ▼
                  ┌─────────────┐
                  │   Claimer   │  rename processing/<sid>.jsonl
                  │             │  → processing/<sid>.<pid>.<wid>.jsonl
                  └──────┬──────┘  (atomic claim — prevents double-pickup)
                         │
                         ▼
        ┌────────────────────────────────────┐
        │       Worker Pool (configurable)    │
        │                                     │
        │   QUOTH_CONCURRENCY=4 (default)     │
        │   each worker = independent async   │
        │   loop, pulls from claim queue      │
        └────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────┐
        │         Stage Semaphores            │
        │                                     │
        │   triage:  max 8 concurrent         │
        │   extract: max 3 concurrent         │
        │   embed:   max 2 concurrent         │
        │   persist: max 1 (serialized)       │
        └────────────────────────────────────┘
```

**Concurrency contract:**

- **Workers** are async functions (no threads). Up to `QUOTH_CONCURRENCY` (default 4) sessions in flight at once.
- **Stage semaphores** cap concurrent calls per stage independent of worker count. A worker that finishes triage on session A can immediately start triage on session B even if session A is stuck waiting for the extract semaphore.
- **PERSIST is serialized** (semaphore=1) because the pure-JS HNSW index isn't concurrency-safe and SQLite write contention thrashes disk under load. Persist is cheap (~10 ms per session), so serialization doesn't bottleneck.
- **Claim-by-rename** prevents two workers from grabbing the same file: each worker tries `fs.renameSync('processing/<sid>.jsonl', 'processing/<sid>.<pid>.<wid>.jsonl')`, POSIX-atomic, fails fast on race.

**`daemon/pipeline/triage.js`** (new, ~150 LOC)

- One LLM call per session, **Gemini 2.5 Flash Lite** via Vercel AI Gateway
- Prompt summarizes session: project, first 5 + last 5 tool calls, user_intent fields, outcome rate
- Returns `{productive: bool, urgency: 'low'|'medium'|'high', suspected_kinds: ['pattern','decision','fact','anti_pattern']}`
- Cost ~$0.0005/session
- Routine sessions short-circuit: archived to `routine/` with no further LLM call

**`daemon/pipeline/extract.js`** (rewrite, ~400 LOC)

- **Always Kimi K2.5** via Moonshot multi-turn tool calling — model is constant; what varies is prompt depth and tool budget based on `urgency`:
  - `low` → tool budget 2, single follow-up turn allowed, simpler prompt
  - `medium` → tool budget 5, full multi-turn loop
  - `high` → tool budget 8, additional "explain your reasoning" prompt section
- Prompt asks **only** for the entity types in `suspected_kinds`. Avoids paying for empty fields.
- Same dependency-injection pattern as current code so all extractors are testable in isolation.
- Sonnet 4.6 (`claude -p --effort low --model claude-sonnet-4-6`) is the **fallback only**, called when Kimi raises an error after retries. Never used as the primary path.
- Cost typical ~$0.005–$0.025/session depending on urgency

**`daemon/pipeline/embed.js`** (small refactor)

- Already exists as `daemon/lib/embed.js`. Extended to embed all four entity kinds in a single batched MiniLM call (one MiniLM run per session, not per kind).
- Output: 384d Float32Array per entity, written into `knowledge_entities.embedding` as a BLOB.

**`daemon/pipeline/persist.js`** (new, ~200 LOC)

- One SQLite transaction per session: insert entities into `knowledge_entities`, update HNSW index, write `pipeline_costs` row.
- Single global lock (the persist semaphore in the daemon).
- Failure mode: if persist throws, the file gets rolled back to `processing/<sid>.jsonl` (un-claimed) and re-queued.

**`daemon/lib/llm-budget.js`** (new, ~100 LOC)

- Tracks `daily_spend_usd` in SQLite (`llm_budget` table, one row per UTC date)
- Hard ceiling enforced **inside** the stage semaphores: if a triage call would push spend over `QUOTH_DAILY_LLM_BUDGET_USD` (default $1.00), the file gets re-queued and the daemon logs `budget_exhausted`. Budget resets at UTC midnight.
- The "no caps on stored entities" decision stays true; the cap is on **LLM spend**, not stored output.

### 2.3 Inject layer

**`daemon/lib/query-server.js`** (extends existing query server)

New endpoint: `GET /inject?prompt=<text>&kinds=<csv>&limit=<n>&project=<name>&agentType=<type>`

- Embeds `prompt` via local MiniLM (cached: same prompt → same embedding for 60 s)
- HNSW search filtered by `kind IN (...)` and `(scope='global' OR scope='project:<name>')`
  - Pure-JS HNSW doesn't support filtered search natively, so we **over-fetch K×3** and filter in JS afterward
- Re-ranks results by `recency_decay × confidence × cosine_similarity × kind_weight`
- `kind_weight` defaults: `anti_pattern=1.5`, `decision=1.3`, `pattern=1.0`, `fact=0.8`. Tunable via `QUOTH_KIND_WEIGHT_*` env vars.
- Returns top-K JSON with `{kind, content, score, source_session_id}` per item

**Existing endpoints kept**: `GET /sessions/:sid/status`, `GET /facts/:ns?limit=N`, `DELETE /facts/:ns/:topic`. New `GET /health` endpoint added (see §5.5).

**`hooks/hook-dispatch.js route`** (rewrite, ~80 LOC delta)

- Removes the eager daemon spawn-and-wait. New flow:
  1. Try to connect to daemon socket with **200 ms timeout** (`QUOTH_DAEMON_SOCKET_TIMEOUT_MS`)
  2. If timeout/refused: return immediately, no injection. Spawn daemon detached so the *next* prompt has a warm daemon.
  3. If connected: query `/inject` with the prompt text. Daemon responds with top-K. Inject as `additionalContext`.
- The "Daemon failed to start within 5s" warning never appears because we never wait that long.

**`hooks/hook-dispatch.js session-restore`** (small change)

- Removes the pattern injection block (those move to `route`)
- Keeps facts injection (top 5 per namespace)
- Keeps intelligence-graph init and project-context.md injection
- Net effect: faster session start, more relevant per-prompt context

**`hooks/hook-dispatch.js subagent-start`** (small change)

- Calls `/inject` with `agentType` filter (mapped from the spawned subagent type)
- Returns `additionalContext` for the spawned subagent (current behavior, just routed through the new endpoint)

### 2.4 New MCP tools

- `quoth_recall_decisions(situation, limit?)` — returns past decisions matching situation via semantic search
- `quoth_recall_anti_patterns(situation, limit?)` — returns past anti-patterns
- `quoth_log_decision(situation, options, choice, reasoning)` — explicit agent-driven decision log
- `quoth_log_anti_pattern(condition, what_not_to_do, why_failed)` — explicit agent-driven anti-pattern log
- `quoth_health()` — daemon state, error counts, budget, stuck files (see §5.5)
- `quoth_replay_session(session_id)` — reads a JSONL from `error/` and re-runs the pipeline against it without writing to the DB; returns a diff

## 3. Data Model & Schema

### 3.1 The polymorphic core: `knowledge_entities`

One table holds patterns, decisions, anti-patterns, and facts. Same shape on SQLite (local plugin) and Postgres + pgvector (SaaS) — only the embedding column type differs.

```sql
CREATE TABLE knowledge_entities (
  id                TEXT PRIMARY KEY,             -- sha1(kind + content)[:12]
  kind              TEXT NOT NULL,                -- 'pattern'|'decision'|'anti_pattern'|'fact'
  scope             TEXT NOT NULL,                -- 'global' | 'project:<name>'
  summary           TEXT NOT NULL,                -- ≤120 chars, for display & ranking
  content           TEXT NOT NULL,                -- canonical text (what gets embedded)
  metadata          TEXT NOT NULL,                -- JSON, kind-specific shape (see 3.2)
  embedding         BLOB,                         -- 384d MiniLM (Float32Array as BLOB)
  tags              TEXT NOT NULL DEFAULT '[]',   -- JSON array, max 5
  confidence        REAL NOT NULL DEFAULT 0.5,    -- alpha/(alpha+beta)
  alpha             REAL NOT NULL DEFAULT 1.0,    -- Bayesian success count
  beta              REAL NOT NULL DEFAULT 1.0,    -- Bayesian failure count
  polarity          TEXT NOT NULL DEFAULT 'positive', -- 'positive'|'negative' (anti_pattern uses 'negative')
  status            TEXT NOT NULL DEFAULT 'active',   -- 'active'|'archived'|'merged'
  source            TEXT NOT NULL,                -- 'extracted'|'agent_logged'|'seeded'
  source_session_id TEXT,                         -- traceability to the originating session
  created_at        INTEGER NOT NULL,             -- ms epoch
  updated_at        INTEGER NOT NULL,
  last_exposed_at   INTEGER,                      -- last time injected into a hook context
  exposure_count    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_ke_kind          ON knowledge_entities(kind);
CREATE INDEX idx_ke_scope         ON knowledge_entities(scope);
CREATE INDEX idx_ke_kind_scope    ON knowledge_entities(kind, scope, status);
CREATE INDEX idx_ke_session       ON knowledge_entities(source_session_id);
CREATE INDEX idx_ke_created       ON knowledge_entities(created_at DESC);
CREATE INDEX idx_ke_confidence    ON knowledge_entities(kind, confidence DESC) WHERE status='active';
```

### 3.2 Per-kind metadata shapes

```jsonc
// kind='pattern'
{
  "condition": "When refactoring across multiple files in a monorepo",
  "action":    "Read all target files in parallel before batch-editing...",
  "quality_signal": "domain"
}

// kind='decision'
{
  "situation":          "User asked for streaming uploads on a 5GB file pipeline",
  "options_considered": ["chunked upload + resume", "single multipart", "pre-signed S3 URLs"],
  "choice":             "pre-signed S3 URLs",
  "reasoning":          "Avoids serverless function memory limits and gives the client direct retry semantics",
  "outcome":            "shipped, no incidents in 2 weeks"
}

// kind='anti_pattern'
{
  "condition":      "When mocking external APIs in integration tests",
  "what_not_to_do": "Mock the database client itself with vi.mock()",
  "why_failed":     "Migration logic uses SQL features the mock doesn't model — tests passed but prod migration broke"
}

// kind='fact'
{
  "topic":     "build command",
  "statement": "Plugin builds with `pnpm -C quoth-plugin test`",
  "evidence":  "package.json scripts"
}
```

### 3.3 Embedding & semantic search

**Mandatory throughout**: every entity gets a 384d MiniLM-L6-v2 embedding at extract time (batched per session). Every `/inject` query embeds the prompt and runs cosine HNSW search before re-ranking.

**Local (plugin)**:
- Single HNSW index across all kinds (`M=16`, `efConstruction=200`, `efSearch=50`, cosine, 384d)
- Persisted at `~/.quoth/hnsw.bin` every 30 min and on SIGTERM
- Filter happens *after* HNSW search (over-fetch `limit × 3` then filter by kind/scope)
- Search latency target: <50 ms for 1M-row index

**Cloud (SaaS)**:
- Postgres column `embedding vector(384)` with `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`
- Filter pushes down into the SQL `WHERE` clause natively
- Same MiniLM embeddings written by the SaaS pipeline endpoint

### 3.4 Supporting tables

```sql
-- Already exist, kept as-is:
CREATE TABLE sessions (...);            -- session_id, epoch, status, project, ...
CREATE TABLE pipeline_costs (...);      -- per-stage cost tracking
CREATE TABLE pipeline_errors (...);     -- error log (see §5)

-- New:
CREATE TABLE llm_budget (
  date          TEXT PRIMARY KEY,        -- 'YYYY-MM-DD' UTC
  spend_usd     REAL NOT NULL DEFAULT 0,
  triage_calls  INTEGER NOT NULL DEFAULT 0,
  extract_calls INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);
```

### 3.5 Tables & files dropped (greenfield reset)

```
patterns                                 -- replaced by knowledge_entities (kind='pattern')
memory_entries                           -- replaced by knowledge_entities (kind='fact')
judge_queue                              -- pairwise judge subsystem retired
agent_registry                           -- only used by agent coordination, leave for now (out of scope)
trajectories / trajectory_steps          -- in-memory schema, never persisted, no-op
skills                                   -- skills subsystem removed (see §11)
```

Filesystem state to delete on first run of the new daemon:
- `~/.quoth/memory.db` (recreated empty)
- `~/.quoth/hnsw.bin`
- `~/.quoth/intelligence/*.json` (graph cache, prompt history)
- `~/.quoth/trajectories/processing-deferred/` (5684 quarantined files)

### 3.6 Project Isolation

Every entity gets one of two scope values:
- `'global'` — true across all projects
- `'project:<name>'` — true only in one project

The `<name>` comes from `resolveProjectName()` (existing function), which resolves to the git remote origin repo name, lowercased.

**Flow:**

1. **CAPTURE** — `trajectory-capture.js` writes `project: "<name>"` into every JSONL entry and the sidecar.
2. **TRIAGE** — reads project from sidecar, passes into the triage prompt.
3. **EXTRACT** — LLM is told the project name and instructed to set scope as `'global'` or `'project'`.
4. **PERSIST** — `persist.js` rewrites the LLM's `'project'` string to `'project:<name>'` using the **session's** project from the sidecar, never trusting the LLM's project field.
5. **INJECT** — route hook resolves current project via `resolveProjectName(CLAUDE_PROJECT_DIR)`, calls `daemon /inject?project=<name>`, daemon filters with `WHERE scope='global' OR scope='project:<name>'`.

**Concrete query:**
```sql
SELECT id, kind, summary, content, metadata, confidence
FROM knowledge_entities
WHERE status = 'active'
  AND kind IN ('pattern', 'decision', 'anti_pattern')
  AND (scope = 'global' OR scope = 'project:skill-registry')
  AND id IN (<top K from HNSW search>)
ORDER BY (cosine_score * confidence * recency_decay(updated_at) * kind_weight(kind)) DESC
LIMIT 15;
```

**Edge cases:**

| Edge case | Handling |
|---|---|
| Two projects with same git repo name (forks) | Collision; both write to `project:<name>`. Out of scope to fix here. |
| Workspace session with no git remote | Falls back to directory basename via existing `resolveProjectName`. |
| LLM hallucinates a project name in metadata | `persist.js` always uses the sidecar's project, never the LLM's. |
| Subagent inherits parent project | Subagents inherit `CLAUDE_PROJECT_DIR`, so `subagent-start` resolves to the same project. |
| Cross-project recall opt-in | New MCP tool `quoth_recall_global(query)` returns only `scope='global'` entities. |

**Guarantees:**

- Project A patterns never leak into project B's injection.
- Global facts are universally available.
- Project rename: `UPDATE knowledge_entities SET scope='project:<new>' WHERE scope='project:<old>'`.
- Project deletion: `DELETE FROM knowledge_entities WHERE scope='project:<name>'`.

### 3.7 SaaS-side delta

The Postgres schema in `src/lib/db/schema.ts` mirrors `knowledge_entities` 1:1. The existing Postgres `patterns` table is dropped. The `POST /api/v1/pipeline/process` endpoint stops returning pattern objects and starts returning `knowledge_entities` objects with `kind` set. API key auth, rate limiting, multi-tenancy (`org_id`) all stay.

## 4. Data Flow

### Flow A — Productive session, normal extraction

1. **T+0**: User runs `claude` in `~/projects/skill-registry`. SessionStart hook fires `session-restore` — initGraph, inject project context, inject top 5 facts per namespace, exit in <300 ms. Daemon socket existence check kicks off detached daemon spawn if not running.
2. **T+5s**: User submits prompt. UserPromptSubmit hook fires `route` — connects to daemon socket (200 ms timeout), POSTs `/inject`, daemon embeds prompt, HNSW search, scope filter, re-rank, returns 8 results in ~80 ms. Hook injects via `additionalContext`.
3. **T+10s onward**: Each tool call fires PostToolUse → trajectory-capture appends to `active/<sid>.jsonl` (with dedup) and updates sidecar in <3 ms.
4. **T+8 min**: User exits. SessionEnd hook fires — atomic rename `active/<sid>.* → processing/<sid>.*`.
5. **T+8 min + 1 s**: Daemon's `fs.watch(processing/)` fires. FileWatcher debounces 500 ms, enqueues for claim.
6. **T+8 min + 2 s**: Free worker claims via rename `processing/<sid>.jsonl → processing/<sid>.<pid>.<wid>.jsonl`.
7. **T+8 min + 3 s**: TRIAGE — Gemini Flash Lite, ~$0.0003. Returns `{productive: true, urgency: medium, suspected_kinds: [pattern, decision, fact]}`.
8. **T+8 min + 5 s**: EXTRACT — Kimi K2.5 multi-turn tool calling, ~$0.012. Returns 3 patterns + 1 decision + 2 facts.
9. **T+8 min + 8 s**: EMBED — MiniLM batches all 6 entities into one call.
10. **T+8 min + 8.5 s**: PERSIST — single transaction: insert/strengthen entities, update HNSW, write `pipeline_costs` row.
11. **T+8 min + 9 s**: ARCHIVE — move file to `done/2026-04-11/skill-registry/`. Worker returns to claim queue.

### Flow B — Routine session, fast-path archive

1. Session ran `cat README.md`, `ls`, `git status`, 6 tool calls.
2. SessionEnd → atomic rename to `processing/`.
3. Worker claims, runs TRIAGE → `{productive: false, urgency: low, suspected_kinds: [], reason: "agent only inspected state, no changes"}`.
4. Skip extract/embed/persist entirely. Move to `routine/2026-04-11/skill-registry/`. Cost: $0.0003.

### Flow C — Multiple concurrent sessions

```
T+0    4 sessions land in processing/ within 1 s:
         S1 (skill-registry, 12 entries)
         S2 (quoth, 87 entries)
         S3 (skill-registry, 4 entries)
         S4 (sales-companion, 230 entries)

T+0.5s fs.watch debounces, enqueues all 4

T+1s   All 4 workers pick up (worker pool=4)
       Workers 1,2,3,4 → each TRIAGE in parallel (8 slots free)

T+3s   All 4 triage calls return:
         S1 routine → archive immediately, worker 1 free
         S2 productive medium → enter EXTRACT (3 slots)
         S3 productive low    → enter EXTRACT (2 slots left)
         S4 productive high   → enter EXTRACT (1 slot left)

T+5s   Worker 1 picks up S5 from queue (newly arrived)
       S5 begins TRIAGE — extract slots full but triage runs immediately

T+10s  S2 finishes extract → embed → persist (~10 ms)
       S2 worker free, picks up S6

T+15s  S3 finishes (low-urgency Kimi path is faster)

T+30s  S4 finishes (high-urgency, deeper Kimi loop)
       Throughput ~6 sessions / 30 s = 720 sessions/hour
```

The persist semaphore (1) never bottlenecks because persist is millisecond-scale relative to second-scale LLM calls. The triage 8-slot semaphore exists not because triage is expensive but to cap concurrent Vercel AI Gateway calls under provider rate limits.

### Flow D — Daemon-down on UserPromptSubmit (graceful degradation)

1. User runs `claude` for the first time today. SessionStart → session-restore. Daemon socket missing. Inject facts from DB (works without daemon — DB is local). Spawn daemon detached. Exit in <300 ms.
2. **T+10s**: User submits prompt. UserPromptSubmit → route. Try connect daemon socket. Daemon still booting. 200 ms timeout fires. Exit immediately, no injection for this prompt. **No stderr output.** A `pipeline_errors` row is written with `severity='warn'`, `stage='inject'`.
3. **T+12s**: Daemon finishes boot, socket live, fs.watch armed.
4. **T+30s**: Next prompt — connects in 5 ms, injects normally.

**The "Daemon failed to start within 5s" warning never appears.** First prompt of the day might miss injection; every subsequent prompt has it.

## 5. Error Handling & Observability

### 5.1 The "loud DB, quiet stderr" principle

Two channels, two purposes:

| Channel | Audience | Verbosity |
|---|---|---|
| `pipeline_errors` table + `daemon.log` JSON lines | Operator (post-mortem, dashboard) | **Always loud** — every error, every degraded path, every retry |
| stderr / hook output | Claude Code session | **Quiet by default** — only print if `QUOTH_DEBUG=true` or it would mislead the user |

Today the existing code does *both* silently (`try {} catch {}` in trajectory-capture.js drops errors entirely). Every catch block in the new design writes to `pipeline_errors` before returning.

### 5.2 Expanded `pipeline_errors` schema

```sql
CREATE TABLE pipeline_errors (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                 INTEGER NOT NULL,
  stage              TEXT NOT NULL,            -- 'capture'|'session-end'|'claim'|'triage'|'extract'|'embed'|'persist'|'inject'|'archive'|'budget'|'daemon-startup'
  severity           TEXT NOT NULL,            -- 'fatal'|'error'|'warn'|'degraded'
  session_id         TEXT,
  project            TEXT,
  worker_id          TEXT,                     -- which worker hit it
  error_message      TEXT NOT NULL,
  error_stack        TEXT,
  context            TEXT,                     -- JSON: { tool_count, model, urgency, ... }
  model_attempted    TEXT,
  fallback_attempted INTEGER NOT NULL DEFAULT 0,
  fallback_succeeded INTEGER NOT NULL DEFAULT 0,
  retry_count        INTEGER NOT NULL DEFAULT 0,
  resolution         TEXT                       -- 'recovered'|'archived-as-error'|'still-failing'|null
);

CREATE INDEX idx_pe_stage_ts ON pipeline_errors(stage, ts DESC);
CREATE INDEX idx_pe_session  ON pipeline_errors(session_id);
CREATE INDEX idx_pe_severity ON pipeline_errors(severity, ts DESC);
```

`severity='degraded'` is new — it covers cases where we *succeeded* but with a non-default path (e.g. fallback model used, partial result returned, daemon was cold). These aren't errors but they're things you want to see when asking "is the system healthy?"

### 5.3 Per-stage failure modes and recovery

| Stage | Failure | What happens to the file | DB write | User-visible? |
|---|---|---|---|---|
| **capture** | sidecar write fails | JSONL append already succeeded; sidecar can be rebuilt | `severity='warn'` | No |
| **capture** | dedup state corrupt | clear dedup file, treat next entry as fresh | `severity='warn'` | No |
| **session-end** | atomic rename fails | mkdir + retry once; if still fails, file stays in active/ and stale detector picks it up next pass | `severity='error'` | No |
| **claim** | rename race (another worker won) | skip this file, pick next | `severity='warn'` | No |
| **triage** | LLM API error | retry up to 2× with backoff (1 s, 4 s); if all fail, skip triage and route to extract anyway | `severity='error'`, `retry_count` tracked | No |
| **triage** | budget exhausted | unclaim file (rename back), log + sleep until midnight UTC | `severity='warn'`, `stage='budget'` | **Yes** if `QUOTH_NOTIFY_BUDGET_EXHAUSTED=true` |
| **extract** | Kimi fails after retries | fallback to `claude -p sonnet-4-6 --effort low` | `severity='degraded'`, `fallback_attempted=1`, `fallback_succeeded=1` | No |
| **extract** | both Kimi AND fallback fail | move file to `error/2026-04-11/<project>/` for inspection | `severity='error'`, `resolution='archived-as-error'` | **Yes** if `QUOTH_DEBUG`, else just DB |
| **extract** | LLM returns invalid JSON | one retry with stricter prompt; if still fails, archive to error/ | `severity='error'` | No |
| **extract** | LLM hallucinates wrong shape | validator drops bad entities; if 0 valid entities remain, treat session as routine | `severity='warn'` per dropped entity | No |
| **embed** | MiniLM fails | persist entities **without embeddings** (re-embedded by nightly sweep) | `severity='degraded'` | No |
| **persist** | duplicate id | strengthen existing entity (alpha+=1) instead of insert | normal merge, not an error | No |
| **persist** | SQLite I/O error / disk full | rollback, unclaim file, retry next pass | `severity='fatal'` | **Yes** — daemon.log + stderr |
| **persist** | HNSW.add fails | persist row anyway (without index), nightly sweep rebuilds index | `severity='degraded'` | No |
| **inject** | daemon socket dead | return empty result, no injection for this prompt | `severity='warn'` | No |
| **inject** | daemon returns malformed response | parse what we can, drop the rest | `severity='warn'` | No |
| **daemon-startup** | port/socket already bound | log existing PID, exit cleanly | `severity='warn'` | No |
| **daemon-startup** | DB migration failed | exit with code 1, leave a `~/.quoth/STARTUP_FAILED` flag file | `severity='fatal'` | **Yes** — next hook run reads the flag and prints a one-line warning |

### 5.4 The "broken-pipe escape hatch"

If the daemon is in a bad state, capture should NOT stop. The capture hook never depends on the daemon. Worst case the user keeps building up `processing/` files that the daemon will catch up on once fixed. **No data is lost** because everything is on disk.

The stale-session detector becomes the safety net: if `processing/` files are older than `QUOTH_PROCESSING_MAX_AGE_HOURS` (default 24 h), the daemon logs a warning and the session is moved to `error/` with a `pipeline_errors` row explaining "processed by stale-sweep, original failure unknown."

### 5.5 Observability surfaces

**A. Daemon log file** (`~/.quoth/daemon.log`) — JSON lines, structured. Existing format, expanded to include severity. `tail -f | jq` friendly.

**B. New MCP tool: `quoth_health()`**
```json
{
  "daemon": { "pid": 3928, "uptime_s": 3600, "queue_depth": 0, "in_flight": 3 },
  "errors_24h": {
    "triage":  { "error": 2, "warn": 5, "degraded": 0 },
    "extract": { "error": 1, "warn": 0, "degraded": 12 },
    "persist": { "error": 0, "warn": 0, "degraded": 0 }
  },
  "budget": { "date": "2026-04-11", "spend_usd": 0.42, "limit_usd": 1.00 },
  "stuck_files": [],
  "recent_failures": []
}
```

**C. New query-server endpoint: `GET /health`** — same JSON as `quoth_health()` but accessible via `curl --unix-socket ~/.quoth/daemon.sock http://daemon/health | jq`.

### 5.6 Failure replay

For sessions in `error/`, a CLI command:
```
node quoth-plugin/scripts/cli.js replay <session-id>
```

Reads the JSONL from `error/`, runs the pipeline against it without writing to the DB, prints what *would* have happened, returns a diff against the original error. Loop you'd use to debug "why did this session fail extraction?" without polluting prod state.

### 5.7 Notifications (opt-in)

- `QUOTH_NOTIFY_BUDGET_EXHAUSTED=true` → daemon writes a single line to stderr the first time budget hits 100% in a day
- `QUOTH_NOTIFY_STUCK_FILES=true` → daemon writes a stderr line when a file has been in `processing/` for >1 h

Default off. Everything else lives in the DB and you query it via `quoth_health()`.

## 6. Cleanup & Migration

### 6.1 Code to delete

**Plugin (`quoth-plugin/`):**
```
daemon/lib/judge.js                       # pairwise judge subsystem (Gemini Flash)
daemon/lib/snips.js                       # SNIPS cluster posterior
daemon/lib/clustering.js                  # cluster-level Thompson sampling
daemon/lib/bandit-v2.js                   # Thompson sampling cluster selector
daemon/lib/sampler.js                     # if only used by bandit-v2
daemon/lib/curation.js                    # 30d archive lifecycle
daemon/lib/mutate.js                      # pattern mutation experiments (unused)
daemon/lib/propensity.js                  # IPS reweighting
daemon/lib/attribute.js                   # decision attribution v1
daemon/lib/attribution.js                 # duplicate
daemon/lib/doc-update-api.js              # cloud doc-updater (separate, out of scope)
daemon/lib/doc-updater.js
daemon/lib/doc-manifest.js
daemon/lib/pull.js                        # if only used by cloud doc-updater
daemon/lib/skill-extract.js               # skills subsystem removed
daemon/pipeline/extract.js                # rewritten — see §2.2

mcp/handlers/skills.js                    # skills MCP handlers removed

scripts/migrate-session-isolation.js      # one-shot migration, no longer needed
scripts/setup.sh                          # legacy non-interactive installer

trajectories/processing-deferred/         # 5684 quarantined files
~/.quoth/intelligence/*.json              # graph cache (regenerated)
~/.quoth/hnsw.bin                         # rebuilt empty
~/.quoth/memory.db                        # rebuilt empty
```

**SaaS (`src/`):**
```
src/app/api/v1/patterns/*                 # old pattern endpoints
src/app/api/v1/patterns/promote/*
src/lib/db/schema/patterns.ts             # old patterns Drizzle schema
src/lib/db/schema/memory_entries.ts       # old facts schema
src/lib/embeddings/voyage.ts              # if voyage-4-lite still referenced
```

### 6.2 Code to rewrite

| File | Change |
|---|---|
| `daemon/daemon.js` | Worker pool + stage semaphores + new pipeline orchestration |
| `daemon/daemon-core.js` | `processSessionFile()` → `processSessionWithPipeline()`, async stages |
| `daemon/db.js` | New schema, drop old tables, migration as a single one-shot |
| `daemon/pipeline/extract.js` | Rewritten — four-entity Kimi prompt, urgency-based prompt depth |
| `daemon/lib/llm.js` | Keep Kimi + Gemini Flash Lite + claude -p; remove judge code paths |
| `daemon/lib/query-server.js` | Add `/inject`, `/health`; existing endpoints stay |
| `hooks/trajectory-capture.js` | Matcher-less + dedup |
| `hooks/hook-dispatch.js` | route hook fast-path; session-restore drops pattern injection; subagent-start uses /inject |
| `mcp/handlers/patterns.js` | Renamed → `entities.js`; tools renamed (see 6.3) |
| `scripts/cli.js` | `init` wizard updated for new env vars |

### 6.3 MCP tool migration

| Old tool | Action | New tool |
|---|---|---|
| `quoth_log_outcome` | **Keep** | `quoth_log_outcome` |
| `quoth_score_pattern` | **Rename** | `quoth_score_entity` |
| `quoth_top_patterns` | **Rename + extend** | `quoth_top_entities(kind?, limit)` |
| `quoth_search_patterns` | **Rename + extend** | `quoth_search_entities(query, kinds?, limit)` |
| `quoth_project_patterns` | **Delete** — covered by `quoth_search_entities` with project filter | — |
| `quoth_promote_global` | **Rename** | `quoth_promote_entity` |
| `quoth_seed_from_exolar` | **Delete** — exolar seed source gone | — |
| `quoth_propose_update` | **Delete** | — |
| `quoth_daemon_status` | **Keep** | `quoth_daemon_status` |
| `quoth_ingest_trajectory` | **Delete** — capture is hook-driven | — |
| `quoth_agent_register/heartbeat/list/assign_task` | **Keep** | (no change) |
| `quoth_route_task` | **Keep** | (no change) |
| `quoth_intelligence_init/context/consolidate/stats/feedback` | **Delete** — replaced by per-entity scoring + new injection | — |
| `quoth_extract_skill` / `quoth_list_skills` | **Delete** — skills subsystem removed | — |

**New MCP tools added:**
- `quoth_recall_decisions(situation, limit?)`
- `quoth_recall_anti_patterns(situation, limit?)`
- `quoth_log_decision(situation, options, choice, reasoning)`
- `quoth_log_anti_pattern(condition, what_not_to_do, why_failed)`
- `quoth_recall_global(query)` — cross-project semantic search, global scope only
- `quoth_health()`
- `quoth_replay_session(session_id)`

**Net count**: 22 → ~14 tools.

### 6.4 Env vars

**Removed:**
```
QUOTH_LLM_MODEL                       # implicit in pipeline routing now
QUOTH_JUDGE_DAILY_LIMIT               # judge subsystem gone
QUOTH_V2_MINI_JUDGE_LIMIT
```

**Added:**
```
QUOTH_CONCURRENCY=4                   # worker pool size
QUOTH_TRIAGE_CONCURRENCY=8            # triage stage semaphore
QUOTH_EXTRACT_CONCURRENCY=3           # extract stage semaphore
QUOTH_EMBED_CONCURRENCY=2             # embed stage semaphore
QUOTH_DAILY_LLM_BUDGET_USD=1.00       # hard cost ceiling per UTC day
QUOTH_PROCESSING_MAX_AGE_HOURS=24     # stale processing/ file detection
QUOTH_NOTIFY_BUDGET_EXHAUSTED=false
QUOTH_NOTIFY_STUCK_FILES=false
QUOTH_DAEMON_SOCKET_TIMEOUT_MS=200    # how long /inject waits for daemon
QUOTH_KIND_WEIGHT_PATTERN=1.0
QUOTH_KIND_WEIGHT_DECISION=1.3
QUOTH_KIND_WEIGHT_ANTI_PATTERN=1.5
QUOTH_KIND_WEIGHT_FACT=0.8
```

**Kept:**
```
QUOTH_HOME, QUOTH_DEBUG, QUOTH_MODE, QUOTH_API_KEY, QUOTH_API_URL, QUOTH_PROJECT_ID
AI_GATEWAY_API_KEY                    # Vercel AI Gateway for Gemini Flash Lite
MOONSHOT_API_KEY                      # Kimi K2.5 access
QUOTH_STALE_TTL_MS                    # stale active/ session detection
QUOTH_RETENTION_DONE_DAYS, _ROUTINE_DAYS, _EMPTY_DAYS, _ERROR_DAYS
QUOTH_MANAGED_LOCAL_BACKGROUND
```

### 6.5 Documentation cleanup

**Files to fully rewrite:**
- `quoth-plugin/CLAUDE.md` — remove JUDGE/DISTILL/CONSOLIDATE language; describe TRIAGE/EXTRACT/EMBED/PERSIST + four entity kinds.
- `quoth-plugin/README.md` — if it references old pipeline.

**Files to archive (move to `docs/superpowers/specs/archive/`):**
- `2026-04-10-extract-v2-tool-calling.md`
- `2026-04-10-session-isolation.md`
- `2026-04-10-unified-injection-design.md`
- `2026-04-08-agent-type-pipeline-design.md`
- `2026-04-09-intent-outcome-temporal.md`
- Any spec referencing JUDGE→DISTILL→CONSOLIDATE, bandit-v2, SNIPS, voyage-4-lite

**Verification step**: `scripts/verify-cleanup.sh` greps the entire repo (excluding `_archive/`) for stale terms — `JUDGE`, `DISTILL`, `CONSOLIDATE`, `voyage-4-lite`, `bandit-v2`, `SNIPS`, `judge_queue`, `cluster_posterior`. Fails CI if any references remain.

### 6.6 Cutover sequence

1. Implement new code on a feature branch (no deletion yet)
2. Run new daemon against a wiped `~/.quoth-test/` in a sandbox
3. Verify capture/extract/inject end-to-end on real sessions
4. Run `verify-cleanup.sh` — should still fail (old code present)
5. Delete old files in one commit
6. Run `verify-cleanup.sh` — should pass
7. Wipe production `~/.quoth/` (with explicit user confirm)
8. Restart daemon on new code
9. SaaS deploys in a follow-up PR using the same spec

### 6.7 Archive directories

```
docs/superpowers/specs/archive/...
quoth-plugin/daemon/lib/_archive/judge.js
quoth-plugin/daemon/lib/_archive/bandit-v2.js
quoth-plugin/daemon/lib/_archive/...
```

Archive directories are ignored by `verify-cleanup.sh`. Git history preserves everything anyway.

## 7. Testing Strategy

### 7.1 Unit tests (fast, no LLM calls)

**Capture (`tests/unit/capture/`):**
- `dedup.test.js` — 5 identical Read calls → 1 entry
- `dedup-distinct.test.js` — Read(a) → Read(b) → Read(a) → 3 entries
- `sanitizer.test.js` — every secret pattern in `REDACT_PATTERNS` redacts
- `project-resolution.test.js` — git remote → repo name; workspace path → ws name; bare dir → basename
- `sidecar-roundtrip.test.js` — append + sidecar update is atomic; corrupted sidecar gets rebuilt
- `matcher-less-perf.test.js` — 1000 PostToolUse calls in <100 ms total

**Pipeline stages (`tests/unit/pipeline/`):**
- `triage.test.js` — fake LLM returns canned responses; routing decisions verified
- `extract.test.js` — fake Kimi returns each entity shape; parser drops malformed; project name from sidecar overrides LLM
- `embed.test.js` — batched call covers all 4 kinds in one shot
- `persist.test.js` — duplicate id strengthens; new id inserts; HNSW.add called once per new id; rollback on partial failure
- `llm-budget.test.js` — spend accumulates; midnight reset; over-limit triggers requeue

**Daemon orchestration (`tests/unit/daemon/`):**
- `worker-pool.test.js` — N workers each pull from claim queue; no double-claim
- `stage-semaphores.test.js` — 8 concurrent triages allowed, 9th waits; extract semaphore=3 doesn't block triage of 4 more
- `claim-by-rename.test.js` — two workers race → exactly one wins
- `persist-serialization.test.js` — 10 concurrent persist calls execute one at a time

**Inject (`tests/unit/inject/`):**
- `kind-weight-ranking.test.js` — anti-patterns rank above patterns at equal cosine score
- `scope-filter.test.js` — query for `project:quoth` never returns `project:skill-registry` rows
- `daemon-down.test.js` — fake socket dies → route hook returns within 200 ms with empty injection
- `prompt-embedding-cache.test.js` — same prompt within 60 s → cache hit, no MiniLM call

### 7.2 Integration tests (real DB, no LLM)

`tests/integration/` — real SQLite in `/tmp/quoth-test-<uuid>/`, real fs operations, fake LLM stubs.

- `end-to-end-productive.test.js`
- `end-to-end-routine.test.js`
- `end-to-end-multi-session.test.js` — drop 10 fixtures into `processing/` simultaneously
- `end-to-end-extract-failure.test.js`
- `end-to-end-budget-exhausted.test.js`
- `end-to-end-injection.test.js` — pre-populate entities, hit `/inject` over Unix socket, verify ranking
- `cleanup-verification.test.js` — runs `verify-cleanup.sh`

### 7.3 E2E tests with real LLMs (opt-in)

`tests/e2e/` — opt-in via `QUOTH_E2E_LLM=true`. **Not in CI by default.** Cost ceiling <$0.10 per full run.

- `triage-real-llm.test.js` — 5 hand-crafted fixtures, assert Gemini classifies correctly
- `extract-four-kinds.test.js` — fixture designed to surface all 4 kinds, run through real Kimi
- `failure-replay.test.js`

### 7.4 Concurrency property tests

`tests/property/concurrent-pipeline.test.js`:
- Generate N random fixtures (N ∈ [1, 50])
- Drop them into `processing/` over a randomized time window
- Run daemon with random `QUOTH_CONCURRENCY ∈ [1, 8]`
- Assert: every fixture lands in exactly one terminal bucket; no fixtures lost; no double-processed; row counts match

### 7.5 Migration tests

`tests/migration/cutover.test.js`:
- Set up `~/.quoth-test/` with old `patterns` table populated
- Run new daemon's first-boot path
- Verify old tables dropped, new schema created, no data left

### 7.6 What is **not** tested

- LLM output quality (model question, not code question)
- Network failures at the LLM provider (covered by fallback path tests)
- The `claude -p` CLI (out of process, black box)
- HNSW index correctness (third-party library)
- SaaS pipeline (separate test suite in `src/`)

### 7.7 CI gate

1. All unit tests pass (~3–5 s)
2. All integration tests pass (~30–60 s)
3. `verify-cleanup.sh` exits 0
4. `node quoth-plugin/scripts/cli.js init --dry-run` succeeds
5. Concurrency property test runs ≥30 iterations without losing a fixture

E2E tests run on a manual workflow and are advisory.

## 8. Cost Model

| Stage | Model | Per-call cost | Frequency |
|---|---|---|---|
| triage | Gemini 2.5 Flash Lite | ~$0.0003 | Every productive + routine session |
| extract (low) | Kimi K2.5 single-turn | ~$0.005 | Productive low-urgency |
| extract (medium) | Kimi K2.5 multi-turn | ~$0.012 | Productive medium-urgency |
| extract (high) | Kimi K2.5 deep multi-turn | ~$0.025 | Productive high-urgency |
| embed | MiniLM-L6-v2 (local) | $0 | Every productive session |
| persist | SQLite + HNSW | $0 | Every productive session |
| inject | MiniLM (local, cached) | $0 | Every UserPromptSubmit |

**Daily budget**: `QUOTH_DAILY_LLM_BUDGET_USD=1.00` default. At typical mix (60% routine, 30% medium, 10% high), supports ~120 sessions/day before requeue. Configurable up or down.

## 9. Migration Path

This is a **greenfield reset**. No data migration script.

1. Implement all new code on `feat/extract-v3`
2. Add `verify-cleanup.sh` and a one-shot migration in `daemon/db.js` that drops old tables on first boot
3. Test against `QUOTH_HOME=/tmp/quoth-test`
4. Land the PR
5. Operator wipes `~/.quoth/` manually before restarting daemon (the cli.js init wizard prompts for this)
6. SaaS migration as follow-up PR using same spec

## 10. Open Questions

None remaining at design time. All decisions locked during brainstorming.

## 11. Future Integration: `skill-registry`

**Status**: blocked on user's in-progress refactor of `/home/lord_montino/projects/agents-tools/skill-registry`. **Not implemented in this design.** The architecture leaves a clean seam for it.

**The seam:**

1. **MCP tool boundary** — when `skill-registry` ships its own MCP server, Quoth doesn't need to know it exists. Claude Code loads both MCP servers from `~/.mcp.json`. Tool namespaces don't collide (`quoth_*` vs `skills_*`). Zero coupling.

2. **Per-prompt skill suggestion** — the new `route` hook does semantic search against `knowledge_entities`. We add a parallel call to a `skill-registry` query endpoint at the same time, merge results, inject both. Single env var `SKILL_REGISTRY_QUERY_URL`. If unset, the call is skipped. Zero failure if `skill-registry` is down.

3. **Knowledge → skill promotion** — when a `kind='pattern'` reaches high confidence (e.g. >0.85, >5 uses, recurring across sessions), it's a candidate to become an executable skill. New nightly job `daemon/jobs/skill-promotion-candidates.js` writes candidates to `~/.quoth/skill-candidates.jsonl`. The `skill-registry` CLI reads that file. Quoth never writes into the skill-registry repo directly.

4. **Skill outcomes → Quoth feedback loop** — when `skill-registry` runs an executable skill and that skill succeeds or fails, it can `POST /skill-feedback {skill_id, outcome, source_pattern_id}` to Quoth's daemon socket. The daemon updates the originating pattern's Bayesian alpha/beta. This closes the loop between abstract patterns and executable skills.

5. **Project context sharing** — `skill-registry` already needs to know "what stack is this project, what conventions" — exactly what `kind='fact'` entities encode. New endpoint `GET /facts?scope=project:<name>` returns the scoped fact list as JSON. `skill-registry` calls it during skill installation to filter to project-relevant skills. Read-only, no auth needed for localhost socket.

**What this means concretely:**

- This redesign's `knowledge_entities` table has nothing skill-specific in it.
- The four kinds stay as `pattern`, `decision`, `anti_pattern`, `fact`.
- A future PR (after `skill-registry` refactor lands) adds:
  - `daemon/jobs/skill-promotion-candidates.js`
  - `daemon/lib/query-server.js`: `GET /facts`, `POST /skill-feedback`
  - `hooks/hook-dispatch.js route`: parallel call to `SKILL_REGISTRY_QUERY_URL`
  - One env var: `SKILL_REGISTRY_QUERY_URL` (default unset)
