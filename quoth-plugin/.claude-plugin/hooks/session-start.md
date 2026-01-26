---
event: SessionStart
description: Lightweight hint for Quoth availability
---

# Quoth SessionStart Hook

## Output

Single line hint (~25 tokens):

```
Quoth MCP active. Strongly recommend `quoth_guidelines('code')` and `quoth_search_index` before writing code.
```

## Behavior

1. Check if Quoth MCP is installed
2. Initialize session state
3. Output lightweight hint

Does NOT:
- Force Claude to use Quoth
- Dump full documentation
- List all available tools
