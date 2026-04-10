# Spec — Session Isolation & Per-Session Trajectory Files

**Status:** Draft
**Author:** Agustin + Claude Opus 4.6
**Captured:** 2026-04-10
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

Observed state at capture time (`~/.quoth/trajectories/`):

| File | Lines | Distinct sessions |
|---|---|---|
| `quoth-2026-04-10.jsonl` | 145 | 3 |
| `lord_montino-2026-04-10.jsonl` | 77 | 3 |

→ **Parallel sessions are already interleaving into the same file right now.**

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
        <sessionId>.jsonl   ← archived after extraction
  trivial/
    YYYY-MM-DD/
      <sessionId>.jsonl     ← sessions that never qualified for extraction
```

### 4.2 State Machine per Session

```
  [no file]
     │  hook appends first tool_use
     ▼
  active/<sid>.jsonl ─────────────────────┐
     │                                     │
     │  session-end hook                   │ stale detector (idle >30m)
     │  writes session_summary             │ renames to processing/
     │  + atomic rename                    │
     ▼                                     ▼
  processing/<sid>.jsonl  ◄────────────────┘
     │                                     │
     │  daemon runs EXTRACT                │ daemon sees <3 entries
     │  success                            │
     ▼                                     ▼
  done/YYYY-MM-DD/<project>/<sid>.jsonl   trivial/YYYY-MM-DD/<sid>.jsonl
```

All transitions are `fs.rename()` — atomic on the same filesystem.

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
  status TEXT NOT NULL CHECK (status IN ('active','processing','done','trivial','error')),
  closed_marker INTEGER NOT NULL DEFAULT 0,
  extracted_at INTEGER,
  pattern_count INTEGER,
  epoch INTEGER NOT NULL DEFAULT 1  -- for resume-after-rename case
);

CREATE INDEX idx_sessions_status_last_seen ON sessions(status, last_seen_ts);
CREATE INDEX idx_sessions_project ON sessions(project);
```

**Why the table matters beyond the sidecars:** stale detection becomes a single SQL query instead of a directory scan + file reads:

```sql
SELECT session_id FROM sessions
WHERE status = 'active'
  AND last_seen_ts < :threshold
  AND (closed_marker = 1 OR tool_count >= :min_extract);
```

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

### 6.3 `processSessionBatch()` simplification

No more "find unprocessed tool_use entries matching sessionId across a shared file". The whole file **is** the session. Read it once, run EXTRACT, rename to `done/YYYY-MM-DD/<project>/<sid>.jsonl`, update `sessions` table status → `done`, record `pattern_count`.

```js
async function processSessionFile(sessionFile) {
  const filePath = path.join(PROCESSING_DIR, sessionFile)
  const meta = readSidecar(PROCESSING_DIR, sessionFile.replace('.jsonl', ''))
  const entries = readAllEntries(filePath)   // tool_use + session_summary
  const summary = entries.find(e => e.event === 'session_summary')
  const toolEntries = entries.filter(e => e.event === 'tool_use')

  if (toolEntries.length < MIN_EXTRACT_ENTRIES) {
    return moveToTrivial(filePath, meta)
  }

  const patterns = QUOTH_MODE === 'managed'
    ? await processSessionManaged(summary, toolEntries, meta.project)
    : await processSessionLocal(summary, toolEntries)

  for (const p of patterns) insertNewPattern(p, summary, meta.project)

  moveToDone(filePath, meta, patterns.length)
}
```

### 6.4 Stale Session Detector — New Implementation

```js
function detectStaleSessions() {
  const threshold = Date.now() - STALE_THRESHOLD_MS
  const stale = db.listSessions({ status: 'active', maxLastSeen: threshold })
  for (const s of stale) {
    try {
      if (s.tool_count < MIN_EXTRACT_ENTRIES) {
        // Gap 1 fix: trivial cleanup
        moveActiveFile(s.session_id, 'trivial')
        db.updateSessionStatus(s.session_id, 'trivial')
        continue
      }
      // Double-check mtime to catch late-arriving activity
      const stat = fs.statSync(activePath(s.session_id))
      if (stat.mtimeMs > threshold) continue  // resurrected
      // Synthesize summary, append, rename
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

**Gap 2 fix (last-scan persistence):** store `last_stale_scan_ts` in `daemon_meta` table. On startup, if `now - last > 10min`, run immediately.

**Gap 3 fix (race):** mtime double-check right before rename. Plus: rename is atomic, and the inode continues to receive any in-flight writes — so even if we lose the race window, data is preserved (goes into `processing/<sid>.jsonl`).

### 6.5 Concurrency Model

- **Capture workers (hooks)**: one per session, each writes only to its own `active/<sid>.jsonl`. Zero contention.
- **Stale detector**: one timer, queries SQLite, performs renames. Doesn't touch JSONL contents.
- **Processing workers**: up to N (configurable, default 5) in parallel. Each claims a `processing/<sid>.jsonl` and never touches another worker's file. Lock = "this file exists in processing/".
- **Nightly pipeline / decay timers**: unchanged, still operate on SQLite.

**No shared writable resource across these four workers.** The processing lock file (`processing.lock`) can be removed.

---

## 7. Migration Plan

### 7.1 One-time Migration Script

`scripts/migrate-per-session-files.js`:

1. Iterate every `trajectories/*.jsonl` that is NOT in `active/`, `processing/`, `done/`, `trivial/`.
2. For each file, group entries by `session`.
3. For each session:
   - If session has a `session_summary` → write to `processing/<sid>.jsonl`, sidecar, insert into `sessions` table as `processing`.
   - If session has ≥3 tool_use and no summary → write to `processing/<sid>.jsonl` with a synthesized summary (same logic as stale detector), sidecar, insert as `processing`.
   - If session has <3 tool_use → write to `trivial/YYYY-MM-DD/<sid>.jsonl`, insert as `trivial`.
4. After a successful migration, rename the original shared file to `trajectories/legacy-backup/<original-name>.jsonl` for safekeeping.
5. Migration is idempotent: re-running skips files already under `legacy-backup/`.

### 7.2 Rollback

The migration only moves files; it doesn't delete them. Rollback = `mv legacy-backup/* ./` and drop the `sessions` table.

### 7.3 Version Guard

Add `schema_version` row in `daemon_meta`. Set to `2` after migration. Daemon refuses to start if it finds shared files outside `legacy-backup/` after version 2.

---

## 8. Test Plan (TDD)

### 8.1 Unit Tests — Hooks

- `trajectory-capture.test.js`: appending to `active/<sid>.jsonl` creates the file, creates the sidecar, updates `tool_count`.
- Parallel sessions: simulate 3 concurrent `trajectory-capture` invocations with different `sessionId`. Assert 3 distinct files, no cross-contamination.

### 8.2 Unit Tests — Daemon

- `processSessionFile.test.js`: happy path, <3 entries → trivial, managed mode, local mode, extract failure → error status.
- `detectStaleSessions.test.js`:
  - Gap 1: session with <3 entries idle >30min → moved to `trivial/`.
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

- Fixture: real shared file from `~/.quoth/trajectories/` (anonymized) with 3 interleaved sessions and 1 trivial session.
- Run migration.
- Assert: 3 files in `processing/`, 1 file in `trivial/`, `sessions` table matches.
- Re-run migration → no-op.

---

## 9. Mapping: Gaps → Resolution

| Gap (from memory) | Fix |
|---|---|
| Gap 1 — Trivial session leak | `trivial/` bucket + `sessions.status='trivial'`; stale detector moves trivial files and logs a single summary row instead of repeating them forever |
| Gap 2 — No last-scan persistence | `daemon_meta.last_stale_scan_ts` + startup catch-up |
| Gap 3 — Stale-vs-live race | Mtime double-check + atomic rename + POSIX fd/inode guarantees |
| Opt 1 — Incremental scan | Replaced entirely: SQL index lookup on `sessions`, no directory scans |
| Opt 2 — Archive old JSONLs | `done/YYYY-MM-DD/<project>/` layout is already the archive |
| Opt 3 — Sidecar state | Inherent to the new design |
| Opt 4 — `sessions` table | Included |

---

## 10. Risks & Open Questions

### 10.1 Risks

1. **Migration breakage.** If migration misattributes sessions, we could lose historical trajectories. Mitigation: `legacy-backup/` directory, dry-run mode, explicit `--confirm` flag.
2. **Inotify load on `active/` at scale.** We don't watch `active/` anymore — only `processing/`. But `fs.readdir` on `active/` for status queries could be slow with thousands of files. Mitigation: rely on `sessions` table, never scan `active/` directly.
3. **Sidecar drift.** If a hook crashes mid-write, sidecar and JSONL can diverge. Mitigation: daemon rebuilds sidecar from JSONL on ingest; sidecar is advisory, not authoritative.
4. **Resume epochs.** If a session is wrongly judged stale, the next hook creates a new file with the same `sessionId`. SQL `UNIQUE(session_id)` would break. Mitigation: `epoch` column, composite key `(session_id, epoch)` or internal PK + `(session_id, epoch)` unique index.
5. **Session-end hook failure.** If session-end crashes before rename, the file stays in `active/` and waits for the stale detector. Acceptable — 30-min latency instead of immediate, but no data loss.

### 10.2 Open Questions (for brainstorming)

1. **Do we keep the per-project/date archive structure in `done/`?** Or flatten by `done/<project>/<sid>.jsonl`? Date hierarchy helps with GC; flat helps with lookups. Probably date.
2. **Retention policy.** How long do we keep `done/` files? `trivial/` files? Proposal: `done/` = 90 days, `trivial/` = 7 days. Configurable via env.
3. **Do we compress `done/` files?** gzip on rename would shrink disk use 5-10×. Small daemon cost. Proposal: yes, `<sid>.jsonl.gz`.
4. **Sidecar format: JSON vs SQLite direct?** JSON keeps hooks SQLite-free (current invariant). SQLite would be stronger but adds a hook dependency. Proposal: keep JSON sidecar.
5. **Minimum extract threshold.** Current `MIN_EXTRACT_ENTRIES = 3`. Still the right number? Proposal: keep 3, make configurable.
6. **Should we split by epoch visually?** E.g. `active/<sid>-e2.jsonl` if a session resumes. Or silently merge on the sessions table? Proposal: silently increment `epoch`, use filename `<sid>.jsonl` and rely on `sessions(session_id, epoch)` for uniqueness.
7. **Query server impact.** Does the query server need new endpoints (e.g. `GET /sessions/:sid/status`)? Proposal: yes, one new endpoint, thin wrapper over `sessions` table.

### 10.3 Non-Goals

- No changes to the EXTRACT pipeline itself (v2 stays intact).
- No changes to pattern storage, embeddings, or scoring.
- No changes to managed-mode API contract.
- No new external dependencies.

---

## 11. Files Touched

### New
- `quoth-plugin/scripts/migrate-per-session-files.js`
- `quoth-plugin/daemon/lib/sessions.js` — helpers for sidecar R/W, atomic moves, sessions-table access
- `quoth-plugin/tests/session-isolation.test.js`
- `quoth-plugin/tests/detect-stale-sessions.test.js`
- `quoth-plugin/tests/migrate-per-session.test.js`

### Modified
- `quoth-plugin/hooks/trajectory-capture.js` — write to `active/<sid>.jsonl` + sidecar
- `quoth-plugin/hooks/hook-dispatch.js` — session-end reads own file, rename to processing
- `quoth-plugin/daemon/daemon.js` — new processing loop, new detectStaleSessions, remove markProcessed
- `quoth-plugin/daemon/db.js` — new `sessions` table + migration + helpers
- `quoth-plugin/daemon/lib/query-server.js` — new `/sessions/:sid/status` route (optional)

### Deprecated
- In-line `_processed` flag on JSONL lines (removed; files move directories instead)
- `processing.lock` file (removed; processing state is directory-based)

---

## 12. Execution Plan (Superpowers Workflow)

1. **superpowers:brainstorming** — Resolve the 7 open questions in §10.2 with Agustin.
2. **superpowers:writing-plans** — Convert this spec into a TDD-ordered implementation plan with discrete tasks, each <500 LoC, each with a failing test first:
   1. `sessions` table migration + helpers (no behavior change)
   2. Sidecar R/W helpers + tests
   3. `trajectory-capture.js` rewrite + parallel-session integration test
   4. `session-end` hook rewrite + atomic rename test
   5. Daemon `processSessionFile` loop + test
   6. New `detectStaleSessions` with SQL query + 3 gap tests
   7. Migration script + fixture test
   8. End-to-end contamination test (the big one)
   9. Remove `markProcessed`, `processing.lock`, dead code
   10. Docs update (CLAUDE.md, plugin README)
3. **superpowers:subagent-driven-development** — Fresh subagent per task, same two-stage review (spec compliance + code quality) as Extract Pipeline v2. `main` agent holds the spec as ground truth.
4. **Rollout** — Manual smoke test on Agustin's live daemon with `QUOTH_DEBUG=true` before merging.

---

## 13. Acceptance Criteria

- [ ] Running 5 parallel Claude Code sessions on the same project produces 5 separate `active/<sid>.jsonl` files, zero cross-writes.
- [ ] Killing and restarting the daemon during active processing never loses trajectory data.
- [ ] Trivial sessions (<3 entries) idle >30min are moved to `trivial/` and do not re-appear in any scan.
- [ ] Stale detector runs are O(index lookup), not O(file size × file count) — verifiable via daemon log durations.
- [ ] Migration script converts all existing shared files to per-session layout without data loss (verified by line-count diff).
- [ ] All 329+ existing tests still pass; new tests for isolation, stale detection, migration all green.
- [ ] No references to `markProcessed` or `processing.lock` remain in the codebase.

---
