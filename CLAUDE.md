# Quoth Plugin v3.4.0 (Self-Learning)

Located at `quoth-plugin/`. A standalone Claude Code plugin providing autonomous self-learning, intelligence routing, and agent coordination. Modular architecture: 4 handler modules, 22 MCP tools.

## Setup
```bash
node quoth-plugin/scripts/cli.js init    # Interactive wizard (recommended)
bash quoth-plugin/scripts/setup.sh       # Non-interactive (legacy)
```
Auto-detects `claude` CLI → sets mode (local/managed), writes `~/.quoth/.env`, installs hooks, starts daemon. Idempotent — safe to re-run.

## What It Does
- Logs all agent trajectories to `~/.quoth/trajectories/{repo-name}-{date}.jsonl`
- Background daemon processes trajectories via 3-stage pipeline (JUDGE → DISTILL → CONSOLIDATE)
- JUDGE: batch-evaluates 30 entries at once via Gemini 2.5 Flash, classifies domain (8 canonical agent types)
- DISTILL: extracts patterns via Gemini 2.5 Flash Lite, generates MiniLM embeddings
- CONSOLIDATE: merges duplicates via Claude Haiku 4.5 (`claude -p`)
- Patterns carry `agent:<type>` tags from JUDGE domain classification
- Pipeline costs tracked per stage in `pipeline_costs` table
- Maintains confidence-scored pattern library in `~/.quoth/memory.db` (SQLite + HNSW)
- Injects high-confidence patterns (>= 0.6) at session start — max 3, not noise
- Routes tasks to optimal agents using keyword matching + PageRank intelligence
- Injects domain-relevant patterns into subagents via `additionalContext`
- Project identification via git remote origin (GitHub repo name)
- On-demand semantic search via `quoth_search_patterns` MCP tool (embedding + cosine similarity)

## Global Configuration
Quoth is configured once globally — no per-project setup needed:
- `~/.mcp.json` → `quoth-learning` MCP server
- `~/.claude/settings.json` → all hooks point to `~/.quoth/hooks/`
- `~/.quoth/hooks/` → symlinks to `quoth-plugin/hooks/` in this repo
- Project segregation is automatic via `CLAUDE_PROJECT_DIR` → git remote name

## Daemon Modes
- **Local** (`QUOTH_MODE=local`): Full local pipeline — JUDGE (Gemini 2.5 Flash, batch 30) / DISTILL (Gemini 2.5 Flash Lite) via Vercel AI Gateway, CONSOLIDATE via `claude -p` Haiku 4.5, doc-updater via Sonnet 4.6. Requires own API keys.
- **Managed** (`QUOTH_MODE=managed`): Cloud pipeline — daemon sends trajectories to `POST /api/v1/pipeline/process`, server runs JUDGE→DISTILL→CONSOLIDATE. Only needs `QUOTH_API_KEY`.
- Canonical agent types defined in `mcp/lib/routing.js` AGENT_TYPES (8 roles)
- Auto-starts via `session-start` hook or `cli.js init`
- PID: `~/.quoth/daemon.pid`, Log: `~/.quoth/daemon.log`
- Debug: `QUOTH_DEBUG=true`
- Nightly promotion: high-confidence patterns (>0.8, >10 uses) auto-promote to Quoth cloud at 3am
- Env vars: `QUOTH_API_KEY` (qth_* key), `QUOTH_PROJECT_ID`, `QUOTH_API_URL` (optional, defaults to quoth.triqual.dev)
- Bayesian confidence scoring: Beta(alpha, beta) distribution
- Decision Attribution: tracks which patterns caused success/failure outcomes
- Source tagging: distilled, exolar-seeded, healer-learned, attributed, skill-derived

## MCP Tools (22 total via quoth-learning server)

**Patterns (8):** `quoth_log_outcome`, `quoth_score_pattern`, `quoth_top_patterns`, `quoth_search_patterns`, `quoth_project_patterns`, `quoth_promote_global`, `quoth_seed_from_exolar`, `quoth_propose_update`

**Agents (6):** `quoth_daemon_status`, `quoth_ingest_trajectory`, `quoth_agent_register`, `quoth_agent_heartbeat`, `quoth_agent_list`, `quoth_assign_task`

**Intelligence (6):** `quoth_route_task`, `quoth_intelligence_init`, `quoth_intelligence_context`, `quoth_intelligence_consolidate`, `quoth_intelligence_stats`, `quoth_intelligence_feedback`

**Skills (2):** `quoth_extract_skill`, `quoth_list_skills`

## Hooks (via hook-dispatch.js)

All hooks run through a single unified dispatcher. Zero API calls in automatic hooks.

| Hook Event | Command | What It Does |
|---|---|---|
| `UserPromptSubmit` | `route` | Route task to optimal agent, show relevant patterns (score >= 0.1) |
| `SessionStart` | `session-restore` | Init intelligence graph, inject max 3 patterns (>= 0.6 confidence) |
| `SessionEnd` | `session-end` | Consolidate intelligence graph, recompute PageRank |
| `PreCompact` | `session-end` | Same as SessionEnd (pre-context-compression) |
| `PostToolUse (Write/Edit)` | `post-edit` | Record edit for intelligence |
| `PostToolUse (Bash/Write/Edit/Agent)` | `trajectory-capture` | Capture tool calls to project trajectory file |
| `PreToolUse (Bash)` | `pre-bash` | Block dangerous commands (rm -rf /, fork bombs) |
| `SubagentStart` | `subagent-start` | Inject domain-relevant patterns via `additionalContext` |
| `SubagentStop` | `post-task` | Implicit positive feedback to intelligence |

## Architecture
```
hooks/
  hook-dispatch.js       — Unified dispatcher (all hooks except trajectory)
  trajectory-capture.js  — PostToolUse trajectory logger
  hooks.json             — Plugin hook manifest

mcp/
  quoth-learning-server.js  — MCP protocol (~55 lines)
  handlers/                 — patterns.js, agents.js, intelligence.js, skills.js, index.js
  lib/                      — graph.js (PageRank), routing.js (task routing)

daemon/
  daemon.js   — Background trajectory processor (local/managed mode switch)
  db.js       — SQLite + HNSW index management
  lib/        — embed.js (MiniLM local embeddings + batch), pipeline-api.js (cloud client), promote.js (cloud sync)

scripts/
  cli.js      — Interactive onboarding CLI (init, status, restart)
  setup.sh    — Non-interactive installation (symlinks, settings.json injection)

.claude-plugin/
  plugin.json            — Plugin manifest (MCP server, hooks, commands, agents)
  hooks/hooks.json       — Hook declarations for plugin system
  commands/              — /quoth:patterns, /quoth:learn
  agents/                — quoth:learner (Haiku trajectory reviewer)
```

## Build & Test
```bash
npm test
npm run lint
```

## Security
- NEVER hardcode API keys or secrets in source files
- NEVER commit .env files
- Always validate user input at system boundaries

## Roadmap

### Done in v3.4.0
- ~~Managed mode~~ — SaaS-ready daemon without user API keys (`POST /api/v1/pipeline/process`)
- ~~CLI onboarding~~ — `node cli.js init` interactive wizard
- ~~Batch embeddings~~ — `generateEmbeddingBatch()` for cost optimization (MiniLM local)
- ~~Distiller quality~~ — batch-only distill with session context, improved prompts
- ~~Pattern lifecycle~~ — 30d archive for never-exposed, 600 cap, exposure-based decay only
- ~~Unified injection~~ — patterns + docs in single ranked pipeline via `hierarchicalSelect()`
- ~~V2 Thompson sampling~~ — hierarchical cluster selection with graded reward signal (0.0-1.0)
- ~~SNIPS cold-start~~ — minimum observations lowered from 3 to 1, ESS-scaled pseudo-trials
- ~~Doc chunk Thompson priors~~ — alpha/beta columns, Bayesian updates on doc injection
- ~~Graded reward signal~~ — `sessionOutcomeReward()` returns 7-level scores based on session outcomes
- ~~Doc re-indexing~~ — fs.watch on docs/project/ (5s debounce) + SIGUSR2 for manual trigger
- ~~Batch JUDGE~~ — Gemini 2.5 Flash, 30 entries per batch for cost optimization
- ~~Local MiniLM-L6 embeddings~~ — 384d, $0, replaces voyage-4-lite 1024d

### Phase 2: Cloud & Monetization
- **Venice.ai cloud embeddings** — migrate `src/lib/embeddings/gateway.ts` from voyage-4-lite to Venice BGE-M3 ($0 vs $0.02/MTok)
- **Usage dashboard** — show tokens consumed, patterns learned, quota remaining per org
- **Tier system** — free (50 pipeline calls/day, 500 patterns) vs pro (unlimited)
- **`npx quoth init`** — publish CLI as npm package for zero-friction onboarding

### Phase 3: Distribution & Scale
- **Doc-updater cloud endpoint** — so managed users get doc auto-updates too (cheaper model)
- **Routing coverage** — expand keyword patterns in `routing.js` to reduce "Default routing" fallback rate
- **Cross-org pattern sharing** — opt-in anonymous pattern exchange between organizations
- **Pattern marketplace** — curated high-confidence patterns installable by new users
