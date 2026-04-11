# Spec: Extract Pipeline v2 — Thinking + Tool Calling + Rich Persistence

**Version**: 1.2
**Date**: 2026-04-10
**Status**: Approved (spec review passed, v1.2 — factual corrections applied)
**Builds on**: 2026-04-09-intent-outcome-temporal.md (EXTRACT pipeline)

## Problem

The current EXTRACT pipeline produces generic, tautological patterns. Analysis of 516 active patterns reveals:

1. **Patterns are obvious** — "Preserve existing code structure during edits", "Search for specific keywords across files" describe what any LLM does by default. They add zero signal.
2. **condition/action are broken** — `condition` is hardcoded to `Session: {task.slice(0,100)}` which is just tool counts (e.g. "Session (synthetic): 17 tool calls (Bash:14, Write:2)"). `action` is an exact copy of `name`. Both fields are useless.
3. **intention is discarded** — The LLM returns an `intention` field describing *when/why* to use the pattern. It's never persisted.
4. **The LLM has no context** — `tool_input` and `tool_output` are captured in trajectory JSONL by `trajectory-capture.js` (via `summarizeToolInput()` / `summarizeToolOutput()` with sanitization), but `buildPrompt()` in `extract.js` never passes them to the LLM. It only uses `e.task` (a short 100-char summary like "Bash grep -r foo") and `e.llm_reasoning`. The LLM sees tool names and truncated task summaries but not the actual inputs, outputs, or file contents. It guesses generically.
5. **Thinking is disabled** — `callMoonshot()` passes `thinking: { type: 'disabled' }`. K2.5's reasoning capability is wasted.
6. **JSON parsing is fragile** — Regex-based extraction (`parseJson()`) instead of using K2.5's native JSON mode.

### Root Cause Chain

```
tool_input/tool_output available in JSONL but not passed to extraction LLM
  → buildPrompt() only uses e.task (truncated 100-char summary) + e.llm_reasoning
    → LLM sees "Bash grep -r foo" not what was found or what files were edited
      → LLM generates generic descriptions of tool calls
        → condition = session task string (useless)
        → action = copy of name (redundant)
          → patterns are noise
```

## Design: EXTRACT v2

### Model & API Target

**Kimi K2.5 via Moonshot API directly** (`api.moonshot.ai`). Not routed through Vercel AI Gateway.

Rationale: `extract.js` has always called `callMoonshot()` directly — it was never migrated to the gateway. The gateway uses Gemini Flash Lite as default, which lacks thinking mode and has different tool calling semantics. K2.5 is the right model for this task: 256K context, native thinking, tool calling, and JSON mode.

The existing `callLLM()` / `callGateway()` paths in `llm.js` are untouched — they serve other daemon tasks (consolidation, doc-updater, etc).

### Architecture

Split the LLM call into system message (cacheable, static) and user message (per-session). Enable thinking mode. Give K2.5 tools to read files and search code that was referenced in the session.

```
┌─────────────────────────────────────┐
│ SYSTEM MESSAGE (cached via hash)    │
│ - Role + extraction instructions    │
│ - Tool definitions                  │
│ - Good/bad pattern examples         │
│ - Output JSON schema                │
└──────────────────┬──────────────────┘
                   │
┌──────────────────▼──────────────────┐
│ USER MESSAGE (per-session)          │
│ - Project, outcome, user intents    │
│ - Up to 60 tool entries with:       │
│   tool_input, user_intent, reasoning│
└──────────────────┬──────────────────┘
                   │
          ┌────────▼────────┐
          │ K2.5 + thinking │
          │ + tool calling  │
          └───────┬─────────┘
                  │
          ┌───────▼────────┐
          │ Tool loop       │◄── dynamic max calls
          │ read_file()     │    (2/5/8 by session size)
          │ grep_codebase() │
          └───────┬────────┘
                  │
          ┌───────▼────────┐
          │ Final response  │
          │ JSON (parsed)   │
          │ patterns[] with │
          │ condition/action│
          │ separated       │
          └────────────────┘
```

### What Changes

| Current | v2 |
|---|---|
| `thinking: { type: 'disabled' }` | Thinking enabled (default K2.5 behavior) |
| Regex JSON parsing + `jsonPrefill` hack | Attempt `response_format: json_object` first; if API rejects (combo with tools), fall back to `jsonPrefill` + `parseJson()` |
| 30 tool entries, input buried in `e.task` (truncated 100 chars), raw `tool_input`/`tool_output` from JSONL unused | 60 tool entries with raw `tool_input` content (up to 300 chars) |
| LLM can't see file contents or results | `read_file` + `grep_codebase` tools |
| Static `max_tokens: 600` | `max_tokens: 16384` (thinking needs headroom) |
| Single-turn LLM call | Multi-turn tool calling loop |
| `condition` = session task string | `condition` = LLM-generated "when to apply" |
| `action` = copy of `name` | `action` = LLM-generated "what to do" |
| `intention` discarded | `intention` persisted in `description` column |
| No prompt caching | `prompt_cache_key: sha256(systemPrompt)` |
| HTTP timeout 30s | HTTP timeout 120s (thinking mode is slow) |

### What Does NOT Change

- MiniLM-L6-v2 local embeddings (384d, $0)
- Embedding dedup at write time (0.92 threshold)
- Bayesian confidence scoring (Beta distribution)
- Daily extract cap (50/day)
- Fallback to Claude Sonnet on K2.5 failure
- File watcher + scanAndEnqueue flow
- Session summary detection and tool entry collection

## Detailed Design

### 1. Tool Definitions for K2.5

Two tools, executed locally by the daemon:

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "Read a file from the local filesystem. Use this to understand code that was edited or referenced during the session. Returns file contents (truncated to maxLines).",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "Absolute path to the file"
            },
            "maxLines": {
              "type": "integer",
              "description": "Maximum lines to return (default 100, max 200)",
              "default": 100
            }
          },
          "required": ["path"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "grep_codebase",
        "description": "Search for a pattern in the project codebase. Use this to understand how a function/component is used across the project. Returns matching lines with file paths.",
        "parameters": {
          "type": "object",
          "properties": {
            "pattern": {
              "type": "string",
              "description": "Regex pattern to search for"
            },
            "path": {
              "type": "string",
              "description": "Directory to search in (defaults to project root)"
            },
            "maxResults": {
              "type": "integer",
              "description": "Maximum matching lines to return (default 30, max 50)",
              "default": 30
            }
          },
          "required": ["pattern"]
        }
      }
    }
  ]
}
```

### 2. Tool Execution in Daemon

New module: `daemon/lib/tool-executor.js`

Responsibilities:
- `read_file(path, maxLines)`: `fs.readFileSync` with line limit, returns numbered lines. Hard cap: 200 lines.
- `grep_codebase(pattern, path, maxResults)`: Uses `rg` (ripgrep) for speed. Excludes `node_modules/`, `.git/`, binary files via `rg -I --glob '!node_modules' --glob '!.git'`. Hard cap: 50 results.
- All outputs sanitized via `REDACT_PATTERNS` (reused from `trajectory-capture.js`) **before** sending to K2.5 as tool results.
- Timeout: 15s per tool execution (kill on timeout). Ripgrep is fast enough for large repos within this window.

Security:
- File reads are unrestricted (daemon runs locally, user chose this in design). Tool results are sanitized before being sent to K2.5. Patterns are sanitized again before DB persistence.
- Path traversal is a non-issue: the daemon already has full filesystem access and patterns never leave the local system (except via explicit cloud promotion which has its own sanitization).

### 3. Dynamic Tool Call Budget

Based on session size (number of tool entries in the trajectory):

| Tool entries | Max tool calls | Rationale |
|---|---|---|
| 1-10 | 2 | Small session, quick context check |
| 11-30 | 5 | Normal session, explore key files |
| 31+ | 8 | Complex session, deeper exploration |

Implementation:
- Pass `tool_choice: "auto"` on each turn while budget remains.
- If K2.5 returns N parallel tool calls in one message, all N count against the budget. If this exceeds the remaining budget, still execute them (the call was already made) but set `tool_choice: "none"` on the next turn.
- After budget exhausted, one final call with `tool_choice: "none"` to force the content response.
- Safety cap: max 12 total loop iterations regardless of budget (prevents infinite loops from malformed responses).
- Total token budget cap: 100K tokens across all turns. If cumulative `prompt_tokens + completion_tokens` exceeds this, force `tool_choice: "none"` on the next turn. Prevents runaway costs on complex sessions.

### 4. System Message (Cacheable)

The system message contains all static instructions. It is separated from the per-session user message to enable prompt caching.

```
You are analyzing coding sessions to extract reusable engineering patterns.

You have tools to read files and search code from the session's project.
Use them to understand WHAT ACTUALLY HAPPENED — don't guess from tool names alone.

EXTRACTION RULES:
1. Use your tools to read the key files that were edited or referenced.
   Focus on files that were Written/Edited, not just Read.
2. Extract patterns that encode a TRANSFERABLE TECHNIQUE — not a description
   of what tools were used.
3. Each pattern has TWO parts:
   - condition: WHEN to apply this (situation, context, signals)
   - action: WHAT to do (the technique, approach, or decision)
4. A good pattern helps someone in a SIMILAR situation make a better decision.
   A bad pattern describes obvious tool usage.

GOOD PATTERNS:
- condition: "When adding a NOT NULL column to a table with existing data in a
  Next.js app using Drizzle ORM"
  action: "Add the column as nullable first, backfill with a default via SQL,
  then alter to NOT NULL — Drizzle's push won't handle this in one step"
- condition: "When debugging hydration mismatches in Next.js App Router where
  the component uses Date formatting"
  action: "Move date formatting to a client-only useEffect or pass the
  formatted string from the server as a prop — SSR and client locales diverge"

BAD PATTERNS (do NOT extract):
- "Read file then edit it" (obvious)
- "Use grep to find code" (describes a tool, not a technique)
- "Preserve existing code structure" (tautological)
- "Run tests after changes" (standard practice)

OUTPUT FORMAT:
Respond with JSON:
{
  "patterns": [
    {
      "condition": "when/situation (50-150 chars)",
      "action": "what to do and why (100-250 chars)",
      "tags": ["domain1", "domain2"],
      "quality_signal": "universal" | "domain" | "project" | "edge_case"
    }
  ]
}

Return {"patterns": []} if no genuine technique emerged.
```

**Note:** The current extract.js uses a `session_type` field ("productive" | "routine") to short-circuit routine sessions before pattern validation. The v2 schema drops `session_type` — an empty `patterns` array serves the same purpose. The `parsePatterns()` function should treat both `{"patterns": []}` and `{"session_type": "routine", "patterns": []}` as valid empty results for backward compatibility during the transition.

### 5. User Message (Per-Session)

```
SESSION:
- Project: {project}
- Outcome: {outcome} (success rate: {successRate}%)
- User intents: {intents joined by ' -> '}

ACTIONS ({count} tool calls, chronological):
{for each tool entry:}
  {i}. [{tool}] {task.slice(0, 150)}
     Input: {tool_input.slice(0, 300)}
     Intent: {user_intent || 'not captured'}
     Reasoning: {llm_reasoning.slice(0, 150)}
{end for}

Use your tools to read files that were edited or referenced above,
then extract patterns.
```

Key differences from current `buildPrompt()`:
- Includes `tool_input` content (not just task description)
- Includes `user_intent` per entry
- 60 entries max (up from 30)
- No inline examples (moved to system message for caching)

### 6. Multi-Turn Loop in extract()

```
function extract(summaryEntry, toolEntries, db):
  systemPrompt = buildSystemPrompt()
  userPrompt = buildUserPrompt(summaryEntry, toolEntries)
  cacheKey = sha256(systemPrompt).slice(0, 16)

  maxCalls = toolEntries.length <= 10 ? 2
           : toolEntries.length <= 30 ? 5
           : 8

  messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]

  toolCallCount = 0
  totalTokens = 0

  loop (max 12 iterations):
    forceContent = toolCallCount >= maxCalls || totalTokens >= 100000

    response = callMoonshotWithTools(messages, {
      tools: TOOL_DEFINITIONS,
      tool_choice: forceContent ? 'none' : 'auto',
      maxTokens: 16384,
      promptCacheKey: cacheKey,
    })

    totalTokens += response.usage.prompt_tokens + response.usage.completion_tokens

    if response has tool_calls AND NOT forceContent:
      // Append assistant message (preserve reasoning_content for K2.5)
      messages.push({
        role: 'assistant',
        content: response.content || null,
        reasoning_content: response.reasoning_content || undefined,
        tool_calls: response.tool_calls,
      })

      // Execute each tool call locally
      for each tool_call in response.tool_calls:
        result = executeToolCall(tool_call)
        messages.push({
          role: 'tool',
          tool_call_id: tool_call.id,
          content: sanitize(result)
        })
        toolCallCount++

      continue loop

    if response has content (final answer):
      return parsePatterns(response.content)

  // Exhausted iterations without content — return empty
  return []
```

**`reasoning_content` handling:** K2.5 returns thinking output in a separate `reasoning_content` field on assistant messages. When building the multi-turn context, this field MUST be preserved in the conversation history per Moonshot docs, or the API will error. The `callMoonshotWithTools()` function returns the full message object so the caller can preserve it.

**JSON mode strategy:** Attempt `response_format: { type: 'json_object' }` on the first call. If the Moonshot API rejects the combination of tools + JSON mode (HTTP 400 or specific error code), retry without `response_format` and fall back to the existing `parseJson()` regex extractor for the final content response. Cache which mode works to avoid retrying on subsequent sessions. This is a one-time discovery at daemon startup.

### 7. Return Shape of extract()

Current return shape:
```javascript
{ id, pattern, tags, intention, quality_signal, embedding, source }
```

v2 return shape:
```javascript
{ id, condition, action, tags, quality_signal, embedding, source }
```

- `id` = `sha1(condition + action).slice(0, 12)` (hash of both fields, not just one)
- `condition` = the "when" from the LLM (50-150 chars)
- `action` = the "what to do" from the LLM (100-250 chars)
- `embedding` = MiniLM embedding of `condition + " → " + action` (combined for richer semantic matching)
- `tags`, `quality_signal`, `source` = same as before

The `pattern` and `intention` fields are removed from the return shape. Callers use `condition` and `action` instead.

### 8. Persistence Fix in insertNewPattern()

Current (broken):
```javascript
name: distilled.pattern.slice(0, 200),        // = pattern text
condition: `Session: ${task.slice(0, 100)}`,   // = "Session (synthetic): 17 tool calls..."
action: distilled.pattern,                     // = same as name (!!!)
```

v2 (fixed):
```javascript
name: distilled.action.slice(0, 200),          // = "What to do" (searchable, used in dedup)
condition: distilled.condition,                 // = "When X situation..." (full from LLM)
action: distilled.action,                      // = "What to do and why" (full from LLM)
description: distilled.condition,              // = condition duplicated here for search display
```

**Why `name` = `action`:** The `name` column is used by `findDuplicateByName()` for prefix-based dedup matching. Two patterns with the same technique (action) but triggered by different situations (condition) should dedup — the technique is what matters for dedup, not the trigger. This preserves compatibility with existing name-based dedup logic, which compares technique descriptions against technique descriptions.

**Embedding text for dedup:** `findDuplicateByEmbedding()` uses the `embedding` column. In v2, embeddings are generated from `condition + " → " + action`, giving richer semantic signal than just the action alone.

**Transition period risk:** During rollout, new patterns (embedded from `condition → action` text) will be compared against existing patterns (embedded from `pattern` text only). These represent different embedding distributions — cosine similarity between them will be systematically lower, risking duplicate creation. Mitigation options:
1. **Recommended:** On first daemon restart after deployment, re-embed all active patterns using the new `condition + " → " + action` text format (use existing `name` + `action` columns as source since `name ≈ action` in v1 patterns). This is a one-time batch of ~500 embeddings via MiniLM (local, ~2 seconds).
2. **Alternative:** Temporarily lower the dedup threshold from 0.92 to 0.85 for the first 48 hours, then restore after the v1 pattern population has been re-embedded or displaced.

### 9. Prompt Caching

K2.5 supports `prompt_cache_key` for caching repeated prompt prefixes.

- System message is static between sessions → cacheable
- Cache key: `sha256(systemPrompt).slice(0, 16)` — auto-invalidates on prompt changes
- Passed as top-level parameter in the API request body
- Cache TTL is ~5 minutes on Moonshot. Savings are most significant when multiple sessions process in quick succession (batch processing after a long coding session). For isolated sessions throughout the day, cache hits will be infrequent. Still worth implementing — it's one line of code and helps in burst scenarios.

### 10. callMoonshotWithTools() in llm.js

New function alongside existing `callMoonshot()`:

```javascript
async function callMoonshotWithTools(messages, {
  tools,
  tool_choice = 'auto',
  maxTokens = 16384,
  promptCacheKey = null,
  responseFormat = null,  // { type: 'json_object' } or null
} = {})
```

Key implementation details:
- Accepts full `messages` array (system + user + assistant + tool messages)
- Supports `tools` and `tool_choice` parameters
- `thinking` left as default (enabled) — do NOT pass `thinking: { type: 'disabled' }`
- HTTP timeout: **120s** (up from 30s — thinking mode + tool calling is slow)
- Returns full response object: `{ message, tool_calls, content, reasoning_content, usage }`
  - `message`: the full assistant message object (for appending to history)
  - `tool_calls`: array of tool call objects (null if final content response)
  - `content`: text content (null if tool call response)
  - `reasoning_content`: thinking output (must be preserved in conversation history)
  - `usage`: `{ prompt_tokens, completion_tokens }` for token budget tracking
- `prompt_cache_key` passed when provided
- Does NOT use the `jsonPrefill` hack (JSON mode or regex fallback handles this)

The existing `callMoonshot()` is unchanged — other daemon tasks depend on it. Note: `extract.js` currently calls `callMoonshot(prompt, 600, { jsonPrefill: true })` which uses the partial prefill hack (assistant message starting with `{`). The v2 migration removes this dependency entirely — `callMoonshotWithTools()` uses JSON mode or regex fallback instead.

### 11. Fallback Behavior

**K2.5 failure (API error, timeout, malformed response):**

1. Log to `pipeline_errors` with full context (same as today)
2. Fall back to `claude -p --model claude-sonnet-4-6` with system + user prompt concatenated as a single text input (separated by `\n---\n`). No tool calling, no thinking — single-turn text extraction.
3. Sonnet fallback uses the enriched prompt (tool_input, user_intent) but can't read files. Still better than current because the prompt itself carries more context.
4. Parse Sonnet response with existing `parseJson()` regex extractor.

**Tool execution failure (file not found, grep error, timeout):**
- Return error message as tool result: `"Error: file not found: /path/to/file"`
- K2.5 handles this gracefully (it's a coding model, expects errors)
- Counts against tool call budget (the call was made, budget reflects API round-trips)

**Feature combination failure (thinking + tools + JSON mode rejected by API):**
- On first call, if API returns HTTP 400 with error mentioning `response_format`, retry without `response_format`. Cache the discovery in a module-level boolean `jsonModeSupported` so subsequent sessions skip the failed attempt.
- If thinking + tools is rejected, this is a critical failure — fall back to Sonnet entirely (the whole value of this spec is K2.5's tool calling + thinking).

### 12. Project Root Resolution for Tool Execution

Tool calls need a project root path to resolve relative paths and as default `grep_codebase` directory. The trajectory entries contain `project` (a git remote name like "ips" or "quoth") but not the filesystem path.

**Note:** The existing `detectProjectFromTask()` in `daemon.js` maps file path patterns → project names (e.g. `/IPS_audit\/IPS/` → `'ips'`). It does the *reverse* of what's needed here. A **new** reverse mapping must be built for `resolveProjectRoot()`.

Resolution strategy in `tool-executor.js`:
1. Extract file paths from the session's tool entries (`tool_input` fields). Find the common ancestor directory.
2. If no paths found, use a new `resolveProjectRoot(project)` function with an explicit name→path mapping:
   ```javascript
   const PROJECT_ROOTS = {
     'ips': '/home/lord_montino/IPS_audit/IPS',
     'quoth': '/home/lord_montino/projects/agents-tools/quoth',
     'exolar': '/home/lord_montino/projects/agents-tools/exolar',
     'triqual': '/home/lord_montino/projects/agents-tools/triqual',
     // Add as needed — or auto-discover via `find ~ -name .git -type d`
   }
   ```
   This is distinct from `detectProjectFromTask()` which maps paths→names.
3. Pass the resolved project root to `executeToolCall()` so `grep_codebase` has a default search directory.

## Files Modified

| File | Changes |
|---|---|
| `daemon/pipeline/extract.js` | Rewrite `buildPrompt()` → `buildSystemPrompt()` + `buildUserPrompt()`. Rewrite `extract()` with multi-turn tool loop. New `parsePatterns()` for condition/action schema. Keep `parseJson()` as fallback. Update return shape to `{ id, condition, action, ... }`. |
| `daemon/lib/llm.js` | New `callMoonshotWithTools()` function (120s timeout, full message support, tool calling). Keep existing `callMoonshot()` unchanged. |
| `daemon/lib/tool-executor.js` | **New file.** `executeToolCall()`, `readFile()`, `grepCodebase()`, `resolveProjectRoot()`. Reuses sanitize patterns from trajectory-capture. |
| `daemon/daemon.js` | Update `insertNewPattern()`: `name`=action, `condition`=condition, `action`=action, `description`=condition. Update `findDuplicateByName(distilled.action)` call (was `distilled.pattern`). Update `processSessionLocal()` to pass enriched tool entries (60 max). |

## Cost Impact

**Kimi K2.5 pricing (Moonshot API, as of 2026-04):**
- Input: $1.40/MTok (non-cached), $0.70/MTok (cached)
- Output: $5.60/MTok (non-thinking), thinking tokens billed at output rate
- Reference: https://platform.moonshot.ai/docs/pricing

**Per session extraction (current):**
- 1 K2.5 call, ~2K input tokens, ~500 output tokens, thinking disabled
- ~$0.006/session ($1.40×2K/1M + $5.60×500/1M)

**Per session extraction (v2, average case — 11-30 entries, ~3 tool calls):**
- 1 initial K2.5 call: ~6K input tokens (richer prompt), ~4K output (thinking + content)
- 3 tool call rounds: ~2K input tokens each (tool results + history), ~1K output each
- Total: ~12K input, ~7K output ≈ $0.056/session
- With prompt caching on burst (~50% cache hit on system message): ~$0.048/session

**Per session (worst case — 31+ entries, 8 tool calls, large files):**
- ~50K input, ~15K output ≈ $0.154/session
- Token budget cap (100K) prevents runaway beyond ~$0.22/session absolute max

**Daily cap of 50 sessions:** typical ~$2.80/day, max ~$7.70/day (vs ~$0.30/day current).

**Mitigation:** Dynamic budget concentrates cost on complex sessions. Small sessions (≤10 entries, 2 tool calls) cost ~$0.02. The 100K token budget cap prevents outliers.

## Migration

1. Deploy extract.js + llm.js + tool-executor.js changes
2. Existing patterns in DB are unaffected (old format still readable, old `name` field had action-like text anyway)
3. New patterns will have proper condition/action/description fields
4. No schema migration needed — `condition`, `action`, `description` columns already exist in patterns table
5. Embedding dimension unchanged (384d MiniLM) — HNSW index compatible
6. **Re-embed existing patterns:** On first startup, re-embed all active patterns using `condition + " → " + action` text format (from existing `name` + `action` columns). ~500 patterns × MiniLM local = ~2 seconds. This prevents dedup drift during the transition (see §8 transition period risk).
7. Restart daemon: `kill -TERM $(cat ~/.quoth/daemon.pid)` — session-start hook auto-restarts it

## Success Criteria

After running for 48 hours with the new pipeline:

1. **Condition fields are specific** — No pattern has condition = "Session: ..." or generic descriptions
2. **Action fields are distinct from name** — `action` contains technique details, not a copy of `name`
3. **Patterns reference real code** — At least 50% of patterns mention specific functions, components, or architectural decisions (not just tool names)
4. **Quality distribution shifts up** — Higher ratio of `universal`/`domain` vs `edge_case` quality signals compared to current (currently 2.3% high confidence)
5. **Tool calls are useful** — Average of 2+ tool calls per non-trivial session (measured via daemon.log)
6. **No regressions** — Fallback to Sonnet works when K2.5 is unavailable. Daily cap still enforced. Dedup still catches duplicates.
