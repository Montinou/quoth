# Quoth — Quick Start

## Option A: Cloud MCP Server Only

For semantic search and agent coordination without local learning:

```bash
claude mcp add --transport http quoth https://quoth.triqual.dev/api/mcp
```

## Option B: Full Plugin (Recommended)

For self-learning, trajectory capture, intelligence routing, and pattern injection:

### Prerequisites

- Claude Code installed
- Node.js >= 18

### Install

```bash
cd /path/to/quoth-plugin
bash scripts/setup.sh
```

This:
- Symlinks hooks to `~/.quoth/hooks/`
- Injects hook declarations into `~/.claude/settings.json`
- Adds `quoth-learning` MCP server config to `~/.mcp.json`
- Creates `~/.quoth/` directory structure

### Verify

```bash
# Check daemon status
claude> Use quoth_daemon_status

# Check loaded patterns
claude> Use quoth_top_patterns
```

## What Happens Automatically

Once installed, the plugin works transparently:

1. **Session start** — Intelligence graph initializes, top patterns (>= 0.6 confidence) inject into context
2. **Each prompt** — Task routed to optimal agent type, relevant patterns shown
3. **Each tool use** — Actions captured to trajectory file for later learning
4. **Session end** — Intelligence graph consolidates, PageRank recomputed

### Background Daemon

The daemon auto-starts on session start. It processes trajectories using Haiku subagents through a 3-stage pipeline:

```
JUDGE → DISTILL → CONSOLIDATE
```

- **JUDGE**: Evaluates trajectory quality
- **DISTILL**: Extracts reusable patterns
- **CONSOLIDATE**: Merges into pattern library with Bayesian confidence scores

Patterns are stored in `~/.quoth/memory.db` (SQLite + HNSW index).

## Useful MCP Tools

| Tool | What It Does |
|------|-------------|
| `quoth_search_patterns` | Semantic search over learned patterns |
| `quoth_top_patterns` | View highest-confidence patterns |
| `quoth_route_task` | Route a task description to the best agent type |
| `quoth_intelligence_stats` | View intelligence graph statistics |
| `quoth_daemon_status` | Check daemon health |

## Links

- [Full Documentation](https://quoth.triqual.dev/docs)
- [Plugin Details](quoth-plugin/README.md)
