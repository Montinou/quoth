# Quoth Plugin for Claude Code

AI-driven documentation as a single source of truth.

## Features

- **SessionStart**: Detects project, checks for Quoth docs, offers Genesis if missing
- **PreToolUse (Edit/Write)**: Injects relevant patterns before code generation
- **PostToolUse (Edit/Write)**: Audits generated code against documentation
- **Stop**: Shows Quoth Badge with pattern summary

## Installation

```bash
claude plugins install quoth
```

Or manually:

```bash
git clone https://github.com/Montinou/quoth-plugin ~/.claude/plugins/quoth
```

## Configuration

Settings in `~/.claude/plugins/quoth.local.md`:

```yaml
---
autoInjectPatterns: true
showBadge: true
auditEnabled: true
---
```

## Skills

- `/quoth-genesis` - Bootstrap documentation for a new project

## Requirements

- Quoth MCP server connected: `claude mcp add quoth`
