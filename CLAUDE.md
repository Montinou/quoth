# Quoth Plugin v3.6.0 (Knowledge Entities)

Located at `quoth-plugin/`. A standalone Claude Code plugin that captures
agent sessions and distills them into a polymorphic knowledge store of
patterns, decisions, anti-patterns, and facts. Modular architecture:
4 handler modules, 18 MCP tools.

## Setup
```bash
node quoth-plugin/scripts/cli.js init     # Interactive wizard (recommended)
bash quoth-plugin/scripts/setup.sh        # Non-interactive (legacy)

# Back up + wipe a pre-v3.6 install before first v3.6 boot
node quoth-plugin/scripts/cli.js reset
```
Auto-detects `claude` CLI → sets mode (local/managed), writes `~/.quoth/.env`,
installs hooks, starts daemon. Idempotent — safe to re-run. First boot
bootstraps the `knowledge_entities` schema and stamps
`daemon_meta.key='greenfield_reset_v3_6'`.

## What It Does
- Logs each agent session to its own JSONL at `~/.quoth/trajectories/active/<sessionId>.jsonl` with a sidecar `<sessionId>.meta.json` for status + dedup hash
- Dedup sidecar suppresses no-op PostToolUse events so compaction-spam never reaches the daemon
- On session end, the hook atomically renames the pair into `~/.quoth/trajectories/processing/` — the rename IS the handoff
- Daemon worker pool claims files from `processing/`, runs the 4-stage pipeline, and archives them to `done/YYYY-MM-DD/<project>/`, `routine/`, `empty/`, or `error/`
- **Four-stage pipeline:** triage → extract → embed → persist
  - **triage** — Gemini 2.5 Flash Lite via AI Gateway classifies whether a session is worth mining
  - **extract** — Kimi K2.5 (Moonshot) emits the four entity kinds in one call
  - **embed** — Local MiniLM-L6 encodes each entity (384d BLOB)
  - **persist** — Single-transaction upsert into `knowledge_entities` + HNSW index update
- Stage semaphores bound concurrent LLM calls; race-free daily USD budget reserved atomically before every call
- `/inject` over the unix socket serves per-prompt pattern retrieval with a 200 ms timeout fast-path (fall back to SQL)
- `/health` reports daemon PID, 24 h error count, budget, and any stuck `processing/` files
- Four entity kinds share one `knowledge_entities` table: `pattern`, `decision`, `anti_pattern`, `fact`
- Scope column is `global` or `project:<name>` — only two flavors
- Facts surface on SessionStart (top 5 per scope); patterns/decisions/anti-patterns surface via `/inject` on UserPromptSubmit and SubagentStart, weighted by `QUOTH_KIND_WEIGHT_*`
- Confidence is a Beta(alpha, beta) posterior updated by outcome logging
- Pipeline cost/error telemetry lives in `llm_budget` and `pipeline_errors`

## Trajectory Layout
```
~/.quoth/trajectories/
  active/                        # in-progress sessions (written by trajectory-capture.js)
  processing/                    # claimed by daemon (renamed from active/ on session-end)
  done/YYYY-MM-DD/<project>/     # productive sessions — entities persisted
  routine/YYYY-MM-DD/<project>/  # triage said: no signal worth mining
  empty/YYYY-MM-DD/              # zero tool_use entries (no project subdir)
  error/YYYY-MM-DD/              # pipeline failures (no project subdir)
```

State machine: `active → processing → {done, routine, empty, error}`.

Each `<sessionId>.jsonl` is paired with `<sessionId>.meta.json`. Sidecars
carry `{session_id, project, status, first_seen_ts, last_seen_ts,
tool_count, dedup_hash, closed_marker, ...}`. Both files move together on
every state change via `fs.renameSync` (POSIX atomic). Per spec §6.4
there is **no trivial gate** — every non-empty session passes through
`processing/` regardless of entry count; a session that crashed after
2 Writes may be the most valuable kind of trajectory.

Query the daemon via the local socket:
- `GET /health` — daemon PID, 24 h errors, budget usage, stuck files
- `GET /inject?prompt=...&project=...&kinds=pattern,decision&limit=5` — per-prompt retrieval
- `GET /sessions/:sid/status` — sidecar + bucket location
- `GET /facts/:scope?limit=N` — facts for `global` or `project:<name>`
- `DELETE /facts/:scope/:id` — soft-archives (status='archived')

## Global Configuration
Quoth is configured once globally — no per-project setup needed:
- `~/.mcp.json` → `quoth-learning` MCP server
- `~/.claude/settings.json` → all hooks point to `~/.quoth/hooks/`
- `~/.quoth/hooks/` → symlinks to `quoth-plugin/hooks/` in this repo
- Project segregation is automatic via `CLAUDE_PROJECT_DIR` → git remote name

## Daemon Modes
- **Local** (`QUOTH_MODE=local`): runs triage and extract via own API keys — `AI_GATEWAY_API_KEY` (Gemini Flash Lite) + `MOONSHOT_API_KEY` (Kimi K2.5). Embed is always local MiniLM.
- **Managed** (`QUOTH_MODE=managed`): daemon posts trajectories to `POST /api/v1/pipeline/process`. Only needs `QUOTH_API_KEY`.
- Canonical agent types defined in `mcp/lib/routing.js` AGENT_TYPES (8 roles)
- Auto-starts via `session-start` hook detach or `cli.js init`
- PID: `~/.quoth/daemon.pid`, Log: `~/.quoth/daemon.log`, Socket: `~/.quoth/daemon.sock`
- HNSW index: `~/.quoth/hnsw.bin` (rebuilt from SQLite on boot if missing)
- Debug: `QUOTH_DEBUG=true`

### Environment variables (spec §6.4)

**Pipeline:**
```
QUOTH_CONCURRENCY=4                   # worker pool size
QUOTH_TRIAGE_CONCURRENCY=8
QUOTH_EXTRACT_CONCURRENCY=3
QUOTH_EMBED_CONCURRENCY=2
QUOTH_DAILY_LLM_BUDGET_USD=1.00       # hard cost ceiling per UTC day
QUOTH_PROCESSING_MAX_AGE_HOURS=24     # stuck file detection
QUOTH_POLL_INTERVAL_MS=5000           # polling fallback interval
QUOTH_SHUTDOWN_GRACE_MS=30000         # SIGTERM grace before force-rollback
QUOTH_HNSW_REBUILD_BATCH=500          # boot-time index rebuild batch size
```

**Ranking weights:**
```
QUOTH_KIND_WEIGHT_PATTERN=1.0
QUOTH_KIND_WEIGHT_DECISION=1.3
QUOTH_KIND_WEIGHT_ANTI_PATTERN=1.5
# facts are session-start only, never re-ranked
```

**Socket + notifications:**
```
QUOTH_DAEMON_SOCKET_TIMEOUT_MS=200    # /inject fast-path ceiling
QUOTH_NOTIFY_BUDGET_EXHAUSTED=false
QUOTH_NOTIFY_STUCK_FILES=false
```

**Retention (unchanged from v3.5):**
```
QUOTH_STALE_TTL_MS                    # active/ session idle detection
QUOTH_RETENTION_DONE_DAYS              # default 30
QUOTH_RETENTION_ROUTINE_DAYS           # default 7
QUOTH_RETENTION_EMPTY_DAYS             # default 3
QUOTH_RETENTION_ERROR_DAYS             # default 14
```

**LLM + managed-mode:**
```
QUOTH_HOME, QUOTH_DEBUG, QUOTH_MODE
QUOTH_API_KEY, QUOTH_API_URL, QUOTH_PROJECT_ID
AI_GATEWAY_API_KEY                    # Vercel AI Gateway for triage
MOONSHOT_API_KEY                      # Kimi K2.5 for extract
QUOTH_MANAGED_LOCAL_BACKGROUND        # write-through confirmation mode
```

## MCP Tools (18 total via quoth-learning server)

**Entities (4):** `quoth_score_entity`, `quoth_top_entities`, `quoth_search_entities`, `quoth_promote_entity`

**Recall / log (5):** `quoth_recall_decisions`, `quoth_recall_anti_patterns`, `quoth_log_decision`, `quoth_log_anti_pattern`, `quoth_recall_global`

**Outcome + routing (2):** `quoth_log_outcome`, `quoth_route_task`

**Daemon + ops (3):** `quoth_daemon_status`, `quoth_health`, `quoth_replay_session`

**Agents (4):** `quoth_agent_register`, `quoth_agent_heartbeat`, `quoth_agent_list`, `quoth_assign_task`

## Hooks (via hook-dispatch.js)

All hooks run through a single unified dispatcher. Automatic hooks make
zero network calls — everything routes through `/inject` on the daemon
socket with a 200 ms ceiling.

| Hook Event | Matcher | Command | What It Does |
|---|---|---|---|
| `UserPromptSubmit` | — | `route` | Hits `/inject` with the prompt + project; surfaces top-ranked patterns/decisions/anti-patterns |
| `SessionStart` | — | `session-restore` | Injects top 5 facts for `global` + `project:<name>` (direct SQL on `knowledge_entities`) |
| `SessionEnd` | — | `session-end` | Flushes the active session sidecar, moves the pair to `processing/` |
| `PostToolUse` | `*` | `trajectory-capture` | Captures every tool call, dedupes via sidecar hash |
| `PreToolUse` | `Bash` | `pre-bash` | Blocks dangerous commands (rm -rf /, fork bombs) |
| `SubagentStart` | — | `subagent-start` | Hits `/inject` with subagent prompt_tag; injects entities via `additionalContext` |
| `PreCompact` | — | (none) | Removed: session-end on compact was wrong — session is still alive post-compact |
| `SubagentStop` | — | (none) | Removed: post-task handler never existed |
| `Stop` | — | (none) | Not used |

## Architecture
```
hooks/
  hook-dispatch.js       — Unified dispatcher (all hooks except trajectory)
  trajectory-capture.js  — PostToolUse logger + dedup sidecar
  hooks.json             — Plugin hook manifest

mcp/
  quoth-learning-server.js  — MCP protocol entry point
  handlers/                 — entities.js, agents.js, outcomes.js, ops.js, index.js
  lib/                      — routing.js (task routing), hnsw.js (singleton)

daemon/
  daemon.js                 — Worker pool, polling fallback, SIGTERM handling
  daemon-core.js            — Stage driver + file state machine
  db.js                     — SQLite + HNSW boot rebuild
  lib/
    triage.js               — Gemini Flash Lite stage
    extract.js              — Kimi K2.5 four-kind extractor
    embed.js                — MiniLM local embeddings (batched)
    persist.js              — Single-tx upsert + HNSW update
    llm-budget.js           — Race-free daily USD reservation
    knowledge-entities.js   — CRUD helpers
    query-server.js         — Unix socket /health, /inject, /facts, /sessions
    pipeline-api.js         — Managed-mode cloud client

scripts/
  cli.js                    — init, status, restart, reset subcommands
  reset-quoth-home.js       — Greenfield backup + wipe helper
  setup.sh                  — Non-interactive installation
  verify-cleanup.sh         — Stale-term guard for greenfield reset

.claude-plugin/
  plugin.json               — Plugin manifest
  hooks/hooks.json          — Hook declarations
  commands/                 — /quoth:patterns, /quoth:learn
  agents/                   — quoth:learner (Haiku trajectory reviewer)
```

## Build & Test
```bash
cd quoth-plugin
npm test                           # vitest run
bash scripts/verify-cleanup.sh     # stale-term guard
```

## Security
- NEVER hardcode API keys or secrets in source files
- NEVER commit .env files
- Always validate user input at system boundaries
- Daemon socket is unix-only; no TCP surface

## Greenfield cutover (v3.5 → v3.6)
`cli.js reset` tars `~/.quoth/` to a sibling backup, then wipes only the
canonical v3.6 set: `memory.db`, `hnsw.bin`, `intelligence/`, and
`trajectories/processing-deferred/`. Everything else survives: `.env`,
credentials, and the active trajectory archive. On next daemon boot the
new schema bootstraps and stamps `daemon_meta.greenfield_reset_v3_6`.
