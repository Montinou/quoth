---
event: PreToolUse
tool: Edit|Write
description: Lightweight reminder for Quoth patterns
---

# Quoth PreToolUse Hook (Edit|Write)

## Output

Single line hint (~15 tokens):

```
Quoth patterns available via `quoth_guidelines()` and `quoth_search_index`
```

## Behavior

1. Check if MCP available and session exists
2. Skip non-code files (md, json, yaml, etc.)
3. Output lightweight reminder

Does NOT:
- Force Claude to search
- Inject patterns directly
- Block the operation
