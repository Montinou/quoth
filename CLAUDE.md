# Quoth Plugin v3.2.0 (Self-Learning)

Located at `quoth-plugin/`. A standalone Claude Code plugin providing autonomous self-learning, intelligence routing, and agent coordination. Modular architecture: 4 handler modules, 22 MCP tools.

## Setup
```bash
bash quoth-plugin/scripts/setup.sh
```
Symlinks hooks to `~/.quoth/hooks/`, injects hook declarations into `~/.claude/settings.json`, and adds permissions. Idempotent — safe to re-run.

## What It Does
- Logs all agent trajectories to `~/.quoth/trajectories/{repo-name}-{date}.jsonl`
- Background daemon processes trajectories using Haiku subagents (JUDGE → DISTILL → CONSOLIDATE)
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

## Daemon
- Auto-starts via `session-start` hook
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
  daemon.js   — Background trajectory processor
  db.js       — SQLite + HNSW index management
  lib/        — embed.js (OpenAI embeddings), promote.js (cloud sync)

scripts/
  setup.sh    — Automated installation (symlinks, settings.json injection)

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

### Next: Core Quality Improvements
- **Distiller quality** — pattern names are too raw ("claude-code: Write /path/to/file"). Improve daemon's JUDGE → DISTILL pipeline to produce meaningful, reusable pattern names and actions
- **Temporal confidence decay** — patterns not matched/used should decay over time (e.g. -0.01/week). Prevents stale patterns from dominating
- **Routing coverage** — expand keyword patterns in `routing.js` to reduce "Default routing" fallback rate. Add project-specific routing patterns learned from trajectories
- **Pattern dedup** — detect and merge near-duplicate patterns (e.g. multiple "Write to skill-registry/scripts/*" entries)
