# Configuration

*Version: 1.0.1 | Last updated: 2026-04-07*

Complete reference for all configuration files, environment variables, file paths, and setup procedures in the Quoth system.

---

## Plugin Configuration

### Global MCP Server (`~/.mcp.json`)

Registers the `quoth-learning` MCP server so Claude Code can access all 22 tools globally across all projects.

```json
{
  "mcpServers": {
    "quoth-learning": {
      "command": "node",
      "args": ["/absolute/path/to/quoth-plugin/mcp/quoth-learning-server.js"]
    }
  }
}
```

The MCP server communicates over stdio using JSON-RPC 2.0 (MCP protocol version `2024-11-05`). It lazy-loads the SQLite database only when a tool is first called.

---

### Claude Code Settings (`~/.claude/settings.json`)

The `setup.sh` script injects hook declarations and permissions into this file. Hooks use the unified dispatcher pattern -- all hooks (except trajectory capture) route through `hook-dispatch.js` with a command argument.

**Hook declarations (8 events):**

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "sh -c 'exec node \"$HOME/.quoth/hooks/hook-dispatch.js\" pre-bash'",
        "timeout": 5000
      }]
    }],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{
          "type": "command",
          "command": "sh -c 'exec node \"$HOME/.quoth/hooks/hook-dispatch.js\" post-edit'",
          "timeout": 10000
        }]
      },
      {
        "matcher": "Bash|Write|Edit|MultiEdit|Agent",
        "hooks": [{
          "type": "command",
          "command": "sh -c 'exec node \"$HOME/.quoth/hooks/trajectory-capture.js\"'",
          "timeout": 3000
        }]
      }
    ],
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "sh -c 'exec node \"$HOME/.quoth/hooks/hook-dispatch.js\" route'",
        "timeout": 10000
      }]
    }],
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "sh -c 'exec node \"$HOME/.quoth/hooks/hook-dispatch.js\" session-restore'",
        "timeout": 15000
      }]
    }],
    "SessionEnd": [{
      "hooks": [{
        "type": "command",
        "command": "sh -c 'exec node \"$HOME/.quoth/hooks/hook-dispatch.js\" session-end'",
        "timeout": 10000
      }]
    }],
    "PreCompact": [{
      "hooks": [{
        "type": "command",
        "command": "sh -c 'exec node \"$HOME/.quoth/hooks/hook-dispatch.js\" session-end'",
        "timeout": 6000
      }]
    }],
    "SubagentStart": [{
      "hooks": [{
        "type": "command",
        "command": "sh -c 'exec node \"$HOME/.quoth/hooks/hook-dispatch.js\" subagent-start'",
        "timeout": 3000
      }]
    }],
    "SubagentStop": [{
      "hooks": [{
        "type": "command",
        "command": "sh -c 'exec node \"$HOME/.quoth/hooks/hook-dispatch.js\" post-task'",
        "timeout": 5000
      }]
    }]
  }
}
```

**Hook timeout reference:**

| Event | Command | Timeout |
|-------|---------|---------|
| PreToolUse (Bash) | `pre-bash` | 5000 ms |
| PostToolUse (Write/Edit) | `post-edit` | 10000 ms |
| PostToolUse (Bash/Write/Edit/Agent) | `trajectory-capture.js` | 3000 ms |
| UserPromptSubmit | `route` | 10000 ms |
| SessionStart | `session-restore` | 15000 ms |
| SessionEnd | `session-end` | 10000 ms |
| PreCompact | `session-end` | 6000 ms |
| SubagentStart | `subagent-start` | 3000 ms |
| SubagentStop | `post-task` | 5000 ms |

**Permissions:**

```json
{
  "permissions": {
    "allow": ["Bash(node .quoth/*)"]
  }
}
```

This permission allows hook scripts in `~/.quoth/hooks/` to execute without user confirmation.

---

### Plugin Manifest (`.claude-plugin/plugin.json`)

The Claude Code plugin system manifest, declaring the MCP server, hooks, commands, agents, and user configuration.

```json
{
  "name": "quoth",
  "version": "3.2.0",
  "description": "Universal self-learning and agent coordination for Claude Code...",
  "author": {
    "name": "Montino",
    "url": "https://github.com/Montinou/quoth"
  },
  "homepage": "https://github.com/Montinou/quoth",
  "keywords": ["self-learning", "patterns", "memory", "agents", "coordination"],
  "mcpServers": {
    "quoth-learning": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/../mcp/quoth-learning-server.js"]
    }
  },
  "hooks": "./hooks/hooks.json",
  "commands": "./commands/",
  "agents": "./agents/",
  "userConfig": {
    "QUOTH_API_KEY": {
      "type": "string",
      "title": "Quoth Cloud API Key",
      "description": "Optional qth_* key for cloud pattern sync",
      "required": false,
      "sensitive": true
    }
  }
}
```

**Key details:**
- `${CLAUDE_PLUGIN_ROOT}` resolves to `.claude-plugin/` at runtime, so `../mcp/` reaches `quoth-plugin/mcp/`.
- The `userConfig` section allows users to set `QUOTH_API_KEY` through the plugin config UI.
- `hooks` points to `.claude-plugin/hooks/hooks.json` which mirrors the same 8 events as `settings.json` but uses `${CLAUDE_PLUGIN_ROOT}` variable paths.

---

### Plugin Hooks Manifest (`.claude-plugin/hooks/hooks.json`)

Declares all 8 hook events for the plugin system. Uses `${CLAUDE_PLUGIN_ROOT}` for portable paths.

| Event | Matcher | Command | Timeout |
|-------|---------|---------|---------|
| PreToolUse | `Bash` | `pre-bash` | 2000 ms |
| PostToolUse | `Bash\|Write\|Edit\|MultiEdit\|Agent` | `trajectory-capture.js` | 3000 ms |
| PostToolUse | `Write\|Edit\|MultiEdit` | `post-edit` | 2000 ms |
| UserPromptSubmit | *(all)* | `route` | 3000 ms |
| SessionStart | *(all)* | `session-restore` | 15000 ms |
| SessionEnd | *(all)* | `session-end` | 10000 ms |
| PreCompact | *(all)* | `session-end` | 6000 ms |
| SubagentStart | *(all)* | `subagent-start` | 3000 ms |
| SubagentStop | *(all)* | `post-task` | 5000 ms |

Note: The plugin hooks.json has shorter timeouts for some events compared to the `settings.json` version (e.g., PreToolUse is 2000 ms vs 5000 ms). The `settings.json` values take precedence when hooks are installed via `setup.sh`.

---

## Environment Variables

### Plugin Environment (Daemon and MCP Server)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QUOTH_HOME` | No | `~/.quoth` | Override the Quoth data directory |
| `QUOTH_DEBUG` | No | `false` | Enable verbose debug logging to stderr |
| `QUOTH_PLUGIN_DIR` | No | *(auto-detected)* | Override the plugin root directory |
| `AI_GATEWAY_API_KEY` | Yes* | - | Vercel AI Gateway key (`vck_*`) for embedding generation via `voyage-4-lite` |
| `MOONSHOT_API_KEY` | Yes* | - | Moonshot API key for Kimi K2.5 LLM calls in daemon pipeline |
| `QUOTH_API_KEY` | No | - | Cloud sync API key (`qth_*` prefix) for pattern promotion |
| `QUOTH_API_URL` | No | `https://quoth.triqual.dev` | Quoth SaaS API base URL |
| `QUOTH_PROJECT_ID` | No | *(auto from git remote)* | Override project ID for cloud operations |
| `JINA_API_KEY` | No | - | Jina AI key for reranking search results |

*Graceful degradation: Without `AI_GATEWAY_API_KEY`, embeddings return `null` and search falls back to keyword matching. Without `MOONSHOT_API_KEY`, the JUDGE/DISTILL/CONSOLIDATE daemon pipeline stages fail with logged errors but the daemon continues running.

---

### SaaS Environment (Next.js on Vercel)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | Neon Postgres connection string |
| `CLERK_SECRET_KEY` | Yes | - | Clerk backend authentication secret |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | - | Clerk frontend publishable key |
| `AI_GATEWAY_API_KEY` | Yes | - | Vercel AI Gateway key for server-side embeddings |
| `OPENAI_API_KEY` | Alt | - | Alternative to AI Gateway for embeddings |
| `JINA_API_KEY` | No | - | Jina reranking for search results |
| `UPSTASH_REDIS_REST_URL` | No | - | Upstash Redis URL for rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | No | - | Upstash Redis auth token |
| `QSTASH_TOKEN` | No | - | QStash token for background job scheduling |
| `RESEND_API_KEY` | No | - | Resend API key for transactional emails |

When `UPSTASH_REDIS_REST_URL` is not set, rate limiting is disabled (requests pass through). When `JINA_API_KEY` is not set, reranking is skipped and results are returned in vector-similarity order.

---

### Claude Code Injected Variables

These are set by Claude Code and available to hooks at runtime:

| Variable | Description |
|----------|-------------|
| `CLAUDE_PROJECT_DIR` | Absolute path to the current project directory |
| `CLAUDE_SESSION_ID` | Unique session identifier |
| `CLAUDE_PLUGIN_ROOT` | Plugin root directory (`.claude-plugin/`) |

---

## Setup Script (`quoth-plugin/scripts/setup.sh`)

Automated installation script. Idempotent -- safe to re-run at any time.

```bash
bash quoth-plugin/scripts/setup.sh
```

**Steps performed:**

1. **Create directory structure:**
   - `~/.quoth/hooks/`
   - `~/.quoth/intelligence/`
   - `~/.quoth/trajectories/`

2. **Symlink hook files:**
   - `~/.quoth/hooks/hook-dispatch.js` -> `quoth-plugin/hooks/hook-dispatch.js`
   - `~/.quoth/hooks/trajectory-capture.js` -> `quoth-plugin/hooks/trajectory-capture.js`
   - Skips if symlink already points to the correct target.

3. **Inject hooks into `~/.claude/settings.json`:**
   - Creates the file if it does not exist.
   - Uses Node.js for reliable JSON manipulation.
   - Merges hooks into existing arrays (does not overwrite other hooks).
   - Skips injection if `hook-dispatch.js` is already referenced.

4. **Add bash permission:**
   - Appends `Bash(node .quoth/*)` to `permissions.allow` if not already present.

**Output:**
```
[quoth] Setting up from /path/to/quoth-plugin
[quoth] Linked hook-dispatch.js
[quoth] Linked trajectory-capture.js
[quoth] Hooks injected successfully
[quoth] Added .quoth permission

[quoth] Setup complete!
  Hooks: ~/.quoth/hooks/
  Settings: ~/.claude/settings.json

  Start daemon: node /path/to/quoth-plugin/daemon/daemon.js &
  Verify: node ~/.quoth/hooks/hook-dispatch.js stats
```

---

## File Paths Reference

### Plugin State (`~/.quoth/`)

| Path | Format | Description |
|------|--------|-------------|
| `~/.quoth/memory.db` | SQLite 3 (WAL mode) | Primary pattern database with better-sqlite3 |
| `~/.quoth/hnsw.index.json` | JSON | HNSW vector index for fast approximate nearest neighbor search |
| `~/.quoth/daemon.pid` | Plain text | PID of the running daemon process |
| `~/.quoth/daemon.log` | JSON lines | Daemon processing log (one JSON object per line) |
| `~/.quoth/processing.lock` | Lock file | Prevents concurrent daemon processing |
| `~/.quoth/hooks/` | Directory | Symlinked hook scripts (from `quoth-plugin/hooks/`) |
| `~/.quoth/hooks/hook-dispatch.js` | Symlink | Unified hook dispatcher |
| `~/.quoth/hooks/trajectory-capture.js` | Symlink | PostToolUse trajectory logger |

---

### Trajectories (`~/.quoth/trajectories/`)

| Path Pattern | Format | Description |
|--------------|--------|-------------|
| `{repo-name}-{YYYY-MM-DD}.jsonl` | JSON lines | Per-project daily trajectory files (from hooks) |
| `api-{YYYY-MM-DD}.jsonl` | JSON lines | Trajectories ingested via `quoth_ingest_trajectory` MCP tool |
| `exolar-seed-{timestamp}.jsonl` | JSON lines | Exolar-seeded failure trajectories |

Each JSONL line contains:
```json
{
  "event": "tool_use",
  "agent": "claude-code",
  "project": "quoth",
  "session": "session-abc123",
  "task": "Edit src/lib/api/handler.ts",
  "outcome": "success",
  "pattern_used": null,
  "source": "hook",
  "timestamp": 1712188800000
}
```

---

### Intelligence Graph (`~/.quoth/intelligence/`)

| Path | Format | Description |
|------|--------|-------------|
| `store.json` | JSON array | All intelligence entries (memory + pattern bootstrap) |
| `graph-state.json` | JSON object | Graph nodes, edges, PageRank values, and metadata |
| `ranked-context.json` | JSON object | Pre-ranked entries sorted by `0.6 * pageRank + 0.4 * confidence` |
| `last-matched.json` | JSON array | IDs of last-matched entries (for feedback loop) |
| `pending-insights.jsonl` | JSON lines | Pending edit events awaiting consolidation |
| `snapshots.json` | JSON array | Historical graph snapshots (max 50, used for delta tracking) |

**`graph-state.json` structure:**
```json
{
  "version": 1,
  "updatedAt": 1712188800000,
  "nodeCount": 42,
  "nodes": {
    "pat-abc": {
      "id": "pat-abc",
      "category": "patterns",
      "confidence": 0.82,
      "accessCount": 7,
      "createdAt": 1712100000000
    }
  },
  "edges": [
    { "source": "pat-abc", "target": "mem-overview", "type": "trigram", "weight": 0.34 }
  ],
  "pageRanks": {
    "pat-abc": 0.0234,
    "mem-overview": 0.0189
  }
}
```

---

### Database Schema (SQLite)

The local SQLite database (`~/.quoth/memory.db`) uses WAL mode with the following tables:

**`patterns`** -- Core pattern storage

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | - | Pattern identifier |
| `name` | TEXT NOT NULL | - | Human-readable name |
| `pattern_type` | TEXT | `'code-pattern'` | Type: `code-pattern`, `skill`, etc. |
| `condition` | TEXT NOT NULL | - | When this pattern applies |
| `action` | TEXT NOT NULL | - | What to do when condition is met |
| `description` | TEXT | `NULL` | Optional description |
| `confidence` | REAL | `0.5` | Bayesian confidence score (0.0-1.0) |
| `success_count` | INTEGER | `0` | Bayesian alpha parameter |
| `failure_count` | INTEGER | `0` | Bayesian beta parameter |
| `decay_rate` | REAL | `0.005` | Per-day confidence decay rate |
| `embedding` | TEXT | `NULL` | JSON-encoded embedding vector |
| `version` | INTEGER | `1` | Schema version |
| `tags` | TEXT | `'[]'` | JSON array of tags |
| `source` | TEXT | `'distilled'` | Origin: `distilled`, `exolar-seeded`, `healer-learned`, `attributed`, `skill-derived` |
| `status` | TEXT | `'active'` | Status: `active`, `archived` |
| `created_at` | INTEGER | `NOW` | Unix ms timestamp |
| `updated_at` | INTEGER | `NOW` | Unix ms timestamp |
| `last_matched_at` | INTEGER | `NULL` | Last time this pattern was returned in a search |

**`trajectories`** -- Trajectory sessions

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | - | Trajectory identifier |
| `session_id` | TEXT | `NULL` | Claude session ID |
| `status` | TEXT | `'active'` | Processing status |
| `verdict` | TEXT | `NULL` | JUDGE pipeline verdict |
| `task` | TEXT | `NULL` | Task description |
| `context` | TEXT | `NULL` | Additional context |
| `total_steps` | INTEGER | `0` | Number of steps |
| `total_reward` | REAL | `0` | Cumulative reward |
| `started_at` | INTEGER | `NOW` | Unix ms timestamp |
| `ended_at` | INTEGER | `NULL` | Completion timestamp |
| `extracted_pattern_id` | TEXT FK | `NULL` | Pattern extracted from this trajectory |

**`trajectory_steps`** -- Individual steps within trajectories

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | INTEGER PK AUTO | - | Auto-incrementing ID |
| `trajectory_id` | TEXT FK NOT NULL | - | Parent trajectory |
| `step_number` | INTEGER NOT NULL | - | Sequence number |
| `action` | TEXT NOT NULL | - | Tool/action taken |
| `observation` | TEXT | `NULL` | Result observed |
| `reward` | REAL | `0` | Step reward |
| `metadata` | TEXT | `NULL` | JSON metadata |
| `created_at` | INTEGER | `NOW` | Unix ms timestamp |

**`memory_entries`** -- Key-value memory storage

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | - | Entry identifier |
| `key` | TEXT NOT NULL | - | Lookup key (unique within namespace) |
| `namespace` | TEXT | `'default'` | Isolation namespace |
| `content` | TEXT NOT NULL | - | Entry content |
| `type` | TEXT | `'semantic'` | Entry type |
| `tags` | TEXT | `NULL` | JSON tags array |
| `metadata` | TEXT | `NULL` | JSON metadata |
| `access_count` | INTEGER | `0` | Access counter |
| `status` | TEXT | `'active'` | Status |
| `created_at` | INTEGER | `NOW` | Unix ms timestamp |
| `updated_at` | INTEGER | `NOW` | Unix ms timestamp |
| `last_accessed_at` | INTEGER | `NULL` | Last access timestamp |

**`agent_registry`** -- Registered agents

| Column | Type | Description |
|--------|------|-------------|
| `agent_id` | TEXT PK | Unique agent identifier |
| `name` | TEXT NOT NULL | Human-readable name |
| `type` | TEXT NOT NULL | `claude-code`, `openclaw`, `daemon`, `worker` |
| `project` | TEXT | Associated project |
| `platform` | TEXT | Platform identifier |
| *(additional columns)* | | Capabilities, metadata, timestamps, status |

**SQLite Pragmas:**
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
```

---

### HNSW Vector Index

The HNSW (Hierarchical Navigable Small World) index is stored at `~/.quoth/hnsw.index.json` and managed by `daemon/lib/hnsw.js`. It provides approximate nearest neighbor search for pattern embeddings.

- **Embedding model:** `MiniLM-L6-v2` (local, no API call required)
- **Dimensions:** 384
- **Similarity metric:** Cosine similarity
- **Index format:** JSON-serialized graph with multiple navigation layers

The index is rebuilt during daemon processing and loaded lazily by the MCP server when semantic search is requested. Deleted nodes are soft-deleted (excluded from search results but retained in the graph until a full rebuild).

---

## SaaS Configuration (Next.js)

### Vitest Configuration (`vitest.config.ts`)

```typescript
{
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'src/lib/quoth/__tests__/**'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'src/db/migrations/**'],
      reporter: ['text', 'text-summary'],
    },
    testTimeout: 10000,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: { '@': './src' },
  },
}
```

### Plugin Vitest Configuration (`quoth-plugin/vitest.config.js`)

```javascript
{
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 10000,
  },
}
```

Key difference: Plugin tests do not use global test APIs (`globals: false`) and are plain JavaScript (`.js`).

---

## API Handler Configuration (`createApiHandler`)

Every SaaS API route is wrapped with `createApiHandler` which accepts a configuration object:

```typescript
interface HandlerConfig {
  auth?: 'required' | 'optional' | 'none';
  rateLimit?: { rpm: number };
  maxDuration?: number;        // default: 30000 ms
  validate?: {
    body?: ZodSchema;
    query?: ZodSchema;
  };
}
```

**Middleware execution order:**
1. Request timeout enforcement
2. Authentication (Clerk JWT or agent API key)
3. Rate limiting (Upstash Redis sliding window)
4. Zod input validation
5. Error handling (RFC 7807 problem detail format)

**Example usage:**
```typescript
export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 60 },
    validate: { body: myZodSchema },
    maxDuration: 60_000,
  },
  async (req, ctx) => {
    const body = req.validatedBody;
    // ctx contains: userId, orgId, projectId, agentId, isAgent
    return Response.json({ data: result });
  },
);
```
