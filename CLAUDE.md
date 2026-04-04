# Claude Code Configuration - RuFlo V3

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

## File Organization

- NEVER save to root folder — use the directories below
- Use `/src` for source code files
- Use `/tests` for test files
- Use `/docs` for documentation and markdown files
- Use `/config` for configuration files
- Use `/scripts` for utility scripts
- Use `/examples` for example code

## Project Architecture

- Follow Domain-Driven Design with bounded contexts
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Use event sourcing for state changes
- Ensure input validation at system boundaries

### Project Config

- **Topology**: hierarchical-mesh
- **Max Agents**: 15
- **Memory**: hybrid
- **HNSW**: Enabled
- **Neural**: Enabled

## Build & Test

```bash
# Build
npm run build

# Test
npm test

# Lint
npm run lint
```

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing

## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries
- Always sanitize file paths to prevent directory traversal
- Run `npx @claude-flow/cli@latest security scan` after security-related changes

## Concurrency: 1 MESSAGE = ALL RELATED OPERATIONS

- All operations MUST be concurrent/parallel in a single message
- Use Claude Code's Task tool for spawning agents, not just MCP
- ALWAYS batch ALL todos in ONE TodoWrite call (5-10+ minimum)
- ALWAYS spawn ALL agents in ONE message with full instructions via Task tool
- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL Bash commands in ONE message

## Swarm Orchestration

- MUST initialize the swarm using CLI tools when starting complex tasks
- MUST spawn concurrent agents using Claude Code's Task tool
- Never use CLI tools alone for execution — Task tool agents do the actual work
- MUST call CLI tools AND Task tool in ONE message for complex work

### 3-Tier Model Routing (ADR-026)

| Tier | Handler | Latency | Cost | Use Cases |
|------|---------|---------|------|-----------|
| **1** | Agent Booster (WASM) | <1ms | $0 | Simple transforms (var→const, add types) — Skip LLM |
| **2** | Haiku | ~500ms | $0.0002 | Simple tasks, low complexity (<30%) |
| **3** | Sonnet/Opus | 2-5s | $0.003-0.015 | Complex reasoning, architecture, security (>30%) |

- Always check for `[AGENT_BOOSTER_AVAILABLE]` or `[TASK_MODEL_RECOMMENDATION]` before spawning agents
- Use Edit tool directly when `[AGENT_BOOSTER_AVAILABLE]`

## Swarm Configuration & Anti-Drift

- ALWAYS use hierarchical topology for coding swarms
- Keep maxAgents at 6-8 for tight coordination
- Use specialized strategy for clear role boundaries
- Use `raft` consensus for hive-mind (leader maintains authoritative state)
- Run frequent checkpoints via `post-task` hooks
- Keep shared memory namespace for all agents

```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

## Swarm Execution Rules

- ALWAYS use `run_in_background: true` for all agent Task calls
- ALWAYS put ALL agent Task calls in ONE message for parallel execution
- After spawning, STOP — do NOT add more tool calls or check status
- Never poll TaskOutput or check swarm status — trust agents to return
- When agent results arrive, review ALL results before proceeding

## V3 CLI Commands

### Core Commands

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `init` | 4 | Project initialization |
| `agent` | 8 | Agent lifecycle management |
| `swarm` | 6 | Multi-agent swarm coordination |
| `memory` | 11 | AgentDB memory with HNSW search |
| `task` | 6 | Task creation and lifecycle |
| `session` | 7 | Session state management |
| `hooks` | 17 | Self-learning hooks + 12 workers |
| `hive-mind` | 6 | Byzantine fault-tolerant consensus |

### Quick CLI Examples

```bash
npx @claude-flow/cli@latest init --wizard
npx @claude-flow/cli@latest agent spawn -t coder --name my-coder
npx @claude-flow/cli@latest swarm init --v3-mode
npx @claude-flow/cli@latest memory search --query "authentication patterns"
npx @claude-flow/cli@latest doctor --fix
```

## Available Agents (60+ Types)

### Core Development
`coder`, `reviewer`, `tester`, `planner`, `researcher`

### Specialized
`security-architect`, `security-auditor`, `memory-specialist`, `performance-engineer`

### Swarm Coordination
`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`

### GitHub & Repository
`pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

### SPARC Methodology
`sparc-coord`, `sparc-coder`, `specification`, `pseudocode`, `architecture`

## Memory Commands Reference

```bash
# Store (REQUIRED: --key, --value; OPTIONAL: --namespace, --ttl, --tags)
npx @claude-flow/cli@latest memory store --key "pattern-auth" --value "JWT with refresh" --namespace patterns

# Search (REQUIRED: --query; OPTIONAL: --namespace, --limit, --threshold)
npx @claude-flow/cli@latest memory search --query "authentication patterns"

# List (OPTIONAL: --namespace, --limit)
npx @claude-flow/cli@latest memory list --namespace patterns --limit 10

# Retrieve (REQUIRED: --key; OPTIONAL: --namespace)
npx @claude-flow/cli@latest memory retrieve --key "pattern-auth" --namespace patterns
```

## Quick Setup

```bash
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest
npx @claude-flow/cli@latest daemon start
npx @claude-flow/cli@latest doctor --fix
```

## Claude Code vs CLI Tools

- Claude Code's Task tool handles ALL execution: agents, file ops, code generation, git
- CLI tools handle coordination via Bash: swarm init, memory, hooks, routing
- NEVER use CLI tools as a substitute for Task tool agents

## Support

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues

## Quoth Plugin v3.1.0 (Self-Learning)

Located at `quoth-plugin/`. A standalone Claude Code plugin providing autonomous self-learning, intelligence routing, and agent coordination. Modular architecture: 4 handler modules, 22 MCP tools.

### Setup
```bash
bash quoth-plugin/scripts/setup.sh
```
This symlinks hooks to `~/.quoth/hooks/`, injects hook declarations into `~/.claude/settings.json`, and adds permissions. Idempotent — safe to re-run.

### What It Does
- Logs all agent trajectories to `~/.quoth/trajectories/{session}.jsonl`
- Background daemon processes trajectories using Haiku subagents (JUDGE → DISTILL → CONSOLIDATE)
- Maintains confidence-scored pattern library in `~/.quoth/memory.db`
- Injects top patterns into every agent's context at session start (token-optimized, ~200 tokens)
- Routes tasks to optimal agents using keyword matching + PageRank intelligence
- RL annotations on MCP tool outputs with pattern confidence scores

### Daemon
- Auto-starts via `session-start` hook
- PID: `~/.quoth/daemon.pid`, Log: `~/.quoth/daemon.log`
- Debug: `QUOTH_DEBUG=true`
- Nightly promotion: high-confidence patterns (>0.8, >10 uses) auto-promote to Quoth cloud at 3am
- Re-promotion only when confidence improves by >0.1 since last upload
- Env vars: `QUOTH_API_KEY` (qth_* key), `QUOTH_PROJECT_ID`, `QUOTH_API_URL` (optional, defaults to quoth.triqual.dev)
- Bayesian confidence scoring: Beta(alpha, beta) distribution replaces simple +/-
- Decision Attribution: tracks which patterns caused success/failure outcomes
- Source tagging: distilled, exolar-seeded, healer-learned, attributed, skill-derived

### MCP Tools (22 total via quoth-learning server)

**Patterns (8):** `quoth_log_outcome`, `quoth_score_pattern`, `quoth_top_patterns`, `quoth_search_patterns`, `quoth_project_patterns`, `quoth_promote_global`, `quoth_seed_from_exolar`, `quoth_propose_update`

**Agents (6):** `quoth_daemon_status`, `quoth_ingest_trajectory`, `quoth_agent_register`, `quoth_agent_heartbeat`, `quoth_agent_list`, `quoth_assign_task`

**Intelligence (6):** `quoth_route_task`, `quoth_intelligence_init`, `quoth_intelligence_context`, `quoth_intelligence_consolidate`, `quoth_intelligence_stats`, `quoth_intelligence_feedback`

**Skills (2):** `quoth_extract_skill`, `quoth_list_skills`

### Hooks (via hook-dispatch.js)
- `UserPromptSubmit` → route task to optimal agent
- `SessionStart` → init intelligence graph + inject patterns
- `SessionEnd` / `PreCompact` → consolidate intelligence
- `PostToolUse (Write|Edit)` → record edit for intelligence
- `PostToolUse (Bash|Write|Edit|Agent)` → trajectory capture
- `SubagentStop` → implicit success feedback
- `PreToolUse (Bash)` → command safety check

### Plugin System (.claude-plugin/)
- `plugin.json` — manifest with MCP server, hooks, commands, agents
- `/quoth:patterns` — browse confidence-scored pattern library
- `/quoth:learn` — trigger manual consolidation
- `quoth:learner` — Haiku agent for trajectory review

### Architecture
```
mcp/quoth-learning-server.js  — MCP protocol (~55 lines)
mcp/handlers/                 — patterns.js, agents.js, intelligence.js, skills.js, index.js
mcp/lib/                      — graph.js (PageRank), routing.js (task routing)
hooks/                        — hook-dispatch.js, inject-patterns.js, rl-annotate.js, trajectory-capture.js
daemon/                       — daemon.js, db.js (SQLite)
scripts/                      — setup.sh (automated installation)
```

### Roadmap
Future handlers (not yet implemented): browser automation, workflow engine, terminal management.
