# Quoth v3.3.0 — Project Context

Self-learning platform for AI agents. Two components: local Claude Code plugin (`quoth-plugin/`) and SaaS cloud (`src/`, Next.js 16 on Vercel at quoth.triqual.dev).

## Architecture

**Local plugin:** 9 hook bindings via `hook-dispatch.js` (unified) + `trajectory-capture.js` (JSONL logger). Background daemon processes trajectories through JUDGE (Kimi K2.5) → DISTILL (Kimi K2.5 + voyage-4-lite embeddings) → CONSOLIDATE (Claude Haiku 4.5 via CLI). MCP server `quoth-learning` exposes 22 tools over stdio JSON-RPC. SQLite (better-sqlite3, WAL) + pure-JS HNSW index (M=16, cosine, 1024d).

**SaaS:** Next.js 16 App Router. Neon Postgres + pgvector (6 schemas). Clerk auth (web) + qth_* API keys SHA-256 (agents) + OAuth 2.0 (MCP remote). REST API at `/api/v1/` (agents, comms, patterns, search, memory). Upstash Redis (rate-limit) + QStash (async jobs).

## Hooks (9 bindings)

| Event | Command | Action |
|-------|---------|--------|
| PreToolUse:Bash | pre-bash | Block rm -rf /, fork bombs |
| PostToolUse:Bash/Write/Edit/Agent | trajectory-capture | Append JSONL to ~/.quoth/trajectories/ |
| PostToolUse:Write/Edit | post-edit | Record file in pending-insights.jsonl |
| UserPromptSubmit | route | Classify → agent type + inject patterns ≥0.1 |
| SessionStart | session-restore | Init graph, inject top 3 patterns ≥0.6 |
| SessionEnd | session-end | Consolidate graph, PageRank recompute |
| PreCompact | session-end | Same (pre-context compression) |
| SubagentStart | subagent-start | Inject domain patterns via additionalContext |
| SubagentStop | post-task | Bayesian +1 alpha on matched patterns |

Hooks require() handlers directly (no MCP roundtrip). Symlink resolution via fs.realpathSync from ~/.quoth/hooks/ to plugin source.

## Daemon Pipeline

Persistent Node.js process. PID at ~/.quoth/daemon.pid. File watcher on trajectories/ (fs.watch, 500ms debounce). Job queue with dedup (Set of filename:lineIndex keys). Batch size 5 concurrent.

**JUDGE:** Kimi K2.5, temp 0.6, 150 tok → {effective, reason, category}. Fallback: outcome==='success'.
**DISTILL:** Kimi K2.5, temp 0.6, 200 tok + voyage-4-lite 1024d embedding → {pattern, tags, applicability}. Fallback: raw "{agent}: {task}".
**CONSOLIDATE:** Claude Haiku 4.5 via `claude` CLI, 30s timeout → strengthen (merge) or new (insert). Fallback: action='new'.

Post-pipeline: strengthen → applyBayesianUpdate(targetId, 'success'). new → upsertPattern() with id=SHA-1, confidence=0.5, source='distilled'. Mark JSONL _processed:true in-place.

**Timers:** Decay (60min), HNSW save (30min), agent cleanup (5min), deep consolidation (3am: LLM dedup top 20, cloud promote >0.8/>10 uses, global promote broad patterns). Signals: SIGTERM=graceful, SIGUSR1=flush.

## Bayesian Scoring

Beta(alpha, beta) distribution. New pattern: Beta(1,1)=0.5 (uniform prior). Success: alpha+=1. Failure: beta+=1. Confidence = alpha/(alpha+beta). Decay: alpha *= (1-decay_rate) per week (default 0.005). Min confidence: 0.05. Dual feedback: post-task updates both intelligence graph JSON (+0.05 delta) and SQLite (Bayesian +1 alpha).

## Intelligence Graph

In-memory directed graph (graph.js). Sources: memory .md files + top 50 SQLite patterns. Tokenize → trigrams → Jaccard similarity for edges (>0.3). PageRank d=0.85, 30 iter. Cache 60s in ~/.quoth/intelligence/. Consolidation: process pending edits (3+ edits → insight), refresh patterns, rebuild edges, recompute PageRank.

## MCP Tools (22)

**Patterns (8):** log_outcome, score_pattern, top_patterns, search_patterns, project_patterns, promote_global, seed_from_exolar, propose_update
**Intelligence (6):** route_task, intelligence_init/context/consolidate/stats/feedback
**Agents (6):** daemon_status, ingest_trajectory, agent_register/heartbeat/list, assign_task
**Skills (2):** extract_skill (Sonnet 4.6), list_skills

## Database (SQLite)

**patterns:** id, name, condition, action, confidence, alpha, beta, decay_rate, embedding (JSON 1024d), tags (JSON[]), source (distilled|exolar-seeded|healer-learned|attributed|skill-derived), status (active|archived|merged)
**trajectories:** id, session_id, status, verdict, task
**trajectory_steps:** trajectory_id FK, step_number, action, observation
**memory_entries:** namespace, key (UNIQUE per ns), content, type, tags
**agent_registry:** agent_id, name, type, project, platform
**skills:** id, name, template, params, selectors, assertions

HNSW: pure-JS, M=16, M0=32, efConstruction=200, efSearch=50, cosine distance, O(log n). Persisted every 30min.

## Task Routing

Zero-latency regex in routing.js. First match wins at 0.8 confidence. Default: coder@0.5.
Patterns: implement|create|build→coder, test|spec|coverage→tester, review|audit|security→reviewer, research|find|search→researcher, design|architect|plan→architect, api|endpoint|backend→backend-dev, ui|frontend|react→frontend-dev, deploy|docker|ci→devops.

## Cloud Promotion

Criteria: confidence>0.8, uses>10, active, source=distilled. Nightly at 3am. Auto-creates project in cloud. Payload: pattern data + markdown content + 1024d embedding. Endpoint: POST /api/v1/patterns/promote with qth_* API key.

## Key Paths

- Plugin: quoth-plugin/ (hooks/, daemon/, mcp/, scripts/, tests/)
- SaaS: src/app/ (routes), src/lib/ (db, auth, utils)
- Runtime: ~/.quoth/ (memory.db, trajectories/, intelligence/, daemon.pid)
- Config: ~/.mcp.json (MCP server), ~/.claude/settings.json (hooks)
