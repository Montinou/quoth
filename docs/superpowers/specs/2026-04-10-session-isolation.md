# Spec — Session Isolation & Per-Session Trajectory Files

**Status:** Brainstorming Done — ready for `superpowers:writing-plans`
**Author:** Agustin + Claude Opus 4.6
**Captured:** 2026-04-10
**Brainstorming resolved:** 2026-04-10 (all 11 questions in §10.2, see decisions inline)
**Related memories:** `project_stale_session_detector_gaps_2026_04_10.md`
**Supersedes:** current "shared JSONL per project/date" model in `trajectory-capture.js` + `daemon.js`

---

## 1. Problem Statement

> "Los procesamientos de sessions no deberían ser contaminados por nuevos registros. Siempre vamos a tener sessions en paralelo, no deberían jamás contaminarse entre sí, ni el daemon dejar de capturar por procesar. Deberían ser procesos que corren por separado en paralelo y cada session guardar sus logs por separado."
> — Agustin, 2026-04-10

The current trajectory layout **fails all three guarantees** implicit in this request. This spec replaces it with a per-session append-only file model so that capture, stale detection, and extraction never touch the same file at the same time.

---

## 2. Deep Analysis — What's Broken Today

### 2.1 Current Layout

```
~/.quoth/trajectories/
  <project>-<YYYY-MM-DD>.jsonl   ← shared across ALL sessions on that project/day
```

Observed state at capture time (`~/.quoth/trajectories/`, snapshot 2026-04-10):

| File | Lines | Distinct sessions |
|---|---|---|
| `quoth-2026-04-10.jsonl` | 149 | 3 |
| `lord_montino-2026-04-10.jsonl` | 77 | 3 |

→ **Parallel sessions are already interleaving into the same file right now.** Line counts grow continuously while sessions are active; the snapshot is illustrative, not load-bearing.

### 2.2 Contamination Vectors

#### Vector A — `markProcessed()` is read-modify-write on a shared file

`daemon.js:467-473`:

```js
function markProcessed(filePath, originalLine) {
  const content = fs.readFileSync(filePath, 'utf8')
  const processedLine = originalLine.replace(/\}(\s*)$/, ',"_processed":true}$1')
  fs.writeFileSync(filePath, content.replace(originalLine, processedLine))
}
```

Failure modes:

1. **Lost append.** `readFileSync` → live hook runs `appendFileSync` → `writeFileSync` overwrites the new line. **Silent data loss.** Happens every time the daemon processes an entry while a parallel session is active on the same project.
2. **Concurrent markProcessed races.** `processQueue()` runs 5 workers in parallel (`daemon.js:211`). Each calls `markProcessed` on potentially the same file. Classic TOCTOU — last writer wins, others' `_processed` flags are lost, those lines get re-queued next scan.
3. **Partial-write corruption.** If the daemon crashes between `writeFileSync` and fsync, the file is half-old / half-new. No atomic rename, no fsync.

#### Vector B — Stale detector vs live session

`detectStaleSessions()` (daemon.js:1402-1487) reads the file, decides a session is stale, appends a synthetic `session_summary`. But:

- Decision is based on a snapshot read. A live process can append `tool_use` entries between the read and the synthetic-summary append.
- The 30-min threshold makes it rare in practice, but it's not a guarantee — only a hope.

#### Vector C — fs.watch storm

`watchTrajectories()` fires on ANY write to the directory. Every parallel session's every `tool_use` hook triggers a 500ms-debounced full directory rescan. `scanAndEnqueue()` then `readFileSync`'s every file, parses every line. O(files × lines) per hook invocation across the whole fleet.

#### Vector D — Trivial session leak (Gap 1 from memory)

Sessions with <3 tool_use entries are never marked `_processed` (by design — extract isn't worth running). They accumulate forever. `detectStaleSessions` re-scans them every 10 minutes. `scanAndEnqueue` re-parses them on every hook-triggered rescan. Bounded-growth → unbounded work.

#### Vector E — Processing blocks capture (user's explicit concern)

Today: daemon holds a `processing.lock`, processes the queue, can take seconds (EXTRACT calls Kimi K2.5 for 15-30s per session). During that time, `markProcessed` holds the file for its read-modify-write. A live hook that tries to append in that window may race.

### 2.3 Summary of Harm

| Harm | Likelihood | Impact |
|---|---|---|
| Silent data loss via markProcessed races | **High** when parallel sessions active | Tool calls never reach EXTRACT, patterns never learned |
| Re-processing of already-done entries | Medium (if `_processed` flag lost) | Duplicate LLM spend, duplicate pattern inserts |
| Stale-detector synthesizes summary for live session | Low (30-min guard) | Spurious pattern extraction, misattributed outcomes |
| Trivial session accumulation | Certain | Wasted I/O on every scan tick (measurable in `daemon.log`) |
| Stale detector silently drops trivial sessions | Certain | Leaks, no audit trail, GC never happens |

---

## 3. Design Principles

1. **Hooks only append.** Never read, never rewrite. Append is the only atomic operation POSIX guarantees for our case.
2. **One session = one file.** Zero shared writers → zero contention.
3. **Daemon never touches active files.** Processing operates on a frozen copy obtained via atomic rename.
4. **File location = processing state.** No in-line `_processed` flag, no read-modify-write. State is encoded by which directory the file lives in.
5. **Capture never blocks on processing.** The two run in separate directories.
6. **Every transition is atomic.** `fs.rename()` on the same filesystem is the atomicity primitive.

---

## 4. Proposed Architecture

### 4.1 Directory Layout

```
~/.quoth/trajectories/
  active/
    <sessionId>.jsonl       ← hooks append here, never read
    <sessionId>.meta.json   ← {project, first_seen, last_seen, tool_count}
  processing/
    <sessionId>.jsonl       ← daemon reads here, capture never touches
    <sessionId>.meta.json
  done/
    YYYY-MM-DD/
      <project>/
        <sessionId>.jsonl   ← EXTRACT produced ≥1 pattern or fact
  routine/
    YYYY-MM-DD/
      <project>/
        <sessionId>.jsonl   ← EXTRACT ran and LLM classified as routine
                              (no learnable signal — decided by model, not heuristics)
  empty/
    YYYY-MM-DD/
      <sessionId>.jsonl     ← zero tool_use entries — nothing to feed the LLM
                              (only pre-filter case; extremely rare)
  error/
    YYYY-MM-DD/
      <sessionId>.jsonl     ← EXTRACT threw an unrecoverable error
                              (kept for audit + retry)
```

**Bucket philosophy**: the only mechanical gate is `empty/` (no input → no LLM call). Every other classification is made by EXTRACT itself via its `session_type: productive|routine` output. Zero heuristic parsing decides "is this worth learning from" — that is the LLM's job.

### 4.2 State Machine per Session

```
  [no file]
     │  hook appends first tool_use
     ▼
  active/<sid>.jsonl ─────────────────────┐
     │                                     │
     │  session-end hook                   │ stale detector (idle >30m)
     │  writes session_summary             │ synthesizes summary (aggregation only)
     │  + atomic rename                    │ + renames to processing/
     ▼                                     ▼
  processing/<sid>.jsonl  ◄────────────────┘
     │
     │  daemon reads file
     │
     ├── toolEntries.length === 0 ─────────────────────▶  empty/<sid>.jsonl
     │   (nothing to feed the LLM — only hard gate)
     │
     │  otherwise → EXTRACT (Kimi K2.5 multi-turn tool loop)
     │                          │
     │          ┌───────────────┼────────────────┬─────────────┐
     │          │               │                │             │
     │  session_type=        patterns>0      LLM threw       managed
     │   routine OR        OR facts>0       unrecoverable    mode API
     │   (patterns=0                         error            returns
     │    AND facts=0)                                        similar
     │          │               │                │             │
     ▼          ▼               ▼                ▼             ▼
routine/     done/<project>/ done/<project>/  error/      (same routing
<sid>.jsonl  <sid>.jsonl     <sid>.jsonl      <sid>.jsonl  as local path)
```

All transitions are `fs.rename()` — atomic on the same filesystem. **Notice what is NOT in this diagram**: any branch labelled "fewer than N entries" or "no outcome" or similar heuristic pre-filter. Only the LLM decides `routine` vs `productive`.

### 4.3 Why Rename Is Safe Under Concurrent Append

POSIX guarantees: an open file descriptor remains bound to the inode across rename. So the only race surface is **a new hook invocation that opens a fresh fd for a session whose file has been moved.**

- Case 1: hook opens fd, appends, closes → detector renames → **safe**, write landed in what is now `processing/<sid>.jsonl`.
- Case 2: detector renames → hook opens new fd via `open(O_CREAT|O_APPEND)` → **creates a NEW `active/<sid>.jsonl`**. The daemon already has the frozen copy in `processing/`, extracts from it. The new `active/<sid>.jsonl` becomes a logical "resume" of the session and will be processed on its own stale-detect cycle.
- Case 3: hook's `appendFileSync` is in-flight during rename → the in-flight write lands in the renamed file (same inode), the next append from a new hook call creates a fresh `active/<sid>.jsonl`.

All three cases are safe. The only observable effect is that a single user-facing session can, in rare cases, produce two extracted pattern batches — one per "epoch". This is strictly better than the current "silent data loss" failure mode.

### 4.4 Metadata Sidecar

`<sessionId>.meta.json` is written once by the first hook that sees the session and updated by subsequent hooks (or rebuilt from the JSONL if missing). Schema:

```json
{
  "session_id": "a53012bf-5bca-47c6-932b-d862675977a0",
  "project": "quoth",
  "first_seen_ts": 1739200000000,
  "last_seen_ts": 1739200360000,
  "tool_count": 12,
  "closed_marker": false
}
```

Updates are cheap: the sidecar is per-session, so there's no cross-session contention. Updates use `fs.writeFileSync` with rename-trick for atomicity (`<sid>.meta.json.tmp` → rename to `.meta.json`).

**Why a sidecar instead of only SQLite?** So that hooks never need to open SQLite (currently they don't — keeping it that way matters for hook latency under load).

### 4.5 SQLite `sessions` Table (New)

The sidecar is the source of truth for hooks; SQLite is the source of truth for the daemon. Daemon ingests sidecars on rename and keeps the table in sync.

```sql
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  first_seen_ts INTEGER NOT NULL,
  last_seen_ts INTEGER NOT NULL,
  tool_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('active','processing','done','routine','empty','error')),
  closed_marker INTEGER NOT NULL DEFAULT 0,
  extracted_at INTEGER,
  pattern_count INTEGER,
  fact_count INTEGER,
  epoch INTEGER NOT NULL DEFAULT 1  -- for resume-after-rename case
);

CREATE INDEX idx_sessions_status_last_seen ON sessions(status, last_seen_ts);
CREATE INDEX idx_sessions_project ON sessions(project);
```

**Why the table matters beyond the sidecars:** stale detection becomes a single SQL query instead of a directory scan + file reads:

```sql
SELECT session_id FROM sessions
WHERE status = 'active'
  AND last_seen_ts < :threshold;
```

No `tool_count` filter here — the detector's only job is "dead or alive?". EXTRACT decides downstream whether there's anything worth learning from.

---

## 5. Hook Changes

### 5.1 `trajectory-capture.js`

Replace:

```js
const trajFile = path.join(TRAJECTORIES_DIR, `${project}-${date}.jsonl`)
fs.appendFileSync(trajFile, JSON.stringify(entry) + '\n')
```

With:

```js
const activeDir = path.join(TRAJECTORIES_DIR, 'active')
if (!fs.existsSync(activeDir)) fs.mkdirSync(activeDir, { recursive: true })
const trajFile = path.join(activeDir, `${sessionId}.jsonl`)
fs.appendFileSync(trajFile, JSON.stringify(entry) + '\n')
updateSidecar(activeDir, sessionId, project, entry.timestamp)
```

`updateSidecar` writes `active/<sid>.meta.json.tmp` and renames (atomic). Read-increment-write is OK **because each session has exactly one writer** (the hooks for that session run sequentially within a single Claude Code instance).

### 5.2 `hook-dispatch.js` — `session-end`

Today: reads the shared file, builds summary, appends to shared file. New flow:

1. Read `active/<sessionId>.jsonl` (exclusive access — this is the session's own file).
2. Build `session_summary`.
3. Append summary to `active/<sessionId>.jsonl`.
4. `fs.renameSync(active/<sid>.jsonl, processing/<sid>.jsonl)` — atomic.
5. Also rename the sidecar.
6. Signal daemon via SIGUSR1 (existing mechanism).

The `closed_marker` in the sidecar is set to `true` before the rename so the daemon knows this was a graceful close, not a stale-detected close.

---

## 6. Daemon Changes

### 6.1 Remove `markProcessed()` entirely

Gone. Processing state is directory-based.

### 6.2 Replace `watchTrajectories()` / `scanAndEnqueue()`

Watch **`processing/`**, not the whole trajectories dir. Hooks can hammer `active/` all day — daemon doesn't care.

```js
fs.watch(PROCESSING_DIR, (event, filename) => {
  if (filename && filename.endsWith('.jsonl')) enqueueSession(filename)
})
```

On startup, list `processing/` once and enqueue everything found.

### 6.3 `processSessionFile()` — LLM-only evaluation

No more "find unprocessed tool_use entries matching sessionId across a shared file". The whole file **is** the session. Read it once, run EXTRACT, route based on what the LLM returned.

**The only hard pre-filter is "file has ≥1 tool_use entry"** — because with zero entries there is literally nothing to pass to the model as input. Every other decision (productive vs routine, worth extracting or not, good signal or noise) is made by EXTRACT's own `session_type` classification. No heuristic `if` statements sit between the session and the LLM.

If the real `session_summary` is missing (e.g. the session crashed before the `session-end` hook fired), the daemon synthesizes one by **mechanically aggregating** the tool entries (tool counts, intents, reasonings, outcome rate). This is pure bookkeeping — zero relevance decisions. The synthetic summary is then passed to EXTRACT exactly like a real one.

```js
async function processSessionFile(sessionFile) {
  const sid = sessionFile.replace('.jsonl', '')
  const filePath = path.join(PROCESSING_DIR, sessionFile)
  const meta = readSidecar(PROCESSING_DIR, sid)
  const entries = readAllEntries(filePath)
  const toolEntries = entries.filter(e => e.event === 'tool_use')

  // ── Only hard gate: do we have anything to show the LLM? ──
  if (toolEntries.length === 0) {
    return moveToEmpty(filePath, meta)
  }

  // Real summary if the session closed gracefully, synthetic (aggregation only) otherwise.
  // Synthesis is mechanical: tool_counts, intents, reasonings, outcome — no judgement.
  const summary = entries.find(e => e.event === 'session_summary')
                ?? synthesizeSummaryFromEntries(toolEntries, meta)

  // EXTRACT is the sole judge. It returns { session_type, patterns, facts }.
  let result
  try {
    result = QUOTH_MODE === 'managed'
      ? await processSessionManaged(summary, toolEntries, meta.project)
      : await extract(summary, toolEntries, db)
  } catch (err) {
    log('error', 'EXTRACT failed', { sid, err: err.message })
    db.recordPipelineError('extract', sid, err.message)
    return moveToError(filePath, meta, err.message)
  }

  const patterns = result.patterns || []
  const facts = result.facts || []

  // LLM classified the session as routine OR produced nothing learnable → routine bucket.
  // This is the ONLY "not worth extracting" branch, and it's decided by the model.
  if (result.session_type === 'routine' || (patterns.length === 0 && facts.length === 0)) {
    return moveToRoutine(filePath, meta)
  }

  for (const p of patterns) insertNewPattern(p, summary, meta.project)
  for (const f of facts) insertNewFact(f, meta.project)

  moveToDone(filePath, meta, { patterns: patterns.length, facts: facts.length })
}
```

**What was removed and why:**

| Removed | Reason |
|---|---|
| `toolEntries.length < MIN_EXTRACT_ENTRIES` gate | Heuristic. A 2-entry session after a crash could still contain a genuine workflow. Let EXTRACT decide. |
| `DAILY_EXTRACT_CAP` / `dailyExtractCount` / `dailyExtractDate` (`daemon.js:69-71, 320-326`) | Arbitrary numeric cap. Relevance gating is now semantic (`routine` classification), so the cap would only hide good sessions on productive days. |
| `markProcessed()` calls in all error paths (`daemon.js:308, 314, 323, 348-349`) | Processing state is now directory-based. Error path → `error/` bucket; no in-line flag. |
| Summary required to proceed | Stale-crashed sessions without a summary used to be synthesized only if `entries.length >= 3`. Now every non-empty session gets a synthetic summary and reaches EXTRACT. |

### 6.4 Stale Session Detector — New Implementation

A session is "stale" strictly by **timing**: no new tool_use in >30 minutes. Whether a stale session is *worth extracting from* is a separate question that EXTRACT will answer later. The detector makes one decision: "dead or alive?" — and ships every dead session to `processing/` regardless of how many entries it has.

```js
function detectStaleSessions() {
  const threshold = Date.now() - STALE_THRESHOLD_MS
  const stale = db.listSessions({ status: 'active', maxLastSeen: threshold })
  for (const s of stale) {
    try {
      // Double-check mtime to catch late-arriving activity.
      // Rename is atomic and POSIX keeps in-flight writes bound to the inode,
      // so even on a tight race we don't lose data — it lands in processing/.
      const stat = fs.statSync(activePath(s.session_id))
      if (stat.mtimeMs > threshold) continue  // resurrected

      // Synthesize summary = mechanical aggregation of existing tool entries.
      // No count threshold, no relevance judgement. EXTRACT decides later.
      appendSyntheticSummary(s)

      moveActiveFile(s.session_id, 'processing')
      db.updateSessionStatus(s.session_id, 'processing')
    } catch (err) {
      log('error', 'Stale transition failed', { sid: s.session_id, err: err.message })
    }
  }
}
```

Ticked every 10 min via `setInterval`. No full directory scan — the SQL query is O(index lookup).

**Key change from the original draft of this spec:** the detector used to skip sessions with `tool_count < MIN_EXTRACT_ENTRIES` to bypass EXTRACT for tiny crashes. That gate is **removed**. A session that crashed after 2 meaningful Writes is potentially the most valuable kind of trajectory — the user had an intent, hit a problem, and never got to close cleanly. Throwing that away would contradict the whole goal of "extraer patrones, reglas, información relevante para trabajo futuro". EXTRACT will look at it, and if there is nothing to learn, it routes to `routine/`. Cost of running EXTRACT on a tiny session is negligible (short input → short output → <$0.005).

**Gap 1 fix (trivial session leak):** replaced with the broader design. Trivial sessions don't "leak" anymore because every stale session — tiny or not — leaves `active/` on the first detector tick. Nothing accumulates.

**Gap 2 fix (last-scan persistence):** store `last_stale_scan_ts` in `daemon_meta` table. On startup, if `now - last > 10min`, run immediately.

**Gap 3 fix (race):** mtime double-check right before rename. Plus: rename is atomic, and the inode continues to receive any in-flight writes — so even if we lose the race window, data is preserved (goes into `processing/<sid>.jsonl`).

> **Prerequisite:** `daemon_meta` table does **not** exist in the current codebase (verified via `grep daemon_meta quoth-plugin/daemon/*` → 0 matches). The memory note this spec is built on said "has daemon_meta table (I think)" — that turned out to be wrong. Creating `daemon_meta(key TEXT PRIMARY KEY, value TEXT)` is an explicit prerequisite task, listed under §11 Modified → `db.js`.

### 6.5 Concurrency Model

- **Capture workers (hooks)**: one per session, each writes only to its own `active/<sid>.jsonl`. Zero contention.
- **Stale detector**: one timer, queries SQLite, performs renames. Doesn't touch JSONL contents.
- **Processing workers**: up to N (configurable, default 5) in parallel. Each claims a `processing/<sid>.jsonl` and never touches another worker's file. Lock = "this file exists in processing/".
- **Nightly pipeline / decay timers**: unchanged, still operate on SQLite.

**No shared writable resource across these four workers.** The processing lock file (`processing.lock`) can be removed.

### 6.6 EXTRACT schema extension — patterns + facts

The current EXTRACT output schema (`pipeline/extract.js:103-117`) only captures condition/action patterns. The user's goal for this work is broader: *"evaluar lo que ocurrió en la sesión y extraer patrones, reglas, información relevante para trabajo futuro"*. Condition/action covers "patterns and rules" (a rule is a pattern with prescriptive action), but it does **not** cover factual claims observed during the session — things like *"Moonshot API rejects `reasoning_content` as an input field"* or *"memory_entries uses UNIQUE(namespace, key)"*.

These facts are reusable knowledge but do not fit the condition/action mould. They belong in a different store (`memory_entries`, which already has the right schema) and need a different part of the LLM output.

#### Extended output schema

```json
{
  "session_type": "productive" | "routine",
  "patterns": [
    {
      "condition": "...",
      "action": "...",
      "tags": ["..."],
      "quality_signal": "universal" | "domain" | "project" | "edge_case"
    }
  ],
  "facts": [
    {
      "topic": "short identifier (3-80 chars, snake_case preferred)",
      "statement": "observed truth about the system (20-400 chars)",
      "evidence": "why we believe it — file:line, error msg, tool output ref (max 200 chars)",
      "scope": "project" | "global",
      "tags": ["db", "api", "..."]
    }
  ]
}
```

A `routine` session returns `patterns: []` and `facts: []`. A productive session may return any combination — patterns only, facts only, or both.

#### System prompt extension

Append to `buildSystemPrompt()` in `extract.js:80-118`:

```
FACT EXTRACTION RULES:
In addition to patterns, extract concrete factual claims observed during
this session. A fact is a verifiable statement about the system — code,
APIs, data shapes, constraints, failure modes — NOT an action or workflow.

GOOD FACTS:
- topic: "moonshot_reasoning_content_input_rejected"
  statement: "Moonshot API rejects `reasoning_content` when passed in assistant input messages; the field is output-only."
  evidence: "400 response from Kimi K2.5 tool loop when message history included prior reasoning_content"
  scope: "global"
  tags: ["moonshot", "api", "tool-calling"]

- topic: "memory_entries_unique_namespace_key"
  statement: "quoth memory_entries table enforces UNIQUE(namespace, key); same key across namespaces is permitted."
  evidence: "quoth-plugin/daemon/db.js:73"
  scope: "project"
  tags: ["db", "schema"]

BAD FACTS (do NOT extract):
- "The file exists" (trivial)
- "The command executed" (no learning value)
- "The user was investigating X" (ephemeral context)
- Opinions, guesses, hypotheses — only directly observed truths
- Facts that are already obvious from standard knowledge

scope="global" is for facts about external systems, APIs, tools, protocols
— anything useful beyond this single project. scope="project" is for facts
about this codebase specifically.
```

#### Schema parser extension

`parsePatterns()` in `extract.js:152-165` becomes `parseExtractOutput()` and returns `{ session_type, patterns, facts }`. Fact validation mirrors pattern validation: required fields present, length bounds respected, `scope` in enum. Invalid facts are dropped (not whole-response rejected) so one malformed fact doesn't lose the patterns.

### 6.7 `insertNewFact()` + `memory_entries` helpers

**Current state (verified):** the `memory_entries` table is defined in `db.js:60-74` but **has no reader or writer helpers anywhere in the codebase**. Grep for `memory_entries|upsertMemory|insertMemory|setMemoryEntry` in `db.js` returns only the `CREATE TABLE` line. Grep across `hooks/` and `mcp/` returns zero matches. The table is a dormant schema with no wiring.

This spec adds the helpers.

#### `db.js` — new helpers

```js
// Insert or update a memory entry. Uses UNIQUE(namespace, key) as the conflict key.
function upsertMemoryEntry({ namespace, key, content, type, tags, metadata }) {
  const id = crypto.createHash('sha1').update(`${namespace}:${key}`).digest('hex').slice(0, 12)
  const now = Date.now()
  db.prepare(`
    INSERT INTO memory_entries (id, namespace, key, content, type, tags, metadata, created_at, updated_at)
    VALUES (@id, @namespace, @key, @content, @type, @tags, @metadata, @created_at, @updated_at)
    ON CONFLICT(namespace, key) DO UPDATE SET
      content = excluded.content,
      tags = excluded.tags,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at
  `).run({
    id, namespace, key, content,
    type: type || 'fact',
    tags: JSON.stringify(tags || []),
    metadata: JSON.stringify(metadata || {}),
    created_at: now, updated_at: now,
  })
}

// List facts for a given namespace (used by session-restore to inject context).
function listFactsByNamespace(namespace, limit = 20) {
  return db.prepare(`
    SELECT key, content, tags, metadata, updated_at
    FROM memory_entries
    WHERE namespace = ? AND type = 'fact' AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(namespace, limit)
}
```

#### `daemon.js` — new `insertNewFact()` helper

```js
function insertNewFact(fact, project) {
  const namespace = fact.scope === 'global' ? 'global' : project
  db.upsertMemoryEntry({
    namespace,
    key: fact.topic,
    content: fact.statement,
    type: 'fact',
    tags: fact.tags || [],
    metadata: {
      evidence: fact.evidence,
      scope: fact.scope,
      extracted_at: Date.now(),
    },
  })
  log('info', 'FACT stored', { namespace, topic: fact.topic })
}
```

#### `hook-dispatch.js` — `session-restore` wires facts into context

Current `session-restore` handler injects top patterns. Extend it to also inject the top N (default 10) facts for the current project namespace **and** the `global` namespace:

```js
// existing pattern injection …
const projectFacts = db.listFactsByNamespace(project, 10)
const globalFacts  = db.listFactsByNamespace('global', 5)
if (projectFacts.length > 0 || globalFacts.length > 0) {
  const factLines = [
    ...projectFacts.map(f => `  • [${f.key}] ${f.content}`),
    ...globalFacts.map(f => `  • [global:${f.key}] ${f.content}`),
  ]
  console.log(`[INTELLIGENCE] Facts loaded (${projectFacts.length} project, ${globalFacts.length} global):`)
  console.log(factLines.join('\n'))
}
```

Without this wiring the facts extracted today would never surface tomorrow — the whole point would be lost. Listing this as an explicit step because the verification found that `memory_entries` is currently unreferenced by any hook.

#### Dedup strategy for facts

`UNIQUE(namespace, key)` in the table definition is the dedup primitive. A re-extraction of the same fact (same `topic`) **updates** the statement and metadata. This is the right behavior: if the fact was wrong the first time and we now have better evidence, the newer version wins. No Bayesian confidence on facts — a fact is true or false, not probabilistic.

### 6.8 Kimi K2.5 token limit bumps

**Verification:** K2.5 context window is **262,144 tokens** (confirmed via Moonshot/Kimi official docs at `platform.kimi.ai/docs/pricing/chat-k25`). The extract-v2 spec cites the same number. Max output is not explicitly documented by Moonshot.

Current caps in `extract.js` and `llm.js` are conservative remnants from before K2.5 existed. With `facts` joining `patterns` in the output, the call now has two arrays to produce, and the output cap deserves headroom.

| Parameter | Old value | New value | Location | Rationale |
|---|---|---|---|---|
| `maxTokens` (output per call) | `16384` | `32768` | `extract.js:223`, `llm.js:190` | 2× headroom to fit `patterns[]` + `facts[]` + thinking tokens. 32K output is well-supported by K2.5. |
| Cumulative tokens cap | `100_000` | `200_000` | `extract.js:219` | K2.5 context = 262,144. Leaving 62K headroom covers the final turn's output + thinking buffer without ever tripping a real context-full error. The old 100K was set before K2.5 existed. |
| Tool loop iterations | `12` | `12` (unchanged) | `extract.js:218` | Facts need no additional tool calls — same read_file/grep_codebase are sufficient. |
| Dynamic tool budget | `2/5/8` | `2/5/8` (unchanged) | `extract.js:188` | Same rationale. |
| HTTP timeout | `120000` ms | `120000` ms (unchanged) | `llm.js:221` | 2 minutes remains comfortable even for fuller outputs; thinking mode is the pacing factor, not bandwidth. |

**Why not bump to the full 262,144 cumulative cap?** The 200K ceiling is a safety margin, not a limit on K2.5 itself. If a session is genuinely large enough to need more than 200K of cumulative input+thinking+output, something upstream (too many tool entries, runaway tool calls) is wrong. The cap is a circuit breaker, not a throughput knob.

**Cost impact:** negligible. A typical extract call uses ~3-8K tokens today; the bumped caps only activate on very dense sessions. At K2.5 pricing, the worst-case additional spend per session is pennies.

---

## 7. Migration Plan

### 7.1 One-time Migration Script

`scripts/migrate-per-session-files.js`:

1. Iterate every `trajectories/*.jsonl` that is NOT in `active/`, `processing/`, `done/`, `routine/`, `empty/`, `error/`.
2. For each file, group entries by `session`.
3. For each session:
   - If the session has **zero** `tool_use` entries → write to `empty/YYYY-MM-DD/<sid>.jsonl`, insert into `sessions` as `empty`. (Never touches EXTRACT — same hard gate as §6.3.)
   - Otherwise → write to `processing/<sid>.jsonl` + sidecar, insert into `sessions` table as `processing`. If the session lacks a `session_summary`, synthesize one via the same mechanical aggregator used by the stale detector. The daemon picks the file up on its next scan; EXTRACT decides `done` vs `routine` vs `error` with no numeric threshold involved.
4. After a successful migration, rename the original shared file to `trajectories/legacy-backup/<original-name>.jsonl` for safekeeping.
5. Migration is idempotent: re-running skips files already under `legacy-backup/`.

**Notice the migration has no `trivial` path.** The old spec draft had one; it was removed along with the 3-entry heuristic. A 1-entry legacy session now goes to `processing/` just like any other non-empty session and gets the same LLM evaluation.

### 7.2 Rollback

The migration only moves files; it doesn't delete them. Rollback = `mv legacy-backup/* ./` and drop the `sessions` + `daemon_meta` tables. The `memory_entries` table stays (it predates this spec); any facts inserted during the rollback window remain queryable but the `session-restore` hook reverts to pattern-only injection.

### 7.3 Version Guard

Add `schema_version` row in `daemon_meta`. Set to `2` after migration. Daemon refuses to start if it finds shared files outside `legacy-backup/` after version 2.

---

## 8. Test Plan (TDD)

### 8.1 Unit Tests — Hooks

- `trajectory-capture.test.js`: appending to `active/<sid>.jsonl` creates the file, creates the sidecar, updates `tool_count`.
- Parallel sessions: simulate 3 concurrent `trajectory-capture` invocations with different `sessionId`. Assert 3 distinct files, no cross-contamination.

### 8.2 Unit Tests — Daemon

- `processSessionFile.test.js`: branches covered:
  - `toolEntries.length === 0` → `empty/` bucket, no LLM call.
  - LLM returns `session_type=routine` (patterns=[], facts=[]) → `routine/` bucket.
  - LLM returns patterns only → `done/` bucket + `insertNewPattern` called, `insertNewFact` not called.
  - LLM returns facts only → `done/` bucket + `insertNewFact` called, `insertNewPattern` not called.
  - LLM returns both patterns and facts → `done/` bucket + both inserters called.
  - EXTRACT throws → `error/` bucket + `recordPipelineError` called.
  - Managed mode (`QUOTH_MODE=managed`) routes through `processSessionManaged`; local mode routes through `extract`.
  - **Explicit assertion that there is no numeric entry-count gate**: a fixture with 1 tool_use entry lands in `processing/` just fine and reaches EXTRACT.
- `detectStaleSessions.test.js`:
  - Gap 1 (rewritten): a stale session with **1 tool_use entry** is moved to `processing/`, not skipped. The old "skip if <3" behavior must not return.
  - Gap 2: restart daemon, `last_stale_scan_ts` >10min old → immediate scan.
  - Gap 3: race simulation — after `listSessions` returns a session, fake an `fs.utimes` to advance mtime, assert skip.

### 8.3 Integration Tests

- **Contamination test (the big one):** spawn 3 concurrent "hook" processes writing to 3 sessions + 1 "daemon" process running `processSessionFile` on a 4th session. Run for 60s. Assert:
  - All 3 hooks' entries landed in their respective `active/<sid>.jsonl` files.
  - Daemon's 4th session extract completed without reading any of the other 3.
  - No `_processed` flag lost, no entries duplicated, no entries missing.
- **Stale detection under load**: 10 sessions active, 5 go idle, detector runs — exactly 5 move to `processing/`.
- **Rename race**: repeatedly rename active → processing while appending. Assert no data loss.

### 8.4 Migration Test

- Fixture: real shared file from `~/.quoth/trajectories/` (anonymized) with 3 interleaved sessions (multiple tool_use entries each) plus 1 session that contains only a `session_summary` with no `tool_use` entries (simulating a zero-activity session).
- Run migration.
- Assert: 3 files in `processing/` (all non-empty sessions, including 1-entry ones), 1 file in `empty/YYYY-MM-DD/`, `sessions` table rows match one-for-one, legacy shared file moved under `legacy-backup/`.
- Re-run migration → no-op (legacy-backup skip).
- Explicit negative assertion: no file lands in a `trivial/` directory — the bucket no longer exists.

---

## 9. Mapping: Gaps → Resolution

| Gap (from memory) | Fix |
|---|---|
| Gap 1 — Trivial session leak | Dissolved entirely. There is no "trivial" concept left — every stale session, tiny or not, goes to EXTRACT. The LLM routes it to `done/` (found signal) or `routine/` (no signal). Nothing accumulates in `active/`. |
| Gap 2 — No last-scan persistence | `daemon_meta.last_stale_scan_ts` + startup catch-up. `daemon_meta` table is created as a prerequisite (§6.4 note — table did not exist). |
| Gap 3 — Stale-vs-live race | Mtime double-check + atomic rename + POSIX fd/inode guarantees. |
| Opt 1 — Incremental scan | Replaced entirely: SQL index lookup on `sessions`, no directory scans. |
| Opt 2 — Archive old JSONLs | `done/YYYY-MM-DD/<project>/` and `routine/YYYY-MM-DD/<project>/` layouts are the archive. |
| Opt 3 — Sidecar state | Inherent to the new design. |
| Opt 4 — `sessions` table | Included. |

---

## 10. Risks & Open Questions

### 10.1 Risks

1. **Migration breakage.** If migration misattributes sessions, we could lose historical trajectories. Mitigation: `legacy-backup/` directory, dry-run mode, explicit `--confirm` flag.
2. **Inotify load on `active/` at scale.** We don't watch `active/` anymore — only `processing/`. But `fs.readdir` on `active/` for status queries could be slow with thousands of files. Mitigation: rely on `sessions` table, never scan `active/` directly.
3. **Sidecar drift.** If a hook crashes mid-write, sidecar and JSONL can diverge. Mitigation: daemon rebuilds sidecar from JSONL on ingest; sidecar is advisory, not authoritative.
4. **Resume epochs.** If a session is wrongly judged stale, the next hook creates a new file with the same `sessionId`. SQL `UNIQUE(session_id)` would break. Mitigation: `epoch` column, composite key `(session_id, epoch)` or internal PK + `(session_id, epoch)` unique index.
5. **Session-end hook failure.** If session-end crashes before rename, the file stays in `active/` and waits for the stale detector. Acceptable — 30-min latency instead of immediate, but no data loss.

### 10.2 Resolved Design Decisions

All 11 questions brainstormed and resolved on 2026-04-10 with Agustin. Original proposal + chosen answer:

1. ~~**Archive structure for `done/` and `routine/`.**~~ **Resolved (A — date-first).** Layout is `done/YYYY-MM-DD/<project>/<sid>.jsonl` and `routine/YYYY-MM-DD/<project>/<sid>.jsonl`. Date-first makes retention sweeps trivial (`rm -rf done/<old-date>/`). Project-first subdirectories still allow human grep by project.
2. ~~**Retention policy.**~~ **Resolved (B — lean).** Defaults: `done/` = **30 days**, `routine/` = **7 days**, `empty/` = **3 days**, `error/` = **14 days**. Configurable via `QUOTH_RETENTION_{DONE,ROUTINE,EMPTY,ERROR}_DAYS`. Rationale: distilled patterns/facts already live in SQLite; raw JSONL only matters for re-extract after a bug fix or "what happened yesterday" debugging. Neither needs 90 days.
3. ~~**Compression on rename.**~~ **Resolved (B — no compression).** Plain `.jsonl` everywhere. With lean retention (Q2), `done/` tops out around 300 MB on a busy week on 200+ GB disk. Compression would break `grep`/`cat` on debug workflows for no meaningful storage win.
4. ~~**Sidecar format.**~~ **Resolved (A — JSON sidecar).** Hooks write `<sid>.meta.json` via atomic rename (`.tmp` → rename). Daemon reconciles with `sessions` table on ingest. Hooks stay SQLite-free — the load-bearing invariant for hook latency under concurrent sessions.
5. ~~**Minimum extract threshold.**~~ **Resolved.** There is no numeric threshold. Every non-empty session goes to EXTRACT; the LLM decides. `MIN_EXTRACT_ENTRIES` and `DAILY_EXTRACT_CAP` are removed.
6. ~~**Epoch display for resumed sessions.**~~ **Resolved (C — archive-time only).** Hooks always write plain `active/<sid>.jsonl`. The daemon's `moveToDone`/`moveToRoutine` checks `sessions(session_id, epoch)` at archive time and appends `-e2`, `-e3`, etc. to the filename only if a prior epoch already exists in the target bucket. Hot path stays untouched; resume cases stay visible in `ls`.
7. ~~**Query server endpoints.**~~ **Resolved (C — two GETs + one DELETE).** Ship: `GET /sessions/:sid/status`, `GET /facts/:namespace`, `DELETE /facts/:namespace/:topic`. The DELETE route is specifically coupled to Q10 (newest-wins, no history) — it's the recovery path when a bad fact overwrites a good one. `GET /sessions?status=active` and `GET /facts/:namespace/:topic` are speculative and not shipped.
8. ~~**Facts with `scope=global` — auto-promote?**~~ **Resolved (D — defer).** No cloud promotion of facts in v1. Ship the local extract → store → inject loop, observe fact quality on real sessions for 1-2 weeks, then come back with a data-informed promotion rule. The `scope=global` field is still written to `memory_entries.metadata` so the follow-up implementation knows which rows are candidates. No `/api/v1/facts/promote` endpoint is designed or implemented in this spec.
9. ~~**Fact injection metric in `session-restore`.**~~ **Resolved (A — `updated_at DESC`).** Sort facts by `updated_at DESC` (most recently extracted first), cap at 10 project-scoped + 5 global-scoped. The `access_count` column exists but stays unpopulated in v1; rank tuning via access_count or tag-overlap is a follow-up tuning step only if recency-sort underperforms in practice.
10. ~~**Facts conflict resolution.**~~ **Resolved (A for v1, B documented as follow-up).** v1 ships newest-wins via plain `UPSERT` — the UPSERT in §6.7 `upsertMemoryEntry` replaces `content`/`metadata`/`updated_at` unconditionally. No audit trail for the overwritten version. **Follow-up (tracked, not implemented here):** add a `memory_entries_history(id INTEGER PK, memory_id TEXT, content TEXT, metadata TEXT, replaced_at INTEGER)` table and emit one `INSERT` per UPSERT-that-changed-content, preserving the old version. Trigger-based or explicit write in `upsertMemoryEntry` — either works. This gives us newest-wins semantics with a cheap audit trail, without any human triage friction. Deferred because conflicts are rare in practice and the simple UPSERT ships first; the history table is an additive upgrade that doesn't change any existing behavior.
11. ~~**Managed mode parity.**~~ **Resolved (A + local-background).** Managed mode stays the primary product path. The plugin tolerates optional `facts[]` in the `/api/v1/pipeline/process` response (graceful fallback if the cloud hasn't shipped the schema yet). **Additionally**, local EXTRACT can run as a background process even in managed mode — either as a fallback when the cloud call fails or to fill feature gaps (e.g., facts extraction before the cloud endpoint rolls it out). This is an enabling capability, not a default behavior; gated by `QUOTH_MANAGED_LOCAL_BACKGROUND=true` (off by default so managed users don't pay for two extractions by accident). Cloud schema extension is still tracked separately.

### 10.3 Non-Goals

- No changes to the EXTRACT tool loop mechanics (v2 multi-turn + Kimi K2.5 + fallback stay intact). **Scope-in**: the EXTRACT output schema is extended with `facts[]` and the system prompt gains a facts section. The loop, model, fallback, and token flow are untouched beyond the cap bumps in §6.8.
- No changes to pattern storage, embeddings, or scoring.
- No new external dependencies.
- No new LLM providers or pipeline stages. Triage is done by the existing EXTRACT call via its own `session_type` output — not by a separate Gemini/Kimi/Claude call.
- No cloud-side implementation of the managed `/api/v1/pipeline/process` schema extension (tracked separately — see §10.2 Q11).

---

## 11. Files Touched

### New
- `quoth-plugin/scripts/migrate-per-session-files.js` — one-shot migration of shared JSONL files to per-session layout.
- `quoth-plugin/daemon/lib/sessions.js` — helpers for sidecar R/W, atomic moves, sessions-table access.
- `quoth-plugin/tests/session-isolation.test.js` — parallel-session contamination test.
- `quoth-plugin/tests/detect-stale-sessions.test.js` — Gap 1/2/3 coverage, plus the "no entry-count skip" assertion.
- `quoth-plugin/tests/migrate-per-session.test.js` — migration fixture test.
- `quoth-plugin/tests/extract-facts.test.js` — asserts EXTRACT parses and routes `facts[]` to `memory_entries`, covers `scope=project` vs `scope=global`, covers dedup via `UPSERT`.
- `quoth-plugin/tests/memory-entries-helpers.test.js` — unit tests for `upsertMemoryEntry` / `listFactsByNamespace`.

### Modified
- `quoth-plugin/hooks/trajectory-capture.js` — write to `active/<sid>.jsonl` + sidecar.
- `quoth-plugin/hooks/hook-dispatch.js` —
  - `session-end` reads its own file, writes summary, atomic-renames to `processing/`.
  - `session-restore` additionally injects top facts via `db.listFactsByNamespace(project, 10)` + `db.listFactsByNamespace('global', 5)`.
- `quoth-plugin/daemon/daemon.js` —
  - New `processSessionFile()` loop (§6.3). Removes `markProcessed`, `DAILY_EXTRACT_CAP`, `dailyExtractCount`, `dailyExtractDate`.
  - New `detectStaleSessions()` (§6.4) — no entry-count gate, mtime double-check, SQL-driven.
  - New helpers: `moveToEmpty`, `moveToRoutine`, `moveToDone`, `moveToError`, `synthesizeSummaryFromEntries`, `insertNewFact`.
  - `moveToDone` / `moveToRoutine` read `sessions(session_id, epoch)` and append `-e2`/`-e3` suffix to filename only when a prior epoch already exists in the target bucket (§10.2 Q6 resolution).
  - Add `daemon_meta` schema init + `last_stale_scan_ts` catch-up on startup.
  - **New retention sweep** (`runRetentionSweep()`) runs in the existing 3am nightly cron. Deletes files/directories under `done/`, `routine/`, `empty/`, `error/` older than the configured TTL (defaults 30/7/3/14 days per §10.2 Q2). Implementation: `fs.readdir` on each bucket, date-parse the top-level `YYYY-MM-DD` folder names, `rm -rf` anything older than `now - ttlDays`. O(bucket × days) — trivial because date-first layout means the top-level dir name alone is enough to decide. Env vars: `QUOTH_RETENTION_DONE_DAYS`, `QUOTH_RETENTION_ROUTINE_DAYS`, `QUOTH_RETENTION_EMPTY_DAYS`, `QUOTH_RETENTION_ERROR_DAYS`.
  - **Managed-mode local-background path** (§10.2 Q11 resolution): when `QUOTH_MODE=managed` AND `QUOTH_MANAGED_LOCAL_BACKGROUND=true`, `processSessionFile` calls `processSessionManaged` first and, after it returns, schedules a fire-and-forget `extract()` on the same frozen session. Any facts the local run produces that were not present in the managed response are merged into `memory_entries` via `upsertMemoryEntry`. Errors in the background path are logged but never bubble up — managed mode's result is authoritative for patterns and bucket routing.
- `quoth-plugin/daemon/db.js` —
  - **New table `sessions`** (§4.5) with `fact_count` column and status enum including `routine`/`empty`/`error`.
  - **New table `daemon_meta`** (`key TEXT PRIMARY KEY, value TEXT`) — this table did **not** exist; verified by grep, see §6.4 prerequisite note.
  - **New helpers** for `memory_entries`: `upsertMemoryEntry`, `listFactsByNamespace`, `deleteMemoryEntry({ namespace, key })` (for the DELETE route from §10.2 Q7). The table existed but had no helpers.
  - Migration: sessions + daemon_meta.
- `quoth-plugin/daemon/pipeline/extract.js` —
  - System prompt extended with FACT EXTRACTION RULES (§6.6).
  - Output schema extended with `facts[]`.
  - `parsePatterns()` → `parseExtractOutput()` returning `{ session_type, patterns, facts }`.
  - `maxTokens: 16384` → `32768`.
  - Cumulative cap `totalTokens >= 100_000` → `>= 200_000`.
- `quoth-plugin/daemon/lib/llm.js` — default `maxTokens` in `callMoonshotWithTools` raised from `16384` to `32768` to match the extract bump.
- `quoth-plugin/daemon/lib/query-server.js` — new routes (per §10.2 Q7 resolution):
  - `GET /sessions/:sid/status` — thin wrapper over `sessions` table.
  - `GET /facts/:namespace` — thin wrapper over `listFactsByNamespace`.
  - `DELETE /facts/:namespace/:topic` — recovery path for the newest-wins semantics in §10.2 Q10. Deletes a single fact by `(namespace, topic)` so a bad fact that overwrote a good one can be removed, letting the next extraction rewrite it cleanly.
- `quoth-plugin/daemon/lib/pipeline-api.js` (managed mode) — tolerate optional `facts[]` in the response from `/api/v1/pipeline/process`; pass them through to the local insertion path. Graceful fallback if the cloud hasn't shipped the schema yet. **Also:** expose a `runLocalBackground(summary, toolEntries)` helper that runs the local `extract()` path in a detached way and merges any facts the cloud didn't return. Gated by `QUOTH_MANAGED_LOCAL_BACKGROUND=true`; off by default.

### Deprecated
- In-line `_processed` flag on JSONL lines (removed; files move directories instead).
- `processing.lock` file (removed; processing state is directory-based).
- `MIN_EXTRACT_ENTRIES` (never existed as a constant; the literal `3` in `daemon.js:1438` and equivalent logic in `processSessionBatch` are removed with no replacement — EXTRACT decides).
- `DAILY_EXTRACT_CAP` + `dailyExtractCount` + `dailyExtractDate` (`daemon.js:69-71, 320-326`). Relevance gating is semantic via EXTRACT's own `routine` classification.

---

## 12. Execution Plan (Superpowers Workflow)

1. ~~**superpowers:brainstorming**~~ **Done (2026-04-10).** All 11 open questions in §10.2 resolved. Decisions are baked into the design sections above; see §10.2 for the resolution rationale.
2. **superpowers:writing-plans** — Convert this spec into a TDD-ordered implementation plan with discrete tasks, each <500 LoC, each with a failing test first:
   1. `daemon_meta` table + sessions table + migration (no behavior change). Prerequisite: the whole spec depends on `daemon_meta` existing. `sessions` table uses the resolved status enum (`active,processing,done,routine,empty,error`) and includes `fact_count` + `epoch` columns.
   2. `memory_entries` helpers — `upsertMemoryEntry` + `listFactsByNamespace` + `deleteMemoryEntry` + tests. No production use yet; just the helpers on the dormant table. `deleteMemoryEntry` is needed upfront for the §10.2 Q7 DELETE route.
   3. Sidecar R/W helpers + tests (JSON sidecar per §10.2 Q4).
   4. `trajectory-capture.js` rewrite + parallel-session integration test.
   5. `session-end` hook rewrite + atomic rename test.
   6. **EXTRACT schema extension** — system prompt update, `parseExtractOutput()` returning `{ session_type, patterns, facts }`, fact validation, unit tests with fixture LLM responses (patterns only, facts only, both, routine, malformed facts dropped).
   7. **Token limit bump** — `maxTokens`/cumulative cap in `extract.js` and `llm.js`, with K2.5 context reference in comments.
   8. Daemon `processSessionFile` loop — LLM-only evaluation, new moveTo* helpers, `insertNewFact`. Tests for each branch (empty/routine/done/error).
   9. **Epoch suffix at archive time** (§10.2 Q6) — `moveToDone`/`moveToRoutine` check `sessions(session_id, epoch)` and append `-e2`/`-e3` to filename only if a prior epoch already exists. Test: simulate a stale-rename + resume + session-end, assert both files land in archive with distinct names.
   10. New `detectStaleSessions` with SQL query + 3 gap tests + "no entry-count skip" assertion.
   11. `session-restore` hook extension — inject facts alongside patterns, sorted by `updated_at DESC` (§10.2 Q9), capped at 10 project + 5 global.
   12. Migration script + fixture test (new empty bucket handling per §7.1 rewrite).
   13. Managed-mode tolerance for optional `facts[]` in pipeline-api response (§10.2 Q11 baseline).
   14. **Managed-mode local-background path** (§10.2 Q11 enabler) — `processSessionFile` schedules a fire-and-forget local `extract()` after the managed call when `QUOTH_MANAGED_LOCAL_BACKGROUND=true`, merges any new facts via `upsertMemoryEntry`. Tests: env var off → no background call; env var on + cloud returns facts → local result merged without duplicating; env var on + cloud returns no facts → local facts stored; local path errors swallowed without breaking managed flow.
   15. **Retention sweep** (§10.2 Q2) — `runRetentionSweep()` in the nightly 3am cron, env-configurable TTLs (defaults 30/7/3/14). Tests: seed dated folders at known ages, run sweep, assert only the in-window ones survive.
   16. End-to-end contamination test (the big one) + end-to-end facts extraction test (seed a session that contains an observable truth, assert it lands in `memory_entries` and surfaces in the next `session-restore`).
   17. Remove `markProcessed`, `processing.lock`, `DAILY_EXTRACT_CAP`, `MIN_EXTRACT_ENTRIES`-equivalent literals, dead code.
   18. Query server routes: `GET /sessions/:sid/status`, `GET /facts/:namespace`, `DELETE /facts/:namespace/:topic` (§10.2 Q7).
   19. Docs update (CLAUDE.md pipeline description corrected to single-stage EXTRACT, plugin README notes facts extraction + new env vars: `QUOTH_MANAGED_LOCAL_BACKGROUND`, `QUOTH_RETENTION_*_DAYS`).
3. **superpowers:subagent-driven-development** — Fresh subagent per task, same two-stage review (spec compliance + code quality) as Extract Pipeline v2. `main` agent holds the spec as ground truth.
4. **Rollout** — Manual smoke test on Agustin's live daemon with `QUOTH_DEBUG=true` before merging. Verify facts appear in `session-restore` output on the following session.

---

## 13. Acceptance Criteria

### Session isolation
- [ ] Running 5 parallel Claude Code sessions on the same project produces 5 separate `active/<sid>.jsonl` files, zero cross-writes.
- [ ] Killing and restarting the daemon during active processing never loses trajectory data.
- [ ] Stale detector runs are O(index lookup), not O(file size × file count) — verifiable via daemon log durations.
- [ ] Migration script converts all existing shared files to per-session layout without data loss (verified by line-count diff).
- [ ] No references to `markProcessed`, `processing.lock`, `MIN_EXTRACT_ENTRIES`, `DAILY_EXTRACT_CAP`, `dailyExtractCount`, or `dailyExtractDate` remain in the codebase.

### LLM-only evaluation
- [ ] The daemon has exactly **one** mechanical gate before EXTRACT: `toolEntries.length > 0`. No other `if` pre-filters relevance.
- [ ] Stale-crashed sessions with 1 or 2 tool entries are sent to EXTRACT (not skipped, not moved to `empty/`).
- [ ] Sessions classified by EXTRACT as `session_type=routine` land in `routine/` and do not re-appear in `processing/`.
- [ ] A session with 0 tool entries lands in `empty/` without invoking any LLM.

### Facts extraction + storage
- [ ] `extract()` returns `{ session_type, patterns, facts }` (schema extended, parser updated).
- [ ] Facts with `scope="project"` are written to `memory_entries` with `namespace=<project_name>`, `type='fact'`.
- [ ] Facts with `scope="global"` are written to `memory_entries` with `namespace='global'`, `type='fact'`.
- [ ] Re-extraction of the same `topic` in the same namespace performs an `UPSERT` (dedup via `UNIQUE(namespace, key)`), updating `content` and `metadata` without creating a duplicate row.
- [ ] Invalid facts in the LLM response (missing required fields, length out of bounds, unknown scope) are dropped individually without rejecting the whole response.

### Facts injection into future sessions
- [ ] `session-restore` hook queries `listFactsByNamespace(project, 10)` and `listFactsByNamespace('global', 5)` and prints the results to stdout as context.
- [ ] `db.js` exposes `upsertMemoryEntry()` and `listFactsByNamespace()` helpers with unit test coverage.

### Token limits (Kimi K2.5)
- [ ] `extract.js:223` uses `maxTokens: 32768`.
- [ ] `extract.js:219` uses cumulative cap `200_000`.
- [ ] `llm.js:190` default `maxTokens` is `32768`.
- [ ] Spec for K2.5 context window (262,144) is referenced in a code comment so the next reader knows where the 200K cap comes from.

### Tests & compatibility
- [ ] All 329+ existing tests still pass.
- [ ] New test suites for session isolation, stale detection, migration, facts extraction, and memory-entries helpers are all green.
- [ ] `daemon_meta` table is created on fresh DB init and populated on first stale-scan tick.

---
