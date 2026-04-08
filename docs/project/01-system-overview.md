# Quoth v3.3.0 System Overview

## Two-Part Architecture

Quoth is a self-learning knowledge system split into two independent but connected components: a local Claude Code plugin and a cloud SaaS platform.

### LOCAL: quoth-plugin/

The plugin runs entirely on the developer's machine as a Claude Code extension. It provides:

- **Hooks** (9 bindings across 8 events) that intercept Claude Code lifecycle events (session start/end, tool use, subagent start/stop, prompt submit, context compaction). All hooks route through a single unified dispatcher (`hook-dispatch.js`) except trajectory capture which has its own handler.
- **Daemon** (background process) that watches trajectory JSONL files. Processes session summaries via batch distill (Haiku CLI) + consolidate pipeline to extract reusable patterns. Includes V2 subsystems: hierarchical Thompson sampling, LLM-as-judge pairwise ranking, clustering, curation, and doc auto-update.
- **MCP Server** (`quoth-learning`) exposing 22 tools over stdio JSON-RPC for pattern management, agent coordination, intelligence routing, and skill extraction.
- **SQLite Database** (`~/.quoth/memory.db`) with WAL mode, storing patterns, trajectories, trajectory steps, memory entries, agent registry, events, cluster stats, injection log, and judge queue. Includes a pure-JS HNSW vector index for approximate nearest neighbor search over 384-dimensional pattern embeddings (MiniLM-L6-v2).

### CLOUD: src/

The SaaS platform is a Next.js 16 App Router application deployed on Vercel. It provides:

- **Web dashboard** for managing projects, agents, knowledge base documents, proposals, and shared patterns.
- **REST API** (versioned under `/api/v1/`) for agent-to-cloud communication: pattern promotion, trajectory ingestion, memory storage, semantic search, agent registration, and inter-agent messaging.
- **Neon Postgres** database with 6 schemas, pgvector for 1024-dimensional embeddings, full-text search via tsvector, and GIN indexes on array/tag columns.
- **Clerk authentication** for web users plus agent API keys (`qth_*` prefix, SHA-256 hashed) for programmatic access.
- **Cron jobs** for cache cleanup, pattern consolidation, and webhook retry, executed via Vercel Cron + QStash.

---

## Data Flow (End to End)

### 1. User Interacts with Claude Code

A developer opens a Claude Code session. The `SessionStart` hook fires, which:
- Auto-starts the daemon if not already running (checks `~/.quoth/daemon.pid`).
- Initializes the in-memory intelligence graph (PageRank over file/concept nodes).
- Queries SQLite for high-confidence patterns (>= 0.6) relevant to the current project.
- Injects up to 3 top patterns into the session context so Claude sees learned knowledge immediately.

### 2. Hooks Capture Trajectories

On every `PostToolUse` event for Bash, Write, Edit, MultiEdit, or Agent tools, the `trajectory-capture.js` hook fires. It:
- Reads the tool call data from stdin (JSON from Claude Code).
- Reads `~/.quoth/intelligence/prompt-history.json` for recent user prompts (rolling buffer of last 5).
- Extracts LLM reasoning from tool input fields (Bash description, Agent prompt, Edit diff).
- Captures sanitized tool input and output (API keys, tokens, JWTs, UUIDs redacted).
- Appends a JSONL line to `~/.quoth/trajectories/{repo-name}-{date}.jsonl`.
- Each line contains: timestamp, tool name, sanitized tool input/output, outcome, user_intent, conversation_context (last 3 prompts), llm_reasoning, session ID, project name.
- Additionally, `session-memory.js` provides in-session topic/file tracking (session-scoped, not persisted across sessions).

### 3. UserPromptSubmit Routes Task

When the user submits a prompt, the `route` command in `hook-dispatch.js`:
- Parses the prompt text.
- Matches against ~26 keyword pattern groups in `routing.js` (8 agent types: coder, tester, reviewer, researcher, architect, backend-dev, frontend-dev, devops). Supports both English and Spanish (Argentine voseo) task descriptions. Intent patterns (fix/debug/refactor) take priority over domain patterns (api/frontend/deploy). Conversational/question patterns route to researcher at 0.6 confidence.
- Returns the optimal agent type with confidence score and reasoning.
- Also queries patterns with score >= 0.1 relevant to the task for injection.

### 4. SubagentStart Injects Domain Context

When Claude Code spawns a subagent (Task tool), the `subagent-start` hook:
- Reads the subagent's task description.
- Queries the intelligence graph and pattern database for domain-relevant patterns.
- Injects matched patterns into the subagent's `additionalContext` field so the subagent benefits from learned knowledge without a separate MCP connection.

### 5. SubagentStop Applies Bayesian Feedback

When a subagent completes (`SubagentStop`), the `post-task` hook:
- Treats completion as implicit positive signal.
- Identifies which patterns were injected into that subagent.
- Updates pattern confidence using Bayesian Beta(alpha, beta) distribution: `alpha += 1` for success (increasing confidence toward 1.0).
- Records the attribution so patterns that consistently lead to successful outcomes rise in confidence.

### 6. PostToolUse Records Edits for Intelligence

Write/Edit/MultiEdit events additionally trigger the `post-edit` command, which:
- Records the edited file path and nature of the change in the intelligence graph.
- Builds edges between concepts (file types, frameworks, patterns) for PageRank computation.

### 7. Daemon Processes Trajectories

The daemon (`daemon.js`) runs as a persistent background process:

**File Watching:** Uses `fs.watch` on `~/.quoth/trajectories/` for new/modified JSONL files (500ms debounce).

**Pipeline (session-based batch processing):**

Individual `tool_use` entries are marked as processed immediately without LLM calls — they serve as context. The actual pipeline triggers on `session_summary` entries generated at session end:

**Local mode (`QUOTH_MODE=local`):**

1. **DISTILL-BATCH** (`pipeline/distill-batch.js`) — Extracts 1-3 reusable patterns from the entire session context using Claude Haiku 4.5 via `claude -p` CLI. Collects up to 30 recent tool entries, user intents, and LLM reasoning into a single prompt. Quality rules enforce technique/strategy descriptions, never raw file paths or tool calls. Also computes 384-dim embeddings via local MiniLM-L6-v2 (@xenova/transformers). Includes pre-insert dedup check (embedding similarity >= 0.92 via HNSW, or name prefix match) to strengthen existing patterns.

2. **CONSOLIDATE** (`pipeline/consolidate.js`) — Uses Claude Haiku 4.5 via `claude -p` CLI to decide whether a distilled pattern should merge into an existing pattern ("strengthen") or be stored as new. Merging triggers a Bayesian success update on the target pattern.

**Managed mode (`QUOTH_MODE=managed`):** Sends session data to `POST /api/v1/pipeline/process` for cloud processing. Falls back to local mode if the cloud returns no results.

**Individual pipeline modules (used in V2 pairwise judge system):**

- **JUDGE** (`pipeline/judge.js`) — Evaluates trajectory effectiveness using `callLLM()` (default: `google/gemini-2.5-flash-lite` via Vercel AI Gateway, legacy fallback: Kimi K2.5 via Moonshot). Used by V2 pairwise judge batch, not per-entry processing.
- **DISTILL** (`pipeline/distill.js`) — Per-entry pattern extraction using `callLLM()`. Used as a fallback path; batch distill is the primary flow.

**Attribution** (`lib/attribute.js`) — Uses Claude Haiku 4.5 via `claude -p` CLI to trace which patterns contributed to successful outcomes, updating their Bayesian confidence scores.

**Query Server** — Unix socket server (`daemon.sock`) for zero-latency daemon queries from hooks (routing, pattern injection) without spawning new processes.

**Stale Session Detector** — Every 10 minutes, scans for orphaned sessions (30-minute stale threshold) and generates synthetic session summaries to trigger batch distill.

### 8. Patterns Stored in SQLite with HNSW

Patterns are stored in the `patterns` table with base columns: id, name, pattern_type, condition, action, description, confidence (0.0-1.0), success_count, failure_count, decay_rate, embedding (JSON-serialized 384-dim vector), version, tags, source, status, timestamps, last_matched_at. Runtime migrations add: alpha, beta (Bayesian scoring), namespace, promoted_at, cloud_document_id, promoted_confidence, applicability, exposure_count, last_exposed_at, ignored_count, embedding_text, pattern_trigrams, quality_history, cluster_id, cluster_rank_score, effective_exposures, distinctiveness, retired_at, retired_reason.

Additional V2 tables: `cluster_stats` (hierarchical Thompson sampling), `injection_log` (pattern exposure tracking), `judge_queue` (LLM-as-judge pairwise comparisons), `events` (event sourcing).

The pure-JS HNSW index (`lib/hnsw.js`) provides O(log n) approximate nearest neighbor search over 384-dim embeddings (MiniLM-L6-v2). It is initialized on daemon startup (`db.initHnsw()`) and saved to disk every 30 minutes.

### 9. Nightly Deep Processing (3am)

Scheduled at 3am ART (06:00 UTC) via `setTimeout` + 24h `setInterval`. Also runs at startup if >24h since last execution (catch-up for daemon restarts).

**Phase A: Deep Consolidation**
- Phase 0: Archive garbage patterns (raw tool-call names like "claude-code: Bash ...").
- Phase 1: Name-based dedup (normalize + 50-char prefix match).
- Phase 2: LLM-assisted review of top 20 patterns via Claude Haiku 4.5 CLI (MERGE/ARCHIVE actions).

**Phase B: Doc Auto-Update** — Updates project documentation from source code changes. Local mode uses Sonnet 4.6 via CLI; managed mode uses cloud API.

**Phase C: Cloud Pull** — Syncs patterns from Quoth cloud + pulls shared cross-org patterns.

**Phase D: V2 Cluster Rebuild** (feature-flagged) — Rebuilds pattern clusters for hierarchical Thompson sampling.

**Phase E: V2 SNIPS Posteriors** (feature-flagged) — Updates cluster posterior distributions.

**Phase F: V2 LLM-as-Judge** (feature-flagged) — Enqueues and runs pairwise pattern comparisons on uncertain clusters.

**Phase G: V2 Curation** (feature-flagged) — Backfills distinctiveness scores. Weekly (Sunday): dedup near-duplicates (>0.92 similarity) and retire poor-performing patterns.

**Recurring timers (separate from nightly):**
- Hourly: exposure-based confidence decay (exposed patterns with high failure rate: beta += 0.05/hr; high-exposure patterns: alpha *= 0.9995/hr for recency). Never-exposed patterns have NO decay. Also archives weak patterns and prunes young unused ones.
- Every 30 minutes: HNSW index save to disk.
- Every 5 minutes: Agent cleanup (stale registrations >5min without heartbeat).
- Every 2 hours: V2 mini-pipeline (clusters + SNIPS + judge batch, feature-flagged).
- Every 6 hours: Cloud pull sync.
- Every 10 minutes: Stale session detector.

### 10. Cloud Stores Promoted Patterns

The SaaS platform receives promoted patterns and:
- Stores them in Neon Postgres with pgvector embeddings.
- Makes them available for cross-project semantic search via `/api/v1/search`.
- Indexes them in the `docs.chunks` table with HNSW cosine similarity index for fast vector retrieval.
- Records the promotion in `analytics.activity` for usage tracking.
- Makes patterns discoverable to other team members and agents within the same organization.

---

## Key Technologies

### Runtime

| Component | Technology |
|-----------|-----------|
| Plugin | Node.js (CommonJS modules, no build step) |
| SaaS | Next.js 16 App Router on Vercel |
| Plugin DB | SQLite via better-sqlite3 with WAL mode |
| Cloud DB | Neon Postgres (serverless driver) with pgvector |

### LLMs

| Use Case | Model | Provider | Cost Profile |
|----------|-------|----------|-------------|
| Batch distillation (primary) | Claude Haiku 4.5 | Anthropic via `claude -p` CLI | Low cost, session-level |
| Pattern consolidation | Claude Haiku 4.5 | Anthropic via `claude -p` CLI | Low cost |
| Deep consolidation (nightly) | Claude Haiku 4.5 | Anthropic via `claude -p` CLI | Low cost |
| Pattern attribution | Claude Haiku 4.5 | Anthropic via `claude -p` CLI | Low cost |
| V2 pairwise judging | Gemini 2.5 Flash Lite | Google via Vercel AI Gateway | Very low cost |
| Per-entry distillation (fallback) | Gemini 2.5 Flash Lite | Google via Vercel AI Gateway | Very low cost |
| Skill extraction | Claude Sonnet 4.6 | Anthropic via `claude -p` CLI | Higher cost, used sparingly |
| Doc auto-update (local mode) | Claude Sonnet 4.6 | Anthropic via `claude -p` CLI | Higher cost, nightly only |

Legacy: Kimi K2.5 via Moonshot API is retained as a last-resort fallback in `llm.js` when `AI_GATEWAY_API_KEY` is not set.

### Embeddings

**Local plugin:**
- **Model:** `Xenova/all-MiniLM-L6-v2` via @xenova/transformers (ONNX, quantized)
- **Dimensions:** 384
- **Cost:** Zero (runs locally, ~5ms per embedding after warmup)
- **Used for:** Pattern similarity (local HNSW), dedup detection

**Cloud SaaS:**
- **Model:** Provider-dependent (pgvector 1024-dim in Neon Postgres)
- **Used for:** Document chunk search, memory search, cross-project semantic search

### Authentication

| Context | Method |
|---------|--------|
| Web users | Clerk (@clerk/nextjs v7) — handles login, signup, email verification, org management |
| Agent API access | API keys with `qth_` prefix, SHA-256 hashed in `agents.api_keys` table, scoped to read/write with optional project restriction |
| MCP transport | OAuth 2.0 flow (`/api/oauth/`) for remote MCP connections |
| CLI auth | Device flow via `/auth/cli` page |

### Infrastructure

| Service | Purpose |
|---------|---------|
| Vercel | SaaS hosting, serverless functions, cron jobs |
| Neon | Managed Postgres with pgvector extension |
| Upstash | Redis for rate limiting (@upstash/ratelimit), QStash for async job scheduling |
| Vercel AI Gateway | Unified proxy to AI providers (Google Gemini for daemon LLM calls) |
| Clerk | Identity and authentication platform |

---

## Project Identity

| Property | Value |
|----------|-------|
| Plugin version | 3.3.0 |
| Package name (SaaS) | quoth-mcp v3.0.0 |
| MCP protocol version | 2024-11-05 |
| MCP server name | quoth-learning |
| MCP server version | 2.0.0 |
| Plugin manifest name | quoth |
| Repository | github.com/Montinou/quoth |
| Production URL | quoth.triqual.dev |

---

## Session Lifecycle Summary

```
Session Start
  |
  v
[SessionStart hook] --> init intelligence graph, inject top 3 patterns (>= 0.6)
  |
  v
User submits prompt
  |
  v
[UserPromptSubmit hook] --> route task to agent type, show relevant patterns
  |
  v
Claude Code works (Bash, Write, Edit...)
  |
  v
[PostToolUse hooks] --> trajectory-capture.js writes enriched JSONL
                    --> (includes user_intent, conversation_context, llm_reasoning, sanitized I/O)
                    --> post-edit records to intelligence graph
  |
  v
Claude spawns subagent
  |
  v
[SubagentStart hook] --> inject domain patterns into additionalContext
  |
  v
Subagent completes
  |
  v
[SubagentStop hook] --> Bayesian success feedback on matched patterns
  |
  v
Session ends (or context compaction)
  |
  v
[SessionEnd / PreCompact hook] --> consolidate graph, write session_summary, SIGUSR1 daemon
  |
  v
[Daemon] --> watches JSONL --> tool_use entries: mark processed (context only)
  |                        --> session_summary: batch distill (Haiku CLI) → consolidate → store
  |                        --> stale session detector (10min) generates synthetic summaries
  |
  v
[Timers] --> hourly: exposure-based decay + prune
         --> 2h: V2 mini-pipeline (clusters + judge batch)
         --> 6h: cloud pull sync
  |
  v
[Nightly 3am] --> deep consolidation, dedup, doc auto-update, cloud pull, V2 curation
  |
  v
[Cloud API] --> Neon Postgres + pgvector --> cross-team search
```
