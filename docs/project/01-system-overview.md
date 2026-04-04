# Quoth v3.2.0 System Overview

## Two-Part Architecture

Quoth is a self-learning knowledge system split into two independent but connected components: a local Claude Code plugin and a cloud SaaS platform.

### LOCAL: quoth-plugin/

The plugin runs entirely on the developer's machine as a Claude Code extension. It provides:

- **Hooks** (8 events) that intercept Claude Code lifecycle events (session start/end, tool use, subagent start/stop, prompt submit, context compaction). All hooks route through a single unified dispatcher (`hook-dispatch.js`) except trajectory capture which has its own handler.
- **Daemon** (background process) that watches trajectory JSONL files and runs a 3-stage LLM pipeline (JUDGE, DISTILL, CONSOLIDATE) to extract reusable patterns from agent behavior.
- **MCP Server** (`quoth-learning`) exposing 22 tools over stdio JSON-RPC for pattern management, agent coordination, intelligence routing, and skill extraction.
- **SQLite Database** (`~/.quoth/memory.db`) with WAL mode, storing patterns, trajectories, trajectory steps, memory entries, agent registry, skills, and intelligence graph state. Includes a pure-JS HNSW vector index for approximate nearest neighbor search over pattern embeddings.

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
- Appends a JSONL line to `~/.quoth/trajectories/{repo-name}-{date}.jsonl`.
- Each line contains: timestamp, tool name, tool input summary, tool output summary, session ID, project name.

### 3. UserPromptSubmit Routes Task

When the user submits a prompt, the `route` command in `hook-dispatch.js`:
- Parses the prompt text.
- Matches against keyword patterns in `routing.js` (8 agent types: coder, tester, reviewer, researcher, architect, backend-dev, frontend-dev, devops).
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

**File Watching:** Uses `fs.watch` on `~/.quoth/trajectories/` for new/modified JSONL files.

**Pipeline (per trajectory batch):**

1. **JUDGE** (`pipeline/judge.js`) — Evaluates trajectory effectiveness using Kimi K2.5 via Moonshot API. Assigns a verdict: effective, partially-effective, or ineffective. Only effective trajectories proceed.

2. **DISTILL** (`pipeline/distill.js`) — Extracts reusable patterns from effective trajectories using Kimi K2.5. Generates: pattern name, condition (when to apply), action (what to do), description, tags. Also computes a 1024-dim embedding via voyage-4-lite for semantic similarity.

3. **CONSOLIDATE** (`pipeline/consolidate.js`) — Uses Claude Haiku 4.5 to decide whether the distilled pattern should merge into an existing pattern (if semantically similar enough via HNSW lookup) or be stored as new. Merging updates confidence, increments version, and blends embeddings.

**Attribution** (`lib/attribute.js`) — Uses Haiku to trace which patterns contributed to successful outcomes, updating their Bayesian confidence scores.

### 8. Patterns Stored in SQLite with HNSW

Patterns are stored in the `patterns` table with columns: id, name, pattern_type, condition, action, description, confidence (0.0-1.0), success_count, failure_count, decay_rate, embedding (JSON-serialized 1024-dim vector), version, tags, source, status, timestamps, last_matched_at.

The pure-JS HNSW index (`lib/hnsw.js`) provides O(log n) approximate nearest neighbor search over pattern embeddings. It is initialized on daemon startup (`db.initHnsw()`) and periodically saved to disk.

### 9. Nightly Deep Processing (3am)

At 3am (scheduled via `setInterval` in the daemon):

- **Deep consolidation:** Re-scans all active patterns, merges near-duplicates using embedding similarity.
- **Confidence decay:** Patterns not matched/used decay at their configured `decay_rate` per week (default 0.005/week).
- **Cloud promotion:** High-confidence patterns (>0.8 confidence, >10 uses) are promoted to the Quoth cloud API via `lib/promote.js`. This sends the pattern data to `POST /api/v1/patterns/promote` with the agent's `QUOTH_API_KEY`.
- **HNSW save:** Persists the in-memory HNSW index to disk.
- **Agent cleanup:** Removes stale agent registrations that haven't heartbeated.

### 10. Cloud Stores Promoted Patterns

The SaaS platform receives promoted patterns and:
- Stores them in Neon Postgres with pgvector 1024-dim embeddings.
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
| Trajectory judging | Kimi K2.5 | Moonshot (OpenAI-compat API) | Low cost, high throughput |
| Pattern distillation | Kimi K2.5 | Moonshot | Low cost |
| Pattern consolidation | Claude Haiku 4.5 | Anthropic (via Vercel AI Gateway) | Low cost, high accuracy |
| Pattern attribution | Claude Haiku 4.5 | Anthropic (via Vercel AI Gateway) | Low cost |
| Skill extraction | Claude Sonnet 4.6 | Anthropic (via Vercel AI Gateway) | Higher cost, used sparingly |

### Embeddings

- **Model:** `voyage/voyage-4-lite` via Vercel AI Gateway
- **Dimensions:** 1024
- **Cost:** ~$0.02 per million tokens
- **Used for:** Pattern similarity (local HNSW), document chunk search (cloud pgvector), memory search (cloud pgvector)

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
| Vercel AI Gateway | Unified proxy to AI providers (Anthropic, Voyage) |
| Clerk | Identity and authentication platform |

---

## Project Identity

| Property | Value |
|----------|-------|
| Plugin version | 3.2.0 |
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
[PostToolUse hooks] --> trajectory-capture.js writes JSONL
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
[SessionEnd / PreCompact hook] --> consolidate intelligence graph, recompute PageRank
  |
  v
[Daemon] --> watches JSONL --> JUDGE --> DISTILL --> CONSOLIDATE --> SQLite + HNSW
  |
  v
[Nightly 3am] --> deep consolidation, dedup, decay, cloud promotion
  |
  v
[Cloud API] --> Neon Postgres + pgvector --> cross-team search
```
