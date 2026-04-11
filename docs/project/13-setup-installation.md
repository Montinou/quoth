# Setup & Installation

> v1.0.4 — Last updated 2026-04-11

Complete guide to installing and configuring the Quoth plugin for Claude Code.

## Prerequisites

- **Node.js** v18+ (for running hooks, daemon, and MCP server)
- **better-sqlite3** npm package (installed in `quoth-plugin/node_modules/`)
- **Claude Code CLI** installed and configured (`~/.claude/settings.json` must exist or will be created)
- **Git** (project identification uses `git remote get-url origin`)

Optional for cloud sync:
- `QUOTH_API_KEY` environment variable (qth_* format key from quoth.triqual.dev)
- `AI_GATEWAY_API_KEY` for LLM calls (JUDGE/DISTILL) in the daemon pipeline (local embeddings use MiniLM-L6-v2, no API key needed)

## Running setup.sh

```bash
bash quoth-plugin/scripts/setup.sh
```

The script is fully idempotent -- safe to re-run at any time. It uses `set -euo pipefail` for strict error handling.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `QUOTH_HOME` | `~/.quoth` | Root directory for all Quoth state |

### Step 1: Create ~/.quoth Directory Structure

```bash
mkdir -p "$QUOTH_HOME/hooks"
mkdir -p "$QUOTH_HOME/intelligence"
mkdir -p "$QUOTH_HOME/trajectories"
```

After setup and first daemon run, the full structure is:

```
~/.quoth/
├── hooks/                    -- Symlinked hook scripts
│   ├── hook-dispatch.js      -- Unified dispatcher (symlink)
│   └── trajectory-capture.js -- Trajectory logger (symlink)
├── intelligence/             -- Graph state JSON files
│   ├── graph-state.json      -- Nodes, edges, PageRank scores
│   ├── ranked-context.json   -- Pre-ranked entries for fast lookup
│   ├── store.json            -- All memory entries (patterns + MEMORY.md)
│   ├── last-matched.json     -- IDs matched in last context lookup
│   ├── pending-insights.jsonl -- Edits pending consolidation
│   └── snapshots.json        -- Historical snapshots (max 50)
├── trajectories/             -- JSONL trajectory files per project
│   ├── {repo-name}-{date}.jsonl
│   └── api-{date}.jsonl      -- Ingested from external sources
├── memory.db                 -- SQLite database (patterns, agents, events, trajectories)
├── hnsw.index.json           -- HNSW approximate nearest neighbor index
├── daemon.pid                -- Daemon process ID
├── daemon.log                -- Daemon log (JSON lines)
└── processing.lock           -- Processing lock file (prevents concurrent processing)
```

### Step 2: Symlink Hook Files

Creates symlinks from `~/.quoth/hooks/` pointing to the source tree:

```
~/.quoth/hooks/hook-dispatch.js      -> quoth-plugin/hooks/hook-dispatch.js
~/.quoth/hooks/trajectory-capture.js -> quoth-plugin/hooks/trajectory-capture.js
```

The script checks for existing correct symlinks before acting:

```bash
if [ -L "$dst" ] && [ "$(readlink -f "$dst")" = "$(readlink -f "$src")" ]; then
  echo "[quoth] $f already linked"
else
  ln -sf "$src" "$dst"
fi
```

**Symlink resolution**: `hook-dispatch.js` uses `fs.realpathSync(__dirname)` to resolve symlinks back to the source tree. This allows it to `require()` modules from `quoth-plugin/mcp/` and `quoth-plugin/daemon/` regardless of being invoked through the symlink.

```javascript
const REAL_DIR = fs.realpathSync(__dirname)
const QUOTH_PLUGIN = process.env.QUOTH_PLUGIN_DIR || path.join(REAL_DIR, '..')
```

### Step 3: Inject Hooks into ~/.claude/settings.json

If `~/.claude/settings.json` does not exist, creates it with `{}`.

Uses an inline Node.js script for reliable JSON manipulation (not sed/awk). Injects 9 hook declarations across 8 hook events:

| Hook Event | Matcher | Command | Timeout |
|---|---|---|---|
| `PreToolUse` | `Bash` | `hook-dispatch.js pre-bash` | 5000ms |
| `PostToolUse` | `Write\|Edit\|MultiEdit` | `hook-dispatch.js post-edit` | 10000ms |
| `PostToolUse` | `Bash\|Write\|Edit\|MultiEdit\|Agent` | `trajectory-capture.js` | 3000ms |
| `UserPromptSubmit` | (all) | `hook-dispatch.js route` | 10000ms |
| `SessionStart` | (all) | `hook-dispatch.js session-restore` | 15000ms |
| `SessionEnd` | (all) | `hook-dispatch.js session-end` | 10000ms |
| `PreCompact` | (all) | `hook-dispatch.js session-end` | 6000ms |
| `SubagentStart` | (all) | `hook-dispatch.js subagent-start` | 3000ms |
| `SubagentStop` | (all) | `hook-dispatch.js post-task` | 5000ms |

Hook commands use the shell-safe pattern:

```
sh -c 'exec node "$HOME/.quoth/hooks/hook-dispatch.js" <command>'
```

**Merge strategy**: The script appends Quoth hooks to existing hook arrays -- it never overwrites other hooks. It checks for existing Quoth hooks by searching for `hook-dispatch.js` or `trajectory-capture.js` in the serialized JSON of each event's hook array, preventing duplicates.

### Step 4: Add Bash Permission

Adds `Bash(node .quoth/*)` to `settings.json` `permissions.allow` array. This auto-approves execution of Quoth hook scripts so Claude Code does not prompt for confirmation on every hook invocation.

```javascript
if (!settings.permissions.allow.includes('Bash(node .quoth/*)')) {
  settings.permissions.allow.push('Bash(node .quoth/*)');
}
```

### Step 5: Sync Skills to skill-registry (v3.4.0)

If `~/projects/skill-registry` exists and `bun` is available, the script syncs the plugin's built-in skills to the external skill-registry:

```bash
SKILL_REGISTRY="$HOME/projects/skill-registry"
if [ -d "$SKILL_REGISTRY" ] && command -v bun &>/dev/null; then
  (cd "$SKILL_REGISTRY" && QUOTH_SKILLS_DIR="$PLUGIN_DIR/skills" bun run sync:quoth 2>&1)
fi
```

This step is non-blocking — if the sync fails or the registry is not found, setup continues with a warning. Skills live at `quoth-plugin/skills/` and include: `quoth-genesis`, `learn`, `patterns`, `quoth-help`, and `quoth-init`.

To sync manually after setup:
```bash
cd ~/projects/skill-registry
QUOTH_SKILLS_DIR=/path/to/quoth-plugin/skills bun run sync:quoth
```

### Idempotent Checks

Each step checks for existing state before acting:

- **Symlinks**: Compares resolved real paths of existing symlink vs source
- **Hook injection**: Greps for `hook-dispatch.js` in settings.json before injecting
- **Permission**: Checks if `Bash(node .quoth/*)` string already exists in permissions array

### Output

Prints paths, skill count, and instructions:

```
[quoth] Setup complete!
  Hooks: ~/.quoth/hooks/
  Settings: ~/.claude/settings.json
  Skills: quoth-plugin/skills/ (5 skills)

  Start daemon: node quoth-plugin/daemon/daemon.js &
  Verify: node ~/.quoth/hooks/hook-dispatch.js stats
```

## Starting the Daemon

The daemon is a long-running Node.js process that watches for trajectory files and processes them through the JUDGE -> DISTILL -> CONSOLIDATE pipeline.

```bash
# Start in background
node quoth-plugin/daemon/daemon.js &

# Or with debug logging to stderr
QUOTH_DEBUG=true node quoth-plugin/daemon/daemon.js &
```

The daemon auto-starts via the `session-start` hook (SessionStart event) in normal operation. You only need to start it manually for the first time or after system restart.

### Daemon Startup Sequence

1. Creates `~/.quoth/` and `~/.quoth/trajectories/` directories
2. Opens/creates SQLite database at `~/.quoth/memory.db`
3. Runs schema migrations (promotion tracking, Bayesian scoring, namespace columns)
4. Initializes HNSW index (loads from `hnsw.index.json` or builds from DB)
5. Writes PID to `~/.quoth/daemon.pid`
6. Cleans stale lock files from previous crashes
7. Starts `fs.watch()` on trajectories directory
8. Starts timers:
   - **Hourly decay** (every 60 min): `applyHourlyDecay()` + `archiveWeakPatterns()`
   - **HNSW save** (every 30 min): Persists HNSW index to disk
   - **Agent cleanup** (every 5 min): Marks agents without heartbeat as offline
   - **Deep consolidation** (daily at 3am): LLM-powered dedup, cloud promotion, global namespace promotion
9. Runs initial `scanAndEnqueue()` + `processQueue()`

### Daemon Signals

| Signal | Action |
|--------|--------|
| `SIGTERM` | Graceful shutdown: clear timers, close DB, exit |
| `SIGUSR1` | Flush: immediate scan and process queue |

### Verifying Status

```bash
# Via hook-dispatch
node ~/.quoth/hooks/hook-dispatch.js stats

# Via MCP tool (from Claude Code)
# Use quoth_daemon_status tool

# Check PID file
cat ~/.quoth/daemon.pid

# Check recent log entries
tail -5 ~/.quoth/daemon.log | jq .
```

## Plugin System (plugin.json)

The `.claude-plugin/plugin.json` manifest defines the plugin for the Claude Code plugin system:

```json
{
  "name": "quoth",
  "version": "3.4.0",
  "description": "Universal self-learning and agent coordination for Claude Code. Captures trajectories, learns patterns, shares knowledge across projects.",
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

### Plugin Components

- **MCP Server** (`quoth-learning`): Provides 22 MCP tools across 4 handler modules (patterns, agents, intelligence, skills)
- **Hooks** (`hooks/hooks.json`): Hook declarations for the plugin system
- **Commands**: `/quoth:patterns` (show top patterns), `/quoth:learn` (trigger learning)
- **Agents**: `quoth:learner` (Haiku-based trajectory reviewer subagent)
- **User Config**: `QUOTH_API_KEY` for optional cloud sync (marked as sensitive)

## Global Configuration

Quoth is configured once globally -- no per-project setup is needed:

| Path | Purpose |
|------|---------|
| `~/.mcp.json` | MCP server registration for `quoth-learning` |
| `~/.claude/settings.json` | All hook declarations + bash permission |
| `~/.quoth/hooks/` | Symlinks to source tree hook scripts |
| `~/.quoth/memory.db` | SQLite database (created on first daemon run) |

**Project segregation** is automatic. The `resolveProjectName()` function in `hook-dispatch.js` determines the current project by:

1. Running `git remote get-url origin` in `CLAUDE_PROJECT_DIR`
2. Extracting the repository name from the URL (e.g., `Montinou/sales-companion` -> `sales-companion`)
3. Falling back to OpenClaw workspace name (`.openclaw/workspaces/<name>/repo/`)
4. Falling back to directory basename

This project name is used as the pattern namespace in SQLite and as the trajectory file prefix.

## Uninstalling

To remove Quoth:

1. Remove hook declarations from `~/.claude/settings.json` (delete entries containing `hook-dispatch.js` and `trajectory-capture.js`)
2. Remove `Bash(node .quoth/*)` from `settings.json` permissions
3. Remove the MCP server entry from `~/.mcp.json`
4. Remove `~/.quoth/` directory (this deletes all learned patterns and state)
5. Stop the daemon: `kill $(cat ~/.quoth/daemon.pid)` (if running)
