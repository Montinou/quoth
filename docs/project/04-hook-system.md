# Hook System

Quoth's hook system integrates with Claude Code's lifecycle events to provide intelligence routing, trajectory capture, pattern injection, and command safety checks. All hooks are declared in `hooks/hooks.json` and execute via two entry points: the unified dispatcher (`hook-dispatch.js`) and the standalone trajectory capture script (`trajectory-capture.js`).

## Table of Contents

- [Hook Dispatcher](#hook-dispatcher)
- [Hook Events Reference](#hook-events-reference)
- [Trajectory Capture](#trajectory-capture)
- [Handler Detail](#handler-detail)
- [Project Name Resolution](#project-name-resolution)
- [Stdin Protocol](#stdin-protocol)

---

## Hook Dispatcher

**File:** `hooks/hook-dispatch.js`

The unified dispatcher is the single entry point for 8 of the 9 hook bindings (trajectory capture has its own script). It reads JSON from stdin, dispatches to the appropriate handler, and writes output to stdout.

### Invocation

```
node hook-dispatch.js <command> [args...]
```

Where `<command>` is one of: `route`, `session-restore`, `session-end`, `post-edit`, `post-task`, `pre-bash`, `subagent-start`, `stats`.

### Symlink Resolution

When deployed, hooks live at `~/.quoth/hooks/hook-dispatch.js` as symlinks pointing to the real source at `quoth-plugin/hooks/hook-dispatch.js`. The dispatcher resolves the real source location using `fs.realpathSync(__dirname)` to find the plugin root directory. This is critical because the dispatcher lazy-loads modules from `mcp/handlers/` and `daemon/db.js` relative to the plugin root.

```
~/.quoth/hooks/hook-dispatch.js  (symlink)
       |
       v
quoth-plugin/hooks/hook-dispatch.js  (real file)
       |
       QUOTH_PLUGIN = path.join(REAL_DIR, '..')  =>  quoth-plugin/
```

The `QUOTH_PLUGIN_DIR` environment variable can override this resolution.

### Lazy Loading

The dispatcher avoids loading heavy modules at startup to keep hook execution fast:

- **Intelligence handlers:** Loaded on first use via `require(QUOTH_PLUGIN/mcp/handlers/intelligence)`. This gives hooks direct access to `initGraph()`, `getContext()`, `applyFeedback()`, `consolidateGraph()`, and `getStats()` without any MCP roundtrip.
- **Database:** Loaded on first use via `require(QUOTH_PLUGIN/daemon/db.js).createDb(DB_PATH)`. Database path defaults to `~/.quoth/memory.db`.

Both are cached after first load so subsequent calls within the same hook invocation reuse the same instances.

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `QUOTH_HOME` | `~/.quoth` | Root directory for all Quoth state |
| `QUOTH_PLUGIN_DIR` | Auto-resolved via symlink | Override plugin root path |
| `CLAUDE_PROJECT_DIR` | `$HOME` | Project directory, set by Claude Code |
| `CLAUDE_SESSION_ID` | Generated | Session identifier |
| `PROMPT` | (none) | Fallback prompt source |
| `TOOL_INPUT_command` | (none) | Fallback tool input source |
| `TOOL_INPUT_file_path` | (none) | Fallback file path source |

### Error Handling

All handler errors are caught and logged as `[WARN]` messages to stdout. The dispatcher always exits with code 0 (via `process.exitCode = 0` and a final `process.exit(0)` in the `.finally()` block) to prevent hook failures from blocking Claude Code. The only exception is `pre-bash`, which exits with code 1 to block dangerous commands.

---

## Hook Events Reference

All hooks are declared in `hooks/hooks.json`. The `${CLAUDE_PLUGIN_ROOT}` variable is resolved by Claude Code to the plugin root directory.

| # | Event | Matcher | Command | Timeout | Purpose |
|---|-------|---------|---------|---------|---------|
| 1 | `PreToolUse` | `Bash` | `hook-dispatch.js pre-bash` | 2000ms | Block dangerous shell commands |
| 2 | `PostToolUse` | `Bash\|Write\|Edit\|MultiEdit\|Agent` | `trajectory-capture.js` | 3000ms | Capture tool calls to JSONL trajectory files |
| 3 | `PostToolUse` | `Write\|Edit\|MultiEdit` | `hook-dispatch.js post-edit` | 2000ms | Record file edit for intelligence graph |
| 4 | `UserPromptSubmit` | (all prompts) | `hook-dispatch.js route` | 3000ms | Route task to optimal agent, show relevant patterns |
| 5 | `SessionStart` | (all sessions) | `hook-dispatch.js session-restore` | 15000ms | Initialize intelligence graph, inject high-confidence patterns |
| 6 | `SessionEnd` | (all sessions) | `hook-dispatch.js session-end` | 10000ms | Consolidate intelligence graph, recompute PageRank |
| 7 | `PreCompact` | (all) | `hook-dispatch.js session-end` | 6000ms | Same consolidation as SessionEnd, triggered before context compression |
| 8 | `SubagentStart` | (all subagents) | `hook-dispatch.js subagent-start` | 3000ms | Inject domain-relevant patterns into subagent context |
| 9 | `SubagentStop` | (all subagents) | `hook-dispatch.js post-task` | 5000ms | Apply Bayesian success feedback to matched patterns |

### Execution Order for PostToolUse

When a `Write`, `Edit`, or `MultiEdit` tool completes, two hooks fire in sequence:

1. `trajectory-capture.js` (captures the raw tool call to JSONL)
2. `hook-dispatch.js post-edit` (records the edit for intelligence insights)

For `Bash` and `Agent` tools, only `trajectory-capture.js` fires.

### Timeout Design

Timeouts are calibrated to each hook's workload:

- **2000ms** for fast operations (pre-bash check, post-edit append)
- **3000ms** for moderate operations (trajectory capture with git, routing with graph lookup, subagent pattern injection)
- **5000ms** for feedback operations (post-task with Bayesian updates)
- **6000-15000ms** for heavy operations (session-end consolidation, session-restore with graph init)

---

## Trajectory Capture

**File:** `hooks/trajectory-capture.js`

A standalone fire-and-forget PostToolUse hook that captures all tool calls across all Claude Code sessions. It operates independently from the dispatcher to minimize latency (must exit under 1 second).

### Data Flow

```
Claude Code PostToolUse event
       |
       v  (JSON via stdin)
trajectory-capture.js
       |
       v  (append JSONL line)
~/.quoth/trajectories/{project}-{YYYY-MM-DD}.jsonl
```

### Entry Format

Each JSONL line contains a single JSON object with full context:

```json
{
  "event": "tool_use",
  "agent": "claude-code",
  "project": "quoth",
  "session": "session-abc123",
  "task": "Edit /home/user/src/db.js",
  "tool": "Edit",
  "tool_input": "file: /home/user/src/db.js, old: function foo()..., new: function bar()...",
  "tool_output": "File updated successfully",
  "outcome": "success",
  "user_intent": "arreglá el bug en la función de decay",
  "conversation_context": [
    "revisá el sistema de confidence scoring",
    "el decay no está funcionando",
    "arreglá el bug en la función de decay"
  ],
  "llm_reasoning": "Edit: replaced \"function foo()\" with \"function bar()\"",
  "pattern_used": null,
  "source": "claude-code",
  "timestamp": 1712188800000
}
```

### Field Details

| Field | Source | Description |
|-------|--------|-------------|
| `event` | Hardcoded | Always `"tool_use"` for tool calls, `"session_summary"` for summaries |
| `agent` | Hardcoded | Always `"claude-code"` |
| `project` | Git remote or directory name | Resolved via `resolveProjectName()` |
| `session` | `CLAUDE_SESSION_ID` env var | Falls back to `session-{timestamp}` |
| `task` | Tool name + summarized input | e.g., `"Edit /path/to/file.js"` or `"Bash npm test"` |
| `tool` | `hookData.tool_name` | The Claude Code tool that was used |
| `tool_input` | Sanitized tool input | Rich capture of what was passed to the tool (up to 500 chars) |
| `tool_output` | Sanitized tool result | Truncated output (up to 300 chars) |
| `outcome` | `hookData.tool_result.is_error` | `"success"` or `"failure"` |
| `user_intent` | `prompt-history.json` | Most recent user prompt (if < 5 min old, same session) |
| `conversation_context` | `prompt-history.json` | Last 3 user prompts in chronological order |
| `llm_reasoning` | Tool input fields | LLM's decision-making context extracted per tool type |
| `pattern_used` | (none) | Always `null` at capture time; set by daemon if applicable |
| `source` | Hardcoded | Always `"claude-code"` |
| `timestamp` | `Date.now()` | Unix milliseconds |

### Context Enrichment

**Prompt history:** The `route` handler (UserPromptSubmit) saves each user prompt to `~/.quoth/intelligence/prompt-history.json` as a rolling buffer of the last 5 prompts per session. Trajectory capture reads this to populate `user_intent` (latest) and `conversation_context` (last 3, chronological).

**LLM reasoning extraction (`extractReasoning`):** Extracts the LLM's decision-making signals from tool input fields:

| Tool Type | Reasoning Source | Example |
|-----------|-----------------|---------|
| Bash | `input.description` (LLM's explanation of the command) | `"Run tests to verify changes"` |
| Agent | `input.prompt` (LLM's delegation plan, 300 chars) + `input.description` | `"Research the auth middleware..."` |
| Write/Edit | Edit diff summary (`old_string` → `new_string`, 80 chars each) | `"Edit: replaced 'foo()' with 'bar()'"` |

**Rich tool input/output (`summarizeToolInput`, `summarizeToolOutput`):** Captures sanitized tool data for downstream LLM analysis:

| Tool | Input Captured | Max Length |
|------|---------------|-----------|
| Bash | Full command | 500 chars |
| Write | File path + content start | 200 chars content |
| Edit | File path + old/new strings | 150 chars each |
| Read | File path + offset/limit | — |
| Glob/Grep | Pattern + path + glob filter | — |
| Agent | Type + description + prompt | 200 chars prompt |

### Data Sanitization

All `tool_input` and `tool_output` fields are passed through `sanitize()` before writing to JSONL. The sanitizer redacts:

| Pattern | Example | Replacement |
|---------|---------|-------------|
| API keys (`sk_`, `qth_`, `ghp_`, `vck_`, etc.) | `qth_abc123def456...` | `[REDACTED_KEY]` |
| JWT tokens | `eyJhbGciOi...` | `[REDACTED_JWT]` |
| UUIDs | `550e8400-e29b-41d4-...` | `[REDACTED_UUID]` |
| Long hex strings (32+ chars) | `a1b2c3d4e5f6...` | `[REDACTED_HEX]` |
| Password URLs | `postgres://user:pass@host` | `postgres://user:[REDACTED]@host` |
| Env-style secrets | `API_KEY=supersecret` | `API_KEY=[REDACTED]` |
| Long base64 (60+ chars) | (base64 blob) | `[REDACTED_B64]` |

Normal text, file paths, and code are preserved.

### Input Summarization (legacy `task` field)

The `summarizeInput()` function extracts the most relevant piece of information from the tool input for the compact `task` field:

| Tool Type | Summary Source | Example |
|-----------|---------------|---------|
| File operations | `input.file_path` or `input.path` | `/home/user/src/index.js` |
| Bash | `input.command` (truncated to 80 chars) | `npm run build` |
| Search | `input.pattern` or `input.query` | `function.*export` |
| Other | First 80 chars of stringified input | (varies) |

### Output

The script writes `{}` to stdout to signal success to the Claude Code hook system. Errors are silently swallowed (fire-and-forget design).

### File Organization

Trajectory files are organized by project and date:

```
~/.quoth/trajectories/
  quoth-2026-04-04.jsonl
  sales-companion-2026-04-04.jsonl
  portfolio-2026-04-03.jsonl
```

The daemon's file watcher monitors this directory and processes new entries.

---

## Handler Detail

### `route` (UserPromptSubmit)

Routes the user's prompt to an optimal agent type and displays relevant intelligence patterns. Also persists the prompt for trajectory context enrichment.

**Execution flow:**

1. **Persist prompt history:** Save the user's prompt (truncated to 500 chars) to `~/.quoth/intelligence/prompt-history.json` as a rolling buffer of the last 5 prompts. The buffer resets when the session ID changes. This allows `trajectory-capture.js` to include nearby user intents with each tool call.
2. Call `intelligence.getContext(prompt, 5)` to search the intelligence graph for entries matching the prompt. Uses trigram-based Jaccard similarity weighted with PageRank scores. No API calls involved.
3. Filter results to entries with `score >= 0.1`.
4. Display up to 3 relevant patterns with their score, summary, rank, and access count:
   ```
   [INTELLIGENCE] Relevant patterns for this task:
     * (0.42) Auth must not hard-fail on missing JWT claims [rank #1, 3x accessed]
     * (0.28) Drizzle arrays use {id1,id2} format [rank #2, 7x accessed]
   ```
5. Call `intelligence.routeTask(prompt)` for keyword-based agent recommendation. Matches the prompt against `TASK_PATTERNS` (~20 regex pattern groups, English + Spanish, mapping to 8 agent types). Default: `coder` at 0.5 confidence.
6. Call `routing.getAlternatives(primaryAgent)` to get 2 alternative agent types.
7. Output formatted routing table with primary recommendation box, alternative agents table, and estimated metrics.

**Output format:**

```
[INFO] Routing task: implement user authentication...

Routing Method
  - Method: keyword
  - Backend: quoth-intelligence
  - Latency: 0.234ms
  - Matched Pattern: implement|create|build|add|write code

+------------------- Primary Recommendation -------------------+
| Agent: coder                                                  |
| Confidence: 80.0%                                             |
| Reason: Matched pattern: implement|create|build|add|write cod |
+--------------------------------------------------------------+

Alternative Agents
+------------+------------+-------------------------------------+
| Agent Type | Confidence | Reason                              |
+------------+------------+-------------------------------------+
| tester     |      60.0% | Alternative agent for tester capab  |
| reviewer   |      50.0% | Alternative agent for reviewer capa |
+------------+------------+-------------------------------------+

Estimated Metrics
  - Success Probability: 70.0%
  - Estimated Duration: 10-30 min
  - Complexity: LOW
```

### `session-restore` (SessionStart)

Initializes the intelligence graph, injects project context files, and injects high-confidence patterns for the current project.

**Execution flow:**

1. Call `intelligence.initGraph(db)` to build/refresh the intelligence graph:
   - Loads entries from `~/.quoth/intelligence/store.json` (cached store).
   - If no store exists, bootstraps from two sources:
     - **Memory files:** Parses `.md` files from `~/.claude/projects/*/memory/` and `~/.quoth/memory/`. Splits by markdown headers, creates entries with `type: 'semantic'`.
     - **Pattern DB:** Loads top 50 patterns from SQLite via `db.getTopPatterns()`. Creates entries with `type: 'pattern'`.
   - Builds edges using `buildEdges()`: temporal edges (same source file) and similarity edges (Jaccard trigram similarity > 0.3 within categories).
   - Computes PageRank (damping factor 0.85, max 30 iterations, convergence threshold 1e-6).
   - Caches graph state to `graph-state.json` and ranked entries to `ranked-context.json`.
   - Cache TTL: 60 seconds. Returns early on cache hit.
2. **Inject project context** (v3.2.0 addition): Resolves the current project name and searches three locations in order:
   - **Plugin-bundled context** (`quoth-plugin/context/{project}.md`): Project-specific context files shipped with the plugin. If found, its contents are printed to stdout (injected into session context). Marks `contextInjected = true` and stops searching plugin-bundled files.
   - **Fallback summary** (`quoth-plugin/context/project-summary.md`): Only used if no project-specific file was found AND the current project is `quoth` itself. Prevents the generic summary from being injected in non-quoth sessions.
   - **Project-local context** (`{CLAUDE_PROJECT_DIR}/.quoth-context.md`): Checked independently — injected in addition to the above if it exists. Allows project-local overrides without modifying the plugin.
3. Load project patterns from SQLite filtered to `confidence >= 0.6`, max 3 results.
4. Output pattern summaries:
   ```
   [Quoth] 2 patterns loaded for project "quoth":
   - [0.85] auth-resilience: Use DB fallback for optional JWT claims
   - [0.72] drizzle-arrays: Format JS arrays as {id1,id2} for Postgres ANY()
   ```

**Context injection lookup order:**

| Priority | Path | Condition |
|----------|------|-----------|
| 1 | `quoth-plugin/context/{project}.md` | Always checked first |
| 2 | `quoth-plugin/context/project-summary.md` | Fallback, only if `project === 'quoth'` and no project-specific file found |
| 3 | `{CLAUDE_PROJECT_DIR}/.quoth-context.md` | Always checked, injected in addition to above |

The context files are printed as plain markdown to stdout. Claude Code injects stdout from `SessionStart` hooks into the session's system context, making the content available at the start of every conversation without occupying tool call budget.

### `session-end` (SessionEnd / PreCompact)

Consolidates the intelligence graph, writes a session summary to the trajectory JSONL, and signals the daemon for batch processing.

**Execution flow:**

1. **Intelligence consolidation:** Call `intelligence.consolidateGraph(db)`:
   - Load `store.json` (the entry store).
   - Process `pending-insights.jsonl`: count edits per file. Files edited 3+ times in a session get a new "frequently edited" insight entry added to the store (type: `procedural`, namespace: `insights`).
   - Clear pending insights file.
   - Refresh from pattern DB: add any new patterns not already in the store.
   - Apply confidence decay to unaccessed entries in the graph: entries with 0 access count and age > 24 hours lose 0.005 confidence per day (minimum 0.05).
   - Rebuild edges and recompute PageRank.
   - Save snapshot to `snapshots.json` (keeps last 50 snapshots) for trend analysis.
2. Output consolidation summary:
   ```
   [INTELLIGENCE] Consolidated: 47 entries, 23 edges, 3 new, PageRank recomputed
   ```
3. **Write session summary:** Read today's trajectory JSONL file, filter `tool_use` entries matching the current `CLAUDE_SESSION_ID`, and append a `session_summary` entry:
   ```json
   {
     "event": "session_summary",
     "session": "session-abc123",
     "project": "quoth",
     "task": "Session: 45 tool calls (Edit:18, Read:12, Bash:10). 43 ok, 2 fail.",
     "tool_counts": {"Edit": 18, "Read": 12, "Bash": 10},
     "total_calls": 45,
     "success_rate": 0.955,
     "user_intents": ["fix the auth bug", "update the docs"],
     "llm_reasonings": ["Check git status", "Run tests after edit"],
     "outcome": "success",
     "source": "session-end",
     "timestamp": 1712345678000
   }
   ```
   The `user_intents` field collects unique prompts from `user_intent` fields across tool entries. The `llm_reasonings` field collects unique reasoning snippets (last 10, deduped).
4. **Signal daemon:** Read `~/.quoth/daemon.pid` and send `SIGUSR1` to trigger immediate processing of the session summary via batch distill.

This hook fires on both `SessionEnd` (normal session close, Ctrl+C) and `PreCompact` (context compression). PreCompact is the more frequent trigger — it acts as a natural "checkpoint" so batch distill processes manageable chunks rather than waiting for sessions that may last hours.

### `post-edit` (PostToolUse: Write/Edit/MultiEdit)

Records a file edit for later consolidation into intelligence insights.

**Execution flow:**

1. Extract `file_path` from hook input. Checks multiple locations:
   - `hookInput.file_path`
   - `hookInput.toolInput.file_path`
   - `TOOL_INPUT_file_path` env var
2. Append a JSON line to `~/.quoth/intelligence/pending-insights.jsonl`:
   ```json
   {"type":"edit","file":"/home/user/src/auth.js","timestamp":1712188800000}
   ```
3. Output: `[OK] Edit recorded`

Creates the `~/.quoth/intelligence/` directory if it does not exist.

### `post-task` (SubagentStop)

Applies positive Bayesian feedback to patterns that were matched during the subagent's execution. This is a dual-update mechanism that keeps both the intelligence graph JSON files and the SQLite pattern database in sync.

**Execution flow:**

1. Call `intelligence.applyFeedback(true)`:
   - Read `last-matched.json` to get the IDs of patterns that were matched during the session.
   - Apply `+0.05` confidence delta to matched entries in `ranked-context.json` (clamped to [0, 1]).
   - Apply `+0.05` confidence delta to matched nodes in `graph-state.json`.
   - Increment `accessCount` on all matched entries.
   - Return the list of boosted IDs.
2. For each boosted ID with a `pat-` prefix (indicating a SQLite pattern):
   - Strip the `pat-` prefix to get the real pattern ID.
   - Call `db.applyBayesianUpdate(patternId, 'success')` to increment the alpha parameter and recalculate Bayesian confidence in the SQLite database.
3. Output: `[OK] Task completed`

### `pre-bash` (PreToolUse: Bash)

Checks shell commands against a blocklist of dangerous operations.

**Blocked commands:**

| Pattern | Description |
|---------|-------------|
| `rm -rf /` | Recursive force-delete of root filesystem |
| `format c:` | Windows disk format |
| `del /s /q c:\` | Windows recursive delete |
| `:(){:\|:&};:` | Fork bomb |

**Execution flow:**

1. Extract `command` from hook input, convert to lowercase.
2. Check if the command string contains any blocked pattern (substring match).
3. If blocked: print `[BLOCKED] Dangerous command detected: {pattern}` to stderr and `process.exit(1)`. This causes Claude Code to reject the tool use.
4. If safe: print `[OK] Command validated` to stdout.

### `subagent-start` (SubagentStart)

Injects domain-relevant patterns from the SQLite database into the subagent's context.

**Execution flow:**

1. Load the SQLite database. If unavailable, return silently.
2. Resolve the project name from `CLAUDE_PROJECT_DIR`.
3. Load up to 10 project patterns from SQLite via `db.getProjectPatterns(project, 10)`.
4. If no patterns, return silently.
5. Score each pattern for relevance to the subagent's domain using a keyword map:

   | Agent Type | Domain Keywords |
   |------------|----------------|
   | `coder` | code, implement, write, function, module, refactor |
   | `tester` | test, spec, coverage, assert, mock, fixture |
   | `reviewer` | review, quality, lint, convention, style |
   | `researcher` | search, find, explore, document, investigate |
   | `planner` | plan, design, architect, structure, organize |
   | `security` | security, auth, token, credential, vulnerability |

   For unknown agent types, the type string is tokenized (split on `-`, `_`, spaces) and used as keywords.

6. Each pattern is scored by counting how many domain keywords appear in its `name`, `condition`, `action`, and `tags` fields.
7. Filter to patterns with `relevance > 0` or `confidence >= 0.7`. Sort by relevance (descending), then confidence (descending). Take top 5.
8. Output JSON with `additionalContext` field for Claude Code to inject:
   ```json
   {
     "additionalContext": "[Quoth] 3 patterns for coder agent (project: quoth):\n- [0.85] auth-resilience: Use DB fallback for optional JWT claims\n- [0.72] drizzle-arrays: Format JS arrays as {id1,id2} for Postgres\nUse quoth_search_patterns for deeper semantic search."
   }
   ```

### `stats`

Returns intelligence diagnostics as JSON. Used for debugging and monitoring.

**Output structure:**

```json
{
  "graph": { "nodes": 47, "edges": 23, "density": 0.0213 },
  "confidence": { "min": 0.050, "max": 0.950, "mean": 0.523 },
  "access": { "total": 142, "used": 28 },
  "pageRank": { "topNode": "pat-a1b2c3d4e5f6", "topNodeRank": 0.0847 },
  "edgeTypes": { "temporal": 12, "similar": 11 },
  "pendingInsights": 3,
  "snapshots": 15,
  "topPatterns": [...],
  "delta": { "elapsed": "45m", "nodes": 2, "edges": 1 }
}
```

---

## Project Name Resolution

Both `hook-dispatch.js` and `trajectory-capture.js` share the same `resolveProjectName()` logic:

1. **Git remote origin** (preferred): Run `git remote get-url origin` in the project directory (1-second timeout). Extract the repository name from the URL using regex `[/:]([^/]+\/([^/]+?))(\.git)?$`. Returns the repo name in lowercase (e.g., `sales-companion` from `Montinou/sales-companion.git`).

2. **OpenClaw workspace** (fallback): If the directory matches `/.openclaw/workspaces/([^/]+)/repo`, use the workspace name (e.g., `sales` from `~/.openclaw/workspaces/sales/repo/`).

3. **Parent directory** (fallback): If the basename is `repo` or `src`, use the parent directory name.

4. **Basename** (final fallback): Use the directory basename directly.

---

## Stdin Protocol

Claude Code sends hook data as a JSON object via stdin. The dispatcher reads stdin with a 500ms timeout (via `setTimeout`) to handle cases where no data is provided.

**Input parsing priority for prompt/command:**

1. `hookInput.prompt` (UserPromptSubmit)
2. `hookInput.command` (PreToolUse: Bash)
3. `hookInput.toolInput` (PostToolUse)
4. `PROMPT` env var
5. `TOOL_INPUT_command` env var
6. Remaining CLI arguments joined with spaces

For `post-edit`, `pre-bash`, and `subagent-start`, the raw `hookInput` object is passed directly to the handler. For `route`, the resolved prompt string is passed. For `session-restore`, `session-end`, `post-task`, and `stats`, no arguments are passed.
