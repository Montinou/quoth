# Quoth Plugin Architecture (v3.2.0)

## Directory Structure

```
quoth-plugin/
├── .claude-plugin/
│   ├── plugin.json              — Plugin manifest v3.2.0
│   └── hooks/
│       └── hooks.json           — Hook declarations for plugin system
├── .mcp.json                    — Local MCP server config for development
├── daemon/
│   ├── daemon.js                — Background trajectory processor (main loop, file watcher, timers)
│   ├── db.js                    — SQLite database: schema, CRUD, HNSW init, all query methods
│   ├── lib/
│   │   ├── attribute.js         — Decision attribution via Claude Haiku 4.5
│   │   ├── embed.js             — voyage-4-lite embeddings via Vercel AI Gateway
│   │   ├── hnsw.js              — Pure JS HNSW approximate nearest neighbor index
│   │   ├── llm.js               — Kimi K2.5 via Moonshot OpenAI-compat API
│   │   ├── mutate.js            — Mutation generation for test verification
│   │   ├── promote.js           — Cloud promotion via Quoth REST API
│   │   └── skill-extract.js     — Skill extraction via Claude Sonnet 4.6
│   └── pipeline/
│       ├── judge.js             — Trajectory effectiveness evaluation (Kimi K2.5)
│       ├── distill.js           — Pattern extraction from trajectories (Kimi K2.5 + embeddings)
│       └── consolidate.js       — Merge-or-new decision for patterns (Claude Haiku 4.5)
├── hooks/
│   ├── hook-dispatch.js         — Unified dispatcher for all hook events (8 commands)
│   ├── trajectory-capture.js    — PostToolUse JSONL logger (separate from dispatcher)
│   └── hooks.json               — Hook manifest with matchers and timeouts
├── mcp/
│   ├── quoth-learning-server.js — MCP stdio JSON-RPC protocol handler (~57 lines)
│   ├── handlers/
│   │   ├── index.js             — Tool aggregator + dispatch map (ALL_TOOLS array, dispatch function)
│   │   ├── patterns.js          — 8 pattern management tools
│   │   ├── intelligence.js      — 6 intelligence graph tools
│   │   ├── agents.js            — 6 agent coordination tools
│   │   └── skills.js            — 2 skill extraction tools
│   └── lib/
│       ├── graph.js             — PageRank, trigram generation, Jaccard similarity, edge building
│       └── routing.js           — Task-to-agent routing engine (keyword patterns + alternatives)
├── agents/                      — Plugin agent definitions (quoth:learner)
├── lib/                         — Shared utilities
├── skills/                      — Extracted skills storage
├── scripts/
│   └── setup.sh                 — Automated installation (symlinks, settings.json injection)
├── tests/
│   ├── attribute.test.js        — Attribution pipeline tests
│   ├── consolidate.test.js      — Consolidation pipeline tests
│   ├── db.test.js               — Database CRUD and query tests
│   ├── distill.test.js          — Distillation pipeline tests
│   ├── integration.test.js      — End-to-end integration tests
│   ├── judge.test.js            — Judge pipeline tests
│   ├── mutate.test.js           — Mutation generation tests
│   ├── promote.test.js          — Cloud promotion tests
│   └── skill-extract.test.js    — Skill extraction tests
├── vitest.config.js             — Test configuration
├── package.json                 — Dependencies: better-sqlite3, vitest
└── package-lock.json
```

---

## Module Dependency Graph

### Layer 1: MCP Server (Entry Point)

```
quoth-learning-server.js
  ├── handlers/index.js          (ALL_TOOLS, dispatch)
  │   ├── handlers/patterns.js   (8 tools)
  │   ├── handlers/intelligence.js (6 tools)
  │   ├── handlers/agents.js     (6 tools)
  │   └── handlers/skills.js     (2 tools)
  └── daemon/db.js               (lazy-loaded via getDb())
```

The MCP server (`quoth-learning-server.js`) is a minimal 57-line stdio handler. It:
1. Reads JSON-RPC messages from stdin line-by-line.
2. Handles `initialize`, `tools/list`, and `tools/call` methods.
3. Delegates tool calls to `handlers/index.js` which dispatches to the correct handler module.
4. Lazy-loads the SQLite database only when a tool call requires it.

### Layer 2: Handlers

```
handlers/patterns.js
  ├── daemon/db.js               (pattern CRUD, search, scoring)
  ├── daemon/lib/embed.js        (embedding generation for search)
  └── daemon/lib/promote.js      (cloud promotion)

handlers/intelligence.js
  ├── mcp/lib/graph.js           (PageRank computation, trigrams, Jaccard)
  ├── mcp/lib/routing.js         (task routing engine)
  └── daemon/db.js               (pattern queries for context injection)

handlers/agents.js
  └── daemon/db.js               (agent registry CRUD, heartbeat, task assignment)

handlers/skills.js
  ├── daemon/lib/skill-extract.js (Sonnet 4.6 extraction)
  └── daemon/db.js               (skill storage)
```

Each handler module exports:
- `TOOLS` — Array of MCP tool definitions (name, description, inputSchema).
- `handle(name, args, db)` — Async function that executes the tool and returns a result object.

### Layer 3: Hooks (Direct Require, No MCP Roundtrip)

```
hook-dispatch.js
  ├── mcp/handlers/intelligence.js  (direct require for graph operations)
  ├── daemon/db.js                  (direct require for pattern queries)
  └── child_process (git remote)    (project identification)

trajectory-capture.js
  └── fs                            (JSONL append to ~/.quoth/trajectories/)
```

Hooks bypass the MCP server entirely. They `require()` handler modules and `db.js` directly for zero-latency access. This is critical because hooks have strict timeouts (2000-15000ms) and cannot afford MCP JSON-RPC roundtrip overhead.

The `hook-dispatch.js` resolves the real plugin path via `fs.realpathSync(__dirname)` to handle symlink deployment (hooks are symlinked from `~/.quoth/hooks/` to the source tree).

### Layer 4: Daemon (Background Process)

```
daemon.js
  ├── daemon/db.js               (database access + HNSW init)
  ├── pipeline/judge.js
  │   └── daemon/lib/llm.js      (Kimi K2.5)
  ├── pipeline/distill.js
  │   ├── daemon/lib/llm.js      (Kimi K2.5)
  │   └── daemon/lib/embed.js    (voyage-4-lite)
  ├── pipeline/consolidate.js
  │   ├── daemon/lib/llm.js      (Haiku 4.5)
  │   └── daemon/lib/embed.js    (embedding comparison)
  └── daemon/lib/promote.js      (cloud sync)
```

The daemon is a long-lived Node.js process with:
- **File watcher** on `~/.quoth/trajectories/` for new JSONL files.
- **Job queue** with deduplication (tracks enqueued keys to prevent duplicate processing).
- **Processing lock** (`~/.quoth/processing.lock`) to prevent concurrent pipeline runs.
- **Scheduled timers** for: confidence decay, deep consolidation (3am nightly), HNSW persistence, agent cleanup.
- **Self-healing** via `uncaughtException` handler that logs but does not crash.
- **Signal handling:** SIGTERM for graceful shutdown, SIGUSR1 for forced flush.

---

## Plugin Manifest (plugin.json)

```json
{
  "name": "quoth",
  "version": "3.2.0",
  "description": "Universal self-learning and agent coordination for Claude Code...",
  "author": { "name": "Montino", "url": "https://github.com/Montinou/quoth" },
  "homepage": "https://github.com/Montinou/quoth",
  "keywords": ["self-learning", "patterns", "memory", "agents", "coordination"],
  "mcpServers": { ... },
  "hooks": "./hooks/hooks.json",
  "commands": "./commands/",
  "agents": "./agents/",
  "userConfig": { "QUOTH_API_KEY": { ... } }
}
```

### Field Reference

| Field | Purpose |
|-------|---------|
| `name` | Plugin identifier used for namespacing commands and agents (`quoth:*`) |
| `version` | Semantic version, currently 3.2.0. Independent from the SaaS package version (3.0.0) |
| `description` | Human-readable summary shown in plugin listings |
| `author` | Attribution metadata |
| `homepage` | GitHub repository URL |
| `keywords` | Discovery tags for plugin search |
| `mcpServers` | Declares the `quoth-learning` MCP server. Uses `${CLAUDE_PLUGIN_ROOT}` variable to resolve the path relative to `.claude-plugin/`. The command is `node` with the server JS file as argument |
| `hooks` | Relative path to the hook declarations file (`hooks/hooks.json`). Defines all 8 hook events with their matchers, commands, and timeouts |
| `commands` | Directory containing slash commands (`/quoth:patterns`, `/quoth:learn`) |
| `agents` | Directory containing agent definitions (`quoth:learner` — a Haiku-based trajectory reviewer) |
| `userConfig` | Optional user-configurable settings. `QUOTH_API_KEY` is a sensitive string for cloud pattern sync (qth_* format) |

---

## Hook Event Map

All hooks are defined in `hooks/hooks.json`. The dispatcher and trajectory capture are separate files for separation of concerns.

| Hook Event | Matcher | Handler | Timeout | Command |
|-----------|---------|---------|---------|---------|
| `PreToolUse` | `Bash` | `hook-dispatch.js pre-bash` | 2000ms | Block dangerous commands (rm -rf /, fork bombs) |
| `PostToolUse` | `Bash\|Write\|Edit\|MultiEdit\|Agent` | `trajectory-capture.js` | 3000ms | Append JSONL line to trajectory file |
| `PostToolUse` | `Write\|Edit\|MultiEdit` | `hook-dispatch.js post-edit` | 2000ms | Record file edit in intelligence graph |
| `UserPromptSubmit` | (all) | `hook-dispatch.js route` | 3000ms | Route task to optimal agent, show relevant patterns |
| `SessionStart` | (all) | `hook-dispatch.js session-restore` | 15000ms | Init intelligence graph, inject top 3 patterns (>= 0.6 confidence) |
| `SessionEnd` | (all) | `hook-dispatch.js session-end` | 10000ms | Consolidate intelligence graph, recompute PageRank |
| `PreCompact` | (all) | `hook-dispatch.js session-end` | 6000ms | Same as SessionEnd (runs before context window compression) |
| `SubagentStart` | (all) | `hook-dispatch.js subagent-start` | 3000ms | Inject domain-relevant patterns into subagent additionalContext |
| `SubagentStop` | (all) | `hook-dispatch.js post-task` | 5000ms | Implicit positive Bayesian feedback on matched patterns |

Note: `PostToolUse` has two separate entries. For Write/Edit/MultiEdit, both `trajectory-capture.js` and `hook-dispatch.js post-edit` fire. For Bash and Agent, only `trajectory-capture.js` fires.

---

## MCP Tools (22 Total)

### Pattern Tools (8) — `handlers/patterns.js`

| Tool | Description |
|------|------------|
| `quoth_log_outcome` | Record success/failure for a pattern (Bayesian update) |
| `quoth_score_pattern` | Get confidence score for a specific pattern |
| `quoth_top_patterns` | List highest-confidence patterns (optional project filter) |
| `quoth_search_patterns` | Semantic search via embedding + cosine similarity (HNSW) |
| `quoth_project_patterns` | Get all patterns for a specific project |
| `quoth_promote_global` | Promote a local pattern to cloud storage |
| `quoth_seed_from_exolar` | Seed patterns from an external source (Exolar format) |
| `quoth_propose_update` | Propose a modification to an existing pattern |

### Intelligence Tools (6) — `handlers/intelligence.js`

| Tool | Description |
|------|------------|
| `quoth_route_task` | Route a task description to the optimal agent type |
| `quoth_intelligence_init` | Initialize the in-memory intelligence graph for a project |
| `quoth_intelligence_context` | Get intelligence context (relevant patterns, graph state) for a query |
| `quoth_intelligence_consolidate` | Trigger graph consolidation and PageRank recomputation |
| `quoth_intelligence_stats` | Get intelligence graph statistics (nodes, edges, PageRank distribution) |
| `quoth_intelligence_feedback` | Record positive/negative feedback for intelligence routing |

### Agent Tools (6) — `handlers/agents.js`

| Tool | Description |
|------|------------|
| `quoth_daemon_status` | Check daemon health (PID, uptime, queue depth) |
| `quoth_ingest_trajectory` | Manually trigger trajectory ingestion for a file |
| `quoth_agent_register` | Register an agent in the local registry |
| `quoth_agent_heartbeat` | Update agent last-seen timestamp |
| `quoth_agent_list` | List all registered agents with status |
| `quoth_assign_task` | Assign a task to a specific agent |

### Skill Tools (2) — `handlers/skills.js`

| Tool | Description |
|------|------------|
| `quoth_extract_skill` | Extract a reusable skill from a pattern using Claude Sonnet 4.6 |
| `quoth_list_skills` | List all extracted skills |

---

## SQLite Database Schema (daemon/db.js)

The database uses WAL mode, normal synchronous, and foreign keys enabled.

### Tables

**patterns** — Core learned knowledge
```sql
id TEXT PRIMARY KEY
name TEXT NOT NULL
pattern_type TEXT DEFAULT 'code-pattern'
condition TEXT NOT NULL          -- when to apply
action TEXT NOT NULL             -- what to do
description TEXT
confidence REAL DEFAULT 0.5     -- Bayesian Beta(alpha, beta) → mean
success_count INTEGER DEFAULT 0 -- Beta alpha parameter
failure_count INTEGER DEFAULT 0 -- Beta beta parameter
decay_rate REAL DEFAULT 0.005   -- weekly confidence decay
embedding TEXT                  -- JSON-serialized 1024-dim float array
version INTEGER DEFAULT 1       -- incremented on merge
tags TEXT DEFAULT '[]'           -- JSON array of strings
source TEXT DEFAULT 'distilled' -- distilled|exolar-seeded|healer-learned|attributed|skill-derived
status TEXT DEFAULT 'active'    -- active|archived|merged
created_at INTEGER              -- epoch ms
updated_at INTEGER              -- epoch ms
last_matched_at INTEGER         -- epoch ms, null if never matched
```

**trajectories** — Processing tracking
```sql
id TEXT PRIMARY KEY
session_id TEXT
status TEXT DEFAULT 'active'    -- active|processed|failed
verdict TEXT                    -- effective|partially-effective|ineffective (set by judge)
task TEXT                       -- extracted task description
context TEXT                    -- project context
total_steps INTEGER DEFAULT 0
total_reward REAL DEFAULT 0
started_at INTEGER
ended_at INTEGER
extracted_pattern_id TEXT REFERENCES patterns(id)
```

**trajectory_steps** — Individual tool calls within a trajectory
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
trajectory_id TEXT REFERENCES trajectories(id)
step_number INTEGER NOT NULL
action TEXT NOT NULL             -- tool name + summary
observation TEXT                 -- tool output summary
reward REAL DEFAULT 0
metadata TEXT                   -- JSON
created_at INTEGER
```

**memory_entries** — Key-value semantic memory
```sql
id TEXT PRIMARY KEY
key TEXT NOT NULL
namespace TEXT DEFAULT 'default'
content TEXT NOT NULL
type TEXT DEFAULT 'semantic'
tags TEXT                       -- JSON array
metadata TEXT                   -- JSON
access_count INTEGER DEFAULT 0
status TEXT DEFAULT 'active'
created_at INTEGER
updated_at INTEGER
last_accessed_at INTEGER
UNIQUE(namespace, key)
```

**agent_registry** — Local agent tracking
```sql
agent_id TEXT PRIMARY KEY
name TEXT NOT NULL
type TEXT NOT NULL
project TEXT
platform TEXT
...
```

---

## Intelligence Graph (mcp/lib/graph.js)

The intelligence module maintains an in-memory directed graph for ranking concepts by importance within a project context.

### Core Algorithms

**Tokenization:** Text is lowercased, non-alphanumeric characters removed, stop words filtered (100+ common English words), and tokens must be >2 characters.

**Trigram Generation:** Each token is decomposed into character trigrams for fuzzy matching. For example, "pattern" produces: "pat", "att", "tte", "ter", "ern".

**Jaccard Similarity:** Set intersection over set union of trigram sets. Used to compare query-to-pattern similarity without requiring embeddings.

**PageRank:** Iterative computation with configurable damping factor (default 0.85) and max iterations (default 30). Operates over the graph where:
- **Nodes** represent files, concepts, patterns, and agent types.
- **Edges** represent relationships (file-imports-file, pattern-applies-to-file, agent-produces-output).
- **Weights** on edges influence rank propagation.

### Task Routing (mcp/lib/routing.js)

Routes tasks to one of 8 agent types using regex pattern matching:

| Pattern | Agent Type | Capabilities |
|---------|-----------|-------------|
| `implement\|create\|build\|add\|write code` | coder | code-generation, refactoring, debugging, implementation |
| `test\|spec\|coverage\|unit test\|integration` | tester | unit-testing, integration-testing, coverage, test-generation |
| `review\|audit\|check\|validate\|security` | reviewer | code-review, security-audit, quality-check, best-practices |
| `research\|find\|search\|documentation\|explore` | researcher | web-search, documentation, analysis, summarization |
| `design\|architect\|structure\|plan` | architect | system-design, architecture, patterns, scalability |
| `api\|endpoint\|server\|backend\|database` | backend-dev | api, database, server, authentication |
| `ui\|frontend\|component\|react\|css\|style` | frontend-dev | ui, react, css, components |
| `deploy\|docker\|ci\|cd\|pipeline\|infrastructure` | devops | ci-cd, docker, deployment, infrastructure |

Default fallback: `coder` at 0.5 confidence when no pattern matches.

---

## Daemon Pipeline Detail

### Processing Flow

```
JSONL file detected (fs.watch)
  |
  v
scanAndEnqueue() — read unprocessed lines, deduplicate, add to jobQueue
  |
  v
processQueue() — acquire processing.lock, process entries sequentially
  |
  v
For each trajectory batch:
  |
  ├── JUDGE (judge.js)
  │   Input: trajectory steps (tool calls + outputs)
  │   LLM: Kimi K2.5 via Moonshot API
  │   Output: verdict (effective / partially-effective / ineffective)
  │   Gate: only "effective" proceeds to distill
  │
  ├── DISTILL (distill.js)
  │   Input: effective trajectory + project context
  │   LLM: Kimi K2.5 + voyage-4-lite embeddings
  │   Output: { name, condition, action, description, tags, embedding }
  │
  └── CONSOLIDATE (consolidate.js)
      Input: distilled pattern + existing patterns (via HNSW similarity search)
      LLM: Claude Haiku 4.5
      Decision: MERGE (update existing) or NEW (insert fresh)
      Output: stored/updated pattern in SQLite + HNSW index
```

### Scheduled Timers

| Timer | Interval | Action |
|-------|----------|--------|
| Confidence decay | Weekly | Reduce confidence of unmatched patterns by decay_rate |
| Deep consolidation | Nightly (3am) | Re-scan all patterns, merge near-duplicates, promote to cloud |
| HNSW save | Periodic | Persist in-memory HNSW index to disk |
| Agent cleanup | Periodic | Remove stale agent registrations |

---

## Deployment Model

### Installation (setup.sh)

The setup script performs:

1. Creates `~/.quoth/` directory structure (trajectories/, intelligence/, hooks/).
2. Symlinks hook files from `quoth-plugin/hooks/` into `~/.quoth/hooks/`.
3. Injects hook declarations into `~/.claude/settings.json` (creates backup first).
4. Adds necessary permissions for the MCP server.
5. Installs npm dependencies in `quoth-plugin/`.

The script is idempotent and safe to re-run.

### Runtime Paths

| Path | Purpose |
|------|---------|
| `~/.quoth/memory.db` | SQLite database (patterns, trajectories, agents, memory) |
| `~/.quoth/trajectories/` | JSONL trajectory files, named `{repo-name}-{date}.jsonl` |
| `~/.quoth/intelligence/` | Intelligence graph state files |
| `~/.quoth/daemon.pid` | Daemon PID file |
| `~/.quoth/daemon.log` | Daemon structured JSON log |
| `~/.quoth/processing.lock` | Pipeline processing lock (PID-based) |
| `~/.quoth/hooks/` | Symlinks to quoth-plugin source hooks |

### Dependencies

Production: `better-sqlite3` (native SQLite binding with N-API).
Development: `vitest` (test runner), `@types/better-sqlite3` (TypeScript definitions for IDE support).

No build step required. All source is plain CommonJS JavaScript.
