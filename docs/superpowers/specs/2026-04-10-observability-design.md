# Spec — Observability & "No Silent Bullshit"

**Status:** Draft
**Author:** Agustin + Claude Opus 4.6
**Captured:** 2026-04-10
**Related memories:** `project_observability_braintrust_2026_04_10.md`
**Related specs:** `2026-04-10-session-isolation.md`

---

## 1. Guiding Principle — "No Silent Bullshit"

Every failure in the Quoth plugin **must** be visible to us within seconds of asking "what broke?". Not hidden in a `catch {}`, not lost to a stderr write that nobody reads, not absorbed by a `return null` that looks like success from the outside.

**Operational definition of "not silent":**
1. Every caught exception is either (a) persisted to SQLite with context, OR (b) an explicitly-justified best-effort cleanup that cannot fail meaningfully.
2. Every pipeline stage emits a start/end event including outcome and duration, regardless of mode (local or managed).
3. Every crash path (unhandledRejection, uncaughtException, hook throw, MCP error) reaches SQLite before the process exits.
4. Every "fallback succeeded" path is logged — we want to know when the primary is flaky, not just when both fail.
5. A single SQL query can answer "what has broken in the last hour?".

**What this is NOT:**
- It is **not** terminal spam. Normal operation stays quiet.
- It is **not** Braintrust-first. Braintrust is a later, optional push target. SQLite is the source of truth.
- It is **not** a rewrite of error handling. It is a surgical audit of existing catch blocks + new instrumentation at stage boundaries.

---

## 2. Problem Statement

From Agustin, 2026-04-10:

> "Quiero loggear principalmente para que nosotros podamos identificar puntos de mejora y errores rápidamente. Podemos hacerlo local. No quiero silent bullshit, ese el principio."

The plugin today has a working `pipeline_errors` table and a working `insertPipelineError()` helper — but **only one module uses them**. Everything else either swallows errors, writes to stderr (which nobody reads), or returns null and keeps going. The result: bugs show up as "patterns aren't being learned" instead of "judge.js crashed 14 times in the last hour with this stack trace".

This spec fixes that by:
1. Hardening the crash paths that already exist.
2. Extending `pipeline_errors` coverage to every module that can fail.
3. Adding a new `pipeline_events` table for success-path visibility (stage durations, fallback usage, outcomes).
4. Auditing every `catch {}` block and either opening it up or annotating it as intentional.
5. Adding operator tooling (CLI + MCP tool) so "what broke?" is a one-command answer.
6. Making the whole thing Braintrust-ready via a simple exporter we can wire up in a later phase.

---

## 3. Current State Audit

### 3.1 What Already Exists

| Component | Location | State |
|---|---|---|
| `pipeline_errors` table | `db.js:339` | ✅ Schema solid, indexed by stage + created_at |
| `insertPipelineError()` helper | `db.js:994` | ✅ Fields: stage, error_message, error_stack, context, model_attempted, fallback_attempted, fallback_succeeded |
| `pipeline_costs` table | `db.js:319` | ✅ Already tracks stage/model/tokens/cost/session/project |
| `process.on('uncaughtException')` in daemon | `daemon.js:145` | ⚠️ Exists but only logs to daemon.log, does not persist |
| Signal handlers (SIGTERM/SIGUSR1/SIGUSR2) | `daemon.js:119-142` | ✅ Graceful shutdown, flush, doc re-index |
| `braintrust@3.7.0` package | monorepo `package.json:59` | ⚠️ In SaaS, not in plugin |
| `BRAINTRUST_API_KEY` + `BRAINTRUST_PROJECT_ID` | `~/.quoth/.env` | ✅ Set |
| `daemon/lib/query-server.js` | | ✅ Unix socket, `/health` + `/query` routes |

### 3.2 The Damage — Measured

**Crash handlers missing:**
| Entry point | `uncaughtException` | `unhandledRejection` |
|---|---|---|
| `daemon/daemon.js` | ✅ (logs only) | ❌ |
| `hooks/hook-dispatch.js` | ❌ | ❌ |
| `hooks/trajectory-capture.js` | ❌ | ❌ |
| `mcp/quoth-learning-server.js` | ❌ | ❌ |

**Empty `catch {}` blocks (measured by grep):**
- `daemon/daemon.js`: **24** empty catches
- `daemon/lib/*.js`: **62** total catches across 19 files (many empty, not all — needs audit)
- `hooks/`: multiple silent swallows in hook-dispatch.js
- `mcp/quoth-learning-server.js`: returns JSON-RPC error without persistence

**Modules that can fail but never write to `pipeline_errors`:**
| Module | Failure modes | Instrumented? |
|---|---|---|
| `daemon/pipeline/extract.js` | LLM errors, parse errors, embed errors | ✅ **5 call sites** |
| `daemon/lib/judge.js` | LLM errors, verdict parse errors | ❌ |
| `daemon/lib/embed.js` | MiniLM load failures, inference crashes | ❌ (returns null) |
| `daemon/lib/promote.js` | HTTP timeouts, 4xx/5xx, auth failures | ❌ (returns null) |
| `daemon/lib/pipeline-api.js` | Same as promote.js | ❌ (writes to stderr) |
| `daemon/lib/doc-updater.js` | Sonnet CLI failures, git push failures | ❌ |
| `daemon/lib/doc-update-api.js` | HTTP failures | ❌ |
| `daemon/lib/pull.js` | Cloud sync HTTP failures | ❌ |
| `daemon/lib/llm.js` | Gateway 5xx, Moonshot 5xx, JSON parse | ❌ (throws upward) |
| `daemon/lib/doc-chunks.js` | Indexing failures | ❌ |
| `daemon/lib/hnsw.js` | Index save/load failures | ❌ (swallowed at `daemon.js:492`) |
| `daemon/lib/clustering.js` | V2 cluster rebuild | ❌ |
| `daemon/lib/bandit-v2.js` | V2 Thompson sampling | ❌ |
| `daemon/lib/snips.js` | V2 reward calculation | ❌ |
| `daemon/lib/injection.js` | V2 pattern injection | ❌ |
| `daemon/lib/query-server.js` | Socket errors, handler timeouts | ❌ |

**Translation:** 1 out of 16 modules is instrumented correctly.

### 3.3 Symptoms Agustin Has Seen

- `[WARN] Hook route error: Daemon failed to start within 5s` — appearing in every `UserPromptSubmit` hook invocation this session. Nobody persists this anywhere.
- "Patterns aren't being learned" during an Extract Pipeline v2 session — turned out to be a silent embed failure, required manual `SELECT` to the pipeline_errors table (which only caught the extract stage).
- Daemon silently crashing on OOM — only discovered because the PID file was stale.

---

## 4. Design Principles

1. **SQLite is the source of truth.** Everything writes here first. Braintrust is an optional downstream exporter.
2. **Zero impact on hot path.** Hooks must stay <1s. Any telemetry from hooks goes via the existing Unix socket to the daemon, never via a heavy SDK import.
3. **Explicit > implicit.** Every catch block is either (a) persisted, or (b) annotated with a comment explaining why silence is correct.
4. **Fallbacks are events, not secrets.** When primary → fallback happens, we log it even on success. This is how we notice flaky primaries.
5. **Granular enough to act on.** Stage-level events (L1) are the minimum. Per-LLM-call telemetry (L2) is for debugging spikes.
6. **Queryable without joins.** Any operator question ("what's flaky this hour?", "what stage is slowest?", "which project has the most embed failures?") must be a single SELECT.
7. **Rate-limit by default.** A crash loop cannot exhaust disk / quota / patience. Daemon throttles its own error insertion under pressure.
8. **The instrumentation itself must not silently fail.** If `insertPipelineError` throws, we fall through to `daemon.log` + stderr, never to `/dev/null`.

---

## 5. Architecture

```
┌─────────────────────┐                ┌──────────────────────┐
│   trajectory-       │                │  hook-dispatch.js    │
│   capture.js        │                │  (route, session-    │
│   (PostToolUse)     │                │   end, pre-bash…)    │
└──────────┬──────────┘                └──────────┬───────────┘
           │                                      │
           │  POST /telemetry/event               │  POST /telemetry/event
           ▼                                      ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                  daemon/lib/query-server.js                 │
 │       (Unix socket @ ~/.quoth/daemon.sock, existing)        │
 └─────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
 ┌─────────────────────────────────────────────────────────────┐
 │             daemon/lib/telemetry.js (NEW)                   │
 │  insertEvent(stage, kind, data)  insertError(stage, err)    │
 │  - rate limiter (100/min per stage)                         │
 │  - PII redaction                                            │
 │  - spill to fallback.log if DB write fails                  │
 └─────┬───────────────────────────────────────┬───────────────┘
       │                                       │
       ▼                                       ▼
 ┌──────────────┐                       ┌─────────────────┐
 │  pipeline_   │                       │   pipeline_     │
 │  errors      │                       │   events        │
 │  (existing)  │                       │   (NEW)         │
 └──────────────┘                       └─────────────────┘
       │                                       │
       │                                       │
       │  optional (Phase 3)                   │
       ▼                                       ▼
 ┌─────────────────────────────────────────────────────────┐
 │          daemon/lib/braintrust-exporter.js (NEW)        │
 │  Every 60s: flush unexported rows → Braintrust          │
 │  Dynamic require (no-op if braintrust missing)          │
 └─────────────────────────────────────────────────────────┘
```

### 5.1 Data Flow

1. **Daemon-local instrumentation:** every pipeline module calls `telemetry.insertEvent(...)` / `telemetry.insertError(...)` directly at catch sites and stage boundaries.
2. **Hook-originated telemetry:** hooks POST to `daemon.sock:/telemetry/event` (non-blocking, fire-and-forget).
3. **SQLite buffer:** all events land in `pipeline_events` or `pipeline_errors`.
4. **Optional Braintrust push:** a background timer reads unexported rows, batches them, and calls the Braintrust SDK. If Braintrust isn't installed or the API is down, the rows stay unexported and the timer keeps retrying.
5. **Operator query:** CLI (`quoth errors --since 1h`) and MCP tool (`quoth_diag`) expose the data for ad-hoc investigation.

---

## 6. Schema Changes

### 6.1 Extend `pipeline_errors` table

Add columns the current schema is missing. Non-breaking additions; default values preserve existing rows.

```sql
ALTER TABLE pipeline_errors ADD COLUMN session_id TEXT;
ALTER TABLE pipeline_errors ADD COLUMN project TEXT;
ALTER TABLE pipeline_errors ADD COLUMN severity TEXT NOT NULL DEFAULT 'error';
  -- one of: 'warn', 'error', 'fatal'
ALTER TABLE pipeline_errors ADD COLUMN source TEXT NOT NULL DEFAULT 'daemon';
  -- one of: 'daemon', 'hook', 'mcp', 'extract', 'judge', 'embed', …
ALTER TABLE pipeline_errors ADD COLUMN bt_exported_at INTEGER;
  -- braintrust push watermark (NULL = pending)

CREATE INDEX IF NOT EXISTS idx_pipeline_errors_session ON pipeline_errors(session_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_errors_severity ON pipeline_errors(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_errors_pending_export ON pipeline_errors(bt_exported_at) WHERE bt_exported_at IS NULL;
```

### 6.2 New table `pipeline_events`

For success-path visibility. This is the "everything worked, here's how long it took" table. Complements `pipeline_errors`.

```sql
CREATE TABLE IF NOT EXISTS pipeline_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage TEXT NOT NULL,
    -- e.g. 'extract.session', 'judge.batch', 'embed.batch', 'promote.pattern'
  kind TEXT NOT NULL,
    -- 'start', 'end', 'fallback', 'skip', 'retry'
  outcome TEXT,
    -- 'success', 'failure', 'partial', NULL for 'start'
  duration_ms INTEGER,
  session_id TEXT,
  project TEXT,
  model TEXT,
  metadata TEXT,
    -- JSON blob: free-form per-stage context (tool_count, pattern_count, etc.)
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  bt_exported_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_events_stage_created ON pipeline_events(stage, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_session ON pipeline_events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_outcome ON pipeline_events(outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_pending_export ON pipeline_events(bt_exported_at) WHERE bt_exported_at IS NULL;
```

**Why separate table?** Keeps error queries fast (`SELECT * FROM pipeline_errors` is your "what broke" query). The events table grows faster (~1k rows/day) but can be GC'd independently on a longer retention.

### 6.3 Retention & GC

Add a daily GC task to `daemon.js`:

```js
// Retention: 30d for errors, 7d for events
db.prepare("DELETE FROM pipeline_errors WHERE created_at < ?").run(Date.now() - 30*86400*1000)
db.prepare("DELETE FROM pipeline_events WHERE created_at < ?").run(Date.now() - 7*86400*1000)
```

Runs once per day via the existing nightly pipeline timer. GC counts get logged (so we know the tables aren't silently growing forever).

---

## 7. `daemon/lib/telemetry.js` — The New Module

Single source of truth for all instrumentation. ~150 LoC.

### 7.1 Public API

```js
const telemetry = require('./lib/telemetry.js')(db, log)

// Error path — replaces scattered insertPipelineError calls
telemetry.error({
  stage: 'embed.batch',
  source: 'daemon',
  severity: 'error',        // 'warn' | 'error' | 'fatal'
  message: err.message,
  stack: err.stack,
  context: { text_count: 12, model: 'MiniLM-L6' },
  session_id: summary.session,
  project: summary.project,
  model_attempted: 'MiniLM-L6-v2',
  fallback_attempted: 0,
  fallback_succeeded: 0,
})

// Success/event path — new
const ev = telemetry.start('extract.session', {
  session_id: summary.session,
  project: summary.project,
})
// … do work …
ev.end('success', { pattern_count: 4, duration_ms: 12300 })
// or: ev.end('failure', { reason: 'k2.5_timeout' })
// or: ev.fallback('claude-sonnet-4-6', { reason: 'k2.5_timeout' })

// Shortcut for one-shot events
telemetry.event({
  stage: 'hnsw.save',
  kind: 'end',
  outcome: 'success',
  duration_ms: 42,
  metadata: { vector_count: 515 },
})
```

### 7.2 Implementation Guarantees

1. **Lazy DB open:** reuses the daemon's existing `db` handle. No fresh SQLite open per call.
2. **Rate limit:** in-memory sliding window — max 100 errors and 500 events per stage per minute. Excess is dropped and counted. A synthetic `stage='telemetry.overflow'` row is inserted once per overflow period so we know it happened.
3. **PII redaction:** reuses the redact patterns from `trajectory-capture.js`. Error messages and metadata JSON are scrubbed before insert. Extract the patterns to `daemon/lib/redact.js` (new, ~50 LoC) and import from both places.
4. **Tiered payload:**
   - **success path:** stage, kind, outcome, duration_ms, session_id, project, model, small metadata — no prompts, no completions, no file paths
   - **error path:** all of above + error_message (redacted) + error_stack (truncated 2KB) + context JSON (redacted)
5. **Fallback on DB write failure:**
   - If `db.prepare(...).run()` throws, write the event as a single JSONL line to `~/.quoth/telemetry-fallback.log`.
   - On daemon startup, drain `telemetry-fallback.log` into the DB, then truncate.
   - If even the fallback log fails, write to stderr ONCE per minute (tracked by a module-level timestamp) — no spam loops.
6. **Never throws.** `telemetry.error(...)` is infallible from the caller's perspective. If it can't persist, it degrades; it never propagates.

### 7.3 Integration with Existing Code

`db.insertPipelineError(...)` stays as the low-level primitive. `telemetry.error(...)` is the new, enriched, rate-limited, redacted wrapper. All 5 existing call sites in `extract.js` migrate to `telemetry.error(...)` but the DB schema is backward compatible.

---

## 8. Module-by-Module Instrumentation Plan

Every module gets: (a) surgical catch audit, (b) stage events at boundaries. LoC deltas are rough.

### 8.1 Crash paths (Phase 0 — unblocks everything else)

| File | Change | LoC |
|---|---|---|
| `daemon/daemon.js:145` | Expand `uncaughtException` to also call `telemetry.error({stage:'daemon.uncaught',severity:'fatal',...})` | +5 |
| `daemon/daemon.js` | Add `unhandledRejection` handler with same treatment | +10 |
| `hooks/hook-dispatch.js` | Add `process.on('uncaughtException', ...)` that POSTs to `/telemetry/event` then exits 0 (so Claude Code doesn't see a crash) | +15 |
| `hooks/hook-dispatch.js` | Wrap `main().catch(...)` to also POST telemetry | +10 |
| `hooks/trajectory-capture.js` | Add top-level try/catch around the whole stdin handler, POST telemetry on failure | +15 |
| `mcp/quoth-learning-server.js` | Add `process.on('uncaughtException', ...)` that writes to SQLite directly (MCP server has its own db handle) and re-throws (crash is fine here, Claude Code will restart) | +10 |
| `mcp/quoth-learning-server.js` | In the `tools/call` catch block, also persist to `pipeline_errors` with source='mcp' | +5 |

### 8.2 Pipeline stages (Phase 1 — coverage)

For each module: wrap the main entry point with `telemetry.start(stage)` / `ev.end(...)`, add `telemetry.error(...)` in every catch that isn't already instrumented.

| File | Stage name | Changes |
|---|---|---|
| `daemon/pipeline/extract.js` | `extract.session` | Already uses `insertPipelineError`. Migrate to `telemetry.error`, add `telemetry.start/end`, add `ev.fallback('claude-sonnet-4-6', ...)` on K2.5 failure |
| `daemon/lib/judge.js` | `judge.pair`, `judge.batch` | Wrap `callJudge`, log each LLM call, log parse failures |
| `daemon/lib/embed.js` | `embed.single`, `embed.batch` | Log MiniLM load failures, inference crashes, empty-input skips |
| `daemon/lib/promote.js` | `promote.pattern`, `promote.project_ensure` | Log HTTP errors with status code, log auth failures distinctly |
| `daemon/lib/pipeline-api.js` | `pipeline_api.call` | Log timeouts, 4xx, 5xx; include quota_remaining from response |
| `daemon/lib/doc-updater.js` | `docupdate.file`, `docupdate.commit` | Log claude CLI failures, git push failures |
| `daemon/lib/doc-update-api.js` | `docupdate_api.call` | HTTP error logging |
| `daemon/lib/pull.js` | `cloud.pull` | Log per-batch failures, track partial-sync state |
| `daemon/lib/llm.js` | `llm.gateway`, `llm.moonshot` | Log 5xx, timeouts, no-api-key — these are thrown upward today, we add a logging shim that logs-and-rethrows |
| `daemon/lib/doc-chunks.js` | `docchunks.index`, `docchunks.reindex` | Log per-file failures |
| `daemon/lib/hnsw.js` | `hnsw.save`, `hnsw.load`, `hnsw.query` | Today `daemon.js:492` silently swallows save failures — instrument |
| `daemon/lib/clustering.js` | `v2.clusters.rebuild` | Log cluster build failures |
| `daemon/lib/bandit-v2.js` | `v2.bandit.sample`, `v2.bandit.update` | Log update failures |
| `daemon/lib/snips.js` | `v2.snips.reward` | Log reward calc failures |
| `daemon/lib/injection.js` | `v2.injection.select` | Log selection failures (these affect patterns shown to user) |
| `daemon/lib/query-server.js` | `queryserver.request` | Log handler errors, socket errors, timeouts |
| `daemon/lib/pattern-cache.js` | `cache.miss`, `cache.rebuild` | Low priority, metadata only |

**Total new instrumentation sites:** ~60-80 across 16 files.

### 8.3 Operator tooling (Phase 2)

| File | What | LoC |
|---|---|---|
| `quoth-plugin/scripts/cli.js` | New subcommand: `quoth errors [--since 1h] [--stage X] [--limit 50]` — pretty-prints `pipeline_errors` | +60 |
| `quoth-plugin/scripts/cli.js` | New subcommand: `quoth events [--since 1h] [--stage X] [--outcome failure]` | +50 |
| `quoth-plugin/scripts/cli.js` | New subcommand: `quoth diag` — one-shot health report: daemon up/down, last error, stage failure rates, table sizes | +80 |
| `mcp/handlers/diagnostics.js` (NEW) | New MCP tool `quoth_diag` — same output as `quoth diag` but queryable from Claude Code via MCP | +120 |
| `mcp/handlers/diagnostics.js` | New MCP tool `quoth_recent_errors` — returns recent entries from `pipeline_errors` | +50 |
| `mcp/handlers/index.js` | Register the 2 new tools | +10 |

This is the "we can identify improvement points and errors rápidamente" payoff — Agustin can ask Claude Code "¿qué se rompió en Quoth hoy?" and get a direct answer.

### 8.4 Catch audit (Phase 1.5)

Systematic review of all `catch` blocks. Each one gets classified:

**Class A — Best-effort cleanup (keep as `catch {}` with comment):**
```js
try { fs.unlinkSync(PID_FILE) } catch {} // best-effort: file may already be gone
```
Rule: must be a `fs.unlink`, `fs.rm`, or similarly idempotent cleanup AND must have a comment.

**Class B — Expected parse failures (keep, but count):**
```js
try { JSON.parse(line) } catch { /* skipped: malformed JSONL line */ }
```
Rule: these are skipped by design. Add a lightweight `telemetry.event({stage:'parse.skip', metadata:{source:'jsonl'}})` if volume matters, otherwise comment only.

**Class C — Silent failures (open up):**
```js
try { db.saveHnsw() } catch {} // ← CURRENT: silent
```
Becomes:
```js
try {
  db.saveHnsw()
  telemetry.event({stage:'hnsw.save', kind:'end', outcome:'success'})
} catch (err) {
  telemetry.error({stage:'hnsw.save', message:err.message, stack:err.stack})
}
```

**Class D — Error path that's already logged (migrate to telemetry):**
```js
} catch (err) {
  log('error', 'Failed to read trajectory file', { file, error: err.message })
}
```
Becomes:
```js
} catch (err) {
  telemetry.error({stage:'trajectory.read', message:err.message, context:{file}})
}
```

**Audit deliverable:** a `catch-audit.md` under `docs/superpowers/implementations/` with each file's catches listed, classified, and linked to the PR that fixed them. This becomes the paper trail for "no silent bullshit".

**Audit scope:** 24 empty catches in `daemon.js` + 62 catches across 19 `daemon/lib/*.js` files + unknown count in `hooks/` and `mcp/`. Total: roughly 100-120 catch blocks to review.

### 8.5 Query server `/telemetry/event` endpoint (Phase 0)

Add to `daemon/lib/query-server.js`:

```js
if (req.method === 'POST' && req.url === '/telemetry/event') {
  let body = ''
  req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY) req.destroy() })
  req.on('end', () => {
    try {
      const ev = JSON.parse(body)
      if (ev.kind === 'error') telemetry.error(ev)
      else telemetry.event(ev)
      res.writeHead(204); res.end()
    } catch {
      res.writeHead(400); res.end()
    }
  })
  return
}
```

Hooks use this via a thin fetch helper in `hooks/lib/telemetry-client.js` (NEW, ~40 LoC):

```js
function postTelemetry(payload) {
  return new Promise(resolve => {
    const data = JSON.stringify(payload)
    const req = http.request({
      socketPath: SOCK_PATH,
      path: '/telemetry/event',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 200, // aggressive, hooks must not block
    })
    req.on('error', () => resolve())      // swallow: daemon may be down
    req.on('timeout', () => { req.destroy(); resolve() })
    req.write(data); req.end(() => resolve())
  })
}
```

**Hook fallback when daemon is down:** append the payload to `~/.quoth/telemetry-fallback.log` (one JSONL line). On daemon startup, `drainFallbackLog()` reads this file and bulk-inserts the events, then truncates.

---

## 9. Optional: Braintrust Exporter (Phase 3)

Not required for the "no silent bullshit" principle. Added as a later phase when Agustin wants remote dashboards.

### 9.1 `daemon/lib/braintrust-exporter.js` (NEW, ~150 LoC)

```js
'use strict'

let _bt = null
function getBt() {
  if (_bt !== null) return _bt
  try { _bt = require('braintrust') } catch { _bt = { unavailable: true } }
  return _bt
}

function createExporter(db, log) {
  const apiKey = process.env.BRAINTRUST_API_KEY
  const projectId = process.env.BRAINTRUST_PROJECT_ID
  const bt = getBt()

  if (bt.unavailable || !apiKey || !projectId) {
    log('info', 'Braintrust exporter disabled', {
      reason: bt.unavailable ? 'braintrust package not installed' : 'missing credentials',
    })
    return { start: () => {}, stop: () => {} }
  }

  const logger = bt.initLogger({ apiKey, projectName: 'quoth-plugin' })
  let timer = null

  async function flush() {
    // Read unexported errors (batch of 50)
    const errors = db.prepare(
      `SELECT * FROM pipeline_errors WHERE bt_exported_at IS NULL ORDER BY created_at LIMIT 50`
    ).all()
    for (const err of errors) {
      try {
        await bt.traced('pipeline.error', async (span) => {
          span.log({
            input: err.context ? JSON.parse(err.context) : {},
            output: null,
            metadata: {
              stage: err.stage, severity: err.severity, source: err.source,
              session_id: err.session_id, project: err.project,
              model_attempted: err.model_attempted,
              fallback_attempted: !!err.fallback_attempted,
              fallback_succeeded: !!err.fallback_succeeded,
            },
            error: { message: err.error_message, stack: err.error_stack },
          })
        })
        db.prepare(`UPDATE pipeline_errors SET bt_exported_at = ? WHERE id = ?`)
          .run(Date.now(), err.id)
      } catch (flushErr) {
        // Stop the batch on first failure; retry next tick
        log('warn', 'Braintrust flush interrupted', { err: flushErr.message, id: err.id })
        break
      }
    }
    // Same loop for pipeline_events (metadata only, no error field)
    // …
  }

  function start() {
    timer = setInterval(flush, 60_000)
    // Also flush once at startup after a short delay
    setTimeout(flush, 5_000)
  }
  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }
  return { start, stop, flush }
}

module.exports = { createExporter }
```

### 9.2 Integration

`daemon.js` calls `const exporter = createExporter(db, log); exporter.start()` near the other timer startups. On SIGTERM, calls `exporter.stop()` and awaits a final `exporter.flush()`.

### 9.3 Cost & Rate Control

- Max 100 events flushed per minute (rate limit in the flush function).
- If a flush call fails, exponential backoff: 60s → 120s → 240s → cap at 600s.
- Never blocks the pipeline — flush runs on its own timer.

### 9.4 When to enable

- Phase 3 lands the code.
- User installs `braintrust` via `npm install --prefix quoth-plugin braintrust` or we add it to the plugin's package.json.
- Default: **disabled** if the package is missing. No error, just an info log at startup saying "Braintrust exporter disabled".

---

## 10. Testing Strategy

### 10.1 Unit tests (Phase 0 + 1)

**File: `tests/telemetry.test.js` (NEW)**
- `telemetry.error()` inserts into pipeline_errors with all fields
- `telemetry.start().end()` inserts paired events with duration
- Rate limiter drops events over 100/min and inserts overflow row
- PII redaction strips known patterns from messages and metadata
- Fallback-log write when `db.prepare` throws
- `drainFallbackLog` picks up entries after daemon restart

**File: `tests/crash-handlers.test.js` (NEW)**
- Daemon uncaughtException writes to pipeline_errors before log
- Daemon unhandledRejection writes to pipeline_errors
- Hook dispatch crash is captured (fork a hook subprocess, assert telemetry arrives)
- MCP server crash is captured (fork a server subprocess, assert telemetry)

**File: `tests/query-server.test.js` (extend existing)**
- `POST /telemetry/event` with valid payload inserts into pipeline_events
- `POST /telemetry/event` with invalid JSON returns 400
- Body size limit enforced

### 10.2 Integration tests (Phase 1)

**File: `tests/instrumentation-integration.test.js` (NEW)**
- Force a failure in each of: judge, embed, promote, pipeline-api, doc-updater, pull
- Assert pipeline_errors has a row for each with correct stage/source
- Force a success in each of: extract, judge, embed
- Assert pipeline_events has `start`/`end` pairs for each

### 10.3 Catch audit test (Phase 1.5)

**File: `tests/catch-audit.test.js` (NEW)**

Two-layer static analysis across `daemon/**`, `hooks/**`, `mcp/**`:

**Layer 1 — Empty catches (`catch {}` and `catch (e) {}`):**
- Regex: `catch\s*(\([^)]*\))?\s*\{\s*\}`
- Every match must appear in `docs/superpowers/implementations/catch-audit.md` whitelist with Class A justification, or the test fails.

**Layer 2 — Non-empty catches that swallow (Class C before migration):**
- Regex: find all `catch\s*\([^)]*\)\s*\{[^}]*\}` blocks (single-line only for the static test; multi-line blocks are audited manually and listed in `catch-audit.md`)
- For each block, fail if the body contains neither `telemetry.` nor `insertPipelineError` nor `throw` — the test treats absence of any of those three as "silent swallow".
- Block bodies that call `log(...)` or `console.*` without also reaching telemetry are **not** a pass — these are Class D before migration and must be migrated in Phase 1.5.

**Escape hatch:** A catch block can be exempted by listing `<file>:<line>` in `catch-audit.md` with a Class A/B rationale. Any exemption requires a human-readable justification; the test greps the whitelist for each file:line pair.

**Enforcement boundary:** `daemon/lib/third-party/**` (if any are added later) and `tests/**` are excluded.

This turns the audit into a **durable invariant**: adding a silent catch in the future fails CI, whether empty or logging-only.

### 10.4 Braintrust exporter test (Phase 3)

**File: `tests/braintrust-exporter.test.js` (NEW)**
- With braintrust unavailable: exporter returns no-op, logs info
- With braintrust mocked: `flush()` reads unexported rows, calls `bt.traced(...)`, marks rows exported
- Rate limit: 101 events in batch → only 100 flushed
- Retry on failure: after failure, next flush picks up from where it stopped

### 10.5 Operator CLI test (Phase 2)

**File: `tests/cli-diag.test.js` (NEW)**
- Seed `pipeline_errors` + `pipeline_events` with fixture data
- `quoth errors` output contains expected rows
- `quoth diag` output includes daemon health, recent errors, table sizes

---

## 11. Execution Phases

Each phase is an independent PR, independently reverteable, with its own tests.

### Phase 0 — Crash handlers + telemetry.js baseline (blocker for everything)

**Scope:**
- Create `daemon/lib/telemetry.js` (the module)
- Create `daemon/lib/redact.js` (shared redact)
- Schema migration: extend pipeline_errors, create pipeline_events
- Wire `uncaughtException` + `unhandledRejection` in all 4 entry points
- Add `/telemetry/event` endpoint to query-server
- Add `hooks/lib/telemetry-client.js`
- Tests for all of the above

**Acceptance:** A crash in daemon, hook, or MCP server ALWAYS results in a row in `pipeline_errors`. Verified by a test that forks each entry point and kills it.

**LoC estimate:** ~500 delta across ~15 files, mostly new.

### Phase 1 — Module-by-module coverage

**Scope:**
- Migrate `extract.js` existing 5 `insertPipelineError` calls to `telemetry.error`
- Add `telemetry.start/end` wrappers around `processSessionBatch`, `extract`, `judge.batch`, `embed.batch`, `promote.pattern`, `pipeline_api.call`, `doc-updater.file`, `cloud.pull`
- Add `telemetry.error` in every catch across the 16 identified modules
- Integration tests that force failures in each

**Acceptance:** Every pipeline module can demonstrate a `pipeline_errors` row on failure and a matching `pipeline_events` start/end pair on success.

**LoC estimate:** ~400 delta across ~16 files.

### Phase 1.5 — Catch audit

**Scope:**
- Create `docs/superpowers/implementations/catch-audit.md` listing every `catch {}` in the codebase, classified A/B/C/D
- Fix Class C (silent failures): open them up to `telemetry.error(...)`
- Annotate Class A (best-effort cleanup) with a comment
- Add `tests/catch-audit.test.js` enforcing the whitelist

**Acceptance:** `catch {}` only appears in places on the whitelist, and every whitelist entry has a justification. CI blocks future silent catches.

**LoC estimate:** ~150 delta + 1 new docs file + 1 new test.

### Phase 2 — Operator tooling

**Scope:**
- `quoth errors` / `quoth events` / `quoth diag` CLI subcommands
- `quoth_diag` / `quoth_recent_errors` MCP tools
- README section on "how to debug Quoth" that shows these commands

**Acceptance:** Agustin can ask Claude Code "¿qué se rompió en Quoth en la última hora?" and get a direct answer from the MCP tool.

**LoC estimate:** ~350 delta + docs.

### Phase 3 — Braintrust exporter (optional)

**Scope:**
- `daemon/lib/braintrust-exporter.js`
- Integration into daemon.js timer lifecycle
- `BRAINTRUST_PROJECT_ID` env hookup
- Tests with mocked braintrust module
- Docs on how to enable

**Acceptance:** With `braintrust` installed and env vars set, pipeline_errors rows flow into the Braintrust dashboard within 60s of insertion. Without `braintrust` installed, the daemon runs fine and logs an info line at startup.

**LoC estimate:** ~200 delta + tests.

### Phase 4 — Dashboards & alerts (future, not in this spec)

Explicit non-goal for now. Deferred until Phases 0-3 land and we have 1-2 weeks of real data to understand what to alert on.

---

## 12. Risks & Mitigations

### 12.1 Risks

1. **Table growth.** `pipeline_events` could grow large on a busy day. Mitigation: 7-day retention, daily GC, rate limits.
2. **Rate limiter masks real problems.** If a stage is in a tight crash loop, we'll drop most events. Mitigation: the overflow row is inserted with the dropped count, so "we dropped N events in the last minute" is visible.
3. **Catch audit turns up something scary.** We might find that several silent catches were masking actual bugs that the codebase currently relies on. Mitigation: Class C transitions happen one at a time; each gets a test to prove the new logged behavior is correct.
4. **Hook fallback log grows unbounded.** If the daemon is down for days, `telemetry-fallback.log` accumulates. Mitigation: size cap (10MB), drop oldest lines when exceeded, log the drop.
5. **Braintrust SDK heavy.** The braintrust package pulls express, ajv, and friends (~3MB). Mitigation: dynamic require, not in plugin's package.json by default, no-op fallback.
6. **PII leak through metadata.** If a stage-specific metadata blob contains un-redacted data, it lands in SQLite and maybe Braintrust. Mitigation: `telemetry.js` runs every `metadata` JSON through the redact patterns before insert.
7. **Schema migration on existing DBs.** ALTER TABLE on pipeline_errors adds columns. Mitigation: use the existing `v2Migrate(...)` pattern in db.js, wrapped with IF NOT EXISTS / defensive try-catch.

### 12.2 Non-Goals

- **We are NOT building a dashboard UI.** Query is via SQL, CLI, or MCP tool.
- **We are NOT replacing daemon.log.** The log file stays as a chronological trace; SQLite is the structured queryable store.
- **We are NOT adding user-facing alerts.** No popups, no terminal spam. All visibility is pull-based.
- **We are NOT touching the pipeline's logic.** Every stage still does what it did; we just add observability around it.
- **We are NOT instrumenting hot-path DB queries.** The pattern lookup path has to stay fast — instrumentation happens at stage boundaries, not inside tight loops.
- **We are NOT using OpenTelemetry.** It's a reasonable alternative but adds weight; we stay with direct SQLite + optional Braintrust SDK.

---

## 13. Acceptance Criteria

- [ ] Running `quoth diag` from a fresh install shows: daemon status, last 5 errors (if any), stage health summary, table sizes.
- [ ] Running `quoth errors --since 1h` returns all errors from the last hour with stage, severity, message, context.
- [ ] Forcing a crash in the daemon (e.g. `kill -ABRT`) results in a `pipeline_errors` row with `severity='fatal'` and a stack trace.
- [ ] Forcing a crash in a hook (e.g. syntax error in hook-dispatch) results in a `pipeline_errors` row with `source='hook'` and the hook command name.
- [ ] Forcing a crash in the MCP server results in a `pipeline_errors` row with `source='mcp'`.
- [ ] After running `npm test` + one full pipeline cycle (a real session processed end-to-end), `SELECT stage, COUNT(*) FROM pipeline_events GROUP BY stage` shows rows from at least 8 distinct instrumented stages (judge, extract, embed, promote, consolidate, distill, route, inject). Verifies that instrumentation actually fires, not just that the code compiles.
- [ ] Every `catch {}` in the codebase is either in `docs/superpowers/implementations/catch-audit.md` with a justification, or has been opened up. The `catch-audit.test.js` test enforces this.
- [ ] The `[WARN] Hook route error: Daemon failed to start within 5s` spam that currently appears in every UserPromptSubmit hook is either eliminated (daemon starts faster) or converted to a `pipeline_errors` row with `severity='warn'`.
- [ ] `telemetry.error(...)` never throws from the caller's perspective, verified by a test that forces `db.prepare` to throw.
- [ ] Rate limiter drops events when a stage exceeds 100/min, with a single `stage='telemetry.overflow'` row recording the drop.
- [ ] After 24 hours of normal operation, `pipeline_events` contains start/end pairs for all 8+ instrumented stages.
- [ ] Daemon startup drains `~/.quoth/telemetry-fallback.log` and truncates it.
- [ ] (Phase 3 only) With `braintrust` installed and env vars set, `pipeline_errors` rows appear in the Braintrust dashboard within 60s.
- [ ] All 329+ existing tests still pass. New tests for telemetry, crash handlers, catch audit, and CLI all green.

---

## 14. Files Touched

### New

- `quoth-plugin/daemon/lib/telemetry.js`
- `quoth-plugin/daemon/lib/redact.js`
- `quoth-plugin/daemon/lib/braintrust-exporter.js` (Phase 3)
- `quoth-plugin/hooks/lib/telemetry-client.js`
- `quoth-plugin/mcp/handlers/diagnostics.js`
- `quoth-plugin/tests/telemetry.test.js`
- `quoth-plugin/tests/crash-handlers.test.js`
- `quoth-plugin/tests/instrumentation-integration.test.js`
- `quoth-plugin/tests/catch-audit.test.js`
- `quoth-plugin/tests/cli-diag.test.js`
- `quoth-plugin/tests/braintrust-exporter.test.js` (Phase 3)
- `docs/superpowers/implementations/catch-audit.md`

### Modified

- `quoth-plugin/daemon/daemon.js` — unhandledRejection, uncaughtException upgrade, GC for new tables, timer for exporter
- `quoth-plugin/daemon/db.js` — migration for extended pipeline_errors + new pipeline_events
- `quoth-plugin/daemon/lib/query-server.js` — `/telemetry/event` endpoint
- `quoth-plugin/daemon/pipeline/extract.js` — migrate `insertPipelineError` calls to `telemetry.error`
- `quoth-plugin/daemon/lib/judge.js` — telemetry wiring
- `quoth-plugin/daemon/lib/embed.js` — telemetry wiring
- `quoth-plugin/daemon/lib/promote.js` — telemetry wiring
- `quoth-plugin/daemon/lib/pipeline-api.js` — telemetry wiring (remove stderr writes)
- `quoth-plugin/daemon/lib/doc-updater.js` — telemetry wiring
- `quoth-plugin/daemon/lib/doc-update-api.js` — telemetry wiring
- `quoth-plugin/daemon/lib/pull.js` — telemetry wiring
- `quoth-plugin/daemon/lib/llm.js` — add log-and-rethrow shim
- `quoth-plugin/daemon/lib/doc-chunks.js` — telemetry wiring
- `quoth-plugin/daemon/lib/hnsw.js` — telemetry wiring
- `quoth-plugin/daemon/lib/clustering.js` — telemetry wiring
- `quoth-plugin/daemon/lib/bandit-v2.js` — telemetry wiring
- `quoth-plugin/daemon/lib/snips.js` — telemetry wiring
- `quoth-plugin/daemon/lib/injection.js` — telemetry wiring
- `quoth-plugin/hooks/hook-dispatch.js` — crash handler, telemetry on catch blocks
- `quoth-plugin/hooks/trajectory-capture.js` — crash handler, telemetry on fire-and-forget catch
- `quoth-plugin/mcp/quoth-learning-server.js` — crash handler, telemetry in tools/call catch
- `quoth-plugin/mcp/handlers/index.js` — register diagnostics tools
- `quoth-plugin/scripts/cli.js` — `errors`, `events`, `diag` subcommands
- `quoth-plugin/package.json` — (Phase 3 only, optional) add `braintrust` as optionalDependency

---

## 15. Ordering With session-isolation Spec

This observability work and the session-isolation spec (`2026-04-10-session-isolation.md`) are independent in scope but **not** in sequencing. The session-isolation implementation explicitly depends on Phase 0 of this spec being merged first — without telemetry.js + crash handlers in place, any bug introduced by the trajectory-file refactor would be invisible until a pattern silently fails to extract.

**Hard dependency:**
- Session isolation implementation PR **must not** start until Phase 0 of this spec is merged to `main`.
- The session-isolation spec should, in its own implementation plan, reference `telemetry.start('session.rename')`, `telemetry.start('session.process')`, and `telemetry.error({source: 'daemon', stage: 'session.stale'})` as instrumentation points from day one.

**Execution order:**

1. **Phase 0 of this spec first** (crash handlers + telemetry.js baseline) — blocker for everything else.
2. **Session isolation implementation** — instrumented from day one against the telemetry API.
3. **Phase 1+1.5 of this spec** (module coverage + catch audit) — with session isolation landed, we have a clean substrate to instrument.
4. **Phase 2** (operator tooling) — useful throughout but not blocking.
5. **Phase 3** (Braintrust exporter) — when Agustin wants remote dashboards.

**Shared module seam:** The `daemon/lib/redact.js` module created in Phase 0 is reused by the session-isolation spec's sidecar metadata writer (to redact PII from any residual text in session summaries). Both specs point at the same redact module — do not fork it.

---
