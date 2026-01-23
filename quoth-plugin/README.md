# Quoth Plugin for Claude Code

Lightweight documentation-as-truth plugin. ~60 tokens overhead with gentle hints that guide Claude to use `quoth_guidelines` when relevant.

## Features

- **~60 tokens per session** - Down from ~750 tokens (92% reduction)
- **One adaptive tool** - `quoth_guidelines(mode)` with `code`, `review`, `document` modes
- **🪶 Quoth Badge** - Transparent reporting when Quoth patterns are applied
- **Strongly suggest, not force** - Claude decides when to use Quoth

## Quick Install

### Option 1: From Marketplace (Recommended)

```bash
# Add the Quoth marketplace (one time)
/plugin marketplace add Montinou/quoth-mcp

# Install the plugin
/plugin install quoth@quoth-marketplace
```

This installs everything:
- **Quoth MCP Server** - All tools (`quoth_guidelines`, `quoth_search_index`, etc.)
- **Lightweight Hooks** - Gentle hints (~60 tokens)
- **Skills** - `/quoth-genesis` for bootstrapping

### Option 2: MCP Only (No Hooks)

If you only want the MCP server without hooks:

```bash
claude mcp add --transport http quoth https://quoth.ai-innovation.site/api/mcp
```

### With API Key

For authenticated access:

```bash
# Get a token from https://quoth.ai-innovation.site/dashboard/api-keys
claude mcp add --transport http quoth https://quoth.ai-innovation.site/api/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
```

## What You Get

### MCP Tools (via server)

| Tool | Purpose |
|------|---------|
| `quoth_guidelines` | Adaptive guidelines for code/review/document modes |
| `quoth_search_index` | Semantic search across documentation |
| `quoth_read_doc` | Read full document content |
| `quoth_propose_update` | Submit documentation updates |
| `quoth_genesis` | Bootstrap project documentation |

### Hooks (automatic)

| Hook | Purpose | Tokens |
|------|---------|--------|
| SessionStart | Hint to use `quoth_guidelines('code')` | ~25 |
| PreToolUse (Edit/Write) | Reminder that Quoth patterns available | ~15 |
| Stop | Badge enforcement if Quoth was used | ~20 |

## How It Works

1. **Session starts**: Claude sees hint about `quoth_guidelines`
2. **Before code**: Claude may call `quoth_guidelines('code')`
3. **Search**: Claude may call `quoth_search_index` for patterns
4. **Response ends**: If Quoth was used, badge shows which patterns applied

```
┌─────────────────────────────────────────────────┐
│ 🪶 Quoth                                        │
│   ✓ patterns/testing-pattern.md (vitest mocks) │
└─────────────────────────────────────────────────┘
```

## Configuration

### Plugin Settings

Create `~/.claude/plugins/quoth.local.md`:

```yaml
---
showBadge: true
---
```

### Project Configuration

Create `.quoth/config.json` or `quoth.config.json` in your project:

```json
{
  "project_id": "your-project-id"
}
```

## Skills

- `/quoth-genesis` - Bootstrap documentation for a new project

## Plugin Structure

```
quoth-plugin/
  plugin.json           # Plugin manifest
  hooks/
    hooks.json          # Hook definitions
    session-start.sh    # SessionStart - gentle hint (~25 tokens)
    pre-edit-write.sh   # PreToolUse - pattern reminder (~15 tokens)
    stop.sh             # Stop - badge enforcement (~20 tokens)
  skills/
    genesis.md          # Genesis skill
```

## Development

### Testing Hooks

```bash
./hooks/session-start.sh | jq .
./hooks/stop.sh | jq .
```

## Links

- [Quoth Documentation](https://quoth.ai-innovation.site)
- [Quoth MCP Server](https://github.com/Montinou/quoth-mcp)
- [Blog: Introducing the Quoth Plugin](https://quoth.ai-innovation.site/blog/quoth-plugin-launch)
