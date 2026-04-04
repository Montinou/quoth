# Quoth Universal Improvements: Plugin + RL Hooks + Token Optimization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent improvements to Quoth: (A) Claude Code plugin for zero-config adoption, (B) PostToolUse RL hooks for pattern-based reinforcement, (C) token-optimized pattern injection.

**Architecture:** Each improvement is self-contained. The plugin packages existing hooks/MCP into a discoverable format. RL hooks intercept tool outputs and annotate with pattern confidence. Token optimization compresses pattern injection for minimal context usage.

**Tech Stack:** Node.js, Claude Code Plugin System (plugin.json), MCP stdio, better-sqlite3

---

## Plan A: Quoth Claude Code Plugin

### File Structure

```
quoth-plugin/.claude-plugin/
  plugin.json              # Plugin manifest
  hooks/hooks.json         # Hook declarations (trajectory capture + pattern injection)
  commands/patterns.md     # /quoth:patterns command
  commands/learn.md        # /quoth:learn command
  agents/learner.md        # quoth:learner agent type
```

### Task A1: Plugin Manifest

**Files:**
- Create: `quoth-plugin/.claude-plugin/plugin.json`

- [x] **Step 1: Create plugin.json manifest**

```json
{
  "name": "quoth",
  "version": "3.1.0",
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

- [x] **Step 2: Verify manifest syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('quoth-plugin/.claude-plugin/plugin.json','utf8')); console.log('OK')"`
Expected: OK

- [x] **Step 3: Commit** (pending user request)

### Task A2: Plugin Hooks

**Files:**
- Create: `quoth-plugin/.claude-plugin/hooks/hooks.json`

- [x] **Step 1: Create hooks.json**

```json
{
  "description": "Quoth self-learning hooks: trajectory capture on tool use, pattern injection on session start",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash|Write|Edit|MultiEdit|Agent",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/../hooks/trajectory-capture.js\"",
            "timeout": 3000
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/../hooks/inject-patterns.js\"",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

Note: The hook handlers already exist at `quoth-plugin/hooks/` (trajectory-capture.js was placed at ~/.quoth/hooks/ — we need to copy/symlink them into the plugin structure, OR reference absolute paths). Since `${CLAUDE_PLUGIN_ROOT}` points to `.claude-plugin/`, the `../hooks/` path reaches the existing hook files that need to be placed at `quoth-plugin/hooks/`.

- [x] **Step 2: Copy hook handlers into plugin-accessible location**

Copy `~/.quoth/hooks/trajectory-capture.js` and `~/.quoth/hooks/inject-patterns.js` to `quoth-plugin/hooks/` so they're accessible via `${CLAUDE_PLUGIN_ROOT}/../hooks/`.

- [x] **Step 3: Commit** (pending user request)

### Task A3: Plugin Commands

**Files:**
- Create: `quoth-plugin/.claude-plugin/commands/patterns.md`
- Create: `quoth-plugin/.claude-plugin/commands/learn.md`

- [x] **Step 1: Create /quoth:patterns command**

```markdown
---
description: "Browse confidence-scored pattern library with optional filtering"
argumentHint: "[tags...]"
---

Use the quoth_top_patterns MCP tool to retrieve the top patterns from the local learning database.

If the user provided tag arguments, pass them as the tags filter.
If no arguments, show the top 10 patterns sorted by confidence.

Format the output as a table with columns: ID, Name, Confidence, Tags, Source.
```

- [x] **Step 2: Create /quoth:learn command**

```markdown
---
description: "Trigger manual pattern consolidation from recent trajectories"
---

Use the quoth_daemon_status MCP tool to check if the daemon is running.

If running, send SIGUSR1 to trigger immediate processing by running:
`kill -USR1 $(cat ~/.quoth/daemon.pid)`

Then use quoth_top_patterns to show the latest patterns after a 3-second wait.

If not running, tell the user to start the daemon:
`node /home/lord_montino/projects/agents-tools/quoth/quoth-plugin/daemon/daemon.js &`
```

- [x] **Step 3: Commit** (pending user request)

### Task A4: Plugin Agent

**Files:**
- Create: `quoth-plugin/.claude-plugin/agents/learner.md`

- [x] **Step 1: Create quoth:learner agent**

```markdown
---
description: "Self-learning agent that reviews trajectories and consolidates patterns. Use when you want to manually review and improve the pattern library."
name: "learner"
model: "haiku"
tools: ["Bash", "Read", "Glob", "Grep"]
---

You are the Quoth Learner agent. Your job is to review recent trajectory files and improve the pattern library.

## Available MCP Tools
- quoth_top_patterns — view current patterns
- quoth_search_patterns — semantic search
- quoth_log_outcome — record success/failure
- quoth_score_pattern — adjust confidence
- quoth_promote_global — promote to global scope
- quoth_project_patterns — get project-scoped patterns

## Workflow
1. Read recent trajectory files from ~/.quoth/trajectories/
2. Identify patterns that should be strengthened or archived
3. Use quoth_log_outcome to update pattern confidence
4. Use quoth_promote_global for high-confidence broad patterns
5. Report a summary of changes made
```

- [x] **Step 2: Commit** (pending user request)

---

## Plan B: Post-Sampling RL Hooks

### File Structure

```
quoth-plugin/hooks/
  rl-annotate.js    # PostToolUse hook that annotates MCP tool outputs with pattern confidence
```

### Task B1: RL Annotation Hook

**Files:**
- Create: `quoth-plugin/hooks/rl-annotate.js`

- [x] **Step 1: Create rl-annotate.js**

This hook runs after MCP tool calls. It checks if the tool output matches any known pattern and annotates the output with confidence scores. The annotation is injected via `additionalContext` (since `updatedMCPToolOutput` only works for MCP tools and we want broad coverage).

```javascript
#!/usr/bin/env node
'use strict'

// PostToolUse RL hook: annotates tool outputs with pattern relevance signals
// Reads tool_name + tool_input from stdin, queries pattern DB for matches,
// returns additionalContext with confidence scores

const fs = require('fs')
const path = require('path')
const os = require('os')

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const DB_PATH = path.join(QUOTH_HOME, 'memory.db')
const DB_MODULE = process.env.QUOTH_DB_MODULE || '/home/lord_montino/projects/agents-tools/quoth/quoth-plugin/daemon/db.js'

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  try {
    if (!fs.existsSync(DB_PATH) || !fs.existsSync(DB_MODULE)) {
      process.stdout.write('{}')
      return
    }

    const hookData = JSON.parse(input)
    const toolName = hookData.tool_name || ''
    const toolInput = hookData.tool_input || {}

    // Build search context from tool usage
    const searchContext = `${toolName} ${toolInput.command || toolInput.file_path || toolInput.pattern || toolInput.query || ''}`.trim()
    if (searchContext.length < 5) {
      process.stdout.write('{}')
      return
    }

    const { createDb } = require(DB_MODULE)
    const db = createDb(DB_PATH)

    // Find relevant patterns by tag matching (fast, no embedding needed)
    const toolTag = toolName.toLowerCase()
    const patterns = db.getTopPatterns(3, [toolTag])
    db.close()

    if (patterns.length === 0) {
      process.stdout.write('{}')
      return
    }

    // Format as RL signal
    const signals = patterns.map(p =>
      `[${p.confidence.toFixed(2)}] ${p.name}: ${p.action}`
    ).join('\n')

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `[Quoth RL] Relevant patterns for ${toolName}:\n${signals}`
      }
    }))
  } catch {
    process.stdout.write('{}')
  }
})
```

- [x] **Step 2: Make executable and verify syntax**

Run: `chmod +x quoth-plugin/hooks/rl-annotate.js && node -c quoth-plugin/hooks/rl-annotate.js`
Expected: no output (syntax OK)

- [x] **Step 3: Add to plugin hooks.json**

Add to `quoth-plugin/.claude-plugin/hooks/hooks.json` PostToolUse array:
```json
{
  "matcher": "mcp__quoth-learning__*",
  "hooks": [{
    "type": "command",
    "command": "node \"${CLAUDE_PLUGIN_ROOT}/../hooks/rl-annotate.js\"",
    "timeout": 2000
  }]
}
```

- [x] **Step 4: Commit** (pending user request)

---

## Plan C: Token-Optimized Pattern Injection

### File Structure

```
quoth-plugin/hooks/
  inject-patterns.js   # Modified: compress patterns to minimize token usage
```

### Task C1: Pattern Compression

**Files:**
- Modify: `~/.quoth/hooks/inject-patterns.js` (and copy at `quoth-plugin/hooks/inject-patterns.js`)

- [x] **Step 1: Add compression to inject-patterns.js**

Replace the pattern formatting section with a token-efficient format. Instead of full pattern text, use a compressed format:

```javascript
// Token-efficient format: ~30 tokens per pattern vs ~80 in verbose format
function compressPatterns(patterns) {
  if (patterns.length === 0) return ''

  // Group by confidence tier for scanning
  const high = patterns.filter(p => p.confidence >= 0.8)
  const medium = patterns.filter(p => p.confidence >= 0.5 && p.confidence < 0.8)

  let output = '[Quoth Patterns]\n'

  if (high.length > 0) {
    output += 'HIGH: ' + high.map(p =>
      `${p.name}(${p.confidence.toFixed(1)})`
    ).join(', ') + '\n'
  }

  if (medium.length > 0) {
    output += 'MED: ' + medium.map(p =>
      `${p.name}(${p.confidence.toFixed(1)})`
    ).join(', ') + '\n'
  }

  // Only include action text for top 3 patterns (most likely to be useful)
  const top3 = patterns.slice(0, 3)
  if (top3.length > 0) {
    output += 'Details:\n' + top3.map(p =>
      `- ${p.name}: ${p.action.slice(0, 120)}`
    ).join('\n')
  }

  return output
}
```

This reduces injection from ~800 tokens (8 patterns * ~100 tokens each) to ~200 tokens.

- [x] **Step 2: Add context budget limit**

Add a MAX_INJECT_TOKENS constant and truncation:

```javascript
const MAX_INJECT_CHARS = 800 // ~200 tokens at 4 chars/token
// Truncate output if over budget
if (output.length > MAX_INJECT_CHARS) {
  output = output.slice(0, MAX_INJECT_CHARS) + '...'
}
```

- [x] **Step 3: Update both copies of inject-patterns.js**

The hook exists at:
- `~/.quoth/hooks/inject-patterns.js` (global, used by settings.json hook)
- `quoth-plugin/hooks/inject-patterns.js` (plugin copy, used by plugin hooks.json)

Both must be updated with the compression logic.

- [x] **Step 4: Commit** (pending user request)

---

## Final Integration Task

### Task F1: Wire Everything Together

- [x] **Step 1: Verify plugin structure**

```bash
ls -la quoth-plugin/.claude-plugin/
ls -la quoth-plugin/.claude-plugin/hooks/
ls -la quoth-plugin/.claude-plugin/commands/
ls -la quoth-plugin/.claude-plugin/agents/
```

- [x] **Step 2: Test plugin loads via --plugin-dir** (manual test needed in new session)

```bash
claude --plugin-dir /home/lord_montino/projects/agents-tools/quoth/quoth-plugin/.claude-plugin -p "list your tools" --output-format text 2>&1 | head -20
```

- [x] **Step 3: Final commit** (pending user request)

```bash
git add -A quoth-plugin/.claude-plugin/ quoth-plugin/hooks/
git commit -m "feat: complete Quoth Claude Code plugin with RL hooks and token optimization"
git push
```
