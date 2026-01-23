---
event: SessionStart
description: Detect project and inject Quoth context
---

# Quoth SessionStart Hook

## Check for Quoth Configuration

1. **Detect Quoth MCP**: Check if `quoth` MCP server is connected
   - If not connected: Skip remaining steps (plugin inactive)

2. **Check Project Documentation**: Call `quoth_search_index` with query "project overview"
   - If results found: Project has Quoth docs
   - If no results: Project may need Genesis

## Actions Based on Detection

### If Project Has Quoth Docs

Load architect context silently:

> **Quoth Active**: Documentation patterns will be injected automatically.
> Use `/prompt quoth_architect` for explicit pattern enforcement.

### If Project Needs Documentation

Offer Genesis:

> **No Quoth documentation found for this project.**
>
> Would you like to bootstrap documentation with Genesis?
> - Run `/quoth-genesis` to create project documentation
> - Or connect an existing Quoth project

## Token Efficiency

- Only log a single line acknowledgment
- Do NOT dump full documentation
- Let PreToolUse inject specific patterns as needed
