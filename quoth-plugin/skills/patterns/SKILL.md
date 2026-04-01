---
name: patterns
description: Browse the Quoth confidence-scored pattern library. Use when asked to show learned patterns, check pattern confidence, or find patterns for a task.
---

# Quoth Pattern Library

Show the user the current confidence-scored pattern library.

1. Call `quoth_top_patterns({ limit: 20 })` via the quoth-learning MCP tool
2. Present patterns sorted by confidence with their scores, tags, and use counts
3. Highlight patterns with confidence > 0.8 (promotion candidates)
4. Highlight patterns with confidence < 0.2 (candidates for archival)

Format:
| Pattern | Confidence | Uses | Tags |
|---------|------------|------|------|
| ... | 0.84 | 47 | selector, playwright |

Then offer: "Run `/learn` to trigger manual consolidation"
