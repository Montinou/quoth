# Session Isolation & Per-Session Trajectory Files — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-10-session-isolation.md`

**Goal:** Replace the shared `<project>-<date>.jsonl` trajectory file with a per-session append-only file model so parallel sessions never contaminate each other, and extend the EXTRACT pipeline to also produce facts that land in `memory_entries` and surface in future `session-restore` hooks.

**Architecture:** Hooks only ever append to `trajectories/active/<sid>.jsonl` + maintain a JSON sidecar. The daemon moves sessions between buckets (`active → processing → {done, routine, empty, error}`) via atomic `fs.rename()`. A new `sessions` SQLite table indexes session state so stale detection is an O(index) SQL query. A new `daemon_meta(key, value)` table persists the last scan timestamp. The dormant `memory_entries` table gains `upsertMemoryEntry` / `listFactsByNamespace` / `deleteMemoryEntry` helpers, and EXTRACT's output schema is extended with a `facts[]` array. A one-shot migration script moves legacy shared files into the new layout. A retention sweep runs in the nightly 3am cron.

**Tech Stack:**
- Node.js + `better-sqlite3` (existing plugin tech stack)
- Vitest (existing test framework — `npm test` in `quoth-plugin/`)
- Kimi K2.5 via Moonshot API (existing EXTRACT v2 pipeline — token caps bumped)
- POSIX `fs.rename()` atomicity + `fs.watch()` (existing)
- No new dependencies

**Hard rules for executing this plan:**

1. **Read the spec first.** `docs/superpowers/specs/2026-04-10-session-isolation.md` is the source of truth. If a step in this plan seems to contradict the spec, the spec wins — stop and surface the mismatch.
2. **Work on one task at a time, strictly in order.** Tasks have implicit dependencies (Task 2 needs Task 1's tables, Task 8 needs Tasks 3/6/7, etc.). Do not start Task N+1 until Task N is fully committed and green.
3. **TDD is non-negotiable.** Every behavior change starts with a failing test. Run the test, see it fail, then implement. Run the test again, see it pass, then commit. No exceptions.
4. **Commit frequently.** Each task ends with one commit. Use the exact commit message given in the step. If a hook rejects the commit, fix the issue and create a NEW commit (never amend).
5. **No scope creep.** If a step tells you to add a helper, add only that helper. Do not refactor, rename, or "improve" adjacent code. Dead-code removal is explicitly Task 17 and has its own commit.
6. **Exact paths.** Every file path in this plan is absolute from the repo root. Follow them literally — no guessing based on what "feels right."
7. **Test command.** Unless otherwise specified, run tests from the plugin directory: `cd quoth-plugin && npm test -- <test-file>` (vitest forwards the argument as a filename filter). Full run: `cd quoth-plugin && npm test`.
8. **DO NOT touch `MEMORY.md`, `CLAUDE.md`, or `docs/presentations/`.** Those are out of scope except where Task 19 explicitly says to.
9. **DO NOT delete the legacy shared-file code until Task 17.** Earlier tasks add the new paths alongside the old ones so intermediate commits are always runnable.
10. **Assume you have no memory of prior conversations.** This plan is self-contained. Every decision is either inlined here or referenced by spec section (e.g. "§10.2 Q6").

---

## Relevant skills

- `superpowers:subagent-driven-development` — fresh subagent per task, two-stage review
- `superpowers:executing-plans` — inline execution with checkpoints
- `superpowers:writing-tests` — test-writing patterns used throughout this plan

---

## File Structure

### New files (created by this plan)

| Path | Task | Purpose |
|---|---|---|
| `quoth-plugin/daemon/lib/sessions.js` | 3, 8, 9 | Sidecar R/W helpers, atomic moves, sessions-table access, synthesize summary, epoch resolution |
| `quoth-plugin/scripts/migrate-per-session-files.js` | 12 | One-shot migration of legacy shared JSONL files into the new layout |
| `quoth-plugin/tests/session-isolation.test.js` | 4, 16 | Parallel-session contamination test + e2e flow |
| `quoth-plugin/tests/detect-stale-sessions.test.js` | 10 | Gap 1/2/3 coverage, "no entry-count skip" assertion |
| `quoth-plugin/tests/memory-entries-helpers.test.js` | 2 | Unit tests for `upsertMemoryEntry`, `listFactsByNamespace`, `deleteMemoryEntry` |
| `quoth-plugin/tests/sessions-helpers.test.js` | 1, 3, 9 | Unit tests for the `sessions` table helpers, sidecar helpers, epoch resolution |
| `quoth-plugin/tests/extract-facts.test.js` | 6 | EXTRACT parses/routes `facts[]` per-scope; dedup via UPSERT |
| `quoth-plugin/tests/process-session-file.test.js` | 8, 13, 14 | `processSessionFile` branches (empty/routine/done/error), managed-mode tolerance, local-background path |
| `quoth-plugin/tests/migrate-per-session.test.js` | 12 | Migration fixture test (incl. zero-tool_use session) |
| `quoth-plugin/tests/session-restore-facts.test.js` | 11 | `session-restore` hook injects facts into stdout |
| `quoth-plugin/tests/retention-sweep.test.js` | 15 | Retention sweep deletes only out-of-window dated folders |
| `quoth-plugin/tests/query-server-routes.test.js` | 18 | `GET /sessions/:sid/status`, `GET /facts/:ns`, `DELETE /facts/:ns/:topic` |

### Modified files

| Path | Tasks | Why |
|---|---|---|
| `quoth-plugin/daemon/db.js` | 1, 2 | New `sessions` + `daemon_meta` tables; `memory_entries` helpers (`upsertMemoryEntry`, `listFactsByNamespace`, `deleteMemoryEntry`); session CRUD helpers (`upsertSession`, `updateSessionStatus`, `listSessions`, `getSession`, `countSessionEpochs`, `setDaemonMeta`, `getDaemonMeta`) |
| `quoth-plugin/hooks/trajectory-capture.js` | 4 | Write to `active/<sid>.jsonl` + maintain sidecar via atomic rename |
| `quoth-plugin/hooks/hook-dispatch.js` | 5, 11 | `session-end`: read own file, append summary, atomic-rename to `processing/`. `session-restore`: inject top facts alongside patterns |
| `quoth-plugin/daemon/pipeline/extract.js` | 6, 7 | `parseExtractOutput()` returning `{session_type, patterns, facts}`; system prompt fact section; `maxTokens: 32768`; cumulative cap `200_000` |
| `quoth-plugin/daemon/lib/llm.js` | 7 | Default `maxTokens` in `callMoonshotWithTools` from `16384` → `32768` |
| `quoth-plugin/daemon/daemon.js` | 1, 8, 9, 10, 13, 14, 15, 17 | `processSessionFile`; `detectStaleSessions` rewrite; epoch suffix at archive time; managed-mode facts tolerance + local-background path; retention sweep in nightly cron; dead-code removal |
| `quoth-plugin/daemon/lib/pipeline-api.js` | 13, 14 | Tolerate optional `facts[]`; expose `runLocalBackground` helper (gated) |
| `quoth-plugin/daemon/lib/query-server.js` | 18 | New routes: `GET /sessions/:sid/status`, `GET /facts/:namespace`, `DELETE /facts/:namespace/:topic` |
| `quoth-plugin/CLAUDE.md` + `quoth-plugin/README.md` | 19 | Document new env vars, facts extraction, new directory layout |

### Deprecated (removed in Task 17)
- `markProcessed()` in `daemon.js:467-473`
- `processing.lock` file handling (`daemon.js:48`, `daemon.js:110-115`, `daemon.js:198-207`)
- `DAILY_EXTRACT_CAP`, `dailyExtractCount`, `dailyExtractDate` (`daemon.js:69-71`, `daemon.js:319-326`)
- `entries.length < 3` gate in `detectStaleSessions` (`daemon.js:1438`)
- `setPatternNamespace` stays — it's unrelated

---

## Task Index

| # | Task | Commit prefix |
|---|---|---|
| 1 | `daemon_meta` + `sessions` tables and helpers | `feat(db):` |
| 2 | `memory_entries` helpers | `feat(db):` |
| 3 | Sidecar + atomic-move helpers in `sessions.js` | `feat(daemon):` |
| 4 | `trajectory-capture.js` rewrite to per-session file | `feat(hooks):` |
| 5 | `session-end` hook rewrite with atomic rename | `feat(hooks):` |
| 6 | EXTRACT schema extension (facts) | `feat(extract):` |
| 7 | Kimi K2.5 token limit bump | `feat(extract):` |
| 8 | `processSessionFile` loop + moveTo helpers | `feat(daemon):` |
| 9 | Epoch suffix at archive time | `feat(daemon):` |
| 10 | `detectStaleSessions` rewrite | `feat(daemon):` |
| 11 | `session-restore` hook injects facts | `feat(hooks):` |
| 12 | Migration script + fixture test | `feat(scripts):` |
| 13 | Managed-mode facts tolerance (baseline) | `feat(daemon):` |
| 14 | Managed-mode local-background path | `feat(daemon):` |
| 15 | Retention sweep in nightly cron | `feat(daemon):` |
| 16 | End-to-end contamination + facts tests | `test(integration):` |
| 17 | Remove `markProcessed`, lock, daily cap, etc. | `refactor(daemon):` |
| 18 | Query server routes | `feat(daemon):` |
| 19 | Docs update | `docs:` |

---

## Task 1: `daemon_meta` + `sessions` tables and helpers

**Goal:** Create the SQLite tables + helpers that every downstream task depends on. No behavior change anywhere else — just schema and CRUD.

**Files:**
- Modify: `quoth-plugin/daemon/db.js` (add SCHEMA entries + helpers near the existing `upsertPattern`/`insertPipelineError` style)
- Create: `quoth-plugin/tests/sessions-helpers.test.js`

**Why this is first:** Spec §6.4 prerequisite note — `daemon_meta` does not exist; verified by grep. The stale detector (Task 10), processSessionFile (Task 8), and epoch suffix (Task 9) all depend on these tables existing. Shipping tables first lets every downstream test build on a real DB.

**Spec references:** §4.5 sessions schema, §6.4 prerequisite note.

---

### Step 1.1 — Write a failing test for the `sessions` table and `upsertSession`

Create `quoth-plugin/tests/sessions-helpers.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
const { createDb } = require('../daemon/db.js')

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-sessions-test-'))
  const dbPath = path.join(dir, 'memory.db')
  const db = createDb(dbPath)
  db.initHnsw()
  return { db, dir }
}

describe('sessions table schema', () => {
  it('creates the sessions table with the expected columns', () => {
    const { db } = tmpDb()
    const cols = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining([
      'session_id', 'project', 'first_seen_ts', 'last_seen_ts',
      'tool_count', 'status', 'closed_marker', 'extracted_at',
      'pattern_count', 'fact_count', 'epoch',
    ]))
  })

  it('enforces status CHECK: active,processing,done,routine,empty,error', () => {
    const { db } = tmpDb()
    db.prepare(`
      INSERT INTO sessions (session_id, project, first_seen_ts, last_seen_ts, status)
      VALUES ('s1', 'quoth', 1, 2, 'active')
    `).run()
    expect(() => db.prepare(`
      INSERT INTO sessions (session_id, project, first_seen_ts, last_seen_ts, status)
      VALUES ('s2', 'quoth', 1, 2, 'trivial')
    `).run()).toThrow(/CHECK/)
  })
})

describe('sessions CRUD helpers', () => {
  it('upsertSession inserts then updates', () => {
    const { db } = tmpDb()
    db.upsertSession({
      session_id: 'sess-a', project: 'quoth',
      first_seen_ts: 1000, last_seen_ts: 1000, tool_count: 0,
      status: 'active', closed_marker: 0,
    })
    db.upsertSession({
      session_id: 'sess-a', project: 'quoth',
      first_seen_ts: 1000, last_seen_ts: 2000, tool_count: 5,
      status: 'active', closed_marker: 0,
    })
    const row = db.getSession('sess-a')
    expect(row.last_seen_ts).toBe(2000)
    expect(row.tool_count).toBe(5)
  })

  it('updateSessionStatus changes status and extracted_at on terminal states', () => {
    const { db } = tmpDb()
    db.upsertSession({
      session_id: 's', project: 'p', first_seen_ts: 1, last_seen_ts: 1,
      tool_count: 0, status: 'active', closed_marker: 0,
    })
    db.updateSessionStatus('s', 'processing')
    expect(db.getSession('s').status).toBe('processing')
    db.updateSessionStatus('s', 'done', { pattern_count: 2, fact_count: 1 })
    const row = db.getSession('s')
    expect(row.status).toBe('done')
    expect(row.pattern_count).toBe(2)
    expect(row.fact_count).toBe(1)
    expect(row.extracted_at).toBeGreaterThan(0)
  })

  it('listSessions filters by status and maxLastSeen', () => {
    const { db } = tmpDb()
    db.upsertSession({ session_id: 'a', project: 'p', first_seen_ts: 1, last_seen_ts: 100, tool_count: 1, status: 'active', closed_marker: 0 })
    db.upsertSession({ session_id: 'b', project: 'p', first_seen_ts: 1, last_seen_ts: 500, tool_count: 1, status: 'active', closed_marker: 0 })
    db.upsertSession({ session_id: 'c', project: 'p', first_seen_ts: 1, last_seen_ts: 100, tool_count: 1, status: 'done', closed_marker: 0 })
    const stale = db.listSessions({ status: 'active', maxLastSeen: 200 })
    expect(stale.map(r => r.session_id)).toEqual(['a'])
  })

  it('countSessionEpochs returns number of existing epochs for (session_id, bucket)', () => {
    const { db } = tmpDb()
    db.upsertSession({ session_id: 'sid', project: 'p', first_seen_ts: 1, last_seen_ts: 1, tool_count: 1, status: 'done', closed_marker: 1, epoch: 1 })
    db.upsertSession({ session_id: 'sid', project: 'p', first_seen_ts: 2, last_seen_ts: 2, tool_count: 1, status: 'done', closed_marker: 1, epoch: 2 })
    expect(db.countSessionEpochs('sid', 'done')).toBe(2)
    expect(db.countSessionEpochs('sid', 'routine')).toBe(0)
  })
})

describe('daemon_meta helpers', () => {
  it('setDaemonMeta + getDaemonMeta round-trip', () => {
    const { db } = tmpDb()
    db.setDaemonMeta('last_stale_scan_ts', '1234')
    expect(db.getDaemonMeta('last_stale_scan_ts')).toBe('1234')
    expect(db.getDaemonMeta('missing')).toBeNull()
  })
})
```

- [ ] **Step 1.2 — Run the test and watch it fail**

```bash
cd quoth-plugin && npm test -- sessions-helpers.test.js
```

Expected: all tests fail with "no such table: sessions" or "db.upsertSession is not a function".

- [ ] **Step 1.3 — Add the `sessions` + `daemon_meta` CREATE TABLE statements**

In `quoth-plugin/daemon/db.js`, find the existing `SCHEMA` constant (starts at line 9). Inside the template string, after the `memory_entries` CREATE TABLE (around line 74) and before the `agent_registry` CREATE TABLE (line 76), append:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT NOT NULL,
  project TEXT NOT NULL,
  first_seen_ts INTEGER NOT NULL,
  last_seen_ts INTEGER NOT NULL,
  tool_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('active','processing','done','routine','empty','error')),
  closed_marker INTEGER NOT NULL DEFAULT 0,
  extracted_at INTEGER,
  pattern_count INTEGER,
  fact_count INTEGER,
  epoch INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id, epoch)
);

CREATE INDEX IF NOT EXISTS idx_sessions_status_last_seen ON sessions(status, last_seen_ts);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);

CREATE TABLE IF NOT EXISTS daemon_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

**Note on PK:** spec §4.5 shows `session_id TEXT PRIMARY KEY` but §10.1 Risk 4 requires `(session_id, epoch)` for the resume case. The compound PK is the correct implementation — spec §10.1 takes precedence.

- [ ] **Step 1.4 — Run the schema test to verify the table exists**

```bash
cd quoth-plugin && npm test -- sessions-helpers.test.js -t "creates the sessions table"
```

Expected: PASS. (The CHECK test will also pass once the table is created.)

- [ ] **Step 1.5 — Add the CRUD helpers inside `createDb()`**

In `quoth-plugin/daemon/db.js`, find the existing `db.insertPipelineError` helper (around line 994). Immediately after it (before `db.getCostSummary` at line 1010), add:

```javascript
// --- sessions table helpers (per-session isolation — spec §4.5) ---

db.upsertSession = function(s) {
  db.prepare(`
    INSERT INTO sessions (
      session_id, project, first_seen_ts, last_seen_ts, tool_count,
      status, closed_marker, epoch
    )
    VALUES (@session_id, @project, @first_seen_ts, @last_seen_ts, @tool_count,
            @status, @closed_marker, @epoch)
    ON CONFLICT(session_id, epoch) DO UPDATE SET
      project = excluded.project,
      last_seen_ts = excluded.last_seen_ts,
      tool_count = excluded.tool_count,
      status = excluded.status,
      closed_marker = excluded.closed_marker
  `).run({
    session_id: s.session_id,
    project: s.project,
    first_seen_ts: s.first_seen_ts,
    last_seen_ts: s.last_seen_ts,
    tool_count: s.tool_count || 0,
    status: s.status,
    closed_marker: s.closed_marker ? 1 : 0,
    epoch: s.epoch || 1,
  })
}

db.getSession = function(session_id, epoch) {
  if (epoch != null) {
    return db.prepare('SELECT * FROM sessions WHERE session_id = ? AND epoch = ?').get(session_id, epoch) || null
  }
  // Default: return the latest epoch
  return db.prepare('SELECT * FROM sessions WHERE session_id = ? ORDER BY epoch DESC LIMIT 1').get(session_id) || null
}

db.updateSessionStatus = function(session_id, status, extras = {}) {
  const now = Date.now()
  const terminal = ['done', 'routine', 'empty', 'error'].includes(status)
  db.prepare(`
    UPDATE sessions
    SET status = @status,
        extracted_at = CASE WHEN @terminal THEN @now ELSE extracted_at END,
        pattern_count = COALESCE(@pattern_count, pattern_count),
        fact_count = COALESCE(@fact_count, fact_count)
    WHERE session_id = @session_id
      AND epoch = COALESCE(@epoch, (SELECT MAX(epoch) FROM sessions WHERE session_id = @session_id))
  `).run({
    session_id, status,
    terminal: terminal ? 1 : 0,
    now,
    pattern_count: extras.pattern_count ?? null,
    fact_count: extras.fact_count ?? null,
    epoch: extras.epoch ?? null,
  })
}

db.listSessions = function(filters = {}) {
  let query = 'SELECT * FROM sessions WHERE 1=1'
  const params = []
  if (filters.status) { query += ' AND status = ?'; params.push(filters.status) }
  if (filters.maxLastSeen != null) { query += ' AND last_seen_ts < ?'; params.push(filters.maxLastSeen) }
  if (filters.project) { query += ' AND project = ?'; params.push(filters.project) }
  query += ' ORDER BY last_seen_ts ASC'
  if (filters.limit) { query += ' LIMIT ?'; params.push(filters.limit) }
  return db.prepare(query).all(...params)
}

db.countSessionEpochs = function(session_id, bucket) {
  const row = db.prepare(
    'SELECT COUNT(*) AS c FROM sessions WHERE session_id = ? AND status = ?'
  ).get(session_id, bucket)
  return row ? row.c : 0
}

// --- daemon_meta key/value store (spec §6.4 prerequisite) ---

db.setDaemonMeta = function(key, value) {
  db.prepare(`
    INSERT INTO daemon_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value))
}

db.getDaemonMeta = function(key) {
  const row = db.prepare('SELECT value FROM daemon_meta WHERE key = ?').get(key)
  return row ? row.value : null
}
```

- [ ] **Step 1.6 — Run the full sessions-helpers test file and verify green**

```bash
cd quoth-plugin && npm test -- sessions-helpers.test.js
```

Expected: all tests pass.

- [ ] **Step 1.7 — Run the full plugin test suite to prove nothing regressed**

```bash
cd quoth-plugin && npm test
```

Expected: green (prior count + the new tests from this task).

- [ ] **Step 1.8 — Commit**

```bash
git add quoth-plugin/daemon/db.js quoth-plugin/tests/sessions-helpers.test.js
git commit -m "$(cat <<'EOF'
feat(db): add sessions + daemon_meta tables with CRUD helpers

Adds the sessions table (session_id, epoch composite PK), daemon_meta
key/value store, and CRUD helpers needed by the per-session isolation
work. No behavior change yet — helpers are wired in later tasks.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §4.5, §6.4.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `memory_entries` helpers

**Goal:** Add the CRUD helpers for the dormant `memory_entries` table. This is where EXTRACT-produced facts (Task 6) and `session-restore` (Task 11) will read/write.

**Files:**
- Modify: `quoth-plugin/daemon/db.js`
- Create: `quoth-plugin/tests/memory-entries-helpers.test.js`

**Why this is second:** Task 6 needs these helpers to route facts to SQLite. Task 18's DELETE route needs `deleteMemoryEntry`. Shipping helpers on the dormant table before any caller exists is the safest ordering.

**Spec references:** §6.7 `insertNewFact()` + helpers, §10.2 Q7 (DELETE route), §10.2 Q10 (newest-wins UPSERT).

---

### Step 2.1 — Write the failing test

Create `quoth-plugin/tests/memory-entries-helpers.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
const { createDb } = require('../daemon/db.js')

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-memory-test-'))
  const dbPath = path.join(dir, 'memory.db')
  const db = createDb(dbPath)
  db.initHnsw()
  return { db, dir }
}

describe('upsertMemoryEntry', () => {
  it('inserts a new fact row', () => {
    const { db } = tmpDb()
    db.upsertMemoryEntry({
      namespace: 'quoth',
      key: 'moonshot_reasoning_input_rejected',
      content: 'Moonshot API rejects reasoning_content when passed in assistant input messages.',
      type: 'fact',
      tags: ['moonshot', 'api'],
      metadata: { evidence: '400 response from Kimi K2.5 tool loop', scope: 'global' },
    })
    const rows = db.prepare('SELECT * FROM memory_entries WHERE namespace = ? AND key = ?').all('quoth', 'moonshot_reasoning_input_rejected')
    expect(rows.length).toBe(1)
    expect(rows[0].content).toMatch(/reasoning_content/)
    expect(rows[0].type).toBe('fact')
    expect(JSON.parse(rows[0].tags)).toEqual(['moonshot', 'api'])
    expect(JSON.parse(rows[0].metadata).scope).toBe('global')
  })

  it('UPSERT updates existing row on (namespace, key) conflict', async () => {
    const { db } = tmpDb()
    db.upsertMemoryEntry({
      namespace: 'quoth', key: 'foo', content: 'old version',
      type: 'fact', tags: [], metadata: { v: 1 },
    })
    // tiny sleep to ensure updated_at differs
    await new Promise(r => setTimeout(r, 5))
    db.upsertMemoryEntry({
      namespace: 'quoth', key: 'foo', content: 'new version',
      type: 'fact', tags: ['new'], metadata: { v: 2 },
    })
    const rows = db.prepare('SELECT * FROM memory_entries WHERE namespace = ? AND key = ?').all('quoth', 'foo')
    expect(rows.length).toBe(1)
    expect(rows[0].content).toBe('new version')
    expect(JSON.parse(rows[0].metadata).v).toBe(2)
    expect(rows[0].updated_at).toBeGreaterThanOrEqual(rows[0].created_at)
  })

  it('same key across namespaces is permitted', () => {
    const { db } = tmpDb()
    db.upsertMemoryEntry({ namespace: 'project-a', key: 'foo', content: 'A', type: 'fact', tags: [], metadata: {} })
    db.upsertMemoryEntry({ namespace: 'project-b', key: 'foo', content: 'B', type: 'fact', tags: [], metadata: {} })
    const all = db.prepare("SELECT * FROM memory_entries WHERE key = 'foo'").all()
    expect(all.length).toBe(2)
  })
})

describe('listFactsByNamespace', () => {
  it('returns facts sorted by updated_at DESC', async () => {
    const { db } = tmpDb()
    db.upsertMemoryEntry({ namespace: 'quoth', key: 'a', content: 'first', type: 'fact', tags: [], metadata: {} })
    await new Promise(r => setTimeout(r, 5))
    db.upsertMemoryEntry({ namespace: 'quoth', key: 'b', content: 'second', type: 'fact', tags: [], metadata: {} })
    const rows = db.listFactsByNamespace('quoth', 10)
    expect(rows.map(r => r.key)).toEqual(['b', 'a'])
  })

  it('only returns active, type=fact rows', () => {
    const { db } = tmpDb()
    db.upsertMemoryEntry({ namespace: 'quoth', key: 'a', content: 'x', type: 'semantic', tags: [], metadata: {} })
    db.upsertMemoryEntry({ namespace: 'quoth', key: 'b', content: 'y', type: 'fact', tags: [], metadata: {} })
    expect(db.listFactsByNamespace('quoth', 10).map(r => r.key)).toEqual(['b'])
  })

  it('respects the limit parameter', () => {
    const { db } = tmpDb()
    for (let i = 0; i < 15; i++) {
      db.upsertMemoryEntry({ namespace: 'quoth', key: `f${i}`, content: 'x', type: 'fact', tags: [], metadata: {} })
    }
    expect(db.listFactsByNamespace('quoth', 5).length).toBe(5)
  })
})

describe('deleteMemoryEntry', () => {
  it('deletes by (namespace, key)', () => {
    const { db } = tmpDb()
    db.upsertMemoryEntry({ namespace: 'quoth', key: 'zap', content: 'x', type: 'fact', tags: [], metadata: {} })
    const n = db.deleteMemoryEntry({ namespace: 'quoth', key: 'zap' })
    expect(n).toBe(1)
    expect(db.listFactsByNamespace('quoth', 10).length).toBe(0)
  })

  it('returns 0 if the entry does not exist', () => {
    const { db } = tmpDb()
    expect(db.deleteMemoryEntry({ namespace: 'missing', key: 'missing' })).toBe(0)
  })

  it('leaves other namespaces untouched', () => {
    const { db } = tmpDb()
    db.upsertMemoryEntry({ namespace: 'a', key: 'f', content: 'x', type: 'fact', tags: [], metadata: {} })
    db.upsertMemoryEntry({ namespace: 'b', key: 'f', content: 'x', type: 'fact', tags: [], metadata: {} })
    db.deleteMemoryEntry({ namespace: 'a', key: 'f' })
    expect(db.listFactsByNamespace('a', 10).length).toBe(0)
    expect(db.listFactsByNamespace('b', 10).length).toBe(1)
  })
})
```

- [ ] **Step 2.2 — Run the test and watch it fail**

```bash
cd quoth-plugin && npm test -- memory-entries-helpers.test.js
```

Expected: fails — `db.upsertMemoryEntry is not a function`.

- [ ] **Step 2.3 — Add the helpers inside `createDb()`**

In `quoth-plugin/daemon/db.js`, right after the `daemon_meta` helpers added in Task 1 (`db.getDaemonMeta`), add:

```javascript
// --- memory_entries helpers (spec §6.7) ---

const crypto = require('crypto')

db.upsertMemoryEntry = function({ namespace, key, content, type, tags, metadata }) {
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

db.listFactsByNamespace = function(namespace, limit = 20) {
  return db.prepare(`
    SELECT key, content, tags, metadata, updated_at
    FROM memory_entries
    WHERE namespace = ? AND type = 'fact' AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(namespace, limit)
}

db.deleteMemoryEntry = function({ namespace, key }) {
  const result = db.prepare(`
    DELETE FROM memory_entries WHERE namespace = ? AND key = ?
  `).run(namespace, key)
  return result.changes
}
```

**Note:** `crypto` is already used elsewhere in the codebase; the `require` at the top of `db.js` does not currently include it. Add `const crypto = require('crypto')` at the top of the file (line 4 area, alongside `path`, `fs`) so all helpers share a single require — do NOT scope the require inside the function.

- [ ] **Step 2.4 — Move the `const crypto = require('crypto')` to the top of the file**

In `quoth-plugin/daemon/db.js`, find line 3-7 (the requires block). It currently reads:

```javascript
const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const { HnswIndex } = require('./lib/hnsw.js')
const { trigrams } = require('./lib/injection.js')
```

Add `const crypto = require('crypto')` as a new line before `const { HnswIndex }`. Remove the duplicate `require('crypto')` you added in Step 2.3.

- [ ] **Step 2.5 — Run the memory-entries-helpers test and verify green**

```bash
cd quoth-plugin && npm test -- memory-entries-helpers.test.js
```

Expected: all tests pass.

- [ ] **Step 2.6 — Run the full plugin test suite**

```bash
cd quoth-plugin && npm test
```

Expected: green.

- [ ] **Step 2.7 — Commit**

```bash
git add quoth-plugin/daemon/db.js quoth-plugin/tests/memory-entries-helpers.test.js
git commit -m "$(cat <<'EOF'
feat(db): add memory_entries CRUD helpers for facts extraction

Adds upsertMemoryEntry (UPSERT via UNIQUE(namespace, key) per §10.2 Q10),
listFactsByNamespace (ORDER BY updated_at DESC per §10.2 Q9), and
deleteMemoryEntry (for the DELETE route per §10.2 Q7). The memory_entries
table was dormant — no readers or writers existed before this commit.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §6.7.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Sidecar + atomic-move helpers in `sessions.js`

**Goal:** A new module that encapsulates all filesystem state transitions — sidecar read/write (atomic rename), `fs.renameSync` into a target bucket, and the synthetic-summary aggregator. Everything filesystem-y gets isolated here so Tasks 4, 5, 8, 9, 10, 12 can import from one place.

**Files:**
- Create: `quoth-plugin/daemon/lib/sessions.js`
- Extend: `quoth-plugin/tests/sessions-helpers.test.js` (add a `describe('sessions.js fs helpers', …)` block — keep all sessions-related tests in one file)

**Why this is third:** Tasks 4 and 5 (the hooks) need sidecar helpers. Task 8 (processSessionFile) needs atomic moves. Task 12 (migration) needs the synthetic-summary aggregator. Doing this now and testing it against a tmpdir means every downstream task gets one import and one mental model.

**Spec references:** §4.4 sidecar schema, §4.1 directory layout, §6.3 synthesizeSummaryFromEntries, §6.4 stale detector.

### API contract (canonical — cited by Tasks 4, 5, 8, 9, 10, 12)

Downstream tasks import these names and call them in two different styles depending on context. The helper MUST accept BOTH shapes so the plan stays internally consistent. Do not "simplify" to one form — it will break a downstream task and cause a re-review.

**`updateSidecar` — two call shapes:**

```js
// (a) 3-arg counter-bump form — used by hooks (trajectory-capture, session-end)
//     on every tool call / close. Read-modify-write that increments tool_count
//     and updates last_seen_ts.
updateSidecar(subdir, sessionId, { project, timestamp, closed_marker? })

// (b) 2-arg patch form — used by daemon-core (processSessionFile) and the
//     stale detector to stamp terminal status fields without incrementing
//     the counter.
updateSidecar(sidecarFilePath, { status, empty_reason?, ... })
```

**`moveSessionFile` — two call shapes:**

```js
// (a) Options-bag form — used by tests and the migration script when the
//     full context (trajectoriesDir, sessionId, from, to, dated, project, date)
//     is already known.
moveSessionFile({ trajectoriesDir, sessionId, from, to, dated?, project?, date?, filenameOverride? })

// (b) Positional-path form — used by daemon-core and the stale detector,
//     where the sessionFile path IS the current location. The helper infers
//     trajectoriesDir, sessionId, and from from the path, and uses the
//     `dated` default (true for terminal buckets, false for processing).
moveSessionFile(sessionFilePath, destBucket, opts = {})
```

The implementation below detects which shape was used by inspecting arg types, then normalizes to the internal options bag.

**`filenameOverride` contract:** when supplied, it is the **full filename INCLUDING the `.jsonl` suffix** (e.g. `'sess-resume-2-e2.jsonl'`). The sidecar path is derived automatically by swapping `.jsonl` → `.meta.json`. Downstream tasks (Task 9 epoch collision, Task 12 migration) MUST pass the suffix — a bare base name will silently break sidecar placement.

---

### Step 3.1 — Write the failing test

Append to `quoth-plugin/tests/sessions-helpers.test.js` (add these `describe` blocks alongside the ones from Task 1):

```javascript
import { readSidecar, writeSidecar, updateSidecar, readAllEntries, synthesizeSummaryFromEntries, moveSessionFile, TRAJECTORIES_SUBDIRS } from '../daemon/lib/sessions.js'

describe('sessions.js — sidecar helpers', () => {
  function tmpTrajDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-traj-'))
    for (const sub of TRAJECTORIES_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    return dir
  }

  it('writeSidecar writes via .tmp → rename (atomic)', () => {
    const dir = tmpTrajDir()
    const activeDir = path.join(dir, 'active')
    writeSidecar(activeDir, 'sid-1', { session_id: 'sid-1', project: 'quoth', first_seen_ts: 100, last_seen_ts: 200, tool_count: 3, closed_marker: false })
    const raw = fs.readFileSync(path.join(activeDir, 'sid-1.meta.json'), 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.session_id).toBe('sid-1')
    expect(parsed.tool_count).toBe(3)
    expect(fs.existsSync(path.join(activeDir, 'sid-1.meta.json.tmp'))).toBe(false)
  })

  it('readSidecar returns null when file is missing', () => {
    const dir = tmpTrajDir()
    expect(readSidecar(path.join(dir, 'active'), 'nope')).toBeNull()
  })

  it('updateSidecar is read-modify-write for the same session', () => {
    const dir = tmpTrajDir()
    const activeDir = path.join(dir, 'active')
    updateSidecar(activeDir, 'sid-2', { project: 'quoth', timestamp: 1000 })
    updateSidecar(activeDir, 'sid-2', { project: 'quoth', timestamp: 2000 })
    const meta = readSidecar(activeDir, 'sid-2')
    expect(meta.first_seen_ts).toBe(1000)
    expect(meta.last_seen_ts).toBe(2000)
    expect(meta.tool_count).toBe(2)
  })
})

describe('sessions.js — readAllEntries', () => {
  it('parses every non-empty line as JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-entries-'))
    const file = path.join(dir, 'x.jsonl')
    fs.writeFileSync(file, '{"a":1}\n{"b":2}\n\n{"c":3}\n')
    const entries = readAllEntries(file)
    expect(entries).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })

  it('returns [] if the file does not exist', () => {
    expect(readAllEntries('/tmp/does-not-exist-xyz.jsonl')).toEqual([])
  })

  it('skips malformed lines without throwing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-entries-'))
    const file = path.join(dir, 'x.jsonl')
    fs.writeFileSync(file, '{"a":1}\nnotjson\n{"b":2}\n')
    expect(readAllEntries(file)).toEqual([{ a: 1 }, { b: 2 }])
  })
})

describe('sessions.js — synthesizeSummaryFromEntries', () => {
  it('aggregates tool_use entries into a synthetic session_summary', () => {
    const entries = [
      { event: 'tool_use', tool: 'Read', outcome: 'success', user_intent: 'understand auth', llm_reasoning: 'read auth.js', session: 'sid', project: 'quoth' },
      { event: 'tool_use', tool: 'Read', outcome: 'success', user_intent: 'understand auth', session: 'sid', project: 'quoth' },
      { event: 'tool_use', tool: 'Edit', outcome: 'failure', user_intent: 'fix typo', session: 'sid', project: 'quoth' },
    ]
    const s = synthesizeSummaryFromEntries(entries, { session_id: 'sid', project: 'quoth' })
    expect(s.event).toBe('session_summary')
    expect(s.session).toBe('sid')
    expect(s.project).toBe('quoth')
    expect(s.total_calls).toBe(3)
    expect(s.tool_counts).toEqual({ Read: 2, Edit: 1 })
    expect(s.success_rate).toBeCloseTo(2 / 3, 2)
    expect(s.user_intents).toContain('understand auth')
    expect(s.outcome).toBe('partial')
    expect(s.source).toBe('synthetic-aggregator')
  })

  it('handles zero entries without crashing', () => {
    const s = synthesizeSummaryFromEntries([], { session_id: 'sid', project: 'quoth' })
    expect(s.total_calls).toBe(0)
    expect(s.success_rate).toBe(0)
  })
})

describe('sessions.js — moveSessionFile', () => {
  it('renames active/<sid>.jsonl + sidecar into processing/', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-move-'))
    for (const sub of TRAJECTORIES_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    const sid = 'sid-move'
    fs.writeFileSync(path.join(dir, 'active', `${sid}.jsonl`), '{"a":1}\n')
    writeSidecar(path.join(dir, 'active'), sid, { session_id: sid, project: 'p', first_seen_ts: 1, last_seen_ts: 2, tool_count: 1 })

    const result = moveSessionFile({ trajectoriesDir: dir, sessionId: sid, from: 'active', to: 'processing' })

    expect(result.jsonlPath).toBe(path.join(dir, 'processing', `${sid}.jsonl`))
    expect(fs.existsSync(path.join(dir, 'active', `${sid}.jsonl`))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'active', `${sid}.meta.json`))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'processing', `${sid}.jsonl`))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'processing', `${sid}.meta.json`))).toBe(true)
  })

  it('renames into a dated bucket (done/YYYY-MM-DD/<project>/)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-move-done-'))
    for (const sub of TRAJECTORIES_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    const sid = 'sid-done'
    fs.writeFileSync(path.join(dir, 'processing', `${sid}.jsonl`), '{"a":1}\n')
    writeSidecar(path.join(dir, 'processing'), sid, { session_id: sid, project: 'quoth', first_seen_ts: 1, last_seen_ts: 2, tool_count: 1 })

    const result = moveSessionFile({
      trajectoriesDir: dir, sessionId: sid,
      from: 'processing', to: 'done',
      dated: true, project: 'quoth', date: '2026-04-10',
    })

    expect(result.jsonlPath).toBe(path.join(dir, 'done', '2026-04-10', 'quoth', `${sid}.jsonl`))
    expect(fs.existsSync(result.jsonlPath)).toBe(true)
  })

  it('supports a custom filename (for the epoch suffix case)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-move-epoch-'))
    for (const sub of TRAJECTORIES_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    const sid = 'sid-ep'
    fs.writeFileSync(path.join(dir, 'processing', `${sid}.jsonl`), '{"a":1}\n')
    writeSidecar(path.join(dir, 'processing'), sid, { session_id: sid, project: 'quoth', first_seen_ts: 1, last_seen_ts: 2, tool_count: 1 })

    const result = moveSessionFile({
      trajectoriesDir: dir, sessionId: sid,
      from: 'processing', to: 'done',
      dated: true, project: 'quoth', date: '2026-04-10',
      filenameOverride: `${sid}-e2.jsonl`,
    })

    expect(fs.existsSync(path.join(dir, 'done', '2026-04-10', 'quoth', `${sid}-e2.jsonl`))).toBe(true)
  })

  // Dual-form contract: positional-path form used by daemon-core and stale detector
  it('accepts positional form: moveSessionFile(jsonlPath, "processing")', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-move-pos-'))
    for (const sub of TRAJECTORIES_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    const sid = 'sid-pos'
    const activePath = path.join(dir, 'active', `${sid}.jsonl`)
    fs.writeFileSync(activePath, '{"a":1}\n')
    writeSidecar(path.join(dir, 'active'), sid, { session_id: sid, project: 'quoth', first_seen_ts: 1, last_seen_ts: 2, tool_count: 1 })

    const result = moveSessionFile(activePath, 'processing')

    expect(result.jsonlPath).toBe(path.join(dir, 'processing', `${sid}.jsonl`))
    expect(fs.existsSync(activePath)).toBe(false)
    expect(fs.existsSync(path.join(dir, 'processing', `${sid}.jsonl`))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'processing', `${sid}.meta.json`))).toBe(true)
  })

  it('positional form defaults dated=true for terminal buckets and uses opts.project', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-move-pos-dated-'))
    for (const sub of TRAJECTORIES_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    const sid = 'sid-pos-done'
    const procPath = path.join(dir, 'processing', `${sid}.jsonl`)
    fs.writeFileSync(procPath, '{"a":1}\n')
    writeSidecar(path.join(dir, 'processing'), sid, { session_id: sid, project: 'quoth', first_seen_ts: 1, last_seen_ts: 2, tool_count: 1 })

    const result = moveSessionFile(procPath, 'done', { project: 'quoth', date: '2026-04-10' })

    expect(result.jsonlPath).toBe(path.join(dir, 'done', '2026-04-10', 'quoth', `${sid}.jsonl`))
    expect(fs.existsSync(result.jsonlPath)).toBe(true)
  })
})

describe('sessions.js — updateSidecar dual-form', () => {
  function tmpTrajDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-traj-patch-'))
    for (const sub of TRAJECTORIES_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    return dir
  }

  it('2-arg patch form stamps fields without incrementing tool_count', () => {
    const dir = tmpTrajDir()
    const activeDir = path.join(dir, 'active')
    const sid = 'sid-patch'
    // prime sidecar with counter=3 via 3-arg form
    updateSidecar(activeDir, sid, { project: 'quoth', timestamp: 1000 })
    updateSidecar(activeDir, sid, { project: 'quoth', timestamp: 2000 })
    updateSidecar(activeDir, sid, { project: 'quoth', timestamp: 3000 })
    expect(readSidecar(activeDir, sid).tool_count).toBe(3)

    // patch form: add status + empty_reason without bumping counter
    const sidecarFile = path.join(activeDir, `${sid}.meta.json`)
    updateSidecar(sidecarFile, { status: 'empty', empty_reason: 'no-entries' })

    const after = readSidecar(activeDir, sid)
    expect(after.tool_count).toBe(3) // unchanged
    expect(after.status).toBe('empty')
    expect(after.empty_reason).toBe('no-entries')
  })

  it('2-arg patch form is a no-op when the sidecar is missing', () => {
    const dir = tmpTrajDir()
    const sidecarFile = path.join(dir, 'active', 'ghost.meta.json')
    expect(() => updateSidecar(sidecarFile, { status: 'error' })).not.toThrow()
  })
})
```

- [ ] **Step 3.2 — Run the test and verify it fails**

```bash
cd quoth-plugin && npm test -- sessions-helpers.test.js
```

Expected: fails with "Cannot find module '../daemon/lib/sessions.js'".

- [ ] **Step 3.3 — Create `quoth-plugin/daemon/lib/sessions.js`**

```javascript
'use strict'

const fs = require('fs')
const path = require('path')

const TRAJECTORIES_SUBDIRS = ['active', 'processing', 'done', 'routine', 'empty', 'error']

/**
 * Ensure `trajectories/<sub>/…` exists. Called by writers before append.
 */
function ensureSubdir(trajectoriesDir, sub) {
  const dir = path.join(trajectoriesDir, sub)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Sidecar path for a session in a given subdir.
 */
function sidecarPath(subdir, sessionId) {
  return path.join(subdir, `${sessionId}.meta.json`)
}

function jsonlPath(subdir, sessionId) {
  return path.join(subdir, `${sessionId}.jsonl`)
}

/**
 * Read a sidecar file. Returns null if missing or malformed.
 */
function readSidecar(subdir, sessionId) {
  try {
    const raw = fs.readFileSync(sidecarPath(subdir, sessionId), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Write a sidecar atomically (.tmp → rename).
 */
function writeSidecar(subdir, sessionId, meta) {
  if (!fs.existsSync(subdir)) fs.mkdirSync(subdir, { recursive: true })
  const finalPath = sidecarPath(subdir, sessionId)
  const tmpPath = finalPath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(meta))
  fs.renameSync(tmpPath, finalPath)
}

/**
 * Dual-form sidecar update. See "API contract" section at the top of Task 3.
 *
 * (a) 3-arg counter-bump form — hooks:
 *       updateSidecar(subdir, sessionId, { project, timestamp, closed_marker? })
 *     Read-modify-write; increments tool_count; updates last_seen_ts.
 *
 * (b) 2-arg patch form — daemon-core / stale detector:
 *       updateSidecar(sidecarFilePath, { status, empty_reason?, ... })
 *     Read-modify-write; does NOT increment tool_count; no-op if file missing.
 *
 * Detection: if `secondArg` is a string (sessionId) → form (a); otherwise form (b).
 */
function updateSidecar(firstArg, secondArg, thirdArg) {
  // Form (b): 2-arg patch — firstArg is a path ending in `.meta.json`
  if (typeof secondArg === 'object' && secondArg !== null && thirdArg === undefined) {
    const sidecarFile = firstArg
    const patch = secondArg
    let existing
    try {
      existing = JSON.parse(fs.readFileSync(sidecarFile, 'utf8'))
    } catch {
      return null // no-op if file missing/malformed
    }
    const next = { ...existing, ...patch }
    const tmp = sidecarFile + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(next))
    fs.renameSync(tmp, sidecarFile)
    return next
  }

  // Form (a): 3-arg counter-bump
  const subdir = firstArg
  const sessionId = secondArg
  const input = thirdArg || {}
  const now = input.timestamp || Date.now()
  const existing = readSidecar(subdir, sessionId)
  const next = existing || {
    session_id: sessionId,
    project: input.project,
    first_seen_ts: now,
    last_seen_ts: now,
    tool_count: 0,
    closed_marker: false,
  }
  next.last_seen_ts = now
  next.tool_count = (next.tool_count || 0) + 1
  if (input.project && !next.project) next.project = input.project
  if (input.closed_marker != null) next.closed_marker = !!input.closed_marker
  writeSidecar(subdir, sessionId, next)
  return next
}

/**
 * Read a JSONL file and parse every line. Skips empty and malformed lines.
 */
function readAllEntries(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const out = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try { out.push(JSON.parse(line)) } catch {}
    }
    return out
  } catch {
    return []
  }
}

/**
 * Mechanically aggregate tool_use entries into a synthetic session_summary.
 * ZERO relevance judgement — just counts, intents, and outcome rate.
 * Used both by the stale detector and the migration script when a session
 * lacks a real session_summary (e.g. crashed before session-end).
 */
function synthesizeSummaryFromEntries(toolEntries, meta) {
  const toolCounts = {}
  const intents = new Set()
  const reasonings = []
  let successes = 0, failures = 0

  for (const e of toolEntries) {
    toolCounts[e.tool] = (toolCounts[e.tool] || 0) + 1
    if (e.outcome === 'success') successes++
    else failures++
    if (e.user_intent) intents.add(e.user_intent)
    if (e.llm_reasoning) reasonings.push(e.llm_reasoning)
  }

  const toolSummary = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t}:${c}`)
    .join(', ')

  const total = toolEntries.length
  return {
    event: 'session_summary',
    agent: 'claude-code',
    project: meta.project || 'default',
    session: meta.session_id,
    task: `Session (synthetic): ${total} tool calls (${toolSummary}). ${successes} ok, ${failures} fail.`,
    tool_counts: toolCounts,
    total_calls: total,
    success_rate: total > 0 ? successes / total : 0,
    user_intents: [...intents].slice(0, 5),
    llm_reasonings: [...new Set(reasonings)].slice(-10),
    outcome: total === 0
      ? 'unknown'
      : (failures === 0 ? 'success' : (successes > failures ? 'partial' : 'failure')),
    source: 'synthetic-aggregator',
    timestamp: Date.now(),
  }
}

const TERMINAL_BUCKETS = new Set(['done', 'routine', 'empty', 'error'])

/**
 * Dual-form atomic move. See "API contract" section at the top of Task 3.
 *
 * (a) Options-bag form — tests, migration script:
 *       moveSessionFile({ trajectoriesDir, sessionId, from, to, dated?, project?, date?, filenameOverride? })
 *
 * (b) Positional-path form — daemon-core, stale detector:
 *       moveSessionFile(sessionFilePath, destBucket, opts = {})
 *     Infers trajectoriesDir/sessionId/from from the path. `dated` defaults
 *     to true when destBucket is a terminal bucket (done/routine/empty/error),
 *     false otherwise.
 *
 * @returns {{ jsonlPath: string, metaPath: string }}
 */
function moveSessionFile(firstArg, secondArg, thirdArg) {
  let opts
  if (typeof firstArg === 'object' && firstArg !== null) {
    // Form (a): options-bag
    opts = firstArg
  } else if (typeof firstArg === 'string' && typeof secondArg === 'string') {
    // Form (b): positional-path — infer context from the path
    const sessionFilePath = firstArg
    const destBucket = secondArg
    const extraOpts = thirdArg || {}
    const sessionId = path.basename(sessionFilePath, '.jsonl')
    const from = path.basename(path.dirname(sessionFilePath))
    const trajectoriesDir = path.dirname(path.dirname(sessionFilePath))
    const datedDefault = TERMINAL_BUCKETS.has(destBucket)
    opts = {
      trajectoriesDir,
      sessionId,
      from,
      to: destBucket,
      dated: extraOpts.dated != null ? extraOpts.dated : datedDefault,
      project: extraOpts.project,
      date: extraOpts.date,
      filenameOverride: extraOpts.filenameOverride,
    }
  } else {
    throw new TypeError('moveSessionFile: expected options-bag or (sessionFilePath, destBucket, opts?)')
  }

  const { trajectoriesDir, sessionId, from, to } = opts
  const { dated = false, project, date, filenameOverride } = opts

  const fromDir = path.join(trajectoriesDir, from)
  const fromJsonl = jsonlPath(fromDir, sessionId)
  const fromMeta = sidecarPath(fromDir, sessionId)

  const d = date || new Date().toISOString().slice(0, 10)
  let toDir
  if (dated) {
    // empty/ uses date only (no project subdir — spec §4.1)
    toDir = to === 'empty'
      ? path.join(trajectoriesDir, to, d)
      : path.join(trajectoriesDir, to, d, project || 'default')
  } else {
    toDir = path.join(trajectoriesDir, to)
  }
  fs.mkdirSync(toDir, { recursive: true })

  const filename = filenameOverride || `${sessionId}.jsonl`
  const metaFilename = filenameOverride
    ? filenameOverride.replace(/\.jsonl$/, '.meta.json')
    : `${sessionId}.meta.json`
  const toJsonl = path.join(toDir, filename)
  const toMeta = path.join(toDir, metaFilename)

  fs.renameSync(fromJsonl, toJsonl)
  if (fs.existsSync(fromMeta)) {
    try { fs.renameSync(fromMeta, toMeta) } catch {}
  }
  return { jsonlPath: toJsonl, metaPath: toMeta }
}

module.exports = {
  TRAJECTORIES_SUBDIRS,
  TERMINAL_BUCKETS,
  ensureSubdir,
  sidecarPath,
  jsonlPath,
  readSidecar,
  writeSidecar,
  updateSidecar,
  readAllEntries,
  synthesizeSummaryFromEntries,
  moveSessionFile,
}
```

- [ ] **Step 3.4 — Run the sessions-helpers test file and verify green**

```bash
cd quoth-plugin && npm test -- sessions-helpers.test.js
```

Expected: all tests pass (both Task 1's DB tests and Task 3's fs tests).

- [ ] **Step 3.5 — Run the full plugin test suite**

```bash
cd quoth-plugin && npm test
```

Expected: green.

- [ ] **Step 3.6 — Commit**

```bash
git add quoth-plugin/daemon/lib/sessions.js quoth-plugin/tests/sessions-helpers.test.js
git commit -m "$(cat <<'EOF'
feat(daemon): add sessions.js with sidecar + atomic-move helpers

New module encapsulates all filesystem state transitions for the
per-session trajectory layout: sidecar read/write via atomic rename,
synthetic summary aggregation (mechanical, zero relevance judgement),
and cross-bucket moveSessionFile with date/project subdirs and
filename override (for epoch suffix).

No callers yet — hooks and daemon rewire in later tasks.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §4.1, §4.4, §6.3.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `trajectory-capture.js` rewrite to per-session JSONL

**Files:**
- Modify: `quoth-plugin/hooks/trajectory-capture.js:107-110` (the append to `${project}-${date}.jsonl`)
- Modify: `quoth-plugin/hooks/trajectory-capture.js:13-16` (ensure directory → ensure `active/`)
- Test: `quoth-plugin/tests/trajectory-capture.test.js` (create)
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §4.1, §6.1, §6.2

**Goal of the task:** Stop writing every hook fire into a shared `<project>-<date>.jsonl`. Instead, append each entry into `~/.quoth/trajectories/active/<sessionId>.jsonl` and bump `last_seen_ts` / `tool_count` on the sidecar. Sessions become truly isolated from the first tool call.

**Commit prefix:** `feat(hooks):`

- [ ] **Step 4.1 — Write failing integration test: two sessions write in parallel**

Create `quoth-plugin/tests/trajectory-capture.test.js`:

```javascript
// Integration test for trajectory-capture.js per-session file layout.
// Runs the hook as a child process with hook data piped to stdin, then
// asserts the filesystem looks the way the spec demands.

const { describe, it, expect, beforeEach, afterEach } = require('vitest')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const HOOK = path.resolve(__dirname, '../hooks/trajectory-capture.js')

function makeTmpHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-hook-test-'))
  return tmp
}

function runHook(tmpHome, payload) {
  const res = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    env: {
      ...process.env,
      QUOTH_HOME: tmpHome,
      CLAUDE_PROJECT_DIR: tmpHome,        // avoid git shenanigans
      CLAUDE_SESSION_ID: payload.session_id,
    },
    encoding: 'utf8',
    timeout: 5000,
  })
  return res
}

function makeEntry(sessionId, toolName, command) {
  return {
    session_id: sessionId,
    tool_name: toolName,
    tool_input: { command },
    tool_result: { output: 'ok' },
  }
}

describe('trajectory-capture — per-session files', () => {
  let tmpHome
  beforeEach(() => { tmpHome = makeTmpHome() })
  afterEach(() => { try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch {} })

  it('creates trajectories/active/ on first run', () => {
    const sid = 'sess-alpha-0001'
    const res = runHook(tmpHome, makeEntry(sid, 'Bash', 'ls'))
    expect(res.status).toBe(0)
    expect(fs.existsSync(path.join(tmpHome, 'trajectories', 'active'))).toBe(true)
  })

  it('writes tool entry to active/<sid>.jsonl (not project-date.jsonl)', () => {
    const sid = 'sess-alpha-0002'
    runHook(tmpHome, makeEntry(sid, 'Bash', 'ls'))

    const activeDir = path.join(tmpHome, 'trajectories', 'active')
    const sessionFile = path.join(activeDir, `${sid}.jsonl`)
    expect(fs.existsSync(sessionFile)).toBe(true)

    // The old per-date file pattern must NOT exist.
    const dated = fs.readdirSync(activeDir).filter(f => /^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    expect(dated).toEqual([])

    const line = fs.readFileSync(sessionFile, 'utf8').trim()
    const parsed = JSON.parse(line)
    expect(parsed.event).toBe('tool_use')
    expect(parsed.session).toBe(sid)
    expect(parsed.tool).toBe('Bash')
  })

  it('writes sidecar <sid>.meta.json with first_seen_ts on first entry', () => {
    const sid = 'sess-alpha-0003'
    const before = Date.now()
    runHook(tmpHome, makeEntry(sid, 'Bash', 'ls'))
    const after = Date.now()

    const meta = path.join(tmpHome, 'trajectories', 'active', `${sid}.meta.json`)
    expect(fs.existsSync(meta)).toBe(true)
    const parsed = JSON.parse(fs.readFileSync(meta, 'utf8'))
    expect(parsed.session_id).toBe(sid)
    expect(parsed.status).toBe('active')
    expect(parsed.first_seen_ts).toBeGreaterThanOrEqual(before)
    expect(parsed.first_seen_ts).toBeLessThanOrEqual(after)
    expect(parsed.last_seen_ts).toBeGreaterThanOrEqual(parsed.first_seen_ts)
    expect(parsed.tool_count).toBe(1)
    expect(parsed.closed_marker).toBe(false)
    expect(typeof parsed.project).toBe('string')
  })

  it('updates sidecar last_seen_ts and tool_count on subsequent entries', () => {
    const sid = 'sess-alpha-0004'
    runHook(tmpHome, makeEntry(sid, 'Bash', 'ls'))
    const meta = path.join(tmpHome, 'trajectories', 'active', `${sid}.meta.json`)
    const first = JSON.parse(fs.readFileSync(meta, 'utf8'))

    runHook(tmpHome, makeEntry(sid, 'Read', 'README.md'))
    const second = JSON.parse(fs.readFileSync(meta, 'utf8'))

    expect(second.first_seen_ts).toBe(first.first_seen_ts)
    expect(second.last_seen_ts).toBeGreaterThanOrEqual(first.last_seen_ts)
    expect(second.tool_count).toBe(2)
  })

  it('two parallel sessions do NOT contaminate each other', () => {
    const sidA = 'sess-parallel-A'
    const sidB = 'sess-parallel-B'
    // Interleave 3 writes each.
    runHook(tmpHome, makeEntry(sidA, 'Bash', 'ls A1'))
    runHook(tmpHome, makeEntry(sidB, 'Bash', 'ls B1'))
    runHook(tmpHome, makeEntry(sidA, 'Bash', 'ls A2'))
    runHook(tmpHome, makeEntry(sidB, 'Bash', 'ls B2'))
    runHook(tmpHome, makeEntry(sidA, 'Bash', 'ls A3'))
    runHook(tmpHome, makeEntry(sidB, 'Bash', 'ls B3'))

    const dir = path.join(tmpHome, 'trajectories', 'active')
    const files = fs.readdirSync(dir).sort()
    expect(files).toContain(`${sidA}.jsonl`)
    expect(files).toContain(`${sidB}.jsonl`)

    const linesA = fs.readFileSync(path.join(dir, `${sidA}.jsonl`), 'utf8').split('\n').filter(Boolean)
    const linesB = fs.readFileSync(path.join(dir, `${sidB}.jsonl`), 'utf8').split('\n').filter(Boolean)
    expect(linesA.length).toBe(3)
    expect(linesB.length).toBe(3)

    // No cross-contamination.
    for (const l of linesA) expect(JSON.parse(l).session).toBe(sidA)
    for (const l of linesB) expect(JSON.parse(l).session).toBe(sidB)

    // Sidecars agree.
    const metaA = JSON.parse(fs.readFileSync(path.join(dir, `${sidA}.meta.json`), 'utf8'))
    const metaB = JSON.parse(fs.readFileSync(path.join(dir, `${sidB}.meta.json`), 'utf8'))
    expect(metaA.tool_count).toBe(3)
    expect(metaB.tool_count).toBe(3)
  })
})
```

- [ ] **Step 4.2 — Run the failing test**

```bash
cd quoth-plugin && npm test -- trajectory-capture.test.js
```

Expected: multiple failures — the hook still writes to `<project>-<date>.jsonl`, there is no `active/` subdir, and no sidecars exist.

- [ ] **Step 4.3 — Rewrite the write block in `trajectory-capture.js`**

Edit `quoth-plugin/hooks/trajectory-capture.js`:

Replace line 13 (`const TRAJECTORIES_DIR = path.join(QUOTH_HOME, 'trajectories')`) through line 16 (`if (!fs.existsSync(TRAJECTORIES_DIR)) fs.mkdirSync(TRAJECTORIES_DIR, { recursive: true })`) with:

```javascript
const TRAJECTORIES_DIR = path.join(QUOTH_HOME, 'trajectories')
const ACTIVE_DIR = path.join(TRAJECTORIES_DIR, 'active')

// Ensure active/ exists (covers both first run and fresh install).
if (!fs.existsSync(ACTIVE_DIR)) fs.mkdirSync(ACTIVE_DIR, { recursive: true })
```

Replace lines 107-110 (the old `trajFile` append) with:

```javascript
    // Per-session file isolation: every session writes to its own JSONL
    // under active/, plus a sidecar with metadata the daemon reads.
    // Sanitize sessionId before using it as a path segment to prevent
    // directory traversal if a malformed payload arrives. Keep the raw
    // value in the JSONL entry body so downstream consumers see the
    // original id.
    const safeSid = String(sessionId).replace(/[^A-Za-z0-9_\-]/g, '_')
    const sessionFile = path.join(ACTIVE_DIR, `${safeSid}.jsonl`)
    const sidecarFile = path.join(ACTIVE_DIR, `${safeSid}.meta.json`)
    const nowTs = Date.now()

    // Append JSONL line first — if we crash between append and sidecar
    // update, the detector can still rebuild sidecar from the JSONL.
    fs.appendFileSync(sessionFile, JSON.stringify(entry) + '\n')

    // Read-modify-write sidecar. Tolerate a missing or malformed file
    // by treating it as a fresh session. We write via .tmp + rename
    // for atomicity (see daemon/lib/sessions.js for the shared helper,
    // but this hook stays dependency-free to keep startup cost near zero).
    // Field names match the canonical schema in spec §5 / db.js sessions
    // table: last_seen_ts (not last_activity_ts), tool_count (not entry_count).
    let meta = null
    try {
      meta = JSON.parse(fs.readFileSync(sidecarFile, 'utf8'))
    } catch {}
    if (!meta || typeof meta !== 'object') {
      meta = {
        session_id: sessionId,
        project,
        status: 'active',
        first_seen_ts: nowTs,
        last_seen_ts: nowTs,
        tool_count: 0,
        closed_marker: false,
        source: 'hook',
      }
    }
    meta.last_seen_ts = nowTs
    meta.tool_count = (meta.tool_count || 0) + 1
    // Keep project stable after first write — don't overwrite on later calls.
    if (!meta.project) meta.project = project

    const tmpPath = sidecarFile + '.tmp'
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(meta))
      fs.renameSync(tmpPath, sidecarFile)
    } catch {
      // fire-and-forget; sidecar can be rebuilt from JSONL if needed
      try { fs.unlinkSync(tmpPath) } catch {}
    }
```

- [ ] **Step 4.4 — Run the hook test and verify green**

```bash
cd quoth-plugin && npm test -- trajectory-capture.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 4.5 — Run the full plugin test suite**

```bash
cd quoth-plugin && npm test
```

Expected: no regressions. (Note: tests that asserted on `<project>-<date>.jsonl` will surface now if any exist — fix them in this same task if so, but do not delete assertions blindly. Favor updating them to read from `active/<sid>.jsonl`.)

- [ ] **Step 4.6 — Commit**

```bash
git add quoth-plugin/hooks/trajectory-capture.js quoth-plugin/tests/trajectory-capture.test.js
git commit -m "$(cat <<'EOF'
feat(hooks): write per-session trajectory JSONL under active/

trajectory-capture.js now appends to active/<sid>.jsonl and maintains
a sidecar <sid>.meta.json with {status, first_seen_ts, last_seen_ts,
tool_count, project}. The sidecar is updated via .tmp + rename so a
crash mid-write never leaves the daemon reading half a JSON file.

Parallel sessions no longer share a file, eliminating the root cause
of cross-session contamination.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §4.1, §6.1.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `session-end` hook rewrite with atomic rename to `processing/`

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js:404-484` (the `session-end` action)
- Test: `quoth-plugin/tests/session-end-hook.test.js` (create)
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §4.1, §4.5, §6.2

**Goal of the task:** When the session ends, the hook (a) writes a real `session_summary` entry into the `active/<sid>.jsonl`, (b) flips the sidecar to `status: 'terminated'` with the summary inline, (c) atomically renames `active/<sid>.jsonl` → `processing/<sid>.jsonl` (and the sidecar alongside it), (d) signals the daemon via SIGUSR1. The rename IS the handoff — once in `processing/`, the file is claimed.

**Commit prefix:** `feat(hooks):`

- [ ] **Step 5.1 — Write failing test: session-end hook moves file to processing/**

Create `quoth-plugin/tests/session-end-hook.test.js`:

```javascript
const { describe, it, expect, beforeEach, afterEach } = require('vitest')
const fs = require('fs')
const path = require('path')
const os = require('os')

// Load the module under test with a scoped QUOTH_HOME.
function freshHooks(tmpHome) {
  process.env.QUOTH_HOME = tmpHome
  const modPath = require.resolve('../hooks/hook-dispatch.js')
  delete require.cache[modPath]
  return require(modPath)
}

function writeActiveSession(tmpHome, sid, entries) {
  const dir = path.join(tmpHome, 'trajectories', 'active')
  fs.mkdirSync(dir, { recursive: true })
  const jsonlPath = path.join(dir, `${sid}.jsonl`)
  fs.writeFileSync(jsonlPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n')

  const sidecar = {
    session_id: sid,
    project: 'quoth',
    status: 'active',
    first_seen_ts: Date.now() - 60_000,
    last_seen_ts: Date.now(),
    tool_count: entries.length,
    closed_marker: false,
    source: 'hook',
  }
  fs.writeFileSync(path.join(dir, `${sid}.meta.json`), JSON.stringify(sidecar))
}

describe('session-end hook — atomic handoff to processing/', () => {
  let tmpHome
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-end-test-'))
    // CLAUDE_SESSION_ID drives the hook
    process.env.CLAUDE_SESSION_ID = 'sess-end-0001'
    process.env.CLAUDE_PROJECT_DIR = tmpHome
  })
  afterEach(() => {
    delete process.env.CLAUDE_SESSION_ID
    delete process.env.CLAUDE_PROJECT_DIR
    try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch {}
  })

  it('moves active/<sid>.jsonl → processing/<sid>.jsonl', async () => {
    const sid = 'sess-end-0001'
    writeActiveSession(tmpHome, sid, [
      { event: 'tool_use', session: sid, tool: 'Bash', outcome: 'success', tool_input: 'ls', timestamp: Date.now() - 50_000 },
      { event: 'tool_use', session: sid, tool: 'Read', outcome: 'success', tool_input: 'README.md', timestamp: Date.now() - 40_000 },
      { event: 'tool_use', session: sid, tool: 'Write', outcome: 'success', tool_input: 'src/foo.ts', timestamp: Date.now() - 30_000 },
    ])

    const hooks = freshHooks(tmpHome)
    await hooks.handle('session-end', {})

    // Files moved.
    expect(fs.existsSync(path.join(tmpHome, 'trajectories', 'active', `${sid}.jsonl`))).toBe(false)
    expect(fs.existsSync(path.join(tmpHome, 'trajectories', 'active', `${sid}.meta.json`))).toBe(false)
    expect(fs.existsSync(path.join(tmpHome, 'trajectories', 'processing', `${sid}.jsonl`))).toBe(true)
    expect(fs.existsSync(path.join(tmpHome, 'trajectories', 'processing', `${sid}.meta.json`))).toBe(true)
  })

  it('appends a session_summary entry with event, total_calls, tool_counts', async () => {
    const sid = 'sess-end-0002'
    process.env.CLAUDE_SESSION_ID = sid
    writeActiveSession(tmpHome, sid, [
      { event: 'tool_use', session: sid, tool: 'Bash', outcome: 'success', timestamp: Date.now() - 10_000 },
      { event: 'tool_use', session: sid, tool: 'Bash', outcome: 'failure', timestamp: Date.now() - 9_000 },
      { event: 'tool_use', session: sid, tool: 'Read', outcome: 'success', timestamp: Date.now() - 8_000 },
    ])

    const hooks = freshHooks(tmpHome)
    await hooks.handle('session-end', {})

    const jsonl = fs.readFileSync(path.join(tmpHome, 'trajectories', 'processing', `${sid}.jsonl`), 'utf8')
    const lines = jsonl.trim().split('\n').map(l => JSON.parse(l))
    const summary = lines.find(e => e.event === 'session_summary')
    expect(summary).toBeTruthy()
    expect(summary.session).toBe(sid)
    expect(summary.total_calls).toBe(3)
    expect(summary.tool_counts.Bash).toBe(2)
    expect(summary.tool_counts.Read).toBe(1)
    expect(summary.source).toBe('session-end')
  })

  it('writes sidecar with status=terminated and closed_marker=true', async () => {
    const sid = 'sess-end-0003'
    process.env.CLAUDE_SESSION_ID = sid
    writeActiveSession(tmpHome, sid, [
      { event: 'tool_use', session: sid, tool: 'Read', outcome: 'success', timestamp: Date.now() },
    ])

    const hooks = freshHooks(tmpHome)
    await hooks.handle('session-end', {})

    const meta = JSON.parse(
      fs.readFileSync(path.join(tmpHome, 'trajectories', 'processing', `${sid}.meta.json`), 'utf8')
    )
    expect(meta.status).toBe('terminated')
    expect(meta.closed_marker).toBe(true)
    expect(meta.tool_count).toBeGreaterThanOrEqual(1)
  })

  it('is a no-op if the active file does not exist (hook reran after handoff)', async () => {
    const sid = 'sess-end-0004'
    process.env.CLAUDE_SESSION_ID = sid
    // Nothing in active/ — simulate hook firing twice or on a fresh process.

    const hooks = freshHooks(tmpHome)
    // Must not throw.
    await hooks.handle('session-end', {})
    expect(fs.existsSync(path.join(tmpHome, 'trajectories', 'processing', `${sid}.jsonl`))).toBe(false)
  })
})
```

- [ ] **Step 5.2 — Run the failing test**

```bash
cd quoth-plugin && npm test -- session-end-hook.test.js
```

Expected: all 4 tests fail — current hook writes to `<project>-<date>.jsonl`, not `active/`.

- [ ] **Step 5.3 — Rewrite the `session-end` block in hook-dispatch.js**

Edit `quoth-plugin/hooks/hook-dispatch.js` and replace the entire `'session-end': async () => { ... }` body (currently lines 404-484 up through the end of the first `try { ... } catch {}` that reads `trajFile`).

Important: the existing function has two parts — the JSONL write (lines 412-484) AND "Apply feedback + snapshot context for next session" (starts around line 487). You are ONLY rewriting the JSONL-write portion, through the end of the `catch {}` that follows `fs.appendFileSync(trajFile, ...)`. Leave the session-memory snapshot code alone.

Replace from `// Write session summary to trajectory JSONL for downstream learning` through the end of that try/catch with:

```javascript
    // Hand off the session to the daemon: write a real session_summary,
    // flip sidecar to terminated, then atomically rename active/<sid>.jsonl
    // → processing/<sid>.jsonl. The rename IS the claim — once the file
    // is in processing/, the daemon owns it.
    try {
      const sessionId = process.env.CLAUDE_SESSION_ID || null
      if (!sessionId) throw new Error('no_session_id')

      const activeDir = path.join(QUOTH_HOME, 'trajectories', 'active')
      const processingDir = path.join(QUOTH_HOME, 'trajectories', 'processing')
      fs.mkdirSync(processingDir, { recursive: true })

      const jsonlSrc = path.join(activeDir, `${sessionId}.jsonl`)
      const sidecarSrc = path.join(activeDir, `${sessionId}.meta.json`)
      if (!fs.existsSync(jsonlSrc)) throw new Error('no_active_jsonl')

      // Read session's tool calls from its own trajectory file (the whole file).
      const lines = fs.readFileSync(jsonlSrc, 'utf8').split('\n').filter(Boolean)
      const sessionEntries = []
      for (const line of lines) {
        try {
          const entry = JSON.parse(line)
          if (entry.event === 'tool_use') sessionEntries.push(entry)
        } catch {}
      }

      // Aggregate tool counts / intents / reasonings.
      const toolCounts = {}
      const intents = new Set()
      const reasonings = []
      let successes = 0, failures = 0
      for (const e of sessionEntries) {
        toolCounts[e.tool] = (toolCounts[e.tool] || 0) + 1
        if (e.outcome === 'success') successes++
        else failures++
        if (e.user_intent) intents.add(e.user_intent)
        if (e.llm_reasoning) reasonings.push(e.llm_reasoning)
      }
      const toolSummary = Object.entries(toolCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([tool, count]) => `${tool}:${count}`)
        .join(', ')
      const uniqueIntents = [...intents].slice(0, 5)
      const uniqueReasonings = [...new Set(reasonings)].slice(-10)

      // Project: prefer sidecar (trust the first-write), fall back to env.
      let project = null
      try {
        const meta = JSON.parse(fs.readFileSync(sidecarSrc, 'utf8'))
        project = meta.project || null
      } catch {}
      if (!project) {
        project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
      }

      const summary = {
        event: 'session_summary',
        agent: 'claude-code',
        project,
        session: sessionId,
        task: `Session: ${sessionEntries.length} tool calls (${toolSummary}). ${successes} ok, ${failures} fail.`,
        tool_counts: toolCounts,
        total_calls: sessionEntries.length,
        success_rate: sessionEntries.length > 0 ? successes / sessionEntries.length : 0,
        user_intents: uniqueIntents,
        llm_reasonings: uniqueReasonings,
        outcome: failures === 0 ? 'success' : (successes > failures ? 'partial' : 'failure'),
        source: 'session-end',
        timestamp: Date.now(),
      }

      fs.appendFileSync(jsonlSrc, JSON.stringify(summary) + '\n')

      // Update sidecar in-place with terminated status + summary inline.
      let meta = null
      try { meta = JSON.parse(fs.readFileSync(sidecarSrc, 'utf8')) } catch {}
      if (!meta) {
        meta = { session_id: sessionId, project, first_seen_ts: Date.now(), tool_count: sessionEntries.length }
      }
      meta.status = 'terminated'
      meta.closed_marker = true
      meta.tool_count = sessionEntries.length
      meta.last_seen_ts = Date.now()
      meta.summary = {
        total_calls: sessionEntries.length,
        tool_counts: toolCounts,
        outcome: summary.outcome,
      }
      const sidecarTmp = sidecarSrc + '.tmp'
      fs.writeFileSync(sidecarTmp, JSON.stringify(meta))
      fs.renameSync(sidecarTmp, sidecarSrc)

      // Atomic handoff: rename into processing/.
      const jsonlDst = path.join(processingDir, `${sessionId}.jsonl`)
      const sidecarDst = path.join(processingDir, `${sessionId}.meta.json`)
      fs.renameSync(jsonlSrc, jsonlDst)
      fs.renameSync(sidecarSrc, sidecarDst)

      // Nudge daemon to consume processing/ now.
      try {
        const pidFile = path.join(QUOTH_HOME, 'daemon.pid')
        if (fs.existsSync(pidFile)) {
          const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim())
          process.kill(pid, 'SIGUSR1')
        }
      } catch {}
    } catch {}
```

- [ ] **Step 5.4 — Verify handle() on hook-dispatch exports `session-end`**

```bash
cd quoth-plugin
node -e "const h = require('./hooks/hook-dispatch.js'); console.log(typeof h.handle)"
```

Expected: `function`.

If the module does not export `handle`, the existing shape is already a dispatcher — in which case the test harness above needs to invoke whichever API the module actually exposes. Confirm by reading `quoth-plugin/hooks/hook-dispatch.js` from the top (first 50 lines) and adjust the test's `hooks.handle(...)` call to match the real export name (e.g. `hooks.run('session-end')` or `hooks.dispatch('session-end')`). Do not invent new exports — use what's there.

- [ ] **Step 5.5 — Run the hook test and verify green**

```bash
cd quoth-plugin && npm test -- session-end-hook.test.js
```

Expected: 4/4 green.

- [ ] **Step 5.6 — Full suite**

```bash
cd quoth-plugin && npm test
```

Expected: all green.

- [ ] **Step 5.7 — Commit**

```bash
git add quoth-plugin/hooks/hook-dispatch.js quoth-plugin/tests/session-end-hook.test.js
git commit -m "$(cat <<'EOF'
feat(hooks): atomic handoff active/ → processing/ on session-end

session-end now writes the session_summary into the session's own
JSONL, flips the sidecar to status=terminated, then renames both
files into trajectories/processing/ via POSIX fs.renameSync — the
rename is the daemon's claim on the session. SIGUSR1 still nudges
the daemon to consume immediately.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §4.1, §6.2.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: EXTRACT schema extension — facts block + `parseExtractOutput`

**Files:**
- Modify: `quoth-plugin/daemon/pipeline/extract.js:80-118` (`buildSystemPrompt`)
- Modify: `quoth-plugin/daemon/pipeline/extract.js:150-165` (rename `parsePatterns` → `parseExtractOutput`, return `{session_type, patterns, facts}`)
- Modify: `quoth-plugin/daemon/pipeline/extract.js:425-428` (module exports)
- Modify: `quoth-plugin/daemon/pipeline/extract.js:382,395` (call sites that used `parsePatterns`)
- Test: `quoth-plugin/tests/extract.test.js` (extend — the file exists per the summary notes)
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §6.6

**Goal of the task:** Teach the EXTRACT model to emit a `facts: []` array alongside `patterns: []`, each fact carrying `{topic, statement, evidence, scope, tags}`. Parser accepts the extended schema, filters invalid entries, and returns `{session_type, patterns, facts}` so the daemon can fan out to `insertNewPattern` AND `insertNewFact` (Task 8). No DB writes in this task — this is pure plumbing.

**Commit prefix:** `feat(extract):`

- [ ] **Step 6.1 — Write failing unit test: parseExtractOutput returns facts**

Append to `quoth-plugin/tests/extract.test.js`:

```javascript
describe('parseExtractOutput — session_type + patterns + facts', () => {
  // Import lazily so we don't break the top-of-file imports.
  const { parseExtractOutput } = require('../daemon/pipeline/extract.js')

  it('parses the full schema', () => {
    const raw = JSON.stringify({
      session_type: 'productive',
      patterns: [
        { condition: 'When you need a fresh pattern', action: 'Do the smallest valid thing that could possibly work', tags: ['process'], quality_signal: 'universal' }
      ],
      facts: [
        {
          topic: 'build command',
          statement: 'The project builds with `pnpm -C quoth-plugin test`.',
          evidence: 'Ran it in the session and it exited 0.',
          scope: 'project',
          tags: ['build', 'pnpm']
        }
      ]
    })
    const out = parseExtractOutput(raw)
    expect(out.session_type).toBe('productive')
    expect(out.patterns).toHaveLength(1)
    expect(out.facts).toHaveLength(1)
    expect(out.facts[0].topic).toBe('build command')
  })

  it('drops facts with missing topic/statement/scope', () => {
    const raw = JSON.stringify({
      session_type: 'productive',
      patterns: [],
      facts: [
        { topic: 'x', statement: 'y' }, // missing scope
        { statement: 'only has statement' },
        { topic: 'valid', statement: 'has all fields', scope: 'global', tags: [] }
      ]
    })
    const out = parseExtractOutput(raw)
    expect(out.facts).toHaveLength(1)
    expect(out.facts[0].topic).toBe('valid')
  })

  it('rejects scope values outside {global, project} — "user" is NOT allowed', () => {
    const raw = JSON.stringify({
      session_type: 'productive', patterns: [],
      facts: [
        { topic: 'bad-scope', statement: 'scope is invalid', scope: 'wtf' },
        { topic: 'also-bad', statement: 'user is not a valid scope per spec §6.6', scope: 'user' },
        { topic: 'good-scope', statement: 'scope is fine', scope: 'project' },
      ]
    })
    const out = parseExtractOutput(raw)
    expect(out.facts).toHaveLength(1)
    expect(out.facts[0].topic).toBe('good-scope')
  })

  it('clamps statement length to 500 chars', () => {
    const long = 'x'.repeat(700)
    const raw = JSON.stringify({
      session_type: 'productive', patterns: [],
      facts: [{ topic: 't', statement: long, scope: 'project' }]
    })
    const out = parseExtractOutput(raw)
    expect(out.facts).toHaveLength(1)
    expect(out.facts[0].statement.length).toBe(500)
  })

  it('clamps tags array to max 5 entries', () => {
    const raw = JSON.stringify({
      session_type: 'productive', patterns: [],
      facts: [{ topic: 't', statement: 's', scope: 'project', tags: ['a','b','c','d','e','f','g'] }]
    })
    const out = parseExtractOutput(raw)
    expect(out.facts[0].tags).toHaveLength(5)
  })

  it('routine sessions still return empty patterns AND empty facts', () => {
    const raw = JSON.stringify({ session_type: 'routine', patterns: [], facts: [] })
    const out = parseExtractOutput(raw)
    expect(out.session_type).toBe('routine')
    expect(out.patterns).toEqual([])
    expect(out.facts).toEqual([])
  })

  it('tolerates missing facts key (backward compat)', () => {
    const raw = JSON.stringify({
      session_type: 'productive',
      patterns: [{ condition: 'When X happens', action: 'Do Y in the correct sequence of operations', tags: [], quality_signal: 'project' }]
    })
    const out = parseExtractOutput(raw)
    expect(out.patterns).toHaveLength(1)
    expect(out.facts).toEqual([])
  })
})
```

- [ ] **Step 6.2 — Run the test and watch it fail**

```bash
cd quoth-plugin && npm test -- extract.test.js -t parseExtractOutput
```

Expected: test suite errors out importing `parseExtractOutput` (not yet exported). Good.

- [ ] **Step 6.3 — Extend `buildSystemPrompt()` to teach the model about facts**

In `quoth-plugin/daemon/pipeline/extract.js`, replace lines 80-118 (the entire `buildSystemPrompt` function) with:

```javascript
function buildSystemPrompt() {
  return `You are a session analyzer. You have tools to read files and search the codebase. You produce two things from a session: PATTERNS (reusable techniques) and FACTS (stable, session-independent knowledge).

DECIDE FIRST: Was this session productive or routine?
- productive: the agent accomplished something non-trivial, learned, fixed a bug, shipped code, established a fact, or made a decision
- routine: the agent just read files, ran standard tests, asked questions — nothing worth remembering

For routine sessions, return { "session_type": "routine", "patterns": [], "facts": [] }.

For productive sessions, extract BOTH patterns and facts.

PATTERN EXTRACTION RULES:
1. A pattern has { condition, action, tags, quality_signal }
   - condition (>= 10 chars): WHEN to apply this pattern — the trigger/situation
   - action (20-500 chars): WHAT to do — the reusable technique/workflow
   - tags: max 5 short domain tags
   - quality_signal: one of "universal", "domain", "project", "edge_case"
2. GOOD PATTERNS:
   - condition: "When refactoring across multiple files in a monorepo"
     action: "Read all target files in parallel before batch-editing to ensure consistency and catch cross-file dependencies before committing"
   - condition: "When debugging intermittent test failures"
     action: "Isolate the failing test with .only, then add verbose logging to setup/teardown hooks to identify timing or state issues"
3. BAD PATTERNS (do NOT extract these):
   - "Read file then edit it" (obvious)
   - "Run npm test after changes" (standard practice)
   - "Use git commit to save changes" (trivial)

FACT EXTRACTION RULES:
1. A fact is a stable piece of knowledge that is true INDEPENDENT of this particular session — it is something someone would want to know next week.
2. A fact has { topic, statement, evidence, scope, tags }
   - topic (<= 120 chars): short slug-like key e.g. "build command", "auth flow", "db primary key"
   - statement (<= 500 chars): the fact itself, in one or two sentences
   - evidence (<= 300 chars, optional): how we know — file path, command output, url, commit, etc
   - scope: one of "global" (true across all projects) or "project" (true for this project). These are the ONLY two allowed scopes. Do NOT use "user" or anything else.
   - tags: max 5 short tags
3. GOOD FACTS:
   - { topic: "build command", statement: "The plugin builds with \`pnpm -C quoth-plugin test\`", evidence: "package.json scripts", scope: "project", tags: ["build","pnpm"] }
   - { topic: "atomic rename on POSIX", statement: "fs.renameSync is atomic inside the same filesystem on POSIX, which is what makes the active→processing handoff race-free", scope: "global", tags: ["posix","fs"] }
   - { topic: "db primary key", statement: "The sessions table uses a compound (session_id, epoch) primary key", evidence: "daemon/db.js", scope: "project", tags: ["db","schema"] }
4. BAD FACTS (do NOT extract these):
   - Anything that's just THIS session's state (e.g. "we just edited foo.ts")
   - Anything that's obviously true (e.g. "Node.js has a fs module")
   - Anything about the human operator (preferences, role, language) — that is NOT in scope for facts
   - Repetition of the exact same topic multiple times — pick the most complete phrasing

Use your tools to inspect files if you need more context. Then respond with JSON:

{
  "session_type": "productive" | "routine",
  "patterns": [
    { "condition": "...", "action": "...", "tags": ["..."], "quality_signal": "universal" | "domain" | "project" | "edge_case" }
  ],
  "facts": [
    { "topic": "...", "statement": "...", "evidence": "...", "scope": "global" | "project", "tags": ["..."] }
  ]
}

If routine, return { "session_type": "routine", "patterns": [], "facts": [] }.`
}
```

- [ ] **Step 6.4 — Replace `parsePatterns` with `parseExtractOutput`**

In the same file, replace lines 150-165 (the `parsePatterns` function) with:

```javascript
// --- Extract output parser ---

// Spec §6.6: only "global" and "project" are allowed. "user" is explicitly
// NOT a valid fact scope — facts about the human operator are out of scope.
const ALLOWED_SCOPES = new Set(['global', 'project'])

function parseExtractOutput(raw) {
  const parsed = parseJson(raw)

  const session_type = parsed.session_type === 'productive' ? 'productive' : 'routine'
  if (session_type === 'routine') {
    return { session_type, patterns: [], facts: [] }
  }

  const rawPatterns = Array.isArray(parsed.patterns) ? parsed.patterns : []
  const patterns = rawPatterns.filter(p => {
    if (!p.condition || typeof p.condition !== 'string' || p.condition.length < 10) return false
    if (!p.action || typeof p.action !== 'string' || p.action.length < 20 || p.action.length > 500) return false
    return true
  })

  const rawFacts = Array.isArray(parsed.facts) ? parsed.facts : []
  const facts = rawFacts
    .filter(f => {
      if (!f.topic || typeof f.topic !== 'string' || f.topic.trim().length === 0) return false
      if (!f.statement || typeof f.statement !== 'string' || f.statement.trim().length === 0) return false
      if (!f.scope || !ALLOWED_SCOPES.has(f.scope)) return false
      return true
    })
    .map(f => ({
      topic: f.topic.trim().slice(0, 120),
      statement: f.statement.trim().slice(0, 500),
      evidence: typeof f.evidence === 'string' ? f.evidence.trim().slice(0, 300) : null,
      scope: f.scope,
      tags: Array.isArray(f.tags) ? f.tags.slice(0, 5) : [],
    }))

  return { session_type, patterns, facts }
}

// Back-compat shim so any existing direct caller still works until Task 8
// rewires everything via parseExtractOutput. NOTE: this just returns the
// patterns array from the new parser.
function parsePatterns(raw) {
  return parseExtractOutput(raw).patterns
}
```

- [ ] **Step 6.5 — Update call site in `extract()`**

Still in `extract.js`, find the line (around line 382) that reads:

```javascript
    validPatterns = parsePatterns(rawOutput)
```

Replace it with:

```javascript
    const parsed = parseExtractOutput(rawOutput)
    validPatterns = parsed.patterns
    // Attach facts onto the result so the caller can consume them.
    // We return from the outer function below — remember them here.
    extractedFacts = parsed.facts
```

And at the top of the `extract()` function (just after the `let rawOutput` line around line 190), add:

```javascript
  let extractedFacts = []
```

And change the final `return validPatterns.map(...)` block near lines 414-422 so the function returns `{patterns, facts}` instead of a raw patterns array. Replace:

```javascript
  return validPatterns.map((p, i) => ({
    id: makeId(p.condition + p.action),
    condition: p.condition,
    action: p.action,
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 5) : [],
    quality_signal: QUALITY_MAP[p.quality_signal] ? p.quality_signal : 'project',
    embedding: embeddings[i],
    source: 'distilled',
  }))
}
```

With:

```javascript
  const patterns = validPatterns.map((p, i) => ({
    id: makeId(p.condition + p.action),
    condition: p.condition,
    action: p.action,
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 5) : [],
    quality_signal: QUALITY_MAP[p.quality_signal] ? p.quality_signal : 'project',
    embedding: embeddings[i],
    source: 'distilled',
  }))

  return { patterns, facts: extractedFacts }
}
```

And at each early-return inside `extract()` that currently returns `[]` (lines ~375, 392, 395), replace `return []` with `return { patterns: [], facts: [] }`.

- [ ] **Step 6.6 — Update the module exports**

Replace lines 425-428 (`module.exports = { extract, makeId, ... }`) with:

```javascript
module.exports = {
  extract, makeId, buildSystemPrompt, buildUserPrompt, parseJson,
  parseExtractOutput, parsePatterns, // parsePatterns kept for back-compat
  QUALITY_MAP, QUALITY_PRIORS, TOOL_DEFINITIONS, _resetJsonModeCache,
}
```

- [ ] **Step 6.7 — Update the daemon call site in `processSessionLocal`**

`quoth-plugin/daemon/daemon.js` around lines 402-406 currently has:

```javascript
async function processSessionLocal(summaryEntry, toolEntries) {
  const result = await extract(summaryEntry, toolEntries, db)
  // extract() returns flat array (unlike distillBatch which returns {patterns, usage})
  return Array.isArray(result) ? result : []
}
```

Replace with (the surrounding caller will be rewired in Task 8, so for now just preserve the old contract of returning patterns only):

```javascript
async function processSessionLocal(summaryEntry, toolEntries) {
  const result = await extract(summaryEntry, toolEntries, db)
  // Back-compat shim: older callers expect an array of patterns.
  // Task 8 will consume the full { patterns, facts } object.
  if (Array.isArray(result)) return result
  if (result && Array.isArray(result.patterns)) return result.patterns
  return []
}
```

- [ ] **Step 6.8 — Run the extract test and verify green**

```bash
cd quoth-plugin && npm test -- extract.test.js
```

Expected: both the new `parseExtractOutput` describe block AND any pre-existing `parsePatterns` tests pass (back-compat shim keeps them alive).

- [ ] **Step 6.9 — Full suite**

```bash
cd quoth-plugin && npm test
```

Expected: all green.

- [ ] **Step 6.10 — Commit**

```bash
git add quoth-plugin/daemon/pipeline/extract.js quoth-plugin/daemon/daemon.js quoth-plugin/tests/extract.test.js
git commit -m "$(cat <<'EOF'
feat(extract): extend schema with facts[] + parseExtractOutput

EXTRACT now produces both reusable patterns and stable facts, the
latter scoped to global|project. The new parseExtractOutput returns
{ session_type, patterns, facts }; parsePatterns is kept as a thin
shim so the rest of the daemon compiles unchanged. Facts are
validated and length-clamped; invalid scopes or empty topics drop
silently.

No DB writes yet — Task 8 wires the facts into memory_entries.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §6.6.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Kimi K2.5 token limit bump (100K → 200K input, 16K → 32K output)

**Files:**
- Modify: `quoth-plugin/daemon/pipeline/extract.js:219` (`totalTokens >= 100_000` → `>= 200_000`)
- Modify: `quoth-plugin/daemon/pipeline/extract.js:223` (`maxTokens: 16384` → `32768`)
- Modify: `quoth-plugin/daemon/lib/llm.js:190` (`maxTokens = 16384` → `maxTokens = 32768`)
- Test: `quoth-plugin/tests/extract.test.js` (extend — one assertion)
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §6.8

**Goal of the task:** Give the multi-turn EXTRACT loop room to breathe on long sessions. Kimi K2.5 advertises 256K context — we were capping at 100K cumulative prompt tokens and 16K output tokens, which was artificially strangling long sessions. Move to 200K cumulative / 32K output. Single-line edits, but important to test.

**Commit prefix:** `feat(extract):`

- [ ] **Step 7.1 — Write a failing test that captures the new cap**

Append to `quoth-plugin/tests/extract.test.js`:

```javascript
describe('extract — token caps', () => {
  it('passes maxTokens=32768 to callMoonshotWithTools on first call', async () => {
    const extractMod = require('../daemon/pipeline/extract.js')

    const captured = []
    const fakeDeps = {
      callMoonshotWithTools: async (_messages, opts) => {
        captured.push(opts)
        // End the loop immediately with a routine session response.
        return {
          content: JSON.stringify({ session_type: 'routine', patterns: [], facts: [] }),
          message: { content: JSON.stringify({ session_type: 'routine', patterns: [], facts: [] }) },
          tool_calls: [],
          usage: { prompt_tokens: 500, completion_tokens: 20 },
        }
      },
      executeToolCall: () => ({ output: 'unused' }),
      resolveProjectRoot: () => '/tmp',
      sanitize: (x) => x,
      generateEmbeddingBatch: async (texts) => texts.map(() => [0]),
    }

    // Minimal stub DB — extract only calls db.insertPipelineError on failure.
    const db = { insertPipelineError: () => {} }

    const summaryEntry = { session: 's1', project: 'quoth', outcome: 'success', success_rate: 1, total_calls: 1, user_intents: [] }
    const toolEntries = [{ tool: 'Bash', task: 'ls', outcome: 'success', timestamp: Date.now() }]

    await extractMod.extract(summaryEntry, toolEntries, db, fakeDeps)

    expect(captured.length).toBeGreaterThanOrEqual(1)
    expect(captured[0].maxTokens).toBe(32768)
  })
})
```

- [ ] **Step 7.2 — Run the test and watch it fail**

```bash
cd quoth-plugin && npm test -- extract.test.js -t "maxTokens=32768"
```

Expected: fail with `expected 16384 to be 32768`.

- [ ] **Step 7.3 — Bump the cap in `extract.js`**

In `quoth-plugin/daemon/pipeline/extract.js` around line 219, find:

```javascript
      const forceNoTools = toolBudget <= 0 || totalTokens >= 100_000
```

Replace with:

```javascript
      const forceNoTools = toolBudget <= 0 || totalTokens >= 200_000
```

And around line 223, find:

```javascript
        maxTokens: 16384,
```

Replace with:

```javascript
        maxTokens: 32768,
```

Also update the comment block near line 213-215 to reflect the new numbers:

```javascript
    // Moonshot's usage.prompt_tokens is cumulative-per-turn (includes full
    // conversation history). We overwrite totalTokens each iteration rather
    // than summing, to avoid artificially tripping the 200K cap. Kimi K2.5
    // advertises 256K context — we leave ~56K slack for output + overhead.
    let totalTokens = 0
```

- [ ] **Step 7.4 — Bump the default in `llm.js`**

In `quoth-plugin/daemon/lib/llm.js` around line 190, find:

```javascript
async function callMoonshotWithTools(messages, {
  tools = [],
  tool_choice = 'auto',
  maxTokens = 16384,
```

Replace with:

```javascript
async function callMoonshotWithTools(messages, {
  tools = [],
  tool_choice = 'auto',
  maxTokens = 32768,
```

- [ ] **Step 7.5 — Run the targeted test, then the full suite**

```bash
cd quoth-plugin && npm test -- extract.test.js -t "maxTokens=32768"
cd quoth-plugin && npm test
```

Expected: targeted test green, full suite green.

- [ ] **Step 7.6 — Commit**

```bash
git add quoth-plugin/daemon/pipeline/extract.js quoth-plugin/daemon/lib/llm.js quoth-plugin/tests/extract.test.js
git commit -m "$(cat <<'EOF'
feat(extract): bump Kimi K2.5 caps to 200K input / 32K output

Long sessions were hitting the artificial 100K cumulative-prompt and
16K output-token caps before the tool loop finished. Kimi K2.5 has a
256K context window; 200K leaves enough slack for the final response
without starving long multi-turn conversations.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §6.8.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `processSessionFile` loop + `moveTo*` helpers + `insertNewFact`

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js:150-162` (replace `watchTrajectories` → watch only `processing/`)
- Modify: `quoth-plugin/daemon/daemon.js:165-193` (replace `scanAndEnqueue` → scan `processing/`)
- Modify: `quoth-plugin/daemon/daemon.js:196-220` (replace `processQueue` → direct per-file path)
- Modify: `quoth-plugin/daemon/daemon.js:287-350` (replace `processSessionBatch` → `processSessionFile`)
- Modify: `quoth-plugin/daemon/daemon.js:402-406` (`processSessionLocal` — now returns full `{patterns, facts}`)
- Test: `quoth-plugin/tests/daemon-process-session.test.js` (create)
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §6.3

**Goal of the task:** The daemon's main loop is rewritten around the new file layout. `watchTrajectories()` watches only `processing/`. For each file there, the daemon: (a) parses the whole JSONL, (b) calls `extract()`, (c) maps facts into `memory_entries` via a new `insertNewFact(db, fact)` helper, (d) sets sidecar `status` to one of `done|routine|empty|error` based on the LLM's `session_type` + presence of patterns/facts, (e) calls `moveToDone|Routine|Empty|Error` from `sessions.js` to archive the file and sidecar. This task does NOT yet add the epoch suffix logic (Task 9) or touch the stale detector (Task 10).

**Commit prefix:** `feat(daemon):`

- [ ] **Step 8.1 — Write failing test: processSessionFile moves terminated session to done/**

Create `quoth-plugin/tests/daemon-process-session.test.js`:

```javascript
const { describe, it, expect, beforeEach, afterEach, vi } = require('vitest')
const fs = require('fs')
const path = require('path')
const os = require('os')

// We import daemon pieces lazily with a stub extract function so we don't
// trigger real Moonshot calls.

function setupHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-daemon-test-'))
  fs.mkdirSync(path.join(tmp, 'trajectories', 'active'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'trajectories', 'processing'), { recursive: true })
  return tmp
}

function seedProcessing(home, sid, entries, summary) {
  const dir = path.join(home, 'trajectories', 'processing')
  const jsonl = path.join(dir, `${sid}.jsonl`)
  const meta = path.join(dir, `${sid}.meta.json`)
  const lines = entries.map(e => JSON.stringify(e))
  if (summary) lines.push(JSON.stringify(summary))
  fs.writeFileSync(jsonl, lines.join('\n') + '\n')
  fs.writeFileSync(meta, JSON.stringify({
    session_id: sid, project: 'quoth', status: 'terminated',
    first_seen_ts: Date.now() - 60_000, last_seen_ts: Date.now(),
    tool_count: entries.length, closed_marker: !!summary,
  }))
  return { jsonl, meta }
}

describe('processSessionFile — core dispatch', () => {
  let home
  beforeEach(() => { home = setupHome() })
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} })

  it('moves productive session with patterns to done/YYYY-MM-DD/<project>/', async () => {
    const sid = 'sess-productive-1'
    const summary = { event: 'session_summary', session: sid, project: 'quoth', total_calls: 5, tool_counts: { Bash: 5 }, success_rate: 1, outcome: 'success', timestamp: Date.now() }
    seedProcessing(home, sid, [
      { event: 'tool_use', session: sid, tool: 'Bash', outcome: 'success', task: 'ls' },
    ], summary)

    process.env.QUOTH_HOME = home
    const { processSessionFile } = require('../daemon/daemon-core.js')

    const fakeExtract = async () => ({
      patterns: [{ id: 'p1', condition: 'when X', action: 'do the specific Y that works every time', tags: [], quality_signal: 'project', embedding: null, source: 'distilled' }],
      facts: [],
    })
    const fakeDb = {
      insertNewPattern: vi.fn(),
      insertNewFact: vi.fn(),
      getSessionsByIds: () => [],
    }

    await processSessionFile({
      sessionFile: path.join(home, 'trajectories', 'processing', `${sid}.jsonl`),
      db: fakeDb,
      extractFn: fakeExtract,
    })

    const today = new Date().toISOString().slice(0, 10)
    const doneDir = path.join(home, 'trajectories', 'done', today, 'quoth')
    expect(fs.existsSync(path.join(doneDir, `${sid}.jsonl`))).toBe(true)
    expect(fs.existsSync(path.join(doneDir, `${sid}.meta.json`))).toBe(true)
    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', `${sid}.jsonl`))).toBe(false)
    expect(fakeDb.insertNewPattern).toHaveBeenCalledTimes(1)
  })

  it('routine session (no patterns, no facts) → routine/', async () => {
    const sid = 'sess-routine-1'
    const summary = { event: 'session_summary', session: sid, project: 'quoth', total_calls: 2, tool_counts: { Read: 2 }, success_rate: 1, outcome: 'success', timestamp: Date.now() }
    seedProcessing(home, sid, [
      { event: 'tool_use', session: sid, tool: 'Read', outcome: 'success', task: 'README' },
    ], summary)

    process.env.QUOTH_HOME = home
    const { processSessionFile } = require('../daemon/daemon-core.js')

    const fakeExtract = async () => ({ session_type: 'productive', patterns: [], facts: [] })
    const fakeDb = { insertNewPattern: vi.fn(), insertNewFact: vi.fn() }

    await processSessionFile({
      sessionFile: path.join(home, 'trajectories', 'processing', `${sid}.jsonl`),
      db: fakeDb,
      extractFn: fakeExtract,
    })

    // Even though LLM said "productive", the extractor produced no patterns
    // and no facts — routing to routine/ per the heuristic fallback in
    // daemon-core.js (extractorProducedNothing branch).
    const routineDir = path.join(home, 'trajectories', 'routine')
    const files = fs.readdirSync(routineDir)
    expect(files).toContain(`${sid}.jsonl`)
    expect(files).toContain(`${sid}.meta.json`)
  })

  it('LLM explicitly says session_type=routine → routine/ (spec §6.3 trust the verdict)', async () => {
    // Even with a single low-value pattern returned, the LLM's explicit
    // "routine" verdict routes the file to routine/. This is the
    // llmSaidRoutine branch in daemon-core.js.
    const sid = 'sess-routine-llm'
    const summary = { event: 'session_summary', session: sid, project: 'quoth', total_calls: 1, tool_counts: { Read: 1 }, success_rate: 1, outcome: 'success', timestamp: Date.now() }
    seedProcessing(home, sid, [
      { event: 'tool_use', session: sid, tool: 'Read', outcome: 'success', task: 'README' },
    ], summary)

    process.env.QUOTH_HOME = home
    const { processSessionFile } = require('../daemon/daemon-core.js')

    const fakeExtract = async () => ({
      session_type: 'routine',
      patterns: [{ id: 'leak', condition: 'leak condition hi', action: 'leak action text long enough to pass the 20 char filter' }],
      facts: [],
    })
    const fakeDb = { insertNewPattern: vi.fn(), insertNewFact: vi.fn() }

    await processSessionFile({
      sessionFile: path.join(home, 'trajectories', 'processing', `${sid}.jsonl`),
      db: fakeDb,
      extractFn: fakeExtract,
    })

    const routineDir = path.join(home, 'trajectories', 'routine')
    expect(fs.readdirSync(routineDir)).toContain(`${sid}.jsonl`)
    // The bucket is the only gate — inserts are orthogonal (not tested here).
  })

  it('empty session (no tool_use entries at all) → empty/', async () => {
    const sid = 'sess-empty-1'
    seedProcessing(home, sid, [], null)

    process.env.QUOTH_HOME = home
    const { processSessionFile } = require('../daemon/daemon-core.js')

    const fakeExtract = async () => { throw new Error('should not be called for empty session') }
    const fakeDb = { insertNewPattern: vi.fn(), insertNewFact: vi.fn() }

    await processSessionFile({
      sessionFile: path.join(home, 'trajectories', 'processing', `${sid}.jsonl`),
      db: fakeDb,
      extractFn: fakeExtract,
    })

    const emptyDir = path.join(home, 'trajectories', 'empty')
    expect(fs.readdirSync(emptyDir)).toContain(`${sid}.jsonl`)
  })

  it('extract failure → error/', async () => {
    const sid = 'sess-err-1'
    const summary = { event: 'session_summary', session: sid, project: 'quoth', total_calls: 1, tool_counts: {}, success_rate: 0, outcome: 'failure', timestamp: Date.now() }
    seedProcessing(home, sid, [
      { event: 'tool_use', session: sid, tool: 'Bash', outcome: 'failure', task: 'boom' },
    ], summary)

    process.env.QUOTH_HOME = home
    const { processSessionFile } = require('../daemon/daemon-core.js')

    const fakeExtract = async () => { throw new Error('Moonshot exploded') }
    const fakeDb = { insertNewPattern: vi.fn(), insertNewFact: vi.fn(), insertPipelineError: vi.fn() }

    await processSessionFile({
      sessionFile: path.join(home, 'trajectories', 'processing', `${sid}.jsonl`),
      db: fakeDb,
      extractFn: fakeExtract,
    })

    const errorDir = path.join(home, 'trajectories', 'error')
    expect(fs.readdirSync(errorDir)).toContain(`${sid}.jsonl`)
  })

  it('inserts each fact via db.insertNewFact', async () => {
    const sid = 'sess-facts-1'
    const summary = { event: 'session_summary', session: sid, project: 'quoth', total_calls: 1, tool_counts: { Bash: 1 }, success_rate: 1, outcome: 'success', timestamp: Date.now() }
    seedProcessing(home, sid, [
      { event: 'tool_use', session: sid, tool: 'Bash', outcome: 'success', task: 'ls' },
    ], summary)

    process.env.QUOTH_HOME = home
    const { processSessionFile } = require('../daemon/daemon-core.js')

    const fakeExtract = async () => ({
      session_type: 'productive',
      patterns: [],
      facts: [
        { topic: 'build cmd', statement: 'pnpm -C quoth-plugin test', scope: 'project', tags: ['build'] },
        { topic: 'atomic rename', statement: 'fs.renameSync is atomic within the same filesystem on POSIX', scope: 'global', tags: ['posix'] },
      ],
    })
    const calls = []
    const fakeDb = {
      insertNewPattern: vi.fn(),
      insertNewFact: vi.fn((fact, meta) => { calls.push({ fact, meta }) }),
    }

    await processSessionFile({
      sessionFile: path.join(home, 'trajectories', 'processing', `${sid}.jsonl`),
      db: fakeDb,
      extractFn: fakeExtract,
    })

    expect(calls.length).toBe(2)
    expect(calls[0].fact.topic).toBe('build cmd')
    expect(calls[0].fact.scope).toBe('project')
    expect(calls[1].fact.scope).toBe('global')
    expect(calls[0].meta.project).toBe('quoth')
    expect(calls[0].meta.session_id).toBe(sid)
  })
})
```

- [ ] **Step 8.2 — Run the test and watch it fail**

```bash
cd quoth-plugin && npm test -- daemon-process-session.test.js
```

Expected: fails because `daemon-core.js` does not exist yet and `processSessionFile` is not exported.

- [ ] **Step 8.3 — Extract core logic to `daemon-core.js` for testability**

Rather than requiring the whole `daemon.js` (which launches timers, signal handlers, and a listener), extract the pure orchestration logic into a new file `quoth-plugin/daemon/daemon-core.js`:

```javascript
'use strict'

const fs = require('fs')
const path = require('path')
const {
  readAllEntries,
  synthesizeSummaryFromEntries,
  moveSessionFile,
  readSidecar,
  updateSidecar,
} = require('./lib/sessions.js')

/**
 * Process a single session file from trajectories/processing/.
 *
 * Pure orchestration — no timers, no signals, no daemon lifecycle. This
 * function is unit-testable with fake db + fake extract.
 *
 * Contract:
 *   1. Read all entries + sidecar.
 *   2. If the file has zero tool_use entries → move to empty/.
 *   3. Ensure a session_summary exists (synthesize if missing).
 *   4. Call extractFn(summary, toolEntries, db) → { patterns, facts }.
 *   5. Insert patterns via db.insertNewPattern, facts via db.insertNewFact.
 *   6. Flip sidecar.status + move file to done|routine based on output.
 *   7. On any throw → log + move to error/.
 */
async function processSessionFile({ sessionFile, db, extractFn, log = noopLog }) {
  const sid = path.basename(sessionFile, '.jsonl')

  let entries
  try {
    entries = readAllEntries(sessionFile)
  } catch (err) {
    log('error', 'read_entries_failed', { sid, error: err.message })
    try { await moveSessionFile(sessionFile, 'error') } catch {}
    return
  }

  const toolEntries = entries.filter(e => e && e.event === 'tool_use')
  let summary = entries.find(e => e && e.event === 'session_summary') || null

  // Empty session: no tool_use entries at all → empty/, do not call extract.
  if (toolEntries.length === 0) {
    await updateSidecarSafe(sessionFile, { status: 'empty' })
    await moveSessionFile(sessionFile, 'empty')
    return
  }

  // Synthesize a minimal summary if none exists (e.g. synthetic stale path).
  if (!summary) {
    summary = synthesizeSummaryFromEntries(toolEntries, { session: sid })
  }

  let result
  try {
    result = await extractFn(summary, toolEntries, db)
  } catch (err) {
    log('error', 'extract_failed', { sid, error: err.message })
    try {
      if (typeof db.insertPipelineError === 'function') {
        db.insertPipelineError({
          stage: 'extract',
          error_message: err.message,
          context: JSON.stringify({ session_id: sid, entry_count: toolEntries.length }),
        })
      }
    } catch {}
    await updateSidecarSafe(sessionFile, { status: 'error' })
    await moveSessionFile(sessionFile, 'error')
    return
  }

  const patterns = Array.isArray(result?.patterns) ? result.patterns : []
  const facts = Array.isArray(result?.facts) ? result.facts : []

  // Spec §6.3: trust the LLM's explicit `session_type` when present. Only
  // fall back to the pattern/fact presence heuristic when the LLM omitted
  // the field. A session is "routine" if EITHER the LLM says so OR the
  // extractor returned no patterns AND no facts.
  const llmSaidRoutine = result?.session_type === 'routine'
  const extractorProducedNothing = patterns.length === 0 && facts.length === 0
  const sessionType = (llmSaidRoutine || extractorProducedNothing) ? 'routine' : 'productive'

  // Insert patterns.
  for (const p of patterns) {
    try { db.insertNewPattern(p, summary, summary.project || 'default') }
    catch (err) { log('error', 'insert_pattern_failed', { sid, error: err.message }) }
  }

  // Insert facts (facts attribution carries project + session).
  const factMeta = {
    project: summary.project || 'default',
    session_id: sid,
  }
  for (const f of facts) {
    try { db.insertNewFact(f, factMeta) }
    catch (err) { log('error', 'insert_fact_failed', { sid, error: err.message }) }
  }

  // Flip sidecar status and archive.
  const bucket = sessionType === 'productive' ? 'done' : 'routine'
  await updateSidecarSafe(sessionFile, {
    status: sessionType === 'productive' ? 'done' : 'routine',
    session_type: sessionType,
    pattern_count: patterns.length,
    fact_count: facts.length,
  })
  await moveSessionFile(sessionFile, bucket, { project: summary.project || 'default' })
}

function noopLog() {}

async function updateSidecarSafe(jsonlPath, patch) {
  try {
    const sidecar = jsonlPath.replace(/\.jsonl$/, '.meta.json')
    updateSidecar(sidecar, patch)
  } catch {}
}

module.exports = { processSessionFile }
```

- [ ] **Step 8.4 — Add `insertNewFact` helper to `db.js`**

In `quoth-plugin/daemon/db.js`, after the `upsertMemoryEntry` helper created in Task 2, add:

```javascript
  /**
   * Insert or upsert a fact extracted from a session.
   * The fact schema has already been validated by parseExtractOutput.
   * Maps scope → namespace per spec §6.6:
   *   - 'global'  → 'facts:global'
   *   - 'project' → 'facts:proj:<project>'
   *
   * (There is NO user scope. Facts about the human operator are out of
   *  scope by spec and would have been rejected by parseExtractOutput.)
   *
   * Returns the inserted memory_entries row.
   */
  function insertNewFact(fact, { project, session_id }) {
    const namespace = factNamespace(fact.scope, project)
    const content = JSON.stringify({
      statement: fact.statement,
      evidence: fact.evidence || null,
      tags: fact.tags || [],
      source_session: session_id || null,
      extracted_at: Date.now(),
    })
    return upsertMemoryEntry({
      namespace,
      key: fact.topic,
      content,
      type: 'fact',
      tags: fact.tags || [],
    })
  }

  function factNamespace(scope, project) {
    if (scope === 'global') return 'facts:global'
    // default: project — this is the only other valid scope per spec §6.6.
    return `facts:proj:${project || 'default'}`
  }
```

And extend the `return` statement at the bottom of `createDb` (the object returned just before `module.exports = { createDb }`) to include the new helpers:

```javascript
    insertNewFact,
    factNamespace,
```

- [ ] **Step 8.5 — Write unit test for `insertNewFact`**

Append to `quoth-plugin/tests/sessions-helpers.test.js`:

```javascript
describe('insertNewFact — scope → namespace mapping', () => {
  const Database = require('better-sqlite3')
  const { createDb } = require('../daemon/db.js')

  let db
  beforeEach(() => {
    db = createDb(new Database(':memory:'))
  })

  it('maps scope=global → facts:global', () => {
    db.insertNewFact(
      { topic: 't1', statement: 's1', scope: 'global', tags: [] },
      { project: 'quoth', session_id: 'x' }
    )
    const rows = db.listFactsByNamespace('facts:global')
    expect(rows.length).toBe(1)
    expect(rows[0].key).toBe('t1')
  })

  it('maps scope=project → facts:proj:<project>', () => {
    db.insertNewFact(
      { topic: 't2', statement: 's2', scope: 'project', tags: [] },
      { project: 'quoth', session_id: 'x' }
    )
    const rows = db.listFactsByNamespace('facts:proj:quoth')
    expect(rows.length).toBe(1)
  })

  it('unknown scope defaults to project namespace (defensive)', () => {
    // Normally parseExtractOutput rejects anything outside {global, project},
    // but insertNewFact is defensive: any unrecognized scope falls through to
    // the project bucket rather than silently losing the fact. This guards
    // against future schema drift or direct callers bypassing the parser.
    db.insertNewFact(
      { topic: 't3', statement: 's3', scope: 'something-else', tags: [] },
      { project: 'quoth', session_id: 'x' }
    )
    const rows = db.listFactsByNamespace('facts:proj:quoth')
    expect(rows.length).toBe(1)
    expect(rows[0].key).toBe('t3')
  })

  it('upserts on duplicate (namespace,key) — new statement replaces old', () => {
    db.insertNewFact({ topic: 't4', statement: 'v1', scope: 'project', tags: [] }, { project: 'quoth', session_id: 'a' })
    db.insertNewFact({ topic: 't4', statement: 'v2', scope: 'project', tags: [] }, { project: 'quoth', session_id: 'b' })
    const rows = db.listFactsByNamespace('facts:proj:quoth')
    expect(rows.length).toBe(1)
    expect(JSON.parse(rows[0].content).statement).toBe('v2')
  })
})
```

- [ ] **Step 8.6 — Run both test files and verify green**

```bash
cd quoth-plugin && npm test -- sessions-helpers.test.js
cd quoth-plugin && npm test -- daemon-process-session.test.js
```

Expected: both green.

- [ ] **Step 8.7 — Wire the new core into daemon.js's live watcher**

In `quoth-plugin/daemon/daemon.js`, replace the old `watchTrajectories()` function (lines 150-162) with:

```javascript
function watchTrajectories() {
  const processingDir = path.join(TRAJECTORIES_DIR, 'processing')
  fs.mkdirSync(processingDir, { recursive: true })

  log('info', 'Watching trajectories/processing/ for session handoffs', { dir: processingDir })
  try {
    fs.watch(processingDir, { persistent: true }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.jsonl')) return
      const fullPath = path.join(processingDir, filename)
      // Debounce — schedule a tick so any paired rename of the sidecar lands first.
      setTimeout(() => { enqueueSessionFile(fullPath) }, 50)
    })
  } catch (err) {
    log('error', 'fs.watch on processing/ failed', { error: err.message })
  }

  // Initial scan: anything left behind from a previous daemon run.
  scanProcessingDir()
}

function scanProcessingDir() {
  const processingDir = path.join(TRAJECTORIES_DIR, 'processing')
  try {
    const files = fs.readdirSync(processingDir).filter(f => f.endsWith('.jsonl'))
    for (const f of files) enqueueSessionFile(path.join(processingDir, f))
  } catch (err) {
    log('error', 'initial scan of processing/ failed', { error: err.message })
  }
}
```

Replace the old `scanAndEnqueue()` (lines 165-193) and `processQueue()` (lines 196-220) with a simple per-file enqueue + serial worker:

```javascript
const _sessionQueue = []
let _workerBusy = false

function enqueueSessionFile(fullPath) {
  // Dedup against current queue.
  if (_sessionQueue.includes(fullPath)) return
  // Skip if the file is already gone (race).
  if (!fs.existsSync(fullPath)) return
  _sessionQueue.push(fullPath)
  runWorker()
}

async function runWorker() {
  if (_workerBusy) return
  _workerBusy = true
  try {
    while (_sessionQueue.length > 0) {
      const file = _sessionQueue.shift()
      if (!fs.existsSync(file)) continue
      const { processSessionFile } = require('./daemon-core.js')
      const { extract } = require('./pipeline/extract.js')
      try {
        await processSessionFile({
          sessionFile: file,
          db,
          extractFn: (summary, toolEntries, db) => extract(summary, toolEntries, db),
          log,
        })
      } catch (err) {
        log('error', 'worker unexpected', { file, error: err.message })
      }
    }
  } finally {
    _workerBusy = false
  }
}
```

Also remove the old `processSessionBatch`, `processSessionManaged`, and `processSessionLocal` → keep them for now if they're referenced elsewhere in this same file (the replacement is a drop-in shift to per-file), but mark them with a `// DEPRECATED: removed in Task 17` comment. Task 17 deletes the corpses.

**NOTE:** The existing `processSessionLocal` will be called by managed-mode code still; leave it stubbed returning `processSessionFile`-compatible output. The managed mode rewiring is Task 13 / 14.

- [ ] **Step 8.8 — Run the full suite**

```bash
cd quoth-plugin && npm test
```

Expected: green.

- [ ] **Step 8.9 — Commit**

```bash
git add quoth-plugin/daemon/daemon-core.js \
        quoth-plugin/daemon/daemon.js \
        quoth-plugin/daemon/db.js \
        quoth-plugin/tests/daemon-process-session.test.js \
        quoth-plugin/tests/sessions-helpers.test.js
git commit -m "$(cat <<'EOF'
feat(daemon): processSessionFile core + per-file watch loop + insertNewFact

daemon-core.js holds the pure orchestration logic: read the JSONL,
synthesize a summary if missing, call extract, insert patterns and
facts, flip sidecar status, archive via moveSessionFile. It's fully
unit-testable with fake db + fake extract.

The live watcher in daemon.js now watches trajectories/processing/
instead of the whole trajectories/ tree, and runs a single-worker
queue that processes one session at a time. Old batch functions are
left in place marked DEPRECATED; Task 17 will remove them.

Also adds db.insertNewFact — maps scope → namespace and upserts via
memory_entries so facts deduplicate on (namespace, topic).

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §6.3, §6.6, §6.7.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Epoch suffix at archive time for resume-after-rename

**Files:**
- Modify: `quoth-plugin/daemon/lib/sessions.js` (extend `moveSessionFile` with epoch-bump logic)
- Modify: `quoth-plugin/daemon/db.js` (`bumpSessionEpoch(session_id)` helper, building on the `sessions` table from Task 1)
- Modify: `quoth-plugin/daemon/daemon-core.js` (call `bumpSessionEpoch` before `moveSessionFile` when a collision is detected)
- Test: `quoth-plugin/tests/sessions-helpers.test.js` (extend — dedicated describe block)
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §6.3, §10.1 Risk 4

**Goal of the task:** Claude Code CAN resume a session ID after the old JSONL is already in `done/`. When that happens, the new session writes a fresh `active/<sid>.jsonl`, hits `session-end`, gets renamed to `processing/<sid>.jsonl`, and the daemon tries to move it to `done/<date>/<project>/<sid>.jsonl` — which already exists. The fix (per §10.1 Risk 4): on collision, bump the epoch in the `sessions` table and archive the new file as `<sid>-e{N}.jsonl`. The original entry keeps its plain `<sid>.jsonl` filename.

**Commit prefix:** `feat(daemon):`

- [ ] **Step 9.1 — Write failing test: collision in done/ bumps epoch**

Append to `quoth-plugin/tests/sessions-helpers.test.js`:

```javascript
describe('moveSessionFile — epoch collision handling', () => {
  const { moveSessionFile } = require('../daemon/lib/sessions.js')
  const Database = require('better-sqlite3')
  const { createDb } = require('../daemon/db.js')

  let tmp
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-epoch-test-')) })
  afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {} })

  function seedInProcessing(sid) {
    const proc = path.join(tmp, 'trajectories', 'processing')
    fs.mkdirSync(proc, { recursive: true })
    const jsonl = path.join(proc, `${sid}.jsonl`)
    const meta = path.join(proc, `${sid}.meta.json`)
    fs.writeFileSync(jsonl, JSON.stringify({ event: 'tool_use', session: sid, tool: 'Bash' }) + '\n')
    fs.writeFileSync(meta, JSON.stringify({ session_id: sid, project: 'quoth', status: 'terminated' }))
    return jsonl
  }

  it('first archive lands as <sid>.jsonl under done/<date>/<project>/', async () => {
    process.env.QUOTH_HOME = tmp
    const sid = 'sess-resume-1'
    const jsonl = seedInProcessing(sid)

    await moveSessionFile(jsonl, 'done', { project: 'quoth' })

    const today = new Date().toISOString().slice(0, 10)
    const dst = path.join(tmp, 'trajectories', 'done', today, 'quoth', `${sid}.jsonl`)
    expect(fs.existsSync(dst)).toBe(true)
  })

  it('second archive of the same sid lands as <sid>-e2.jsonl', async () => {
    process.env.QUOTH_HOME = tmp
    const sid = 'sess-resume-2'
    // First archive.
    let jsonl = seedInProcessing(sid)
    await moveSessionFile(jsonl, 'done', { project: 'quoth' })

    // Resume: a fresh file shows up with the same sid.
    jsonl = seedInProcessing(sid)

    // db-backed epoch counter:
    const db = createDb(new Database(path.join(tmp, 'epoch-test.db')))
    const nextEpoch = db.bumpSessionEpoch(sid)
    expect(nextEpoch).toBe(2)

    // Task 3's moveSessionFile treats `filenameOverride` as the FULL
    // filename including the `.jsonl` suffix (the sidecar path is derived
    // by swapping `.jsonl` → `.meta.json`). Callers must pass the suffix.
    await moveSessionFile(jsonl, 'done', { project: 'quoth', filenameOverride: `${sid}-e${nextEpoch}.jsonl` })

    const today = new Date().toISOString().slice(0, 10)
    const dst = path.join(tmp, 'trajectories', 'done', today, 'quoth', `${sid}-e2.jsonl`)
    expect(fs.existsSync(dst)).toBe(true)
    // Sidecar followed via the `.jsonl` → `.meta.json` swap.
    expect(fs.existsSync(path.join(tmp, 'trajectories', 'done', today, 'quoth', `${sid}-e2.meta.json`))).toBe(true)
    // Original first archive still present.
    expect(fs.existsSync(path.join(tmp, 'trajectories', 'done', today, 'quoth', `${sid}.jsonl`))).toBe(true)
  })

  it('third resume → <sid>-e3.jsonl', async () => {
    process.env.QUOTH_HOME = tmp
    const sid = 'sess-resume-3'
    const db = createDb(new Database(path.join(tmp, 'epoch-test.db')))

    for (let i = 1; i <= 3; i++) {
      const jsonl = seedInProcessing(sid)
      if (i === 1) {
        await moveSessionFile(jsonl, 'done', { project: 'quoth' })
        continue
      }
      const epoch = db.bumpSessionEpoch(sid)
      expect(epoch).toBe(i)
      await moveSessionFile(jsonl, 'done', { project: 'quoth', filenameOverride: `${sid}-e${epoch}.jsonl` })
    }

    const today = new Date().toISOString().slice(0, 10)
    const dir = path.join(tmp, 'trajectories', 'done', today, 'quoth')
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()
    expect(files).toEqual([`${sid}-e2.jsonl`, `${sid}-e3.jsonl`, `${sid}.jsonl`])
  })
})
```

- [ ] **Step 9.2 — Run and watch fail**

```bash
cd quoth-plugin && npm test -- sessions-helpers.test.js -t "epoch collision"
```

Expected: fails at `db.bumpSessionEpoch` (not exported) and/or `filenameOverride` not honored.

- [ ] **Step 9.3 — Add `bumpSessionEpoch` helper to `db.js`**

In `quoth-plugin/daemon/db.js`, after the `upsertSession` helper from Task 1, add:

```javascript
  /**
   * Increment the epoch counter for a session_id. If the row does not
   * exist, create it at epoch=2 (implying epoch=1 already archived
   * without a dedicated row — safe default for Claude Code resume cases
   * where we only discover the collision at archive time).
   * Returns the NEW epoch number.
   *
   * Two-step (max-lookup + insert) instead of ON CONFLICT + RETURNING so
   * the helper works on older better-sqlite3 versions without RETURNING
   * support. The compound PK `(session_id, epoch)` means every bump is a
   * fresh row, not an update, so there is nothing to return from an UPSERT.
   */
  function bumpSessionEpoch(session_id) {
    const row = db.prepare('SELECT MAX(epoch) AS max_epoch FROM sessions WHERE session_id = ?').get(session_id)
    const next = (row?.max_epoch || 1) + 1
    db.prepare(`
      INSERT INTO sessions (session_id, epoch, status, first_seen_ts, last_seen_ts, tool_count)
      VALUES (?, ?, 'processing', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000, 0)
      ON CONFLICT(session_id, epoch) DO NOTHING
    `).run(session_id, next)
    return next
  }
```

Add `bumpSessionEpoch` to the returned object at the bottom of `createDb`:

```javascript
    bumpSessionEpoch,
```

- [ ] **Step 9.4 — Verify `filenameOverride` support is already in place**

Task 3 already wrote `moveSessionFile` with `filenameOverride` support (see the dual-form implementation in `quoth-plugin/daemon/lib/sessions.js` — both the options-bag path and the positional path thread it through). The canonical contract is:

- `filenameOverride` is the **full filename including the `.jsonl` suffix** (e.g. `'sess-resume-2-e2.jsonl'`, NOT `'sess-resume-2-e2'`).
- The sidecar path is derived by swapping `.jsonl` → `.meta.json`.
- Callers that pass a bare base name will silently produce broken sidecar paths (the regex swap is a no-op and filename/metaFilename collide).

Quick grep to confirm the helper is present and unchanged:

```bash
cd quoth-plugin && grep -n "filenameOverride" daemon/lib/sessions.js
```

Expected: 3-4 hits referencing `filenameOverride` in the options-bag branch of `moveSessionFile`. If the helper is missing (i.e. Task 3 was skipped or rewritten), STOP and complete Task 3 first — do not add a second copy here.

No code changes in this step — this is purely a verification checkpoint before Step 9.5 starts passing `filenameOverride` from `daemon-core.js`.

- [ ] **Step 9.5 — Detect collisions in `daemon-core.js` and bump epoch**

In `quoth-plugin/daemon/daemon-core.js`, at the end of `processSessionFile`, replace the single `moveSessionFile(sessionFile, bucket, ...)` call with:

```javascript
  // Epoch collision handling: if the target file already exists, bump
  // the session's epoch in the DB and use the suffixed name.
  // IMPORTANT: moveSessionFile's filenameOverride contract (Task 3)
  // requires the FULL filename INCLUDING the `.jsonl` suffix — it
  // derives the sidecar path by swapping `.jsonl` → `.meta.json`.
  const destBase = path.basename(sessionFile, '.jsonl')
  let filenameOverride = null
  if (bucket === 'done' || bucket === 'routine') {
    const today = new Date().toISOString().slice(0, 10)
    const project = summary.project || 'default'
    const targetDir = path.join(path.dirname(path.dirname(sessionFile)), bucket, today, project)
    const targetJsonl = path.join(targetDir, `${destBase}.jsonl`)
    if (fs.existsSync(targetJsonl) && typeof db.bumpSessionEpoch === 'function') {
      const epoch = db.bumpSessionEpoch(sid)
      filenameOverride = `${destBase}-e${epoch}.jsonl`
      log('info', 'epoch_bumped_for_resume', { sid, epoch })
    }
  }

  await moveSessionFile(sessionFile, bucket, {
    project: summary.project || 'default',
    ...(filenameOverride ? { filenameOverride } : {}),
  })
```

- [ ] **Step 9.6 — Run all three tests + full suite**

```bash
cd quoth-plugin && npm test -- sessions-helpers.test.js -t "epoch collision"
cd quoth-plugin && npm test -- daemon-process-session.test.js
cd quoth-plugin && npm test
```

Expected: all green.

- [ ] **Step 9.7 — Commit**

```bash
git add quoth-plugin/daemon/lib/sessions.js quoth-plugin/daemon/db.js quoth-plugin/daemon/daemon-core.js quoth-plugin/tests/sessions-helpers.test.js
git commit -m "$(cat <<'EOF'
feat(daemon): bump epoch on session resume collisions

Claude Code can resume a session_id after the old JSONL is already in
done/. On collision, we bump the session's epoch via a compound-PK
insert into sessions, then archive the new file as <sid>-e{N}.jsonl.
The original <sid>.jsonl stays put. This preserves full history for
resume cases without loss or overwrite.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §6.3, §10.1 Risk 4.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Stale session detector rewrite (SQL-driven, no trivial gate, race-guarded)

**Files:**
- Create: `quoth-plugin/daemon/stale-detector.js`
- Modify: `quoth-plugin/daemon/daemon.js:1402-1487` (full `detectStaleSessions` rewrite → thin delegator)
- Test: `quoth-plugin/tests/stale-detector.test.js` (create)
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §4.5, §6.4

**Goal of the task:** Replace the legacy per-file readdir scan with a SQL-driven query against the `sessions` table (added in Task 1). The detector's ONLY job is to flush abandoned active sessions into `processing/` — it does NOT classify, does NOT synthesize summaries (that's `processSessionFile`'s job), does NOT apply a trivial gate. Every active session idle longer than `STALE_TTL_MS` is handed off to the daemon regardless of entry count.

**Why no trivial gate?** Per spec §6.4: "A session that crashed after 2 meaningful Writes is potentially the most valuable kind of trajectory." The old gate (`entries.length < 3`) was removed by the spec. The 1-entry case is no longer special — it goes to `processing/` and `processSessionFile` decides whether it becomes a pattern source (productive), lands in `routine/`, or drops to `empty/` (only on zero tool_use entries, which is a hard gate, not a trivial one).

**Three guarantees from §6.4:**
- **(a) SQL-first scan:** query `db.listSessions({status:'active', maxLastSeen: now - STALE_TTL_MS})` instead of `fs.readdirSync(active/)`. A helper `syncActiveSessionsToDb()` runs first to make sure the sessions table reflects any sidecars that the daemon restart may have missed.
- **(b) Startup catch-up:** `db.getDaemonMeta('last_stale_scan_ts')` is consulted on boot; if it's more than 10 minutes stale, run the detector immediately before starting the timer. No setInterval reliance.
- **(c) Race guard:** between SQL snapshot and `fs.renameSync`, re-read the sidecar mtime. If it's newer than `row.last_seen_ts` by more than 1 s, the session is still alive — skip. Avoids false-positive synthetic flushes in the theoretical append-during-scan race.

**Pre-requisite:** Task 1 already added `db.listSessions`, `db.upsertSession`, `db.setDaemonMeta`, and `db.getDaemonMeta` with the correct schema (`daemon_meta(key TEXT PRIMARY KEY, value TEXT)` — no `updated_at` column). This task does NOT duplicate them.

**Commit prefix:** `feat(daemon):`

- [ ] **Step 10.1 — Write failing tests**

Create `quoth-plugin/tests/stale-detector.test.js`:

```javascript
const { describe, it, expect, beforeEach, afterEach, vi } = require('vitest')
const fs = require('fs')
const path = require('path')
const os = require('os')
const Database = require('better-sqlite3')

// Helper: build a temp home with the trajectory layout.
function setupHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-stale-test-'))
  const traj = path.join(tmp, 'trajectories')
  for (const sub of ['active', 'processing', 'done', 'routine', 'empty', 'error']) {
    fs.mkdirSync(path.join(traj, sub), { recursive: true })
  }
  return tmp
}

// Seed an active session: jsonl entries + sidecar with back-dated last_seen_ts.
function seedActive(home, sid, { entries, ageMs, project = 'quoth' }) {
  const dir = path.join(home, 'trajectories', 'active')
  const jsonl = path.join(dir, `${sid}.jsonl`)
  const meta = path.join(dir, `${sid}.meta.json`)
  const lastSeen = Date.now() - ageMs
  fs.writeFileSync(
    jsonl,
    entries.length ? entries.map(e => JSON.stringify(e)).join('\n') + '\n' : ''
  )
  fs.writeFileSync(meta, JSON.stringify({
    session_id: sid,
    project,
    first_seen_ts: lastSeen - 1000,
    last_seen_ts: lastSeen,
    tool_count: entries.length,
    closed_marker: false,
  }))
  fs.utimesSync(jsonl, new Date(lastSeen), new Date(lastSeen))
  fs.utimesSync(meta, new Date(lastSeen), new Date(lastSeen))
}

describe('syncActiveSessionsToDb — sidecar → sessions table', () => {
  let home, db
  beforeEach(() => {
    home = setupHome()
    process.env.QUOTH_HOME = home
    db = require('../daemon/db.js').createDb(new Database(path.join(home, 'stale.db')))
  })
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} })

  it('upserts every sidecar in active/ into the sessions table with status=active', () => {
    seedActive(home, 'sA', { entries: [{ event: 'tool_use', tool: 'Bash' }], ageMs: 1000 })
    seedActive(home, 'sB', { entries: [{ event: 'tool_use', tool: 'Read' }, { event: 'tool_use', tool: 'Edit' }], ageMs: 2000 })

    const { syncActiveSessionsToDb } = require('../daemon/stale-detector.js')
    const n = syncActiveSessionsToDb(db, path.join(home, 'trajectories'))
    expect(n).toBe(2)

    const rows = db.listSessions({ status: 'active' })
    expect(rows.length).toBe(2)
    const sA = rows.find(r => r.session_id === 'sA')
    expect(sA.tool_count).toBe(1)
    expect(sA.project).toBe('quoth')
  })

  it('is a no-op when active/ is empty', () => {
    const { syncActiveSessionsToDb } = require('../daemon/stale-detector.js')
    expect(syncActiveSessionsToDb(db, path.join(home, 'trajectories'))).toBe(0)
    expect(db.listSessions({ status: 'active' }).length).toBe(0)
  })

  it('skips malformed sidecars without throwing', () => {
    fs.writeFileSync(path.join(home, 'trajectories', 'active', 'bad.meta.json'), '{not json')
    const { syncActiveSessionsToDb } = require('../daemon/stale-detector.js')
    expect(() => syncActiveSessionsToDb(db, path.join(home, 'trajectories'))).not.toThrow()
  })
})

describe('detectStaleSessions — NO trivial gate: every stale active → processing/', () => {
  let home, db
  beforeEach(() => {
    home = setupHome()
    process.env.QUOTH_HOME = home
    db = require('../daemon/db.js').createDb(new Database(path.join(home, 'stale.db')))
  })
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} })

  it('1-entry session idle > STALE_TTL → processing/ (spec §6.4: no trivial gate)', () => {
    // The key reviewer-flagged case. The legacy detector had an
    // `entries.length < 3` skip that left 1-entry sessions stuck in
    // active/ forever. Per spec §6.4 that gate is gone: a single
    // meaningful Write is a potentially-valuable trajectory and MUST
    // flow through processing/ → processSessionFile.
    const sid = 'sess-1entry-stale'
    seedActive(home, sid, {
      entries: [{ event: 'tool_use', session: sid, tool: 'Write', outcome: 'success', task: 'add feature flag' }],
      ageMs: 35 * 60 * 1000,
    })

    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })

    expect(fs.existsSync(path.join(home, 'trajectories', 'active', `${sid}.jsonl`))).toBe(false)
    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', `${sid}.jsonl`))).toBe(true)
    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', `${sid}.meta.json`))).toBe(true)
    // Not in empty/
    expect(fs.readdirSync(path.join(home, 'trajectories', 'empty'))).not.toContain(`${sid}.jsonl`)
  })

  it('2-entry session idle > STALE_TTL → processing/ (no trivial gate)', () => {
    const sid = 'sess-2entry-stale'
    seedActive(home, sid, {
      entries: [
        { event: 'tool_use', session: sid, tool: 'Bash', outcome: 'success' },
        { event: 'tool_use', session: sid, tool: 'Read', outcome: 'success' },
      ],
      ageMs: 35 * 60 * 1000,
    })

    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })

    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', `${sid}.jsonl`))).toBe(true)
    expect(fs.readdirSync(path.join(home, 'trajectories', 'empty'))).not.toContain(`${sid}.jsonl`)
  })

  it('5-entry session idle > STALE_TTL → processing/', () => {
    const sid = 'sess-5entry-stale'
    const entries = Array.from({ length: 5 }, (_, i) => ({
      event: 'tool_use', session: sid, tool: 'Bash', outcome: 'success', task: `cmd ${i}`,
    }))
    seedActive(home, sid, { entries, ageMs: 35 * 60 * 1000 })

    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })

    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', `${sid}.jsonl`))).toBe(true)
    // Sessions table row reflects the new bucket.
    const row = db.getSession(sid)
    expect(row).toBeTruthy()
    expect(row.status).toBe('processing')
  })

  it('0-entry session idle > STALE_TTL → processing/ (daemon will route to empty/)', () => {
    // The stale detector is bucket-agnostic: zero-entry sessions also flow
    // into processing/. processSessionFile will see no tool_use entries and
    // route to empty/. The detector does NOT short-circuit.
    const sid = 'sess-0entry'
    seedActive(home, sid, { entries: [], ageMs: 35 * 60 * 1000 })

    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })

    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', `${sid}.jsonl`))).toBe(true)
  })

  it('fresh 5-entry session (idle < STALE_TTL) is untouched', () => {
    const sid = 'sess-active-5'
    const entries = Array.from({ length: 5 }, () => ({
      event: 'tool_use', session: sid, tool: 'Read', outcome: 'success',
    }))
    seedActive(home, sid, { entries, ageMs: 5 * 60 * 1000 })

    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })

    expect(fs.existsSync(path.join(home, 'trajectories', 'active', `${sid}.jsonl`))).toBe(true)
    expect(fs.readdirSync(path.join(home, 'trajectories', 'processing'))).toHaveLength(0)
  })

  it('stale detector uses the SQL query path, NOT fs.readdir on active/', () => {
    // Regression guard: prior plan iteration used fs.readdirSync(active/).
    // Under the spec, listSessions({status:active}) is authoritative. We
    // verify this by seeding the sessions table WITHOUT corresponding
    // files — the detector must skip such rows gracefully.
    db.upsertSession({
      session_id: 'ghost',
      project: 'quoth',
      first_seen_ts: Date.now() - 40 * 60 * 1000,
      last_seen_ts: Date.now() - 40 * 60 * 1000,
      tool_count: 3,
      status: 'active',
      closed_marker: 0,
      epoch: 1,
    })
    // No sidecar/jsonl on disk for this row.
    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    expect(() => detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })).not.toThrow()
    // Row survives — detector just skips missing files, does not crash.
    expect(db.getSession('ghost')).toBeTruthy()
  })
})

describe('detectStaleSessions — last_stale_scan_ts persistence', () => {
  let home, db
  beforeEach(() => {
    home = setupHome()
    process.env.QUOTH_HOME = home
    db = require('../daemon/db.js').createDb(new Database(path.join(home, 'stale.db')))
  })
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} })

  it('writes last_stale_scan_ts into daemon_meta on every run', () => {
    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    const before = Date.now()
    detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })
    const ts = db.getDaemonMeta('last_stale_scan_ts')
    expect(Number(ts)).toBeGreaterThanOrEqual(before)
  })

  it('getDaemonMeta returns null for unset keys', () => {
    expect(db.getDaemonMeta('never_set_key')).toBeNull()
  })

  it('persists across daemon restarts (same DB file)', () => {
    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })
    const ts1 = db.getDaemonMeta('last_stale_scan_ts')

    // "Restart" — new createDb on the same file.
    const db2 = require('../daemon/db.js').createDb(new Database(path.join(home, 'stale.db')))
    expect(db2.getDaemonMeta('last_stale_scan_ts')).toBe(ts1)
  })
})

describe('detectStaleSessions — race guard', () => {
  let home, db
  beforeEach(() => {
    home = setupHome()
    process.env.QUOTH_HOME = home
    db = require('../daemon/db.js').createDb(new Database(path.join(home, 'stale.db')))
  })
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} })

  it('aborts the move if the sidecar was touched between SQL snapshot and rename', () => {
    const sid = 'sess-race-1'
    const entries = Array.from({ length: 5 }, () => ({
      event: 'tool_use', session: sid, tool: 'Bash', outcome: 'success',
    }))
    seedActive(home, sid, { entries, ageMs: 35 * 60 * 1000 })

    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    let aborted = false
    detectStaleSessions({
      db,
      trajectoriesDir: path.join(home, 'trajectories'),
      _onRaceAbort: () => { aborted = true },
      _raceSimulator: () => {
        // Simulate a live append touching the sidecar right before the
        // race-guard mtime check.
        fs.utimesSync(
          path.join(home, 'trajectories', 'active', `${sid}.meta.json`),
          new Date(), new Date()
        )
      },
    })

    expect(aborted).toBe(true)
    // File stays in active/.
    expect(fs.existsSync(path.join(home, 'trajectories', 'active', `${sid}.jsonl`))).toBe(true)
    expect(fs.readdirSync(path.join(home, 'trajectories', 'processing'))).toHaveLength(0)
  })
})
```

- [ ] **Step 10.2 — Run the tests, watch them fail**

```bash
cd quoth-plugin && npm test -- stale-detector.test.js
```

Expected: every test fails because `quoth-plugin/daemon/stale-detector.js` does not exist yet.

- [ ] **Step 10.3 — Create `quoth-plugin/daemon/stale-detector.js`**

This is a NEW file. It consumes the `db.listSessions` / `db.setDaemonMeta` / `db.getDaemonMeta` helpers that Task 1 already added — do NOT duplicate those helpers here. The detector does NOT write to a `daemon_meta.updated_at` column; Task 1's schema is `daemon_meta(key PK, value)` only.

```javascript
'use strict'

const fs = require('fs')
const path = require('path')
const {
  moveSessionFile,
  readSidecar,
  updateSidecar,
} = require('./lib/sessions.js')

// Idle threshold: any active session whose sidecar last_seen_ts is older
// than this gets flushed to processing/. Per spec §6.4 this is the ONLY
// gate — there is no second-tier "trivial TTL" and no entry-count skip.
const STALE_TTL_MS = Number(process.env.QUOTH_STALE_TTL_MS || 30 * 60 * 1000) // 30 min

function noopLog() {}

/**
 * Read every sidecar under trajectories/active/ and upsert into the
 * sessions table so SQL is the source of truth for the detector.
 *
 * Runs as the first step of every stale scan. Cheap: one readdir + one
 * JSON.parse per file + one upsert per file. Daemon already runs this
 * at ~10-min cadence so the working set is small.
 *
 * @returns {number} count of sidecars processed
 */
function syncActiveSessionsToDb(db, trajectoriesDir) {
  const activeDir = path.join(trajectoriesDir, 'active')
  let metaFiles
  try {
    metaFiles = fs.readdirSync(activeDir).filter(f => f.endsWith('.meta.json'))
  } catch {
    return 0
  }
  let count = 0
  for (const f of metaFiles) {
    try {
      const sid = f.replace(/\.meta\.json$/, '')
      const meta = JSON.parse(fs.readFileSync(path.join(activeDir, f), 'utf8'))
      db.upsertSession({
        session_id: sid,
        project: meta.project || 'default',
        first_seen_ts: meta.first_seen_ts || Date.now(),
        last_seen_ts: meta.last_seen_ts || Date.now(),
        tool_count: meta.tool_count || 0,
        status: 'active',
        closed_marker: meta.closed_marker ? 1 : 0,
        epoch: 1,
      })
      count++
    } catch {
      // Corrupt sidecar — skip silently so one bad file can't break the
      // whole scan. The next hook write will replace it.
    }
  }
  return count
}

/**
 * Flush abandoned active sessions to processing/.
 *
 * Flow:
 *   1. syncActiveSessionsToDb() — bring the sessions table up to date
 *      with whatever is on disk (catches restart gaps).
 *   2. db.listSessions({ status: 'active', maxLastSeen: now - STALE_TTL_MS })
 *      — SQL-first, no fs.readdir on active/ here.
 *   3. For each stale row:
 *      a. Race guard — compare sidecar mtime to row.last_seen_ts. If the
 *         sidecar was touched since the snapshot, the session is alive →
 *         skip.
 *      b. Stamp sidecar with status='stale-flushed' via the 2-arg patch
 *         form of updateSidecar.
 *      c. Atomically rename jsonl + sidecar into processing/ via the
 *         positional form of moveSessionFile.
 *      d. Update the sessions row to status='processing' so the next SQL
 *         scan doesn't re-pick it.
 *   4. db.setDaemonMeta('last_stale_scan_ts', now) — persisted for the
 *      startup catch-up.
 *
 * Every error on a single session is logged and swallowed; the loop
 * continues with the next row.
 *
 * Test hooks (underscore prefix, not part of the public contract):
 *   - _raceSimulator() — called just before the race-guard mtime read
 *   - _onRaceAbort() — called when the race guard triggers
 */
function detectStaleSessions({
  db,
  trajectoriesDir,
  log = noopLog,
  _raceSimulator = null,
  _onRaceAbort = null,
} = {}) {
  const now = Date.now()

  // (1) Sync sidecars → sessions table.
  try {
    syncActiveSessionsToDb(db, trajectoriesDir)
  } catch (err) {
    log('error', 'stale_sync_failed', { error: err.message })
  }

  // (2) SQL query — spec §4.5.
  const staleCutoff = now - STALE_TTL_MS
  let rows
  try {
    rows = db.listSessions({ status: 'active', maxLastSeen: staleCutoff }) || []
  } catch (err) {
    log('error', 'stale_query_failed', { error: err.message })
    try { db.setDaemonMeta('last_stale_scan_ts', String(now)) } catch {}
    return
  }

  const activeDir = path.join(trajectoriesDir, 'active')

  for (const row of rows) {
    const sid = row.session_id
    const jsonlPath = path.join(activeDir, `${sid}.jsonl`)
    const sidecarFile = path.join(activeDir, `${sid}.meta.json`)

    // Skip rows whose files no longer exist (e.g. manual cleanup, crash
    // during a prior flush). The DB row survives so future scans don't
    // keep probing it — the daemon's bucket-status update eventually
    // reconciles it.
    if (!fs.existsSync(jsonlPath)) continue

    // (3a) Race guard — let the test simulate a concurrent append.
    if (typeof _raceSimulator === 'function') _raceSimulator()

    let sidecarMtime
    try {
      sidecarMtime = fs.statSync(sidecarFile).mtimeMs
    } catch {
      continue
    }
    // Tolerate up to 1 s of clock/fs drift; anything newer means the hook
    // has re-written the sidecar since the SQL snapshot → session is alive.
    if (sidecarMtime > row.last_seen_ts + 1000) {
      log('info', 'stale_race_abort', {
        sid,
        row_last_seen: row.last_seen_ts,
        sidecar_mtime: sidecarMtime,
      })
      if (typeof _onRaceAbort === 'function') _onRaceAbort()
      continue
    }

    // (3b) Stamp status on sidecar — 2-arg patch form (no counter bump).
    try {
      updateSidecar(sidecarFile, {
        status: 'stale-flushed',
        stale_flushed_at: now,
      })
    } catch (err) {
      log('error', 'stale_sidecar_patch_failed', { sid, error: err.message })
      continue
    }

    // (3c) Atomic rename — positional form (path + bucket).
    try {
      moveSessionFile(jsonlPath, 'processing')
    } catch (err) {
      log('error', 'stale_rename_failed', { sid, error: err.message })
      continue
    }

    // (3d) Keep the SQL row in sync so the next tick doesn't re-pick it.
    try {
      db.updateSessionStatus(sid, 'processing', { epoch: row.epoch })
    } catch (err) {
      log('warn', 'stale_row_status_update_failed', { sid, error: err.message })
    }

    log('info', 'stale_flushed_to_processing', {
      sid,
      tool_count: row.tool_count,
      idle_min: Math.round((now - row.last_seen_ts) / 60000),
    })
  }

  // (4) Persist scan ts for the startup catch-up path.
  try {
    db.setDaemonMeta('last_stale_scan_ts', String(now))
  } catch (err) {
    log('warn', 'stale_meta_persist_failed', { error: err.message })
  }
}

module.exports = {
  detectStaleSessions,
  syncActiveSessionsToDb,
  STALE_TTL_MS,
}
```

- [ ] **Step 10.4 — Wire the new detector into `daemon.js`**

In `quoth-plugin/daemon/daemon.js`, replace the entire legacy `detectStaleSessions` function (lines 1402-1487) with a thin delegator:

```javascript
function detectStaleSessions() {
  const { detectStaleSessions: scan } = require('./stale-detector.js')
  try {
    scan({ db, trajectoriesDir: TRAJECTORIES_DIR, log })
  } catch (err) {
    log('error', 'Stale session detection failed', { error: err.message })
  }
}
```

And update `startStaleSessionTimer` (line ~1390) to consult `daemon_meta` on boot so a daemon that restarted across a tick catches up immediately instead of waiting another 10 min:

```javascript
function startStaleSessionTimer() {
  // Spec §6.4(b): startup catch-up using daemon_meta.last_stale_scan_ts.
  try {
    const lastTsRaw = typeof db.getDaemonMeta === 'function'
      ? db.getDaemonMeta('last_stale_scan_ts')
      : null
    const lastTs = lastTsRaw != null ? Number(lastTsRaw) || 0 : 0
    if (Date.now() - lastTs > 10 * 60 * 1000) {
      log('info', 'Stale scan startup catch-up', { last_scan_ts: lastTs })
      detectStaleSessions()
    }
  } catch (err) {
    log('warn', 'Stale startup catch-up failed', { error: err.message })
  }

  staleSessionTimer = setInterval(() => {
    try { detectStaleSessions() }
    catch (err) { log('error', 'Stale session detection failed', { error: err.message }) }
  }, 10 * 60 * 1000) // Every 10 minutes
}
```

- [ ] **Step 10.5 — Run the stale tests + full suite**

```bash
cd quoth-plugin && npm test -- stale-detector.test.js
cd quoth-plugin && npm test
```

Expected: all green.

- [ ] **Step 10.6 — Commit**

```bash
git add quoth-plugin/daemon/stale-detector.js quoth-plugin/daemon/daemon.js quoth-plugin/tests/stale-detector.test.js
git commit -m "$(cat <<'EOF'
feat(daemon): rewrite stale session detector — SQL-first, no trivial gate

Replaces the legacy fs.readdirSync scan with a db.listSessions query
against the sessions table added in Task 1. Spec §6.4 removes the old
<3-entry gate entirely: every active session idle > STALE_TTL_MS is
handed off to processing/ regardless of tool count, because a session
that crashed after 2 meaningful Writes may be the most valuable kind
of trajectory. processSessionFile still owns the empty/routine/done
classification downstream.

Three guarantees:
- (a) SQL-first scan via syncActiveSessionsToDb() + db.listSessions
- (b) Startup catch-up via daemon_meta.last_stale_scan_ts (Task 1
  already persists the key)
- (c) Race guard comparing sidecar mtime to the SQL snapshot's
  last_seen_ts before the rename

The detector does NOT duplicate Task 1's daemon_meta helpers and does
NOT write to an updated_at column (Task 1's schema is key/value only).

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §4.5, §6.4.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `session-restore` hook extends with facts injection

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js:275-402` (session-restore action — add facts injection at the end)
- Modify: `quoth-plugin/daemon/db.js` (add `listFactsByNamespace(namespace, limit)` helper — partial from Task 2, confirmed to exist)
- Test: `quoth-plugin/tests/session-restore-facts.test.js` (create)
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §6.7

**Goal of the task:** At `session-restore`, after the existing intelligence-graph work, load up to N facts per namespace (`facts:global`, `facts:proj:<current-project>`) and emit them to stdout as a block formatted like:

```
## Facts

### Facts (project — quoth)
- **build command**: The plugin builds with `pnpm -C quoth-plugin test`
- **db primary key**: The sessions table uses a compound (session_id, epoch) primary key

### Facts (global)
- **atomic rename on POSIX**: fs.renameSync is atomic inside the same filesystem on POSIX
```

The hook then returns that text to Claude Code via the hook stdout protocol so it lands in the session's initial context. Per spec §6.6 there are only two fact scopes — `global` and `project` — and therefore only two namespaces to query.

**Commit prefix:** `feat(hooks):`

- [ ] **Step 11.1 — Write failing test: session-restore emits facts block**

Create `quoth-plugin/tests/session-restore-facts.test.js`:

```javascript
const { describe, it, expect, beforeEach, afterEach } = require('vitest')
const fs = require('fs')
const path = require('path')
const os = require('os')
const Database = require('better-sqlite3')

function freshHooks(tmpHome) {
  process.env.QUOTH_HOME = tmpHome
  delete require.cache[require.resolve('../hooks/hook-dispatch.js')]
  return require('../hooks/hook-dispatch.js')
}

describe('session-restore — facts injection block', () => {
  let tmpHome, dbPath
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-restore-test-'))
    dbPath = path.join(tmpHome, 'memory.db')
    // Seed the DB with facts directly so the hook picks them up.
    const { createDb } = require('../daemon/db.js')
    const db = createDb(new Database(dbPath))
    db.insertNewFact({ topic: 'build command', statement: 'pnpm -C quoth-plugin test', scope: 'project', tags: [] }, { project: 'quoth', session_id: 'seed' })
    db.insertNewFact({ topic: 'db primary key', statement: 'sessions uses compound (session_id, epoch)', scope: 'project', tags: [] }, { project: 'quoth', session_id: 'seed' })
    db.insertNewFact({ topic: 'llm rule', statement: 'never call openai without gateway', scope: 'global', tags: [] }, { project: 'quoth', session_id: 'seed' })
  })
  afterEach(() => { try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch {} })

  it('renders a facts block with both global and project namespaces', async () => {
    process.env.CLAUDE_PROJECT_DIR = tmpHome
    const hooks = freshHooks(tmpHome)

    // Capture stdout for the duration of the hook call.
    let captured = ''
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk, ...rest) => { captured += chunk; return true }
    try {
      await hooks.handle('session-restore', {})
    } finally {
      process.stdout.write = origWrite
    }

    expect(captured).toContain('## Facts')
    expect(captured).toContain('build command')
    expect(captured).toContain('db primary key')
    expect(captured).toContain('llm rule')
  })

  it('caps facts per namespace to listFactsByNamespace limit (5 default)', async () => {
    // Seed 8 project facts.
    const { createDb } = require('../daemon/db.js')
    const db = createDb(new Database(dbPath))
    for (let i = 0; i < 8; i++) {
      db.insertNewFact(
        { topic: `t${i}`, statement: `s${i}`, scope: 'project', tags: [] },
        { project: 'quoth', session_id: 'seed' }
      )
    }

    process.env.CLAUDE_PROJECT_DIR = tmpHome
    const hooks = freshHooks(tmpHome)
    let captured = ''
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk, ...rest) => { captured += chunk; return true }
    try { await hooks.handle('session-restore', {}) }
    finally { process.stdout.write = origWrite }

    const matches = captured.match(/^- \*\*t\d+\*\*/gm) || []
    expect(matches.length).toBeLessThanOrEqual(5)
  })

  it('silent when there are no facts (no error, no block)', async () => {
    // Wipe the DB.
    fs.unlinkSync(dbPath)
    const { createDb } = require('../daemon/db.js')
    createDb(new Database(dbPath)) // fresh empty DB

    process.env.CLAUDE_PROJECT_DIR = tmpHome
    const hooks = freshHooks(tmpHome)
    let captured = ''
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk, ...rest) => { captured += chunk; return true }
    try { await hooks.handle('session-restore', {}) }
    finally { process.stdout.write = origWrite }

    // No facts block present.
    expect(captured).not.toContain('## Facts')
  })
})
```

- [ ] **Step 11.2 — Run, watch fail**

```bash
cd quoth-plugin && npm test -- session-restore-facts.test.js
```

Expected: fails — the hook doesn't emit any facts block yet.

- [ ] **Step 11.3 — Add the facts injection block to `session-restore`**

Open `quoth-plugin/hooks/hook-dispatch.js`. Find the `'session-restore': async () => { ... }` action (starts ~line 275). At the END of that function, just before the closing `}`, append:

```javascript
    // --- Facts injection ---
    // Load up to 5 facts per namespace (project, global) and emit them
    // as a markdown block so Claude Code sees them in the opening
    // context. Silent on error or empty. Per spec §6.6 there are only
    // two fact scopes — no facts:user namespace.
    try {
      if (!db || typeof db.listFactsByNamespace !== 'function') return

      const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
      const namespaces = [
        ['project', `facts:proj:${project}`],
        ['global',  'facts:global'],
      ]

      const blocks = []
      for (const [label, ns] of namespaces) {
        const rows = db.listFactsByNamespace(ns, 5) || []
        if (rows.length === 0) continue
        const lines = rows.map(r => {
          let content
          try { content = JSON.parse(r.content) } catch { content = { statement: String(r.content || '').slice(0, 200) } }
          const stmt = (content.statement || '').replace(/\s+/g, ' ').trim().slice(0, 240)
          return `- **${r.key}**: ${stmt}`
        })
        blocks.push(`### Facts (${label}${label === 'project' ? ` — ${project}` : ''})\n${lines.join('\n')}`)
      }

      if (blocks.length > 0) {
        const header = '## Facts'
        const body = blocks.join('\n\n')
        process.stdout.write(`${header}\n\n${body}\n`)
      }
    } catch {}
```

- [ ] **Step 11.4 — Verify `listFactsByNamespace` exists on db**

Task 2 should have already added a `listFactsByNamespace(namespace, limit = 20)` helper on `createDb`. If it was written as `listMemoryEntries` or similar, rename it (Task 2 edit history) or add an alias:

```javascript
  const _listFactsStmt = db.prepare(`
    SELECT id, key, namespace, content, type, tags, access_count, created_at, updated_at
    FROM memory_entries
    WHERE namespace = ? AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT ?
  `)

  function listFactsByNamespace(namespace, limit = 20) {
    return _listFactsStmt.all(namespace, limit)
  }
```

Add `listFactsByNamespace` to the exports at the bottom of `createDb`.

- [ ] **Step 11.5 — Run the test + full suite**

```bash
cd quoth-plugin && npm test -- session-restore-facts.test.js
cd quoth-plugin && npm test
```

Expected: green.

- [ ] **Step 11.6 — Commit**

```bash
git add quoth-plugin/hooks/hook-dispatch.js quoth-plugin/daemon/db.js quoth-plugin/tests/session-restore-facts.test.js
git commit -m "$(cat <<'EOF'
feat(hooks): inject extracted facts on session-restore

session-restore now pulls up to 5 facts from each of facts:proj:<p>
and facts:global, and prints a markdown block that Claude Code
captures as initial context. Silent on error or empty DB so the
hook never breaks a fresh install.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §6.7.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Migration script for legacy `<project>-<date>.jsonl` files

**Files:**
- Create: `quoth-plugin/scripts/migrate-session-isolation.js`
- Create: `quoth-plugin/tests/migrate-session-isolation.test.js`
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §7.1

**Goal of the task:** One-shot migration for existing installs. Reads every `~/.quoth/trajectories/<anything>-<YYYY-MM-DD>.jsonl`, groups by `session` field, and writes each session to the new layout:
- Sessions with **zero** `tool_use` entries → `empty/<sid>.jsonl` (nothing to extract from)
- Sessions with **any** `tool_use` entries → `processing/<sid>.jsonl` (daemon will pick them up, classify productive/routine, and sort into the right terminal bucket)
- Meaty sessions without `session_summary` → synthesize one, still go to `processing/`
- Original file is moved to `~/.quoth/trajectories/migrated-legacy/<file>` (not deleted — the operator can audit)

> **No trivial gate.** Per spec §7.1: "A 1-entry legacy session now goes to `processing/` just like any other non-empty session." A session that crashed after 2 Writes is still potentially the most valuable kind of trajectory — we let the extractor decide, not a hand-coded threshold in the migration script.

**Commit prefix:** `feat(daemon):`

- [ ] **Step 12.1 — Write failing integration test with fixture files**

Create `quoth-plugin/tests/migrate-session-isolation.test.js`:

```javascript
const { describe, it, expect, beforeEach, afterEach } = require('vitest')
const fs = require('fs')
const path = require('path')
const os = require('os')

function makeHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-migrate-test-'))
  fs.mkdirSync(path.join(tmp, 'trajectories'), { recursive: true })
  return tmp
}

function writeLegacy(home, filename, entries) {
  fs.writeFileSync(
    path.join(home, 'trajectories', filename),
    entries.map(e => JSON.stringify(e)).join('\n') + '\n'
  )
}

describe('migrate-session-isolation — legacy → per-session', () => {
  let home
  beforeEach(() => { home = makeHome(); process.env.QUOTH_HOME = home })
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} })

  it('splits a legacy multi-session file into per-session files (no trivial gate)', () => {
    writeLegacy(home, 'quoth-2026-04-08.jsonl', [
      { event: 'tool_use', session: 'A', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'A', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'A', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'A', project: 'quoth', tool: 'Bash' },
      { event: 'session_summary', session: 'A', project: 'quoth', total_calls: 4 },
      { event: 'tool_use', session: 'B', project: 'quoth', tool: 'Read' },
      { event: 'session_summary', session: 'B', project: 'quoth', total_calls: 1 },
    ])

    const { migrate } = require('../scripts/migrate-session-isolation.js')
    migrate({ home })

    const proc = path.join(home, 'trajectories', 'processing')
    const empty = path.join(home, 'trajectories', 'empty')

    // Session A had 4 entries + summary → processing/.
    expect(fs.existsSync(path.join(proc, 'A.jsonl'))).toBe(true)
    // Session B had 1 tool_use — there is NO trivial gate per spec §7.1.
    // Even a 1-entry legacy session goes to processing/ so the extractor
    // gets a chance to decide productive vs routine.
    expect(fs.existsSync(path.join(proc, 'B.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(empty, 'B.jsonl'))).toBe(false)

    // Legacy file moved to migrated-legacy/.
    expect(fs.existsSync(path.join(home, 'trajectories', 'migrated-legacy', 'quoth-2026-04-08.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'trajectories', 'quoth-2026-04-08.jsonl'))).toBe(false)
  })

  it('routes ONLY zero-tool_use sessions to empty/', () => {
    writeLegacy(home, 'quoth-2026-04-04.jsonl', [
      // Session Z has only a session_summary — no tool_use entries → empty/.
      { event: 'session_summary', session: 'Z', project: 'quoth', total_calls: 0 },
    ])

    const { migrate } = require('../scripts/migrate-session-isolation.js')
    migrate({ home })

    expect(fs.existsSync(path.join(home, 'trajectories', 'empty', 'Z.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', 'Z.jsonl'))).toBe(false)
  })

  it('synthesizes summary for a meaty session missing one', () => {
    writeLegacy(home, 'quoth-2026-04-07.jsonl', [
      { event: 'tool_use', session: 'C', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'C', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'C', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'C', project: 'quoth', tool: 'Bash' },
    ])

    const { migrate } = require('../scripts/migrate-session-isolation.js')
    migrate({ home })

    const jsonlPath = path.join(home, 'trajectories', 'processing', 'C.jsonl')
    expect(fs.existsSync(jsonlPath)).toBe(true)
    const lines = fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
    const summary = lines.find(l => l.event === 'session_summary')
    expect(summary).toBeTruthy()
    expect(summary.source).toBe('migration-synthesizer')
  })

  it('writes a sidecar for each migrated session', () => {
    writeLegacy(home, 'quoth-2026-04-06.jsonl', [
      { event: 'tool_use', session: 'D', project: 'quoth', tool: 'Bash' },
      { event: 'session_summary', session: 'D', project: 'quoth', total_calls: 1 },
    ])

    const { migrate } = require('../scripts/migrate-session-isolation.js')
    migrate({ home })

    // D has 1 tool_use + summary. Spec §7.1: NO trivial gate — it goes to
    // processing/ and the extractor decides productive vs routine.
    const meta = JSON.parse(fs.readFileSync(path.join(home, 'trajectories', 'processing', 'D.meta.json'), 'utf8'))
    expect(meta.session_id).toBe('D')
    expect(meta.source).toBe('migration')
    expect(meta.status).toBe('terminated')
    expect(meta.closed_marker).toBe(true)
    // No empty_reason: that field only exists for sessions that landed in empty/.
    expect(meta.empty_reason).toBeUndefined()
  })

  it('is idempotent — a second run is a no-op', () => {
    writeLegacy(home, 'quoth-2026-04-05.jsonl', [
      { event: 'tool_use', session: 'E', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'E', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'E', project: 'quoth', tool: 'Bash' },
      { event: 'session_summary', session: 'E', project: 'quoth', total_calls: 3 },
    ])

    const { migrate } = require('../scripts/migrate-session-isolation.js')
    const result1 = migrate({ home })
    const result2 = migrate({ home })

    expect(result1.migrated).toBe(1)
    expect(result2.migrated).toBe(0)
  })

  it('dry-run writes nothing and reports counts', () => {
    writeLegacy(home, 'quoth-2026-04-03.jsonl', [
      { event: 'tool_use', session: 'F', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'F', project: 'quoth', tool: 'Bash' },
      { event: 'session_summary', session: 'F', project: 'quoth', total_calls: 2 },
    ])

    const { migrate } = require('../scripts/migrate-session-isolation.js')
    const result = migrate({ home, dryRun: true })

    // Legacy file untouched.
    expect(fs.existsSync(path.join(home, 'trajectories', 'quoth-2026-04-03.jsonl'))).toBe(true)
    // No destination files created.
    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', 'F.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'trajectories', 'empty', 'F.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'trajectories', 'migrated-legacy', 'quoth-2026-04-03.jsonl'))).toBe(false)
    // Counts still reflect the discovered work.
    expect(result.migrated).toBe(0)
    expect(result.sessions).toBe(1)
  })
})
```

- [ ] **Step 12.2 — Run, watch fail**

```bash
cd quoth-plugin && npm test -- migrate-session-isolation.test.js
```

Expected: fails because the script doesn't exist.

- [ ] **Step 12.3 — Create `quoth-plugin/scripts/migrate-session-isolation.js`**

```javascript
#!/usr/bin/env node
'use strict'

// One-shot migration for legacy <project>-<date>.jsonl files into the
// per-session layout introduced in spec §4.1. Safe to run on a fresh
// install (no-op) and safe to run multiple times (idempotent — files
// already in migrated-legacy/ are skipped).
//
// Usage:
//   node quoth-plugin/scripts/migrate-session-isolation.js
//   node quoth-plugin/scripts/migrate-session-isolation.js --dry-run

const fs = require('fs')
const path = require('path')
const os = require('os')

const LEGACY_NAME_RE = /^(.+)-(\d{4}-\d{2}-\d{2})\.jsonl$/

function migrate({ home = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth'), dryRun = false } = {}) {
  const trajDir = path.join(home, 'trajectories')
  if (!fs.existsSync(trajDir)) return { migrated: 0, sessions: 0, skipped: 0 }

  const migratedDir = path.join(trajDir, 'migrated-legacy')
  const activeDir = path.join(trajDir, 'active')
  const processingDir = path.join(trajDir, 'processing')
  const emptyDir = path.join(trajDir, 'empty')

  if (!dryRun) {
    fs.mkdirSync(migratedDir, { recursive: true })
    fs.mkdirSync(activeDir, { recursive: true })
    fs.mkdirSync(processingDir, { recursive: true })
    fs.mkdirSync(emptyDir, { recursive: true })
  }

  const entries = fs.readdirSync(trajDir, { withFileTypes: true })
  let migrated = 0
  let totalSessions = 0
  let skipped = 0

  for (const d of entries) {
    if (!d.isFile()) continue
    const match = LEGACY_NAME_RE.exec(d.name)
    if (!match) continue

    const filePath = path.join(trajDir, d.name)
    const project = match[1]
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split('\n').filter(Boolean)

    // Group by session id.
    const bySession = new Map()
    for (const raw of lines) {
      let parsed
      try { parsed = JSON.parse(raw) } catch { continue }
      const sid = parsed.session || parsed.session_id
      if (!sid) continue
      if (!bySession.has(sid)) bySession.set(sid, { tool: [], summary: null, any: [] })
      const bucket = bySession.get(sid)
      bucket.any.push(parsed)
      if (parsed.event === 'tool_use') bucket.tool.push(parsed)
      else if (parsed.event === 'session_summary') bucket.summary = parsed
    }

    for (const [sid, bucket] of bySession) {
      totalSessions++
      // Spec §7.1: NO trivial gate. The ONLY thing that sends a legacy
      // session to empty/ is having zero tool_use entries. Everything
      // else — even a 1-entry session — goes to processing/ so the
      // extractor gets a chance to decide productive vs routine.
      const entryCount = bucket.tool.length
      const isEmpty = entryCount === 0
      const destBucket = isEmpty ? 'empty' : 'processing'
      const destDir = isEmpty ? emptyDir : processingDir
      const destJsonl = path.join(destDir, `${sid}.jsonl`)
      const destMeta = path.join(destDir, `${sid}.meta.json`)

      // Idempotent: skip if already migrated.
      if (fs.existsSync(destJsonl)) { skipped++; continue }

      // Serialize bucket.any in original order.
      let body = bucket.any.map(e => JSON.stringify(e)).join('\n')

      // Non-empty session without summary → synthesize one so the daemon
      // has a reliable entrypoint when it picks up the file.
      if (!bucket.summary && !isEmpty) {
        const synth = synthesizeSummary(sid, project, bucket.tool)
        body += '\n' + JSON.stringify(synth)
      }

      const sidecar = {
        session_id: sid,
        project,
        status: isEmpty ? 'empty' : 'terminated',
        first_seen_ts: bucket.any[0]?.timestamp || Date.now(),
        last_seen_ts: bucket.any[bucket.any.length - 1]?.timestamp || Date.now(),
        tool_count: entryCount,
        closed_marker: Boolean(bucket.summary) || (!isEmpty),
        source: 'migration',
        ...(isEmpty ? { empty_reason: 'no-tool-use' } : {}),
      }

      if (!dryRun) {
        fs.writeFileSync(destJsonl, body + '\n')
        fs.writeFileSync(destMeta, JSON.stringify(sidecar))
      }
    }

    // Move the legacy file aside.
    if (!dryRun) {
      fs.renameSync(filePath, path.join(migratedDir, d.name))
    }
    migrated++
  }

  return { migrated, sessions: totalSessions, skipped }
}

function synthesizeSummary(sid, project, toolEntries) {
  const toolCounts = {}
  let successes = 0, failures = 0
  for (const e of toolEntries) {
    toolCounts[e.tool] = (toolCounts[e.tool] || 0) + 1
    if (e.outcome === 'success') successes++
    else if (e.outcome === 'failure') failures++
  }
  const toolSummary = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t}:${c}`)
    .join(', ')

  return {
    event: 'session_summary',
    agent: 'claude-code',
    project,
    session: sid,
    task: `Session (migrated): ${toolEntries.length} tool calls (${toolSummary}). ${successes} ok, ${failures} fail.`,
    tool_counts: toolCounts,
    total_calls: toolEntries.length,
    success_rate: toolEntries.length > 0 ? successes / toolEntries.length : 0,
    outcome: failures === 0 ? 'success' : (successes > failures ? 'partial' : 'failure'),
    source: 'migration-synthesizer',
    timestamp: Date.now(),
  }
}

// CLI entrypoint.
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run')
  const result = migrate({ dryRun })
  console.log(`[migrate-session-isolation] migrated=${result.migrated} sessions=${result.sessions} skipped=${result.skipped}${dryRun ? ' (DRY RUN)' : ''}`)
}

module.exports = { migrate, synthesizeSummary }
```

- [ ] **Step 12.4 — Run test + full suite**

```bash
cd quoth-plugin && npm test -- migrate-session-isolation.test.js
cd quoth-plugin && npm test
```

Expected: green.

- [ ] **Step 12.5 — Commit**

```bash
git add quoth-plugin/scripts/migrate-session-isolation.js quoth-plugin/tests/migrate-session-isolation.test.js
git commit -m "$(cat <<'EOF'
feat(daemon): add migrate-session-isolation.js one-shot migration

Takes every legacy <project>-<date>.jsonl file, groups its lines by
session id, and writes each session into its own JSONL + sidecar
under the new active/processing/empty layout:
- zero-tool_use sessions → empty/ with empty_reason='no-tool-use'
- any session with >= 1 tool_use → processing/, with a synthesized
  summary if the original JSONL was missing one (the daemon will
  classify productive vs routine downstream)
- legacy files are moved to migrated-legacy/ (not deleted) for audit

Per spec §7.1 there is NO trivial gate: a 1-entry legacy session goes
to processing/ just like any other non-empty session. A crashed-early
session is potentially the most valuable trajectory we have.

Idempotent: second invocation is a no-op. Supports --dry-run.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §7.1.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Managed-mode baseline — tolerate `facts[]` in API response

**Files:**
- Modify: `quoth-plugin/daemon/lib/pipeline-api.js` (accept & return `facts` in response)
- Test: `quoth-plugin/tests/pipeline-api-facts.test.js` (create)
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §6.5

**Goal of the task:** The current managed-mode client in `pipeline-api.js` only parses `result.patterns`. Future cloud responses will also return `facts`. Teach the client to tolerate the new field without breaking existing deployments. This is a pure shape tolerance change — no UI, no UI behavior difference yet.

**Commit prefix:** `feat(daemon):`

- [ ] **Step 13.1 — Write failing test**

Create `quoth-plugin/tests/pipeline-api-facts.test.js`:

```javascript
const { describe, it, expect, vi } = require('vitest')
const https = require('https')

describe('pipeline-api — tolerate facts[] in response', () => {
  it('returns facts alongside patterns when server includes them', async () => {
    // Monkey-patch https.request to return a canned response.
    const response = {
      patterns: [{ id: 'p1', pattern: 'x', action: 'new', targetId: null }],
      facts: [
        { topic: 'build', statement: 'pnpm test', scope: 'project', tags: [] }
      ],
      tokens_used: 1234,
    }
    const origRequest = https.request
    https.request = (_opts, cb) => {
      const fakeRes = Object.assign(require('stream').Readable.from([JSON.stringify(response)]), {
        statusCode: 200, headers: {},
      })
      setImmediate(() => cb(fakeRes))
      return { on: () => {}, write: () => {}, end: () => {}, destroy: () => {} }
    }

    try {
      const { callPipelineAPI } = require('../daemon/lib/pipeline-api.js')
      const result = await callPipelineAPI([{ summary: {}, tool_entries: [] }], [])
      expect(Array.isArray(result.patterns)).toBe(true)
      expect(Array.isArray(result.facts)).toBe(true)
      expect(result.facts[0].topic).toBe('build')
    } finally {
      https.request = origRequest
    }
  })

  it('defaults facts to [] when server omits them (back-compat)', async () => {
    const response = { patterns: [], tokens_used: 0 }
    const origRequest = https.request
    https.request = (_opts, cb) => {
      const fakeRes = Object.assign(require('stream').Readable.from([JSON.stringify(response)]), {
        statusCode: 200, headers: {},
      })
      setImmediate(() => cb(fakeRes))
      return { on: () => {}, write: () => {}, end: () => {}, destroy: () => {} }
    }

    try {
      const { callPipelineAPI } = require('../daemon/lib/pipeline-api.js')
      const result = await callPipelineAPI([], [])
      expect(Array.isArray(result.facts)).toBe(true)
      expect(result.facts).toHaveLength(0)
    } finally {
      https.request = origRequest
    }
  })
})
```

- [ ] **Step 13.2 — Run, watch fail**

```bash
cd quoth-plugin && npm test -- pipeline-api-facts.test.js
```

Expected: failure — current response shape does not include `facts`.

- [ ] **Step 13.3 — Update `pipeline-api.js`**

Open `quoth-plugin/daemon/lib/pipeline-api.js`. Find the parse+return block at the bottom of `callPipelineAPI` (the place that does `const parsed = JSON.parse(body); resolve(parsed)` or similar). Change it to normalize the shape:

```javascript
          try {
            const parsed = JSON.parse(body)
            const normalized = {
              patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
              facts: Array.isArray(parsed.facts) ? parsed.facts : [],
              tokens_used: parsed.tokens_used || 0,
              quota_remaining: parsed.quota_remaining || null,
            }
            resolve(normalized)
          } catch (err) {
            reject(new Error('pipeline-api: failed to parse response: ' + err.message))
          }
```

- [ ] **Step 13.4 — Run test + full suite**

```bash
cd quoth-plugin && npm test -- pipeline-api-facts.test.js
cd quoth-plugin && npm test
```

Expected: green.

- [ ] **Step 13.5 — Commit**

```bash
git add quoth-plugin/daemon/lib/pipeline-api.js quoth-plugin/tests/pipeline-api-facts.test.js
git commit -m "$(cat <<'EOF'
feat(daemon): pipeline-api tolerates facts[] in server response

The managed-mode client now normalizes every response to
{ patterns, facts, tokens_used, quota_remaining }. Current server
responses lack facts[]; the client defaults to [] so nothing breaks.
Once the cloud side starts returning facts (separate PR), the client
will pass them straight through.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §6.5.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Managed-mode local-background path (`QUOTH_MANAGED_LOCAL_BACKGROUND=true`)

**Files:**
- Modify: `quoth-plugin/daemon/lib/pipeline-api.js` (add `runLocalBackground(sessionFile, db)` helper that calls the local extract path, but WITHOUT waiting on the server)
- Modify: `quoth-plugin/daemon/daemon.js` (at startup, detect env var and swap pipeline function accordingly)
- Test: `quoth-plugin/tests/pipeline-api-local-background.test.js` (create)
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §10.2 decision #9

**Goal of the task:** Managed mode users should be able to opt into running EXTRACT locally (using their own Moonshot key, no cloud roundtrip) for specific sessions, without losing the cloud sync of results. The env var `QUOTH_MANAGED_LOCAL_BACKGROUND=true` flips the pipeline so `processSessionFile` uses `extract()` from `pipeline/extract.js` directly, then posts the resulting patterns+facts to the cloud as a confirmation write-through.

**Commit prefix:** `feat(daemon):`

- [ ] **Step 14.1 — Write failing test**

Create `quoth-plugin/tests/pipeline-api-local-background.test.js`:

```javascript
const { describe, it, expect, beforeEach, afterEach, vi } = require('vitest')

describe('pipeline-api — runLocalBackground', () => {
  beforeEach(() => {
    process.env.QUOTH_MANAGED_LOCAL_BACKGROUND = 'true'
    process.env.QUOTH_API_KEY = 'qth_test'
    process.env.QUOTH_API_URL = 'https://quoth.test'
  })
  afterEach(() => {
    delete process.env.QUOTH_MANAGED_LOCAL_BACKGROUND
    delete process.env.QUOTH_API_KEY
  })

  it('calls local extract() and posts result as a confirmation', async () => {
    const api = require('../daemon/lib/pipeline-api.js')
    const localExtractMock = vi.fn(async () => ({
      patterns: [{ id: 'p1', condition: 'when a', action: 'do the specific thing that works', tags: [], quality_signal: 'project', embedding: null, source: 'distilled' }],
      facts: [{ topic: 'build', statement: 'pnpm test', scope: 'project', tags: [] }],
    }))
    const postSpy = vi.fn(async () => ({ patterns: [], facts: [], tokens_used: 0 }))

    const result = await api.runLocalBackground({
      summary: { session: 's1', project: 'quoth', total_calls: 5 },
      toolEntries: [{ tool: 'Bash', task: 'ls', outcome: 'success' }],
      db: { insertPipelineError: () => {} },
      _localExtract: localExtractMock,
      _postConfirmation: postSpy,
    })

    expect(localExtractMock).toHaveBeenCalledOnce()
    expect(postSpy).toHaveBeenCalledOnce()
    expect(result.patterns).toHaveLength(1)
    expect(result.facts).toHaveLength(1)
  })

  it('still resolves with local result even if cloud confirmation fails', async () => {
    const api = require('../daemon/lib/pipeline-api.js')
    const localExtractMock = vi.fn(async () => ({
      patterns: [{ id: 'p1', condition: 'when a', action: 'do the specific thing that works', tags: [], quality_signal: 'project', embedding: null, source: 'distilled' }],
      facts: [],
    }))
    const postSpy = vi.fn(async () => { throw new Error('cloud down') })

    const result = await api.runLocalBackground({
      summary: { session: 's2', project: 'quoth' },
      toolEntries: [{ tool: 'Bash' }],
      db: { insertPipelineError: () => {} },
      _localExtract: localExtractMock,
      _postConfirmation: postSpy,
    })

    expect(result.patterns).toHaveLength(1) // local won
  })
})
```

- [ ] **Step 14.2 — Run, watch fail**

```bash
cd quoth-plugin && npm test -- pipeline-api-local-background.test.js
```

Expected: `runLocalBackground is not a function`.

- [ ] **Step 14.3 — Add `runLocalBackground` to `pipeline-api.js`**

Append to `quoth-plugin/daemon/lib/pipeline-api.js`:

```javascript
/**
 * Managed-mode escape hatch: run EXTRACT locally (Moonshot + user's own key)
 * then post the result to the cloud as a confirmation write-through.
 *
 * Controlled by the QUOTH_MANAGED_LOCAL_BACKGROUND env var (see daemon.js
 * startup). The DAEMON decides which sessions get this treatment; this
 * function is just the execution path.
 *
 * Returns { patterns, facts } identical to callPipelineAPI's shape so
 * callers don't need to branch on the mode.
 */
async function runLocalBackground({
  summary,
  toolEntries,
  db,
  _localExtract = null,
  _postConfirmation = null,
} = {}) {
  const extract = _localExtract || require('../pipeline/extract.js').extract
  const postConfirmation = _postConfirmation || _defaultPostConfirmation

  let local
  try {
    local = await extract(summary, toolEntries, db)
  } catch (err) {
    try {
      if (db && typeof db.insertPipelineError === 'function') {
        db.insertPipelineError({
          stage: 'extract-local-background',
          error_message: err.message,
          context: JSON.stringify({ session_id: summary?.session, project: summary?.project }),
        })
      }
    } catch {}
    return { patterns: [], facts: [] }
  }

  // Normalize shape: extract() may return an array (old shim) or object.
  const patterns = Array.isArray(local) ? local : (local?.patterns || [])
  const facts = Array.isArray(local) ? [] : (local?.facts || [])

  // Fire-and-forget cloud confirmation. Errors are logged, not raised.
  try {
    await postConfirmation({ summary, patterns, facts })
  } catch (err) {
    try {
      if (db && typeof db.insertPipelineError === 'function') {
        db.insertPipelineError({
          stage: 'confirmation-post',
          error_message: err.message,
          context: JSON.stringify({ session_id: summary?.session }),
        })
      }
    } catch {}
  }

  return { patterns, facts }
}

async function _defaultPostConfirmation({ summary, patterns, facts }) {
  // Hits the same pipeline API but with the result inline for audit.
  // Implementation matches callPipelineAPI's POST shape — kept separate
  // so servers can route /confirm differently from /process.
  return callPipelineAPI([{
    summary,
    tool_entries: [],
    local_result: { patterns, facts },
  }], [])
}
```

Add to the `module.exports`:

```javascript
module.exports = { callPipelineAPI, runLocalBackground }
```

- [ ] **Step 14.4 — Hook the env flag into `daemon.js`**

In `quoth-plugin/daemon/daemon.js`, near the top where `QUOTH_MODE` is read, add:

```javascript
const QUOTH_MODE = process.env.QUOTH_MODE || 'local'
const MANAGED_LOCAL_BG = process.env.QUOTH_MANAGED_LOCAL_BACKGROUND === 'true'
```

Then in the worker loop body (the place in `runWorker` that chooses which extract function to pass to `processSessionFile`), branch:

```javascript
        let extractFn
        if (QUOTH_MODE === 'managed' && MANAGED_LOCAL_BG) {
          const { runLocalBackground } = require('./lib/pipeline-api.js')
          extractFn = async (summary, toolEntries, dbArg) =>
            runLocalBackground({ summary, toolEntries, db: dbArg })
        } else if (QUOTH_MODE === 'managed') {
          const { callPipelineAPI } = require('./lib/pipeline-api.js')
          extractFn = async (summary, toolEntries) => {
            const res = await callPipelineAPI([{ summary, tool_entries: toolEntries.slice(-30) }], [])
            return res  // already { patterns, facts } shape from Task 13
          }
        } else {
          const { extract } = require('./pipeline/extract.js')
          extractFn = (summary, toolEntries, dbArg) => extract(summary, toolEntries, dbArg)
        }
```

- [ ] **Step 14.5 — Run test + full suite**

```bash
cd quoth-plugin && npm test -- pipeline-api-local-background.test.js
cd quoth-plugin && npm test
```

Expected: green.

- [ ] **Step 14.6 — Commit**

```bash
git add quoth-plugin/daemon/lib/pipeline-api.js quoth-plugin/daemon/daemon.js quoth-plugin/tests/pipeline-api-local-background.test.js
git commit -m "$(cat <<'EOF'
feat(daemon): managed-mode local-background path (opt-in)

When QUOTH_MANAGED_LOCAL_BACKGROUND=true, managed-mode daemons run
EXTRACT locally using their own Moonshot key and post the resulting
patterns + facts to the cloud as a confirmation write-through.

Cloud confirmation failures are logged but never block the local
result from being inserted. This is the escape hatch for users who
want cloud sync without the per-session roundtrip latency.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §10.2 decision #9.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Nightly retention sweep (env-configurable TTLs)

**Files:**
- Create: `quoth-plugin/daemon/retention.js`
- Modify: `quoth-plugin/daemon/daemon.js` (wire `runRetentionSweep()` into the nightly 3am cron)
- Test: `quoth-plugin/tests/retention.test.js` (create)
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §6.4, §10.2 decision #6

**Goal of the task:** At 3am local time, delete old trajectory files from each bucket based on age:
- `done/`: default 30 days
- `routine/`: default 7 days
- `empty/`: default 3 days
- `error/`: default 14 days

All TTLs overridable via env: `QUOTH_RETENTION_DONE_DAYS`, `QUOTH_RETENTION_ROUTINE_DAYS`, `QUOTH_RETENTION_EMPTY_DAYS`, `QUOTH_RETENTION_ERROR_DAYS`. The sweep deletes both `<sid>.jsonl` and `<sid>.meta.json` pairs, logging counts. NEVER touches `active/` or `processing/`.

**Commit prefix:** `feat(daemon):`

- [ ] **Step 15.1 — Write failing test**

Create `quoth-plugin/tests/retention.test.js`:

```javascript
const { describe, it, expect, beforeEach, afterEach } = require('vitest')
const fs = require('fs')
const path = require('path')
const os = require('os')

function setupHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-retention-test-'))
  for (const b of ['active', 'processing', 'done', 'routine', 'empty', 'error']) {
    fs.mkdirSync(path.join(tmp, 'trajectories', b), { recursive: true })
  }
  return tmp
}

function writeAged(dir, sid, ageDays) {
  const jsonl = path.join(dir, `${sid}.jsonl`)
  const meta = path.join(dir, `${sid}.meta.json`)
  fs.writeFileSync(jsonl, '{}\n')
  fs.writeFileSync(meta, '{}')
  const stamp = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000)
  fs.utimesSync(jsonl, stamp, stamp)
  fs.utimesSync(meta, stamp, stamp)
}

describe('runRetentionSweep', () => {
  let home
  beforeEach(() => { home = setupHome(); process.env.QUOTH_HOME = home })
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} })

  it('deletes done/ files older than QUOTH_RETENTION_DONE_DAYS (default 30)', () => {
    const doneDir = path.join(home, 'trajectories', 'done', '2026-03-01', 'quoth')
    fs.mkdirSync(doneDir, { recursive: true })
    writeAged(doneDir, 'old', 45)
    writeAged(doneDir, 'fresh', 5)

    const { runRetentionSweep } = require('../daemon/retention.js')
    const res = runRetentionSweep({ home })

    expect(fs.existsSync(path.join(doneDir, 'old.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(doneDir, 'fresh.jsonl'))).toBe(true)
    expect(res.deleted.done).toBe(1)
  })

  it('deletes routine/ files older than QUOTH_RETENTION_ROUTINE_DAYS (default 7)', () => {
    const rdir = path.join(home, 'trajectories', 'routine', '2026-04-01', 'quoth')
    fs.mkdirSync(rdir, { recursive: true })
    writeAged(rdir, 'old', 10)
    writeAged(rdir, 'fresh', 3)

    const { runRetentionSweep } = require('../daemon/retention.js')
    const res = runRetentionSweep({ home })

    expect(fs.existsSync(path.join(rdir, 'old.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(rdir, 'fresh.jsonl'))).toBe(true)
    expect(res.deleted.routine).toBe(1)
  })

  it('deletes empty/ files older than 3 days and error/ older than 14 days', () => {
    writeAged(path.join(home, 'trajectories', 'empty'), 'e-old', 5)
    writeAged(path.join(home, 'trajectories', 'empty'), 'e-fresh', 1)
    writeAged(path.join(home, 'trajectories', 'error'), 'err-old', 20)
    writeAged(path.join(home, 'trajectories', 'error'), 'err-fresh', 7)

    const { runRetentionSweep } = require('../daemon/retention.js')
    const res = runRetentionSweep({ home })

    expect(fs.existsSync(path.join(home, 'trajectories', 'empty', 'e-old.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'trajectories', 'empty', 'e-fresh.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'trajectories', 'error', 'err-old.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'trajectories', 'error', 'err-fresh.jsonl'))).toBe(true)
  })

  it('NEVER touches active/ or processing/', () => {
    writeAged(path.join(home, 'trajectories', 'active'), 'live', 100)
    writeAged(path.join(home, 'trajectories', 'processing'), 'claimed', 100)

    const { runRetentionSweep } = require('../daemon/retention.js')
    runRetentionSweep({ home })

    expect(fs.existsSync(path.join(home, 'trajectories', 'active', 'live.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', 'claimed.jsonl'))).toBe(true)
  })

  it('deletes the sidecar alongside the JSONL', () => {
    const doneDir = path.join(home, 'trajectories', 'done', '2026-03-01', 'quoth')
    fs.mkdirSync(doneDir, { recursive: true })
    writeAged(doneDir, 'both', 40)

    const { runRetentionSweep } = require('../daemon/retention.js')
    runRetentionSweep({ home })

    expect(fs.existsSync(path.join(doneDir, 'both.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(doneDir, 'both.meta.json'))).toBe(false)
  })

  it('respects env overrides', () => {
    process.env.QUOTH_RETENTION_DONE_DAYS = '1'
    const doneDir = path.join(home, 'trajectories', 'done', '2026-03-01', 'quoth')
    fs.mkdirSync(doneDir, { recursive: true })
    writeAged(doneDir, 'a', 2)

    const { runRetentionSweep } = require('../daemon/retention.js')
    runRetentionSweep({ home })
    expect(fs.existsSync(path.join(doneDir, 'a.jsonl'))).toBe(false)

    delete process.env.QUOTH_RETENTION_DONE_DAYS
  })
})
```

- [ ] **Step 15.2 — Run, watch fail**

```bash
cd quoth-plugin && npm test -- retention.test.js
```

Expected: fails — `retention.js` doesn't exist.

- [ ] **Step 15.3 — Create `quoth-plugin/daemon/retention.js`**

```javascript
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const DAY_MS = 24 * 60 * 60 * 1000
const NEVER_TOUCH = new Set(['active', 'processing', 'migrated-legacy'])

function envDays(key, defaultDays) {
  const raw = process.env[key]
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : defaultDays
}

function getTtls() {
  return {
    done:    envDays('QUOTH_RETENTION_DONE_DAYS', 30),
    routine: envDays('QUOTH_RETENTION_ROUTINE_DAYS', 7),
    empty:   envDays('QUOTH_RETENTION_EMPTY_DAYS', 3),
    error:   envDays('QUOTH_RETENTION_ERROR_DAYS', 14),
  }
}

/**
 * Walk trajectories/<bucket>/** and delete any .jsonl + .meta.json pair
 * whose mtime is older than the bucket's configured TTL.
 */
function runRetentionSweep({ home = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth'), log = () => {} } = {}) {
  const trajDir = path.join(home, 'trajectories')
  const ttls = getTtls()
  const now = Date.now()
  const deleted = { done: 0, routine: 0, empty: 0, error: 0 }

  for (const bucket of Object.keys(ttls)) {
    const bucketDir = path.join(trajDir, bucket)
    if (!fs.existsSync(bucketDir)) continue
    const cutoffMs = ttls[bucket] * DAY_MS
    deleted[bucket] = sweepDir(bucketDir, now, cutoffMs, log)
  }

  log('info', 'retention_sweep', deleted)
  return { deleted, ttls }
}

function sweepDir(dir, now, cutoffMs, log) {
  let count = 0
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return 0 }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (NEVER_TOUCH.has(entry.name)) continue
    if (entry.isDirectory()) {
      count += sweepDir(fullPath, now, cutoffMs, log)
      // Optional: remove empty subdirs after sweep.
      try {
        const remaining = fs.readdirSync(fullPath)
        if (remaining.length === 0) fs.rmdirSync(fullPath)
      } catch {}
      continue
    }
    if (!entry.name.endsWith('.jsonl')) continue

    let stat
    try { stat = fs.statSync(fullPath) } catch { continue }
    if (now - stat.mtimeMs < cutoffMs) continue

    // Delete jsonl + sidecar pair.
    try { fs.unlinkSync(fullPath) } catch {}
    const sidecar = fullPath.replace(/\.jsonl$/, '.meta.json')
    try { fs.unlinkSync(sidecar) } catch {}
    count++
  }

  return count
}

module.exports = { runRetentionSweep, getTtls }
```

- [ ] **Step 15.4 — Wire into daemon.js nightly 3am cron**

In `quoth-plugin/daemon/daemon.js`, find the existing "deep consolidation" 3am timer (search for `nightly` or `03:00` or `3 * 60 * 60` near the bottom of the file). Inside the 3am callback, after the existing dedup+promote work, add:

```javascript
    // Retention sweep — runs inside the same 3am window to amortize cost.
    try {
      const { runRetentionSweep } = require('./retention.js')
      const res = runRetentionSweep({ log })
      log('info', 'nightly_retention_complete', { deleted: res.deleted, ttls: res.ttls })
    } catch (err) {
      log('error', 'nightly_retention_failed', { error: err.message })
    }
```

- [ ] **Step 15.5 — Run test + full suite**

```bash
cd quoth-plugin && npm test -- retention.test.js
cd quoth-plugin && npm test
```

Expected: green.

- [ ] **Step 15.6 — Commit**

```bash
git add quoth-plugin/daemon/retention.js quoth-plugin/daemon/daemon.js quoth-plugin/tests/retention.test.js
git commit -m "$(cat <<'EOF'
feat(daemon): nightly retention sweep for done/routine/empty/error buckets

New retention.js walks each bucket at 3am and deletes pairs whose
mtime exceeds the per-bucket TTL. Defaults: done 30d, routine 7d,
empty 3d, error 14d. All TTLs overridable via env. active/ and
processing/ are never touched. Empty subdirectories are cleaned up
as a side effect.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §6.4, §10.2 decision #6.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: End-to-end contamination + facts tests

**Files:**
- Create: `quoth-plugin/tests/e2e-session-isolation.test.js`
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §8

**Goal of the task:** Two full e2e tests that exercise the whole pipeline from hook → file → daemon core → db. Run them against a fake extractor so they're deterministic. The tests:
1. Two parallel sessions write simultaneously via `trajectory-capture.js`. Session A has 5 entries (fake extractor returns 1 pattern — productive), session B has 1 entry (fake extractor returns 0 patterns — routine). After `session-end` fires for both and `processSessionFile` runs, A's pattern ends up in the DB. Critically: NONE of A's patterns contain B's content and vice versa, AND B was still processed (per spec §6.4 there is NO trivial gate — B goes into `processing/` like any other non-empty session and gets classified routine by the extractor).
2. A productive session with facts survives the full path — write → hook → processing → processSessionFile → `memory_entries` row under `facts:proj:<project>`. Then `session-restore` for a NEW session surfaces the fact in the stdout block.

**Commit prefix:** `test(e2e):`

- [ ] **Step 16.1 — Write the end-to-end contamination test**

Create `quoth-plugin/tests/e2e-session-isolation.test.js`:

```javascript
const { describe, it, expect, beforeEach, afterEach, vi } = require('vitest')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')
const Database = require('better-sqlite3')

const HOOK_TC = path.resolve(__dirname, '../hooks/trajectory-capture.js')

function setupHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-e2e-test-'))
  return tmp
}

function hookCapture(home, sid, toolName, input) {
  spawnSync('node', [HOOK_TC], {
    input: JSON.stringify({
      session_id: sid, tool_name: toolName, tool_input: input, tool_result: { output: 'ok' },
    }),
    env: { ...process.env, QUOTH_HOME: home, CLAUDE_PROJECT_DIR: home, CLAUDE_SESSION_ID: sid },
    encoding: 'utf8', timeout: 5000,
  })
}

function freshHookDispatch(home) {
  process.env.QUOTH_HOME = home
  delete require.cache[require.resolve('../hooks/hook-dispatch.js')]
  return require('../hooks/hook-dispatch.js')
}

describe('e2e — parallel sessions never contaminate', () => {
  let home, db, dbPath
  beforeEach(() => {
    home = setupHome()
    process.env.QUOTH_HOME = home
    process.env.CLAUDE_PROJECT_DIR = home
    dbPath = path.join(home, 'memory.db')
    db = require('../daemon/db.js').createDb(new Database(dbPath))
  })
  afterEach(() => {
    try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
  })

  it('session A (productive, 5 entries) + session B (1 entry, routine) do not mix — both pass through processing/', async () => {
    const sidA = 'sess-e2e-A'
    const sidB = 'sess-e2e-B'

    // Interleave: A1, B1, A2, A3, A4, A5.
    hookCapture(home, sidA, 'Bash', { command: 'pnpm test A1' })
    hookCapture(home, sidB, 'Read', { file_path: '/tmp/B1' })
    hookCapture(home, sidA, 'Bash', { command: 'pnpm test A2' })
    hookCapture(home, sidA, 'Bash', { command: 'pnpm test A3' })
    hookCapture(home, sidA, 'Bash', { command: 'pnpm test A4' })
    hookCapture(home, sidA, 'Bash', { command: 'pnpm test A5' })

    // Fire session-end for each.
    process.env.CLAUDE_SESSION_ID = sidA
    let hooks = freshHookDispatch(home)
    await hooks.handle('session-end', {})
    process.env.CLAUDE_SESSION_ID = sidB
    hooks = freshHookDispatch(home)
    await hooks.handle('session-end', {})

    // Run the daemon core on both processing files.
    const { processSessionFile } = require('../daemon/daemon-core.js')
    const fakeExtract = async (summary) => ({
      patterns: summary.total_calls >= 3
        ? [{ id: `pat-${summary.session}`, condition: `when running ${summary.session}`, action: `do the specific workflow that works for session ${summary.session} end to end`, tags: [], quality_signal: 'project', embedding: null, source: 'distilled' }]
        : [],
      facts: [],
    })

    const procFiles = fs.readdirSync(path.join(home, 'trajectories', 'processing'))
      .filter(f => f.endsWith('.jsonl'))

    // Process B first (smaller), then A.
    for (const f of procFiles.sort()) {
      await processSessionFile({
        sessionFile: path.join(home, 'trajectories', 'processing', f),
        db, extractFn: fakeExtract,
      })
    }

    // Verify: A was productive → pattern in DB with id pat-sess-e2e-A
    const patterns = db.getTopPatterns ? db.getTopPatterns(20) : []
    const patA = patterns.find(p => p.id === 'pat-sess-e2e-A')
    expect(patA).toBeTruthy()
    expect(patA.condition).toContain('sess-e2e-A')
    // CRITICAL: no B-flavored pattern
    const patB = patterns.find(p => p.id === 'pat-sess-e2e-B')
    expect(patB).toBeUndefined()

    // A should be in done/<today>/ (productive).
    const today = new Date().toISOString().slice(0, 10)
    const doneDir = path.join(home, 'trajectories', 'done', today)
    expect(fs.existsSync(doneDir)).toBe(true)
    const allDone = walk(doneDir).map(p => path.basename(p))
    expect(allDone.some(f => f.startsWith('sess-e2e-A'))).toBe(true)
    // B must NOT be in done/.
    expect(allDone.some(f => f.startsWith('sess-e2e-B'))).toBe(false)

    // B should be in routine/<today>/ (classified routine because the fake
    // extractor returned 0 patterns/facts). Per spec §6.4: there is NO
    // trivial gate — B went through processing/ like everything else.
    const routineDir = path.join(home, 'trajectories', 'routine', today)
    expect(fs.existsSync(routineDir)).toBe(true)
    const allRoutine = walk(routineDir).map(p => path.basename(p))
    expect(allRoutine.some(f => f.startsWith('sess-e2e-B'))).toBe(true)

    // And NOTHING should be in empty/: empty is reserved for zero-tool_use
    // sessions, not low-signal ones.
    const emptyRoot = path.join(home, 'trajectories', 'empty')
    const allEmpty = walk(emptyRoot).map(p => path.basename(p))
    expect(allEmpty.some(f => f.startsWith('sess-e2e-B'))).toBe(false)
  })
})

describe('e2e — facts survive productive path and surface on next session-restore', () => {
  let home, dbPath
  beforeEach(() => {
    home = setupHome()
    process.env.QUOTH_HOME = home
    process.env.CLAUDE_PROJECT_DIR = home
    dbPath = path.join(home, 'memory.db')
    require('../daemon/db.js').createDb(new Database(dbPath))
  })
  afterEach(() => {
    try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
  })

  it('extracted fact shows up in session-restore stdout for the next session', async () => {
    const sidProducer = 'sess-producer'
    hookCapture(home, sidProducer, 'Bash', { command: 'pnpm -C quoth-plugin test' })
    hookCapture(home, sidProducer, 'Bash', { command: 'pnpm -C quoth-plugin test' })
    hookCapture(home, sidProducer, 'Bash', { command: 'pnpm -C quoth-plugin test' })

    process.env.CLAUDE_SESSION_ID = sidProducer
    let hooks = freshHookDispatch(home)
    await hooks.handle('session-end', {})

    const { processSessionFile } = require('../daemon/daemon-core.js')
    const fakeExtract = async () => ({
      patterns: [],
      facts: [
        { topic: 'plugin build command', statement: 'Build with pnpm -C quoth-plugin test', scope: 'project', tags: ['build'] },
      ],
    })

    const procFiles = fs.readdirSync(path.join(home, 'trajectories', 'processing'))
      .filter(f => f.endsWith('.jsonl'))
    for (const f of procFiles) {
      await processSessionFile({
        sessionFile: path.join(home, 'trajectories', 'processing', f),
        db: require('../daemon/db.js').createDb(new Database(dbPath)),
        extractFn: fakeExtract,
      })
    }

    // Now a FRESH session fires session-restore.
    process.env.CLAUDE_SESSION_ID = 'sess-consumer'
    delete require.cache[require.resolve('../hooks/hook-dispatch.js')]
    const hooks2 = require('../hooks/hook-dispatch.js')

    let captured = ''
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk) => { captured += chunk; return true }
    try { await hooks2.handle('session-restore', {}) }
    finally { process.stdout.write = orig }

    expect(captured).toContain('plugin build command')
    expect(captured).toContain('pnpm -C quoth-plugin test')
  })
})

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}
```

- [ ] **Step 16.2 — Run the e2e test**

```bash
cd quoth-plugin && npm test -- e2e-session-isolation.test.js
```

Expected: green (assuming Tasks 4-11 landed correctly). If any test fails, trace the failure back to the specific task and fix in place (no new code outside the test file — the implementation should already be correct).

- [ ] **Step 16.3 — Full suite sanity check**

```bash
cd quoth-plugin && npm test
```

Expected: all green.

- [ ] **Step 16.4 — Commit**

```bash
git add quoth-plugin/tests/e2e-session-isolation.test.js
git commit -m "$(cat <<'EOF'
test(e2e): session isolation contamination + facts round-trip

Two end-to-end tests that exercise hook → file layout → daemon core
→ db: (1) two interleaved sessions of different sizes, proving that
session A's productive patterns carry only A's context while session
B (1 entry) is classified routine and its content never leaks into
A — both pass through processing/, confirming spec §6.4's "no trivial
gate" rule; (2) a fact extracted from one session becomes visible to
a fresh session's session-restore stdout block.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §8.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Remove dead code (markProcessed, processing.lock, DAILY_EXTRACT_CAP, 3-entry skip)

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js:467-473` (delete `markProcessed`)
- Modify: `quoth-plugin/daemon/daemon.js:48` (delete `LOCK_FILE` constant + acquire/release code)
- Modify: `quoth-plugin/daemon/daemon.js:69-71` (delete `DAILY_EXTRACT_CAP`, `dailyExtractCount`, `dailyExtractDate`)
- Modify: `quoth-plugin/daemon/daemon.js` (delete the old `processSessionBatch`, `processSessionManaged`, `processSessionLocal` functions marked DEPRECATED in Task 8)
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §11

**Goal of the task:** Now that the per-file pipeline is live and all tests pass, purge the dead code. No behavior change — just deletions and their references.

**Commit prefix:** `refactor(daemon):`

- [ ] **Step 17.1 — Grep for all callers before deleting**

Confirm no live callers remain:

```bash
cd quoth-plugin && grep -n 'markProcessed\|DAILY_EXTRACT_CAP\|processing.lock\|processSessionBatch\|dailyExtractCount\|dailyExtractDate' daemon/daemon.js hooks/*.js scripts/*.js 2>/dev/null || echo '(none)'
```

Expected: matches only inside `daemon/daemon.js` itself (the definitions) and any test file that explicitly covers deletion.

If any live callers remain (e.g. in managed mode), refactor them to use the new `processSessionFile` path before proceeding.

- [ ] **Step 17.2 — Delete `markProcessed` and its call sites**

In `quoth-plugin/daemon/daemon.js`, delete the `markProcessed` function definition (lines 467-473) and every line that calls it. There should be zero call sites after Task 8; if you find any, they're in the DEPRECATED functions from Task 8 and get cleaned up in Step 17.4 below.

- [ ] **Step 17.3 — Delete `LOCK_FILE`, `DAILY_EXTRACT_CAP`, daily extract counters**

Delete lines around 48 (`LOCK_FILE` definition), any `acquireLock()` / `releaseLock()` helpers, and the `DAILY_EXTRACT_CAP`, `dailyExtractCount`, `dailyExtractDate` declarations (lines 69-71). Delete any references to them elsewhere in the file.

- [ ] **Step 17.4 — Delete DEPRECATED `processSessionBatch` / `processSessionManaged` / `processSessionLocal`**

These were left in place during Task 8 so the file still compiled. Now that Task 14 has wired the new `extractFn` selection into the worker, delete them. Verify no grep hits outside the deleted code:

```bash
cd quoth-plugin && grep -n 'processSessionBatch\|processSessionManaged' daemon/*.js hooks/*.js 2>/dev/null || echo '(none)'
```

- [ ] **Step 17.5 — Delete `entries.length < 3` skip from the old detectStaleSessions (redundant but double-check)**

Task 10 already replaced `detectStaleSessions` — the old body should be gone. Grep for the literal string:

```bash
cd quoth-plugin && grep -n 'entries.length < 3' daemon/*.js || echo '(none)'
```

Expected: `(none)`.

- [ ] **Step 17.6 — Run full test suite**

```bash
cd quoth-plugin && npm test
```

Expected: green.

- [ ] **Step 17.7 — Lint pass**

```bash
cd quoth-plugin && npm run lint
```

Expected: clean.

- [ ] **Step 17.8 — Commit**

```bash
git add quoth-plugin/daemon/daemon.js
git commit -m "$(cat <<'EOF'
refactor(daemon): remove dead code superseded by per-session pipeline

Deletes:
- markProcessed() and its in-place JSONL rewrite loop — replaced by
  file-level moves in sessions.js
- LOCK_FILE and the acquire/release dance — replaced by fs.rename
  atomicity
- DAILY_EXTRACT_CAP / dailyExtractCount / dailyExtractDate — the
  cap was a workaround for the shared-file contamination that the
  new layout eliminates
- DEPRECATED processSessionBatch / processSessionManaged /
  processSessionLocal — replaced by processSessionFile in
  daemon-core.js
- The entries.length < 3 skip in the old detectStaleSessions — per
  spec §6.4 there is no trivial gate; every non-empty stale session
  goes through processing/ regardless of entry count

No behavior change — this is purely code removal after the new path
was proven in Tasks 8–16.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §11.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Query server routes for sessions and facts

**Files:**
- Modify: `quoth-plugin/daemon/lib/query-server.js:60-135` (add new routes)
- Test: `quoth-plugin/tests/query-server-routes.test.js` (create)
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md` §10.2 decision #10

**Goal of the task:** The query server is the daemon's local HTTP interface — MCP tools and CLIs can hit it over loopback. Add three new routes so operators and agents can inspect session state and manage facts:
- `GET /sessions/:sid/status` — returns `{session_id, project, status, location, tool_count, last_seen_ts}` by searching all buckets.
- `GET /facts/:namespace` — returns `[{topic, statement, evidence, scope, tags, updated_at}]` for the namespace. Accepts `?limit=N`.
- `DELETE /facts/:namespace/:topic` — marks the memory_entries row as `status=archived`. Returns `{deleted: true}` or `{deleted: false}` if not found.

**Commit prefix:** `feat(daemon):`

- [ ] **Step 18.1 — Write failing tests for all three routes**

Create `quoth-plugin/tests/query-server-routes.test.js`:

```javascript
const { describe, it, expect, beforeEach, afterEach } = require('vitest')
const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')
const Database = require('better-sqlite3')

function setupHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-query-test-'))
  for (const b of ['active', 'processing', 'done/2026-04-10/quoth', 'routine', 'empty', 'error']) {
    fs.mkdirSync(path.join(tmp, 'trajectories', b), { recursive: true })
  }
  return tmp
}

function startServer(db, home) {
  const { createQueryServer } = require('../daemon/lib/query-server.js')
  const server = createQueryServer({ db, trajectoriesDir: path.join(home, 'trajectories') })
  return new Promise((resolve) => {
    const srv = server.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

function httpGET(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }))
    })
    req.on('error', reject)
  })
}

function httpDELETE(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'DELETE' }, (res) => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('query-server — session + facts routes', () => {
  let home, db, srv, port
  beforeEach(async () => {
    home = setupHome()
    process.env.QUOTH_HOME = home
    db = require('../daemon/db.js').createDb(new Database(path.join(home, 'query.db')))
    const started = await startServer(db, home)
    srv = started.srv; port = started.port
  })
  afterEach(() => {
    if (srv) srv.close()
    try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
  })

  describe('GET /sessions/:sid/status', () => {
    it('returns 404 for unknown session', async () => {
      const res = await httpGET(port, '/sessions/nope/status')
      expect(res.status).toBe(404)
    })

    it('finds a session in active/', async () => {
      const sid = 'q-active'
      fs.writeFileSync(path.join(home, 'trajectories', 'active', `${sid}.jsonl`), '{}\n')
      fs.writeFileSync(path.join(home, 'trajectories', 'active', `${sid}.meta.json`), JSON.stringify({
        session_id: sid, project: 'quoth', status: 'active',
        first_seen_ts: 1, last_seen_ts: 2, tool_count: 3,
      }))

      const res = await httpGET(port, `/sessions/${sid}/status`)
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('active')
      expect(res.body.location).toBe('active')
      expect(res.body.tool_count).toBe(3)
    })

    it('finds a session in done/YYYY-MM-DD/<project>/', async () => {
      const sid = 'q-done'
      const doneDir = path.join(home, 'trajectories', 'done', '2026-04-10', 'quoth')
      fs.writeFileSync(path.join(doneDir, `${sid}.jsonl`), '{}\n')
      fs.writeFileSync(path.join(doneDir, `${sid}.meta.json`), JSON.stringify({
        session_id: sid, project: 'quoth', status: 'done', tool_count: 10,
      }))

      const res = await httpGET(port, `/sessions/${sid}/status`)
      expect(res.status).toBe(200)
      expect(res.body.location).toContain('done')
    })
  })

  describe('GET /facts/:namespace', () => {
    it('returns empty array for unknown namespace', async () => {
      const res = await httpGET(port, '/facts/facts:proj:unknown')
      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('returns facts with topic/statement/scope', async () => {
      db.insertNewFact({ topic: 'build', statement: 'pnpm test', scope: 'project', tags: ['build'] }, { project: 'quoth', session_id: 's' })
      db.insertNewFact({ topic: 'lint', statement: 'pnpm lint', scope: 'project', tags: [] }, { project: 'quoth', session_id: 's' })

      const res = await httpGET(port, '/facts/facts:proj:quoth')
      expect(res.status).toBe(200)
      expect(res.body.length).toBe(2)
      expect(res.body.map(r => r.topic).sort()).toEqual(['build', 'lint'])
    })

    it('honors ?limit=N', async () => {
      for (let i = 0; i < 5; i++) {
        db.insertNewFact({ topic: `t${i}`, statement: `s${i}`, scope: 'global', tags: [] }, { project: 'quoth', session_id: 's' })
      }
      const res = await httpGET(port, '/facts/facts:global?limit=2')
      expect(res.body.length).toBe(2)
    })
  })

  describe('DELETE /facts/:namespace/:topic', () => {
    it('archives the fact and returns deleted:true', async () => {
      db.insertNewFact({ topic: 'kill-me', statement: 'remove this', scope: 'project', tags: [] }, { project: 'quoth', session_id: 's' })
      const res = await httpDELETE(port, '/facts/facts:proj:quoth/kill-me')
      expect(res.status).toBe(200)
      expect(res.body.deleted).toBe(true)

      const after = await httpGET(port, '/facts/facts:proj:quoth')
      expect(after.body.find(r => r.topic === 'kill-me')).toBeUndefined()
    })

    it('returns deleted:false for unknown fact', async () => {
      const res = await httpDELETE(port, '/facts/facts:proj:quoth/nope')
      expect(res.status).toBe(200)
      expect(res.body.deleted).toBe(false)
    })
  })
})
```

- [ ] **Step 18.2 — Run, watch fail**

```bash
cd quoth-plugin && npm test -- query-server-routes.test.js
```

Expected: fails on import (factory signature change needed) and on every route.

- [ ] **Step 18.3 — Extend `createQueryServer` to accept `trajectoriesDir` and add the routes**

Open `quoth-plugin/daemon/lib/query-server.js`. Find the existing `_handleRequest` and add three new route branches alongside the current `/health` and `/query`:

```javascript
function createQueryServer({ db, trajectoriesDir = null } = {}) {
  // ... existing setup ...

  return http.createServer((req, res) => {
    _handleRequest(req, res, { db, trajectoriesDir })
  })
}

function _handleRequest(req, res, ctx) {
  const url = new URL(req.url, 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean)

  // --- existing routes left in place ---

  // GET /sessions/:sid/status
  if (req.method === 'GET' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'status') {
    const sid = decodeURIComponent(parts[1])
    const info = findSessionInBuckets(sid, ctx.trajectoriesDir)
    if (!info) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_found' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(info))
    return
  }

  // GET /facts/:namespace?limit=N
  if (req.method === 'GET' && parts[0] === 'facts' && parts.length === 2) {
    const ns = decodeURIComponent(parts[1])
    const limit = Math.min(100, Number(url.searchParams.get('limit')) || 20)
    const rows = ctx.db.listFactsByNamespace(ns, limit) || []
    const mapped = rows.map(r => {
      let content
      try { content = JSON.parse(r.content) } catch { content = {} }
      return {
        topic: r.key,
        statement: content.statement || null,
        evidence: content.evidence || null,
        scope: nsToScope(ns),
        tags: r.tags ? JSON.parse(r.tags) : [],
        updated_at: r.updated_at,
      }
    })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(mapped))
    return
  }

  // DELETE /facts/:namespace/:topic
  if (req.method === 'DELETE' && parts[0] === 'facts' && parts.length === 3) {
    const ns = decodeURIComponent(parts[1])
    const topic = decodeURIComponent(parts[2])
    const deleted = ctx.db.archiveFact ? ctx.db.archiveFact(ns, topic) : false
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ deleted: Boolean(deleted) }))
    return
  }

  // ... existing 404 fall-through ...
}

function findSessionInBuckets(sid, trajectoriesDir) {
  if (!trajectoriesDir) return null
  const jsonlName = `${sid}.jsonl`
  const metaName = `${sid}.meta.json`

  // Flat buckets first.
  for (const bucket of ['active', 'processing', 'empty', 'error']) {
    const sidecar = path.join(trajectoriesDir, bucket, metaName)
    if (fs.existsSync(sidecar)) {
      try {
        const meta = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
        return { ...meta, location: bucket }
      } catch {}
    }
  }

  // Dated buckets: done/YYYY-MM-DD/<project>/ and routine/YYYY-MM-DD/<project>/.
  for (const bucket of ['done', 'routine']) {
    const bucketRoot = path.join(trajectoriesDir, bucket)
    if (!fs.existsSync(bucketRoot)) continue
    for (const dateDir of safeReaddir(bucketRoot)) {
      for (const projDir of safeReaddir(path.join(bucketRoot, dateDir))) {
        const sidecar = path.join(bucketRoot, dateDir, projDir, metaName)
        if (fs.existsSync(sidecar)) {
          try {
            const meta = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
            return { ...meta, location: `${bucket}/${dateDir}/${projDir}` }
          } catch {}
        }
      }
    }
  }

  return null
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir) } catch { return [] }
}

function nsToScope(ns) {
  if (ns === 'facts:global') return 'global'
  if (ns.startsWith('facts:proj:')) return 'project'
  return 'unknown'
}
```

Add `fs` and `path` requires at the top of the file if not already imported.

- [ ] **Step 18.4 — Add `archiveFact` helper to `db.js`**

In `quoth-plugin/daemon/db.js`, after `insertNewFact`, add:

```javascript
  const _archiveFactStmt = db.prepare(`
    UPDATE memory_entries SET status = 'archived', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
    WHERE namespace = ? AND key = ? AND status = 'active'
  `)

  function archiveFact(namespace, topic) {
    const info = _archiveFactStmt.run(namespace, topic)
    return info.changes > 0
  }
```

And add `archiveFact` to the `createDb` return object.

- [ ] **Step 18.5 — Run test + full suite**

```bash
cd quoth-plugin && npm test -- query-server-routes.test.js
cd quoth-plugin && npm test
```

Expected: green.

- [ ] **Step 18.6 — Commit**

```bash
git add quoth-plugin/daemon/lib/query-server.js quoth-plugin/daemon/db.js quoth-plugin/tests/query-server-routes.test.js
git commit -m "$(cat <<'EOF'
feat(daemon): query-server routes for session status and fact CRUD

Adds three local HTTP routes so MCP tools and the CLI can inspect
and manage the new session/facts state:

- GET /sessions/:sid/status → searches every bucket (including the
  dated done/ and routine/ trees) and returns the sidecar with the
  bucket location
- GET /facts/:namespace?limit=N → returns structured facts from
  memory_entries, mapping namespace → scope
- DELETE /facts/:namespace/:topic → archives (not hard-deletes) so
  undo remains possible

db.archiveFact does the status flip; rows remain in the table but
won't come back from listFactsByNamespace.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §10.2 decision #10.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Docs update — CLAUDE.md, plugin README, new env vars

**Files:**
- Modify: `quoth-plugin/CLAUDE.md` or `CLAUDE.md` (the pipeline description — mention facts extraction + session isolation)
- Modify: `quoth-plugin/README.md` if it exists (add facts section + new env vars table)
- Reference: `docs/superpowers/specs/2026-04-10-session-isolation.md`

**Goal of the task:** Make the new behavior discoverable. Document the per-session layout, the facts extraction schema, the new env vars (`QUOTH_STALE_TTL_MS`, `QUOTH_RETENTION_*_DAYS`, `QUOTH_MANAGED_LOCAL_BACKGROUND`), and the migration script. Note: there is NO `QUOTH_TRIVIAL_TTL_MS` — spec §6.4 removed the trivial gate entirely.

**Commit prefix:** `docs:`

- [ ] **Step 19.1 — Check which docs exist**

```bash
cd quoth-plugin && ls CLAUDE.md README.md 2>/dev/null
```

Note which files exist. Do not create files that aren't there — the root `CLAUDE.md` is the only guaranteed docs target.

- [ ] **Step 19.2 — Update the root `CLAUDE.md` pipeline section**

In `/home/lord_montino/projects/agents-tools/quoth/CLAUDE.md`, find the "What It Does" bullet list (around "Logs all agent trajectories to `~/.quoth/trajectories/{repo-name}-{date}.jsonl`"). Replace the trajectory path line with:

```markdown
- Logs each agent session to its own JSONL at `~/.quoth/trajectories/active/<sessionId>.jsonl` with a sidecar `<sessionId>.meta.json` for status + metadata
- On session end, hook atomically renames the pair into `~/.quoth/trajectories/processing/` — the rename IS the handoff to the daemon
- Daemon processes each file individually, archives productive sessions to `done/YYYY-MM-DD/<project>/`, routine ones to `routine/`, empty (zero tool_use) to `empty/`, and failures to `error/`
- 3-stage pipeline (JUDGE → DISTILL → CONSOLIDATE) now extracts BOTH patterns (reusable techniques) and facts (stable session-independent knowledge)
- Facts land in `memory_entries` under `facts:global` or `facts:proj:<project>` depending on scope (spec §6.6: only two scopes, no facts:user)
- `session-restore` hook injects the top 5 facts per namespace into the new session's initial context
```

Add a new section "## Trajectory Layout" with:

```markdown
## Trajectory Layout (v3.5+)

```
~/.quoth/trajectories/
  active/                        # in-progress sessions (written by trajectory-capture.js)
  processing/                    # claimed by daemon (renamed from active/ on session-end)
  done/YYYY-MM-DD/<project>/     # productive sessions with patterns/facts
  routine/                       # routine sessions with no meaningful output
  empty/                         # sessions with zero tool_use entries
  error/                         # EXTRACT failures
  migrated-legacy/               # pre-v3.5 files (one-shot migration target)
```

State machine: `active → processing → {done, routine, empty, error}`.

Each `<sessionId>.jsonl` is paired with `<sessionId>.meta.json`. Sidecars contain `{session_id, project, status, first_seen_ts, last_seen_ts, tool_count, closed_marker, ...}`. Both files move together on every state change via `fs.renameSync` (POSIX atomic).
```

- [ ] **Step 19.3 — Update env vars table**

Still in `/home/lord_montino/projects/agents-tools/quoth/CLAUDE.md`, find the env vars section under "Daemon Modes" and add:

```markdown
### New in v3.5

- `QUOTH_STALE_TTL_MS` (default 1800000 / 30 min) — idle time after which an active session is considered stale and flushed to processing/. Applies to every non-empty session regardless of entry count (per spec §6.4 there is NO trivial gate; a session that crashed after 2 Writes is potentially the most valuable kind of trajectory)
- `QUOTH_RETENTION_DONE_DAYS` (default 30) — nightly sweep deletes done/ files older than this
- `QUOTH_RETENTION_ROUTINE_DAYS` (default 7)
- `QUOTH_RETENTION_EMPTY_DAYS` (default 3)
- `QUOTH_RETENTION_ERROR_DAYS` (default 14)
- `QUOTH_MANAGED_LOCAL_BACKGROUND` (default false) — when true in managed mode, run EXTRACT locally and post to cloud as confirmation
```

- [ ] **Step 19.4 — Mention the migration script**

Under the "Setup" section of `/home/lord_montino/projects/agents-tools/quoth/CLAUDE.md`, add a line after the existing init commands:

```markdown
# Migrate existing install from pre-v3.5 shared-file layout
node quoth-plugin/scripts/migrate-session-isolation.js         # split legacy files
node quoth-plugin/scripts/migrate-session-isolation.js --dry-run  # preview without writing
```

- [ ] **Step 19.5 — Verify build/lint still clean**

```bash
cd quoth-plugin && npm test
cd quoth-plugin && npm run lint
```

Expected: green.

- [ ] **Step 19.6 — Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document session isolation layout, facts extraction, new env vars

CLAUDE.md now explains the active/processing/done/routine/empty/error
directory layout, the new facts namespaces (facts:global and
facts:proj:<p>), the pattern+facts extraction schema, and the
migration script. The env vars for stale TTL, retention, and the
managed-mode local-background flag are listed under Daemon Modes.

Spec: docs/superpowers/specs/2026-04-10-session-isolation.md.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

After Task 19's commit, run the whole chain one more time:

```bash
cd quoth-plugin && npm test
cd quoth-plugin && npm run lint
git log --oneline -25
```

Expected: all 19 tasks present as commits in order, full suite green, lint clean.

Then optionally run the migration against your real `~/.quoth` (dry-run first!):

```bash
node quoth-plugin/scripts/migrate-session-isolation.js --dry-run
node quoth-plugin/scripts/migrate-session-isolation.js
systemctl --user restart quoth-daemon   # or whatever the daemon restart command is
```

Watch `~/.quoth/daemon.log` for the first few `processSessionFile` entries — any `error/` arrivals point to a session that needs manual triage.

---

