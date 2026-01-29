# Quoth v2.0 - Quick Start Guide

Get AI Memory running in 5 minutes.

## Prerequisites

- Claude Code installed
- Internet connection (for Quoth MCP server)

## 1. Install Plugin (1 min)

```bash
# In Claude Code

# Add marketplace (one time)
/plugin marketplace add Montinou/quoth-mcp

# Install plugin
/plugin install quoth@quoth-marketplace
```

## 2. Initialize AI Memory (2 min)

In your project directory:

```bash
/quoth-init
```

Choose your settings:
1. **Strictness**: `blocking` (teams), `reminder` (default), or `off`
2. **Types**: decisions, patterns, errors, knowledge (+ custom)
3. **Gates**: require_reasoning, require_search (if blocking)

This creates:

```
.quoth/
├── config.json         # Your configuration
├── decisions.md        # Architecture choices
├── patterns.md         # Code patterns
├── errors.md           # Failures and fixes
├── knowledge.md        # General context
└── sessions/           # Session logs
```

## 3. Bootstrap Documentation (optional, ~5 min)

If you want to generate initial documentation:

```
Run Genesis on this project with standard depth
```

Genesis will:
- Analyze your codebase
- Generate 5 documents (standard depth)
- Upload to Quoth server
- Populate local `.quoth/*.md` files

## 4. Start Working

That's it! Quoth now automatically:

1. **Session start** - Injects relevant context
2. **During work** - Logs actions to session folder
3. **Session end** - Prompts to promote learnings

### Example Flow

```
You: Create a test for the auth service

Claude: [Searches .quoth/patterns.md for test patterns]
Claude: [Creates test following documented conventions]
Claude: [Logs action to .quoth/sessions/{id}/log.md]

--- Later ---

You: /exit (or end session)

Quoth: Session complete. I captured these learnings:

**Patterns:**
- Used beforeEach for test isolation

Update local files? Upload to Quoth? Both? Skip?

You: Update local

Quoth: [Appends to .quoth/patterns.md]
```

## Query Memory Directly

Ask the quoth-memory subagent:

```
Ask quoth-memory: What's our error handling pattern?
```

It returns concise answers without bloating your context.

## Configuration Reference

### Strictness Levels

| Mode | Effect |
|------|--------|
| `blocking` | Cannot edit until reasoning documented |
| `reminder` | Gentle prompts, not blocking |
| `off` | No enforcement |

### Gates (blocking mode only)

| Gate | Effect |
|------|--------|
| `require_reasoning_before_edit` | Must document reasoning first |
| `require_quoth_search` | Must search Quoth before generating |
| `require_error_documentation` | Must document errors encountered |

## Troubleshooting

**Plugin not working?**
```bash
/plugin list  # Verify quoth is installed
/mcp          # Check MCP server connection
```

**Context not injecting?**
- Ensure `.quoth/config.json` exists
- Run `/quoth-init` if missing

**Gates too strict?**
- Edit `.quoth/config.json`
- Change `strictness` to `"reminder"` or `"off"`

## Next Steps

- **Customize types**: Add project-specific `.quoth/{type}.md` files
- **Team sharing**: Upload learnings to remote Quoth
- **Genesis depth**: Try `comprehensive` for detailed documentation

## Links

- [Full Documentation](https://quoth.ai-innovation.site/docs)
- [Changelog](https://quoth.ai-innovation.site/changelog)
- [GitHub](https://github.com/Montinou/quoth-mcp)
