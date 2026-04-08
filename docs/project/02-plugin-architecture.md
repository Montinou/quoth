# Quoth Plugin Architecture (v3.3.0)

> Version: 1.0.1 | Last updated: 2026-04-06

## Directory Structure

quoth-plugin/
├── .claude-plugin/
│   ├── plugin.json              — Plugin manifest v3.3.0
│   ├── agents/
│   │   └── learner.md           — quoth:learner agent definition (Haiku trajectory reviewer)
│   ├── commands/
│   │   ├── learn.md             — /quoth:learn command
│   │   └── patterns.md          — /quoth:patterns command
│   └── hooks/
│       └── hooks.json           — Hook declarations for plugin system
├── .mcp.json                    — Local MCP server config for development
├── daemon/
│   ├── daemon.js                — Background trajectory processor (main loop, file watcher, timers, V2 subsystems)
│   ├── db.js                    — SQLite database: schema, CRUD, HNSW init, V2 migrations, all query methods
│   ├── lib/
│   │   ├── attribute.js         — Decision attribution via Claude Haiku 4.5 CLI
│   │   ├── attribution.js       — Attribution tracking utilities
│   │   ├── bandit-v2.js         — V2 hierarchical Thompson sampling (multi-armed bandit)
│   │   ├── clustering.js        — V2 pattern clustering (k-means over embeddings)
│   │   ├── curation.js          — V2 quality gates: distinctiveness, dedup, retirement
│   │   ├── doc-chunks.js        — Document chunking for doc auto-updater
│   │   ├── doc-manifest.js      — Doc manifest scanning and hash tracking
│   │   ├── doc-update-api.js    — Cloud doc update API client (managed mode)
│   │   ├── doc-updater.js       — Local doc auto-updater (Sonnet 4.6 CLI)
│   │   ├── embed.js             — Local MiniLM-L6-v2 embeddings via @xenova/transformers (384d, ONNX)
│   │   ├── flags.js             — V2 feature flags (injection, judge, curation)
│   │   ├── hnsw.js              — Pure JS HNSW approximate nearest neighbor index (384d)
│   │   ├── injection.js         — Trigram-based pattern injection and matching
│   │   ├── judge.js             — V2 LLM-as-judge pairwise pair selection (uncertainty sampling)
│   │   ├── llm.js               — Daemon LLM calls: gemini-2.5-flash-lite via AI Gateway (Moonshot fallback)
│   │   ├── mutate.js            — Mutation generation for test verification
│   │   ├── pattern-cache.js     — In-memory pattern cache with TTL
│   │   ├── pipeline-api.js      — Cloud pipeline API client (managed mode)
│   │   ├── promote.js           — Cloud promotion via Quoth REST API
│   │   ├── propensity.js        — V2 propensity scoring for pattern injection
│   │   ├── pull.js              — Cloud pull sync + shared cross-org patterns
│   │   ├── query-server.js      — Unix socket query server (daemon.sock)
│   │   ├── sampler.js           — V2 Thompson sampling for pattern selection
│   │   ├── scoring.js           — V2 composite scoring (Bayesian + PageRank + recency)
│   │   ├── skill-extract.js     — Skill extraction via Claude Sonnet 4.6 CLI
│   │   └── snips.js             — V2 SNIPS cluster posterior updates
│   └── pipeline/
│       ├── judge.js             — Trajectory effectiveness evaluation (gemini-2.5-flash-lite via callLLM)
│       ├── distill.js           — Per-entry pattern extraction (gemini-2.5-flash-lite via callLLM, fallback path)
│       ├── distill-batch.js     — Session-level batch distillation (Claude Haiku 4.5 CLI, primary path)
│       └── consolidate.js       — Merge-or-new decision for patterns (Claude Haiku 4.5 CLI)
├── hooks/
│   ├── hook-dispatch.js         — Unified dispatcher for all hook events (8 commands)
│   ├── trajectory-capture.js    — PostToolUse JSONL logger (separate from dispatcher)
│   ├── session-memory.js        — In-session topic/file tracking (used by hook-dispatch for context)
│   └── hooks.json               — Hook manifest with matchers and timeouts
├── mcp/
│   ├── quoth-learning-server.js — MCP stdio JSON-RPC protocol handler (~55 lines)
│   ├── handlers/
│   │   ├── index.js             — Tool aggregator + dispatch map (ALL_TOOLS array, dispatch function)
│   │   ├── patterns.js          — 8 pattern management tools
│   │   ├── intelligence.js      — 6 intelligence graph tools
│   │   ├── agents.js            — 6 agent coordination tools
│   │   └── skills.js            — 2 skill extraction tools
│   └── lib/
│       ├── graph.js             — PageRank, trigram generation, Jaccard similarity, edge building
│       └── routing.js           — Task-to-agent routing engine (~26 keyword patterns + alternatives)
├── context/
│   ├── project-summary.md       — Generic quoth project context (injected at SessionStart for quoth project)
│   └── quoth.md                 — Project-specific context injected for the quoth repo
├── lib/
│   ├── config-schema.sh         — Configuration schema validation
│   └── memory-schema.sh         — Memory schema validation
├── skills/                      — Built-in skill definitions (9 skills)
│   ├── bayesian-confidence/     — Bayesian confidence scoring guide
│   ├── contextual-bandits/      — Contextual bandit pattern selection
│   ├── knowledge-base-curation/ — Knowledge base curation workflow
│   ├── learn/                   — Manual pattern consolidation trigger
│   ├── llm-as-judge/            — LLM-as-judge pairwise evaluation
│   ├── patterns/                — Browse confidence-scored pattern library
│   ├── quoth-genesis/           — Deep codebase analyzer + docs generator
│   ├── quoth-help/              — Plugin documentation + troubleshooting
│   └── quoth-init/              — Initialize project-local Quoth memory structure
├── scripts/
│   ├── cli.js                   — Interactive onboarding CLI (init, status, restart)
│   ├── setup.sh                 — Non-interactive installation (symlinks, settings.json injection)
│   ├── ab-compare.js            — A/B comparison utility for patterns
│   ├── backfill-embeddings.js   — Backfill missing embeddings on existing patterns
│   ├── cleanup-patterns.js      — Manual pattern cleanup utility
│   ├── migrate-v2-quality.js    — V2 quality column migration
│   └── run-nightly-now.js       — Force-run nightly pipeline immediately
├── tests/                       — 33 test files (vitest)
│   ├── attribute.test.js, attribution.test.js, bandit-v2.test.js, clustering-v2.test.js,
│   │   clustering.test.js, consolidate.test.js, curation.test.js, db.test.js, distill.test.js,
│   │   doc-update-api.test.js, embed-batch.test.js, flags.test.js, injection-log.test.js,
│   │   injection.test.js, integration.test.js, judge-v2.test.js, judge.test.js, mutate.test.js,
│   │   pattern-cache.test.js, pipeline-api.test.js, promote.test.js, propensity.test.js,
│   │   routing-v2.test.js, sampler.test.js, schema-v2.test.js, scoring.test.js,
│   │   session-memory.test.js, shared-pull.test.js, skill-extract.test.js, snips.test.js,
│   │   trigram-backfill.test.js
│   └── auto-memory-lifecycle.sh, memory-v2-integration.sh  — Shell integration tests
├── vitest.config.js             — Test configuration
├── package.json                 — Dependencies: better-sqlite3, @xenova/transformers, vitest
└── package-lock.json

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

The MCP server (`quoth-learning-server.js`) is a minimal ~55-line stdio handler. It:
1. Reads JSON-RPC messages from stdin line-by-line.
2. Handles `initialize`, `tools/list`, and `tools/call` methods.
3. Delegates tool calls to `handlers/index.js` which dispatches to the correct handler module.
4. Lazy-loads the SQLite database only when a tool call requires it.

### Layer 2: Handlers

```
handlers/patterns.js
  ├── daemon/db.js               (pattern CRUD, search, scoring)
  ├── daemon/lib/embed.js        (local MiniLM-L6-v2 embedding generation for search)
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
  ├── hooks/session-memory.js       (in-session topic/file tracking)
  ├── daemon/lib/query-server.js    (Unix socket client for daemon queries)
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
