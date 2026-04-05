# Daemon and Processing Pipeline

The Quoth daemon is a long-running Node.js process that watches trajectory files, processes them through a three-stage LLM pipeline (JUDGE, DISTILL, CONSOLIDATE), and maintains the pattern database. It also manages periodic maintenance tasks including confidence decay, HNSW index persistence, agent cleanup, and nightly deep consolidation with cloud promotion.

## Table of Contents

- [Daemon Overview](#daemon-overview)
- [Startup Sequence](#startup-sequence)
- [File Watcher](#file-watcher)
- [Job Queue](#job-queue)
- [Processing Pipeline](#processing-pipeline)
- [Post-Pipeline Actions](#post-pipeline-actions)
- [Project Detection](#project-detection)
- [Timers and Scheduled Tasks](#timers-and-scheduled-tasks)
- [Deep Consolidation](#deep-consolidation)
- [Daemon Libraries](#daemon-libraries)
- [Signal Handling](#signal-handling)
- [Self-Healing](#self-healing)

---

## Daemon Overview

**File:** `daemon/daemon.js`

| Property | Value |
|----------|-------|
| Runtime | Node.js (long-running process) |
| Start command | `node daemon.js &` |
| PID file | `~/.quoth/daemon.pid` |
| Log file | `~/.quoth/daemon.log` (JSON lines) |
| Lock file | `~/.quoth/processing.lock` |
| Database | `~/.quoth/memory.db` (SQLite via better-sqlite3) |
| Debug mode | `QUOTH_DEBUG=true` (enables stderr output) |
| Trajectories | `~/.quoth/trajectories/` |

The daemon auto-starts via the `session-start` hook and runs continuously in the background. It watches for new trajectory JSONL files, processes entries through the LLM pipeline, and maintains the pattern database.

---

## Startup Sequence

The daemon performs the following steps on startup, in order:

1. **Create directories:** Ensure `~/.quoth` and `~/.quoth/trajectories` exist (recursive mkdir).
2. **Initialize database:** Call `createDb(DB_PATH)` to open/create the SQLite database and run schema migrations.
3. **Initialize HNSW index:** Call `db.initHnsw()` to load or build the HNSW approximate nearest neighbor index from existing pattern embeddings.
4. **Write PID file:** Write `process.pid` to `~/.quoth/daemon.pid`.
5. **Clean stale lock:** If `~/.quoth/processing.lock` exists from a previous crash, check if the PID it contains is still alive. If the process is dead, remove the stale lock file.
6. **Start file watcher:** Watch `~/.quoth/trajectories/` for `.jsonl` file changes.
7. **Start hourly decay timer:** Applies confidence decay and archives weak patterns every hour.
8. **Start HNSW save timer:** Persists the HNSW index to disk every 30 minutes.
9. **Start agent cleanup timer:** Marks stale agents as offline every 5 minutes.
10. **Schedule deep consolidation:** Calculate milliseconds until next 3:00 AM and set a timeout.
11. **Initial scan:** Run `scanAndEnqueue()` to pick up any unprocessed trajectory entries.
12. **Process queue:** Run `processQueue()` to begin processing enqueued entries.

---

## File Watcher

The daemon uses `fs.watch()` on `~/.quoth/trajectories/` to detect new or modified JSONL files.

**Behavior:**

- Watches with `{ persistent: true }` to keep the process alive.
- Triggers on any filesystem event where the filename ends in `.jsonl`.
- Debounced by 500ms via `setTimeout` to batch rapid writes.
- On trigger: calls `scanAndEnqueue()` followed by `processQueue()`.

**Error handling:** If the watcher fails to start (e.g., directory permission issues), the error is logged but the daemon continues. The initial scan and SIGUSR1 signal still function as alternative triggers.

---

## Job Queue

The job queue is an in-memory array with deduplication.

### Deduplication

A `Set` named `enqueuedKeys` tracks which trajectory entries have already been enqueued using composite keys of the format `{filename}:{lineIndex}`. This prevents the same entry from being processed twice, even if the file watcher fires multiple times.

### Scanning

`scanAndEnqueue()` reads all `.jsonl` files in the trajectories directory:

1. List all files ending in `.jsonl`.
2. For each file, read all lines and parse as JSON.
3. Skip lines where `entry._processed === true` (already processed).
4. Skip lines whose `{filename}:{lineIndex}` key is already in the `enqueuedKeys` set.
5. Add new entries to the job queue with their file path, original line text, and dedup key.
6. Log the number of newly enqueued entries and total queue size.

### Concurrency Control

- **Lock file:** `~/.quoth/processing.lock` prevents multiple daemon instances from processing simultaneously. Contains the PID of the lock holder.
- **Lock validation:** Before acquiring the lock, the daemon checks if the existing lock holder is still alive (via `process.kill(pid, 0)`). Dead lock holders are cleaned up automatically.
- **Batch size:** The queue processes up to 5 entries concurrently using `Promise.all()` on spliced batches.
- **Processing loop:** Continues until the queue is empty, then releases the lock.

```
while (jobQueue.length > 0) {
  const batch = jobQueue.splice(0, 5)   // Take up to 5 entries
  await Promise.all(batch.map(job => processEntry(job)))
}
```

---

## Processing Pipeline

Each trajectory entry passes through a three-stage LLM pipeline: JUDGE, DISTILL, CONSOLIDATE.

### Stage 1: JUDGE (`pipeline/judge.js`)

Evaluates whether an agent action was effective and worth learning from.

| Property | Value |
|----------|-------|
| LLM | Kimi K2.5 via Moonshot API |
| Max tokens | 150 |
| Temperature | 0.6 |

**Input template:**

```
Agent: {entry.agent}
Task: {entry.task}
Outcome: {entry.outcome}
Attempts: {entry.attempts || 1}
Tools used: {entry.tool_calls || 0}
```

**Output schema:**

```json
{
  "effective": true,
  "reason": "Task completed successfully with single attempt",
  "category": "general"
}
```

**Categories:** `selector`, `wait`, `auth`, `data`, `env`, `general`

**Fallback behavior:** If the LLM is unavailable (no API key, timeout, parse error), the judge falls back to using `entry.outcome === 'success'` as the effectiveness signal with reason `"fallback: llm unavailable"` and category `"general"`.

**Early exit:** If the judge determines the entry is not effective, the entry is marked as processed and skipped (no distillation or consolidation).

### Stage 2: DISTILL (`pipeline/distill.js`)

Extracts a reusable, generalizable pattern from an effective agent action.

| Property | Value |
|----------|-------|
| LLM | Kimi K2.5 via Moonshot API |
| Max tokens | 200 |
| Temperature | 0.6 |

**Input template:**

```
Agent: {entry.agent}
Task: {entry.task}
User intent: {entry.user_intent || 'unknown'}
Conversation context: {recent user messages + LLM reasoning, if available}
Pattern used: {entry.pattern_used || 'none'}
```

**Prompt rules (v3.2.1):**

The DISTILL prompt includes explicit quality rules to prevent raw tool calls as pattern names:
- Pattern name MUST describe the TECHNIQUE or STRATEGY, not the specific file/command
- NEVER include file paths, directory names, or raw commands in the pattern name
- Focus on WHAT was achieved and WHY it worked, not HOW (specific tool calls)
- Pattern should be applicable across projects, not tied to one codebase

The prompt includes examples of good vs bad patterns:
- **Bad:** `"claude-code: Bash find /home/user/projects/foo"`, `"claude-code: Write /home/user/src/index.js"`
- **Good:** `"Recursive file search before editing unfamiliar codebase"`, `"Read existing file before writing to preserve structure"`

**Output schema:**

```json
{
  "pattern": "technique/strategy description (max 80 chars)",
  "tags": ["domain-tag", "technique-tag"],
  "applicability": "broad"
}
```

**Applicability values:** `broad` (generalizable across projects) or `narrow` (specific to one project/context).

**Post-processing:**

1. Generate a unique ID by SHA-1 hashing the pattern text and taking the first 12 hex characters.
2. Generate an embedding vector via `voyage-4-lite` (see [Embeddings Library](#embeddings-libembed-js)). Returns `null` on failure (graceful degradation).
3. Set `source: 'distilled'`.

**Fallback behavior:** If the LLM fails, the fallback strips file paths from the task description (removes `/home/...`, `/tmp/...`, `~/...` paths) to extract the intent. If the cleaned text is too short (<10 chars), it defaults to `"{agent}: task execution"`. Tags are empty and applicability is `narrow`. The `fallback: true` flag is set on the result.

### Stage 3: CONSOLIDATE (`pipeline/consolidate.js`)

Decides whether to merge the new pattern into an existing one or create a distinct entry.

| Property | Value |
|----------|-------|
| LLM | Kimi K2.5 via Moonshot API (same as JUDGE and DISTILL) |
| Max tokens | 300 |
| Temperature | 0.6 |
| Invocation | `callLLM()` (async, unified with other pipeline stages) |

**Input:**

- New distilled pattern (JSON)
- Top 3 similar existing patterns (from HNSW similarity search if embedding available, otherwise top 3 by confidence)

**Output schema:**

```json
{
  "action": "strengthen",
  "targetId": "a1b2c3d4e5f6",
  "updated": { ... }
}
```

**Action values:**

| Action | Meaning | Follow-up |
|--------|---------|-----------|
| `strengthen` | New pattern is essentially the same as an existing one | Merge into existing via Bayesian success update |
| `new` | New pattern is genuinely different | Create a new entry in the database |

**Fallback behavior:** If the LLM call fails or returns non-JSON, defaults to `action: 'new'` with `fallback: true` and the error message.

---

## Post-Pipeline Actions

After the three pipeline stages complete:

### On `strengthen`:

1. Call `db.applyBayesianUpdate(targetId, 'success')` to increment the alpha parameter and recalculate confidence on the existing pattern.
2. Emit a `pattern.strengthened` event to the event log.
3. Log: `Strengthened pattern {id}`.

### On `new`:

Before inserting, a **pre-insert dedup check** runs:

1. **Embedding dedup:** If the distilled pattern has an embedding, call `db.findDuplicateByEmbedding(embedding, 0.92)` to find patterns with cosine similarity >= 0.92 via HNSW.
2. **Name dedup:** Call `db.findDuplicateByName(name, 0.8)` to find patterns whose normalized name shares >= 80% prefix match.

If a duplicate is found (embedding match takes priority over name match):
- Call `db.applyBayesianUpdate(existingId, 'success')` to strengthen the existing pattern.
- Emit a `pattern.deduped` event with the dedup method (`embedding` or `name`).
- Skip insertion entirely.

If no duplicate exists, insert the new pattern:

1. Call `db.upsertPattern()` with:
   - `id`: SHA-1 hash from distill stage
   - `name`: First 80 characters of the pattern text
   - `pattern_type`: `'code-pattern'`
   - `condition`: The original task description
   - `action`: The full distilled pattern text
   - `confidence`: `0.5` (neutral starting point for Bayesian scoring)
   - `tags`: Distilled tags plus `project:{name}` if not default
   - `source`: `'distilled'` (or from entry source)
   - `embedding`: JSON-stringified vector if available
2. Emit a `pattern.learned` event.
3. Set the pattern's namespace to the detected project (if not `'default'`).
4. Log: `New pattern {id}`.

### Mark as Processed

After successful processing (regardless of action), the original JSONL line in the trajectory file is modified in-place by replacing the closing `}` with `,"_processed":true}`. This prevents reprocessing on subsequent scans.

### Promotion Check

After each entry, call `db.getPromotionCandidates()` to check if any patterns now qualify for cloud promotion (confidence > 0.8, uses > 10). The actual promotion happens during nightly deep consolidation, but candidates are logged immediately.

---

## Project Detection

**Function:** `detectProjectFromTask(task, fallback)`

Scans the task text for known file path patterns to determine the correct project namespace. This is critical for correcting namespace misattribution when sessions run from the home directory but edit project-specific files.

### Path Pattern Matching

Patterns are checked in order (most specific first):

| Regex | Result |
|-------|--------|
| `projects/agents-tools/(quoth\|exolar\|triqual)` | Captured group (e.g., `quoth`) |
| `projects/skill-registry` | `skill-registry` |
| `projects/claude-code-fork-main` | `claude-code-fork-main` |
| `.openclaw/workspaces/([\w-]+)/repo` | Mapped via `WORKSPACE_REPO_MAP` |
| `IPS_audit/IPS` | `ips` |
| `shadcnblocks-registry` | `shadcnblocks-registry` |
| `remotion-studio` | `remotion-studio` |
| `prompt-to-motion-graphics` | `prompt-to-motion-graphics` |

### Workspace-to-Repository Mapping

The `WORKSPACE_REPO_MAP` maps 11 OpenClaw workspace directory names to their corresponding GitHub repository names:

| Workspace | Repository |
|-----------|-----------|
| `ads` | `studio-pipeline` |
| `billing` | `billing-processor` |
| `curator` | `quoth` |
| `deployer` | `agentical` |
| `echo` | `ai-voice-platform` |
| `interviews` | `interview-companion` |
| `jardin` | `jardin-maternal` |
| `multimedia` | `triqual` |
| `omnichannel` | `omnichannel` |
| `portfolio` | `portfolio` |
| `sales` | `sales-companion` |

When a namespace correction occurs, a debug log entry is emitted showing the `from` and `to` namespaces.

---

## Timers and Scheduled Tasks

The daemon runs six recurring timers:

| Timer | Interval | Function | Description |
|-------|----------|----------|-------------|
| Hourly decay | 60 min | `db.applyHourlyDecay()` + `db.archiveWeakPatterns()` | Reduce confidence on unused patterns (3-tier decay), archive patterns below threshold |
| HNSW save | 30 min | `db.saveHnsw()` | Persist the in-memory HNSW index to disk as JSON |
| Agent cleanup | 5 min | `db.cleanupStaleAgents(300000)` | Mark agents as offline if no heartbeat in 5 minutes (300,000ms) |
| Stale session detector | 10 min | `detectStaleSessions()` | Generate synthetic session summaries for orphaned sessions (see below) |
| Nightly pipeline | Daily at 3:00 AM | `runNightlyPipeline()` | Phase A: deep consolidation (dedup, merge, promotion). Phase B: doc auto-update (hash scan, LLM update, git push) |
| File watcher | Event-driven | `scanAndEnqueue()` + `processQueue()` | Triggered by filesystem events on trajectories directory |

All timers are cleared on `SIGTERM` via `clearTimers()`.

---

## Session Batch Distill

**File:** `pipeline/distill-batch.js`

When the daemon encounters a `session_summary` entry (written by the `session-end` hook or the stale session detector), it switches from per-entry processing to session-level batch distill.

### Process

1. **Detect session_summary:** When `processEntry()` encounters `entry.event === 'session_summary'`, it delegates to `processSessionBatch()`.
2. **Gather session entries:** Read all unprocessed `tool_use` entries from the same JSONL file that match the session ID.
3. **Batch DISTILL:** Send a single LLM call (Kimi K2.5, 400 max tokens) with the full session context:
   - Project name, tool call summary, success rate, overall outcome
   - User intents collected during the session (from `user_intent` fields)
   - Key actions with LLM reasoning (last 30 tool entries, each with tool name, task, reasoning, and failure flag)
4. **Output:** 1-3 session-level patterns per call. These are higher-quality than per-entry patterns because the LLM sees the full workflow.
5. **Consolidate + dedup:** Each batch pattern goes through the same CONSOLIDATE + pre-insert dedup pipeline as individual patterns.
6. **Initial confidence:** Batch-distilled patterns start at `confidence = 0.55` (slightly above default 0.5) and get tagged with `batch-distilled`.
7. **Mark processed:** All `tool_use` entries for the session AND the `session_summary` are marked as processed.

### Advantages Over Per-Entry Distill

| Aspect | Per-Entry | Session Batch |
|--------|-----------|---------------|
| LLM calls | 1 per tool call | 1 per session (or compact) |
| Context | Single tool call | Full session workflow |
| Pattern quality | Low — "Write to file X" | High — "Search-then-edit workflow for refactoring" |
| Cost | N × $0.50/MTok | 1 × $0.50/MTok (larger prompt, but single call) |
| Trigger | File watcher (continuous) | SessionEnd, PreCompact, SIGUSR1, or stale detection |

### Trigger Points

- **PreCompact:** When Claude Code compresses context mid-session — acts as a natural checkpoint for long sessions.
- **SessionEnd:** Normal session close or Ctrl+C.
- **SIGUSR1:** Manual flush signal.
- **Stale session detector:** Synthetic summary generated for orphaned sessions (see below).

---

## Stale Session Detector

**Interval:** Every 10 minutes via `startStaleSessionTimer()`.

Handles the case where sessions die without a `SessionEnd` hook (e.g., terminal closed, process killed, network disconnect).

### Detection Criteria

A session is considered stale when:
- The session has `tool_use` entries with no corresponding `session_summary`
- The session has 3+ tool entries (skip tiny sessions)
- The most recent entry is older than 30 minutes

### Synthetic Summary

The detector generates a `session_summary` entry with `source: 'stale-session-detector'`. It contains the same fields as a normal session summary (tool_counts, success_rate, user_intents, llm_reasonings) built from the orphaned tool entries.

Once the synthetic summary is written to the JSONL, the file watcher triggers `scanAndEnqueue()` → `processQueue()`, which picks it up and routes it through `processSessionBatch()` for batch distill.

---

## Deep Consolidation

**Schedule:** Runs at 3:00 AM local time daily. The first execution is scheduled via `setTimeout` (milliseconds until next 3 AM), and subsequent executions use `setInterval` at 24-hour intervals.

### Phase 0: Garbage Pattern Archival

Archive patterns with raw tool-call names that never gained meaningful confidence:

```sql
UPDATE patterns SET status = 'archived'
WHERE status = 'active'
  AND (name LIKE 'claude-code: Bash %' OR name LIKE 'claude-code: Write /%'
       OR name LIKE 'claude-code: Edit /%' OR name LIKE 'claude-code: Read /%'
       OR name LIKE 'claude-code: Glob %' OR name LIKE 'claude-code: Grep %')
  AND confidence <= 0.5
  AND (success_count + failure_count) < 3
```

These are patterns created by the old distiller fallback that used raw tool calls as names. They have no reuse value.

### Phase 1: Name-Based Deduplication

1. Fetch all active patterns ordered by confidence DESC.
2. Normalize each name: lowercase, strip non-alphanumeric, take first 50 chars.
3. Group by normalized prefix — if two patterns share the same prefix:
   - Keep the one with higher confidence (first seen, since sorted by confidence).
   - Archive the duplicate.
   - Apply Bayesian success update to the survivor.
4. Log the number of deduplicated patterns.

### Phase 2: LLM-Assisted Deduplication and Archival

1. Fetch top 20 patterns by confidence from the database.
2. Send to Kimi K2.5 with a prompt asking to identify:
   - Duplicate pairs to merge (keep one, archive the other)
   - Low-value patterns to archive outright
3. Expected response format:
   ```json
   {
     "merges": [{"keep": "id1", "archive": "id2"}],
     "archives": ["id3", "id4"]
   }
   ```
4. Execute archival: Set `status='archived'` on identified patterns.
5. Execute merges: Apply Bayesian success update to the "keep" pattern, archive the "archive" pattern.

### Phase 3: Cloud Promotion

1. Call `db.getPromotionCandidates()` to get patterns meeting promotion criteria (confidence > 0.8, uses > 10).
2. For each candidate, check if promotion is needed:
   - Never promoted before (`!pattern.promoted_at`)
   - Confidence has increased significantly since last promotion (`confidence - promoted_confidence > 0.1`)
3. Call `promotePattern(pattern)` to sync to Quoth cloud (see [Promotion Library](#promotion-libpromote-js)).
4. On success, call `db.markPromoted(id, documentId, confidence)` to record the promotion.
5. Emit `pattern.promoted` event.

### Phase 4: Global Namespace Promotion

1. Query for patterns meeting global promotion criteria:
   - `status = 'active'`
   - `namespace != 'global'` (not already global)
   - `confidence > 0.8`
   - Total uses (`success_count + failure_count`) > 10
   - `applicability = 'broad'`
2. Call `db.promoteToGlobal(id)` for each qualifying pattern.
3. Log the number of newly promoted global patterns.

### Phase 5: Exolar Cross-Validation (Placeholder)

Currently logs the number of eligible patterns for cross-validation. Full implementation requires MCP context (the daemon runs outside Claude Code). Future plans include direct HTTP calls to the Exolar API.

---

## Daemon Libraries

### LLM Library (`lib/llm.js`)

Provides the `callLLM(prompt, maxTokens)` function for Kimi K2.5 inference.

| Property | Value |
|----------|-------|
| Model | `kimi-k2.5` |
| API endpoint | `https://api.moonshot.ai/v1/chat/completions` |
| Protocol | OpenAI-compatible chat completions API |
| Auth | `MOONSHOT_API_KEY` env var, falls back to reading `~/.openclaw/credentials/moonshot-api-key` |
| Default max tokens | 200 |
| Temperature | 0.6 |
| Thinking | Disabled (`{ type: 'disabled' }`) |
| Timeout | 30,000ms |
| Cost | $0.50/MTok input, $2.80/MTok output |

**Post-processing:** Strips markdown code block wrappers (` ```json ` ... ` ``` `) from responses before returning the text.

**Error handling:** Throws on missing API key, API errors, invalid JSON responses, and timeouts. Callers (judge, distill) handle these errors with fallback behavior.

### Embeddings Library (`lib/embed.js`)

Provides `generateEmbedding(text)` for creating vector embeddings.

| Property | Value |
|----------|-------|
| Model | `voyage/voyage-4-lite` |
| API endpoint | `https://ai-gateway.vercel.sh/v1/embeddings` |
| Auth | `AI_GATEWAY_API_KEY` env var (vck_* key) |
| Timeout | 10,000ms |
| Cost | $0.02/MTok (6.5x cheaper than text-embedding-3-large) |
| Dimensions | Model-determined (used with HNSW index at 1536 dimensions) |

**Input preprocessing:** Replaces multiple newlines with spaces and trims whitespace.

**Graceful degradation:** Returns `null` on any failure (missing API key, timeout, parse error). All callers handle `null` embeddings by falling back to non-semantic methods.

### Attribution Library (`lib/attribute.js`)

Determines which patterns caused success or failure in agent actions.

| Property | Value |
|----------|-------|
| LLM | Claude Haiku 4.5 via `claude` CLI |
| Purpose | Causal analysis of pattern-outcome relationships |

**Output tip types:**
- `strategy_tip`: Recommended approach changes
- `recovery_tip`: How to recover from similar failures
- `optimization_tip`: Performance improvements

### Mutation Library (`lib/mutate.js`)

Generates targeted mutations to verify test quality.

| Property | Value |
|----------|-------|
| LLM | Claude Haiku 4.5 via `claude` CLI |
| Purpose | Generate code mutations that real failures would introduce |

Used for test quality verification: if a mutated version of code still passes tests, the tests may be insufficient.

### Skill Extraction Library (`lib/skill-extract.js`)

Extracts parameterized, reusable test recipes from passing tests.

| Property | Value |
|----------|-------|
| LLM | Claude Sonnet 4.6 |
| Purpose | Convert passing tests into reusable skill templates |

**Output schema:**

```json
{
  "name": "login-flow-verification",
  "description": "Verify user login with email and password",
  "template": "Navigate to {{login_url}}, enter {{email}} and {{password}}, click submit, verify redirect to {{dashboard_url}}",
  "params": ["login_url", "email", "password", "dashboard_url"],
  "selectors": ["input[name=email]", "input[name=password]", "button[type=submit]"],
  "pageObjects": ["LoginPage", "DashboardPage"],
  "assertions": ["url-redirect", "element-visible"]
}
```

### Promotion Library (`lib/promote.js`)

Syncs high-confidence local patterns to the Quoth cloud index.

| Property | Value |
|----------|-------|
| API endpoint | `POST {apiUrl}/api/v1/patterns/promote` |
| API URL | `QUOTH_API_URL` env var or `https://quoth.triqual.dev` |
| Auth | `QUOTH_API_KEY` env var (qth_* key) |
| Timeout | 15,000ms per request |

**Project auto-creation:** Before promoting a pattern, `ensureProject(slug)` checks if the project exists in the cloud. If not, it creates it via `POST /api/v1/projects` with an auto-generated name (slug with dashes replaced by spaces, title-cased). Known project slugs are cached in a `Set` to avoid redundant API calls.

**Promotion payload:**

```json
{
  "patternId": "a1b2c3d4e5f6",
  "name": "Auth resilience with DB fallback",
  "condition": "JWT claims may be missing",
  "action": "Use DB fallback for optional fields",
  "content": "# Auth resilience with DB fallback\n\n**Condition:** ...\n**Action:** ...\n**Confidence:** 0.85 (12 successes, 2 failures)\n**Tags:** auth, jwt\n**Source:** Distilled from local learning daemon -- promoted 2026-04-04",
  "confidence": 0.85,
  "successCount": 12,
  "failureCount": 2,
  "tags": ["auth", "jwt"],
  "applicability": "broad",
  "projectSlug": "quoth",
  "embedding": [0.123, -0.456, ...]
}
```

The `content` field is a markdown-formatted document generated by `buildContent()` for human readability in the cloud UI.

### HNSW Index (`lib/hnsw.js`)

Pure JavaScript implementation of the Hierarchical Navigable Small World (HNSW) algorithm for approximate nearest neighbor search.

| Property | Value |
|----------|-------|
| Default dimensions | 1536 (matching text-embedding-3-small) |
| M (max neighbors per layer) | 16 |
| M0 (max neighbors at layer 0) | 32 (2 * M) |
| efConstruction | 200 |
| Search complexity | O(log n) approximate nearest neighbor |
| Native dependencies | None (pure JavaScript) |

**Core operations:**

| Method | Description |
|--------|-------------|
| `add(id, vector)` | Insert a vector into the index. Re-insert after remove updates the vector. |
| `remove(id)` | Soft-delete: marks node as deleted but leaves it in the graph. Excluded from search results. |
| `search(queryVector, k, efSearch)` | Find k nearest neighbors. `efSearch` controls the beam width (default 50; higher = more accurate but slower). |
| `buildFromDb(db)` | Bulk load all active patterns with embeddings from SQLite. Resets and rebuilds the entire index. |
| `save(filePath)` | Serialize index to JSON file (excludes deleted nodes). |
| `load(filePath)` | Deserialize index from JSON file. Reconstructs the full graph structure including neighbor Sets. |

**Algorithm overview:**

1. Each node is assigned a random layer using the HNSW probability distribution: `floor(-log(random) * (1/log(M)))`.
2. **Insertion:** Greedy descent from the top layer to `nodeLayer + 1`, then ef-bounded search and neighbor selection at each layer from `nodeLayer` down to 0. Bidirectional edges are added, and over-capacity neighbors are pruned.
3. **Search:** Greedy descent from top layer to layer 1, then ef-bounded search at layer 0.
4. **Distance metric:** Cosine distance (`1 - cosineSimilarity`).

---

## Signal Handling

| Signal | Behavior |
|--------|----------|
| `SIGTERM` | Graceful shutdown: clear all timers, close database, exit with code 0 |
| `SIGUSR1` | Immediate flush: trigger `scanAndEnqueue()` + `processQueue()`. Used by `quoth_ingest_trajectory` MCP tool to signal new data. |

---

## Self-Healing

The daemon registers an `uncaughtException` handler that logs the error (with stack trace) but does **not** crash the process. This prevents pipeline errors (LLM timeouts, JSON parse failures, database errors) from killing the daemon.

```javascript
process.on('uncaughtException', (err) => {
  log('error', 'uncaughtException', { message: err.message, stack: err.stack })
  // Continue running
})
```

On exit (normal or forced), the daemon cleans up:
- Removes the PID file (`~/.quoth/daemon.pid`)
- Removes the lock file (`~/.quoth/processing.lock`)

These are handled via `process.on('exit', ...)` to cover all exit paths.

---

## Log Format

All daemon logs are JSON lines written to `~/.quoth/daemon.log`:

```json
{"ts":"2026-04-04T12:30:00.000Z","level":"info","msg":"Quoth daemon started","data":{"pid":12345,"home":"/home/user/.quoth"}}
{"ts":"2026-04-04T12:30:01.000Z","level":"info","msg":"Watching trajectories","data":{"dir":"/home/user/.quoth/trajectories"}}
{"ts":"2026-04-04T12:30:01.000Z","level":"info","msg":"Deep consolidation in 870m"}
{"ts":"2026-04-04T12:30:02.000Z","level":"info","msg":"Enqueued 3 new entries (queue: 3)"}
{"ts":"2026-04-04T12:30:03.000Z","level":"info","msg":"Strengthened pattern","data":{"id":"a1b2c3d4e5f6"}}
{"ts":"2026-04-04T12:30:04.000Z","level":"info","msg":"New pattern","data":{"id":"f6e5d4c3b2a1"}}
```

When `QUOTH_DEBUG=true` is set, all log lines are also written to stderr for real-time monitoring.
