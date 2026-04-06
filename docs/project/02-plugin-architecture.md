The arch doc isn't in the repo — it's a standalone doc the user is editing externally. Based on the source change (adding `MultiEdit` to two `PostToolUse` matchers), here is the complete updated document:

---

# Quoth Plugin Architecture (v3.2.0)

> Version: 1.0.1 | Last updated: 2026-04-06

## Directory Structure

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
├── context/
│   ├── project-summary.md       — Generic quoth project context (injected at SessionStart for quoth project)
│   └── quoth.md                 — Project-specific context injected for the quoth repo
├── lib/                         — Shared utilities
├── skills/                      — Built-in skill definitions (synced to skill-registry via setup.sh)
│   ├── quoth-genesis/SKILL.md   — Deep codebase analyzer + docs generator
│   ├── learn/SKILL.md           — Manual pattern consolidation trigger
│   ├── patterns/SKILL.md        — Browse confidence-scored pattern library
│   ├── quoth-help/SKILL.md      — Plugin documentation + troubleshooting
│   └── quoth-init/SKILL.md      — Initialize project-local Quoth memory structure
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
hook-dispatch.js  [matcher: event-specific, see table below]
  ├── mcp/handlers/intelligence.js  (direct require for graph operations)
  ├── daemon/db.js                  (direct require for pattern queries)
  └── child_process (git remote)    (project identification)

trajectory-capture.js  [matcher: Bash|Write|Edit|MultiEdit|Agent]
  └── fs                            (JSONL append to ~/.quoth/trajectories/)
```

Hooks bypass the MCP roundtrip and `require()` handler modules directly. All hooks except `trajectory-capture.js` route through `hook-dispatch.js`.

#### Hook Matchers Reference

| Event | Matcher | Command | Timeout |
|-------|---------|---------|---------|
| `PreToolUse` | `Bash` | `pre-bash` | 2 000 ms |
| `PostToolUse` | `Bash\|Write\|Edit\|MultiEdit\|Agent` | trajectory-capture | 3 000 ms |
| `PostToolUse` | `Write\|Edit\|MultiEdit` | `post-edit` | 2 000 ms |
| `UserPromptSubmit` | _(all)_ | `route` | 3 000 ms |
| `SessionStart` | _(all)_ | `session-restore` | 15 000 ms |
| `SessionEnd` | _(all)_ | `session-end` | 10 000 ms |
| `PreCompact` | _(all)_ | `session-end` | 6 000 ms |
| `SubagentStart` | _(all)_ | `subagent-start` | 3 000 ms |
| `SubagentStop` | _(all)_ | `post-task` | 5 000 ms |
