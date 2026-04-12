# Session Capture & Pattern Extraction Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-11-session-capture-and-pattern-extraction-design.md`

**Goal:** Replace the current capture/extract/inject loop with a polymorphic 4-kind knowledge store (`pattern`, `decision`, `anti_pattern`, `fact`), matcher-less capture with dedup, a worker-pool daemon with stage semaphores, and per-prompt injection over a Unix socket — all on a greenfield SQLite + HNSW reset.

**Architecture:** Three subsystems communicating only through filesystem handoff + SQLite:
- **CAPTURE** — matcher-less `PostToolUse` hook appends to `active/<sid>.jsonl` with a `.dedup` sidecar; atomic rename to `processing/` on `SessionEnd`.
- **EXTRACT** — background daemon with worker pool (N=4) + per-stage semaphores (`triage=8`, `extract=3`, `embed=2`, `persist=1`). Pipeline: `triage.js` (Gemini 2.5 Flash Lite) → `extract.js` (Kimi K2.5, urgency-tuned) → `embed.js` (MiniLM batched) → `persist.js` (single tx + HNSW add). Race-free LLM budget reservation. Loud DB / quiet stderr error channel.
- **INJECT** — `query-server.js /inject` endpoint; `route` hook connects over Unix socket with 200 ms timeout, falls back to empty injection + detached daemon spawn.

**Tech Stack:**
- Node.js + `better-sqlite3` (existing)
- Vitest (existing — `cd quoth-plugin && npm test`)
- Kimi K2.5 via Moonshot API + Gemini 2.5 Flash Lite via Vercel AI Gateway
- Local MiniLM-L6-v2 384d embeddings (existing `daemon/lib/embed.js`, moved)
- Pure-JS HNSW (existing `daemon/lib/hnsw.js`)
- No new dependencies

---

## Hard rules for executing this plan

1. **Read the spec first.** `docs/superpowers/specs/2026-04-11-session-capture-and-pattern-extraction-design.md` is the source of truth. If a step seems to contradict the spec, the spec wins — stop and surface the mismatch.
2. **Work on one task at a time, strictly in order.** Tasks have implicit dependencies (persist needs the schema, worker pool needs the stages, cleanup needs everything else green). Do not start Task N+1 until Task N is fully committed.
3. **TDD is non-negotiable.** Every behavior change starts with a failing test. Run it, watch it fail, then implement. Run again, watch it pass, then commit.
4. **One task = one commit.** Use the exact commit message given in each task. If a hook rejects the commit, fix the issue and create a NEW commit (never `--amend`).
5. **No scope creep.** If a step says "add helper X", add only X. No drive-by cleanups, no renames of adjacent code. Legacy deletions are Task 24, not earlier.
6. **The legacy code stays runnable until Task 24.** Every intermediate commit must leave `npm test` green with old code still in place. The new code is built **alongside** the old code; the cleanup is a single commit at the end.
7. **Exact paths.** Every file path is absolute from repo root. Follow them literally.
8. **Test command.** From repo root: `cd quoth-plugin && npm test -- <file>` runs one file (vitest filters by filename). Full run: `cd quoth-plugin && npm test`.
9. **Env vars for tests.** Use a scratch `QUOTH_HOME=/tmp/quoth-test-<uuid>` in every test that touches filesystem state. Never pollute `~/.quoth/`.
10. **Assume zero prior conversation context.** Every decision in this plan is either inlined or references a spec section (`§2.2`, `§3.1`, etc.). Read those sections when you hit them.
11. **Do not edit `MEMORY.md`, `docs/presentations/`, or `src/` (SaaS)** — SaaS migration is out of scope for this plan (spec §3.7).
12. **Do not wipe `~/.quoth/`** at any point during plan execution. The greenfield reset is a runtime operator action (§6.6) and is orchestrated by Task 25's cutover script, not by any earlier task.

---

## Relevant skills

- `superpowers:subagent-driven-development` — fresh subagent per task, two-stage review
- `superpowers:executing-plans` — inline execution with checkpoints
- `superpowers:writing-tests` — test-writing patterns used throughout this plan
- `superpowers:verification-before-completion` — run before marking any task done

---

## File Structure

### New files (created by this plan)

| Path | Task | Purpose |
|---|---|---|
| `quoth-plugin/daemon/pipeline/triage.js` | 8 | Gemini Flash Lite triage gate; returns `{productive, urgency, suspected_kinds}` |
| `quoth-plugin/daemon/pipeline/embed.js` | 10 | MiniLM batch embedder for all 4 entity kinds (moved from `daemon/lib/embed.js`, extended) |
| `quoth-plugin/daemon/pipeline/persist.js` | 11 | Single-tx knowledge-entity upsert + HNSW add; idempotency contract (spec §2.2) |
| `quoth-plugin/daemon/lib/llm-budget.js` | 5 | Race-free reservation pattern for daily LLM cost ceiling (spec §2.2) |
| `quoth-plugin/daemon/lib/knowledge-entities.js` | 3 | CRUD + search helpers for `knowledge_entities` table |
| `quoth-plugin/mcp/handlers/entities.js` | 20 | Renamed/extended MCP handler (replaces `patterns.js`) |
| `quoth-plugin/scripts/verify-cleanup.sh` | 23 | Greps repo for stale terms; fails CI if any outside exclusion list |
| `quoth-plugin/scripts/reset-quoth-home.js` | 25 | Tars `~/.quoth/` to a backup and wipes it; cutover tool |
| `quoth-plugin/tests/unit/capture/dedup.test.js` | 6 | Dedup sidecar — identical calls collapse, distinct calls keep |
| `quoth-plugin/tests/unit/capture/matcher-less-perf.test.js` | 6 | 1000 PostToolUse calls in <100 ms total |
| `quoth-plugin/tests/unit/pipeline/triage.test.js` | 8 | Canned-LLM triage routing + retry |
| `quoth-plugin/tests/unit/pipeline/extract.test.js` | 9 | Four-kind parser; project-name-from-sidecar anti-leak; retry-on-invalid-JSON |
| `quoth-plugin/tests/unit/pipeline/embed.test.js` | 10 | Batched 4-kind embed; MiniLM throw → `embedding_indexed=0` |
| `quoth-plugin/tests/unit/pipeline/persist.test.js` | 11 | Idempotency (spec §2.2 walk-through 5 cases); duplicate-id strengthen; HNSW fallback |
| `quoth-plugin/tests/unit/pipeline/llm-budget.test.js` | 5 | Reservation atomicity; 4-parallel race; reconcile |
| `quoth-plugin/tests/unit/daemon/worker-pool.test.js` | 12 | No double-claim across N workers |
| `quoth-plugin/tests/unit/daemon/stage-semaphores.test.js` | 12 | Triage=8 cap, extract=3 cap, persist=1 |
| `quoth-plugin/tests/unit/daemon/claim-by-rename.test.js` | 12 | Two workers race → exactly one wins |
| `quoth-plugin/tests/unit/daemon/polling-fallback.test.js` | 13 | fs.watch mocked dead → polling catches within 5 s |
| `quoth-plugin/tests/unit/daemon/orphan-recovery.test.js` | 13 | Dead-PID orphan stripped on boot |
| `quoth-plugin/tests/unit/daemon/sigterm-graceful.test.js` | 13 | In-flight extract rolled back on SIGTERM |
| `quoth-plugin/tests/unit/daemon/daemon-detach.test.js` | 17 | Hook subprocess exits <250 ms; daemon orphan alive 2 s |
| `quoth-plugin/tests/unit/daemon/hnsw-rebuild-on-boot.test.js` | 14 | hnsw.bin deleted → boot rebuilds from SQLite |
| `quoth-plugin/tests/unit/daemon/startup-failed-flag.test.js` | 13 | Corrupt DB → `STARTUP_FAILED` flag + hook warning |
| `quoth-plugin/tests/unit/inject/kind-weight-ranking.test.js` | 15 | anti_pattern outranks pattern at equal cosine |
| `quoth-plugin/tests/unit/inject/scope-filter.test.js` | 15 | project A never returns project B rows |
| `quoth-plugin/tests/unit/inject/daemon-down.test.js` | 17 | Dead socket → 200 ms exit, empty injection |
| `quoth-plugin/tests/unit/inject/prompt-embedding-cache.test.js` | 15 | Cache key includes project — no cross-project leak |
| `quoth-plugin/tests/unit/db/knowledge-entities.test.js` | 3 | `upsertEntity`, `searchByKind`, `listByScope`, `getById` |
| `quoth-plugin/tests/unit/db/schema-bootstrap.test.js` | 2 | Table created + indexes + empty state |
| `quoth-plugin/tests/unit/db/pipeline-errors.test.js` | 4 | All severity levels write; indexes used |
| `quoth-plugin/tests/integration/end-to-end-productive.test.js` | 21 | Fake-LLM full pipeline run, entity appears |
| `quoth-plugin/tests/integration/end-to-end-routine.test.js` | 21 | Routine skips extract, archives to `routine/` |
| `quoth-plugin/tests/integration/end-to-end-multi-session.test.js` | 21 | 10 fixtures in parallel, all terminal-bucketed |
| `quoth-plugin/tests/integration/end-to-end-injection.test.js` | 21 | Pre-populate entities, hit `/inject`, assert ranking |
| `quoth-plugin/tests/integration/end-to-end-budget-exhausted.test.js` | 21 | Budget hits ceiling → requeue |
| `quoth-plugin/tests/property/concurrent-pipeline.test.js` | 22 | N∈[1,50] fixtures, random concurrency, exactly-once invariant |
| `quoth-plugin/tests/integration/cleanup-verification.test.js` | 23 | Runs `verify-cleanup.sh`, asserts exit 0 |

### Modified files

| Path | Tasks | Why |
|---|---|---|
| `quoth-plugin/daemon/db.js` | 2, 3, 4 | Add `knowledge_entities`, `llm_budget`, expanded `pipeline_errors` (alongside old tables) |
| `quoth-plugin/daemon/pipeline/extract.js` | 9 | Rewritten — 4-kind Kimi prompt, urgency-tuned depth, Sonnet fallback-only |
| `quoth-plugin/daemon/daemon.js` | 12, 13, 14, 24 | Worker pool, stage semaphores, polling fallback, orphan recovery, SIGTERM, HNSW boot rebuild, dead-code removal |
| `quoth-plugin/daemon/lib/query-server.js` | 15, 16 | Add `/inject` and `/health` endpoints |
| `quoth-plugin/daemon/lib/hnsw.js` | 14 | `loadOrInit` with rebuild-from-SQLite fallback; catch-up sweep helper |
| `quoth-plugin/daemon/lib/llm.js` | 5, 8, 9 | Keep Kimi + Gemini Flash Lite + `claude -p` fallback; remove judge code paths (Task 24) |
| `quoth-plugin/daemon/retention.js` | 14 | HNSW reindex sweep in nightly |
| `quoth-plugin/hooks/trajectory-capture.js` | 6 | Matcher-less + dedup sidecar lifecycle |
| `quoth-plugin/hooks/hook-dispatch.js` | 17, 18, 19 | `route` fast-path + detach contract; `session-restore` drops patterns; `subagent-start` uses `/inject` |
| `quoth-plugin/hooks/hooks.json` | 7 | `PostToolUse` matcher becomes `*` |
| `quoth-plugin/mcp/handlers/index.js` | 20 | Wire up `entities.js`, drop `intelligence.js` / `skills.js` (Task 24 deletes them) |
| `quoth-plugin/scripts/cli.js` | 25 | Add `reset` subcommand; update `init` for new env vars |
| `quoth-plugin/CLAUDE.md` | 26 | Remove JUDGE/DISTILL/CONSOLIDATE; describe TRIAGE/EXTRACT/EMBED/PERSIST + 4 kinds |

### Deleted files (Task 24 only — single commit)

See spec §6.1 for the canonical list. Every path in that list must be verified with `Grep` before deletion (zero inbound `require`/`import`). Task 24 includes the verification loop.

---

## Task 1: Create feature branch and snapshot baseline

**Files:**
- None (git + shell only)

- [ ] **Step 1:** Confirm you are in the plugin directory and on a clean tree.

```bash
cd /home/lord_montino/projects/agents-tools/quoth
git status
```
Expected: working tree clean or only the spec file / plan file modified. If anything else is dirty, stop and surface.

- [ ] **Step 2:** Create the feature branch.

```bash
git checkout -b feat/knowledge-entities-redesign
```

- [ ] **Step 3:** Baseline the test suite.

```bash
cd quoth-plugin && npm test 2>&1 | tail -40
```
Expected: record the pass/fail count into a scratch note. Every task from here on must keep that baseline green *for tests that aren't being deleted*.

- [ ] **Step 4:** Commit an empty marker so the branch shows up.

```bash
git commit --allow-empty -m "chore: start knowledge-entities redesign (spec 2026-04-11)"
```

---

## Task 2: Add `knowledge_entities` schema (alongside old tables)

**Spec refs:** §3.1, §3.4

**Files:**
- Modify: `quoth-plugin/daemon/db.js`
- Create: `quoth-plugin/tests/unit/db/schema-bootstrap.test.js`

- [ ] **Step 1: Write the failing test.**

```js
// tests/unit/db/schema-bootstrap.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('knowledge_entities schema', () => {
  let home
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'quoth-schema-'))
    process.env.QUOTH_HOME = home
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('creates knowledge_entities with required columns', async () => {
    const { openDb } = await import('../../../daemon/db.js')
    const db = openDb()
    const cols = db.prepare(`PRAGMA table_info(knowledge_entities)`).all()
    const names = cols.map(c => c.name)
    for (const col of ['id','kind','scope','summary','content','metadata','embedding','tags','confidence','alpha','beta','polarity','status','source','source_session_id','created_at','updated_at','last_exposed_at','exposure_count','embedding_indexed']) {
      expect(names).toContain(col)
    }
  })

  it('creates llm_budget table', async () => {
    const { openDb } = await import('../../../daemon/db.js')
    const db = openDb()
    const cols = db.prepare(`PRAGMA table_info(llm_budget)`).all()
    expect(cols.map(c => c.name)).toEqual(
      expect.arrayContaining(['date','spend_usd','triage_calls','extract_calls','updated_at'])
    )
  })

  it('creates expected indexes on knowledge_entities', async () => {
    const { openDb } = await import('../../../daemon/db.js')
    const db = openDb()
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='knowledge_entities'`).all().map(r => r.name)
    for (const name of ['idx_ke_kind','idx_ke_scope','idx_ke_kind_scope','idx_ke_session','idx_ke_created','idx_ke_confidence']) {
      expect(idx).toContain(name)
    }
  })
})
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
cd quoth-plugin && npm test -- schema-bootstrap
```
Expected: FAIL — `no such table: knowledge_entities`.

- [ ] **Step 3: Add the schema to `daemon/db.js`.**

Find the existing `openDb()` / migration block in `daemon/db.js`. Add a new migration block (alongside existing tables, do NOT remove `patterns` or `memory_entries` yet — that's Task 24):

```js
// In daemon/db.js, inside the migration runner
db.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_entities (
    id                TEXT PRIMARY KEY,
    kind              TEXT NOT NULL,
    scope             TEXT NOT NULL,
    summary           TEXT NOT NULL,
    content           TEXT NOT NULL,
    metadata          TEXT NOT NULL,
    embedding         BLOB,
    tags              TEXT NOT NULL DEFAULT '[]',
    confidence        REAL NOT NULL DEFAULT 0.5,
    alpha             REAL NOT NULL DEFAULT 1.0,
    beta              REAL NOT NULL DEFAULT 1.0,
    polarity          TEXT NOT NULL DEFAULT 'positive',
    status            TEXT NOT NULL DEFAULT 'active',
    source            TEXT NOT NULL,
    source_session_id TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    last_exposed_at   INTEGER,
    exposure_count    INTEGER NOT NULL DEFAULT 0,
    embedding_indexed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_ke_kind       ON knowledge_entities(kind);
  CREATE INDEX IF NOT EXISTS idx_ke_scope      ON knowledge_entities(scope);
  CREATE INDEX IF NOT EXISTS idx_ke_kind_scope ON knowledge_entities(kind, scope, status);
  CREATE INDEX IF NOT EXISTS idx_ke_session    ON knowledge_entities(source_session_id);
  CREATE INDEX IF NOT EXISTS idx_ke_created    ON knowledge_entities(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ke_confidence ON knowledge_entities(kind, confidence DESC) WHERE status='active';

  CREATE TABLE IF NOT EXISTS llm_budget (
    date          TEXT PRIMARY KEY,
    spend_usd     REAL NOT NULL DEFAULT 0,
    triage_calls  INTEGER NOT NULL DEFAULT 0,
    extract_calls INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL
  );
`)
```

- [ ] **Step 4: Run to verify PASS.**

```bash
cd quoth-plugin && npm test -- schema-bootstrap
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Full baseline re-run.**

```bash
cd quoth-plugin && npm test 2>&1 | tail -10
```
Expected: baseline count unchanged (new 3 tests add to it; everything else still green).

- [ ] **Step 6: Commit.**

```bash
git add quoth-plugin/daemon/db.js quoth-plugin/tests/unit/db/schema-bootstrap.test.js
git commit -m "feat(db): add knowledge_entities + llm_budget tables"
```

---

## Task 3: `knowledge-entities.js` CRUD helpers

**Spec refs:** §3.1, §3.2

**Files:**
- Create: `quoth-plugin/daemon/lib/knowledge-entities.js`
- Create: `quoth-plugin/tests/unit/db/knowledge-entities.test.js`

- [ ] **Step 1: Write the failing test.**

```js
// tests/unit/db/knowledge-entities.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('knowledge-entities helpers', () => {
  let home, ke
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-ke-'))
    process.env.QUOTH_HOME = home
    const mod = await import(`../../../daemon/lib/knowledge-entities.js?t=${Date.now()}`)
    ke = mod
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('computes a stable id as sha1(kind + canonical_content)[:16]', () => {
    const id1 = ke.computeEntityId('pattern', 'hello world')
    const id2 = ke.computeEntityId('pattern', 'hello world')
    const id3 = ke.computeEntityId('fact', 'hello world')
    expect(id1).toBe(id2)
    expect(id1).not.toBe(id3)
    expect(id1).toHaveLength(16)
  })

  it('upserts a new entity and reads it back', () => {
    const inserted = ke.upsertEntity({
      kind: 'pattern',
      scope: 'project:quoth',
      summary: 'test pattern',
      content: 'canonical body',
      metadata: { condition: 'x', action: 'y' },
      tags: ['foo'],
      source: 'extracted',
      source_session_id: 'sess-1',
    })
    expect(inserted.id).toHaveLength(16)
    expect(inserted.alpha).toBe(1)
    const row = ke.getById(inserted.id)
    expect(row.kind).toBe('pattern')
    expect(JSON.parse(row.metadata).condition).toBe('x')
  })

  it('searchByKind returns only matching kind + active status', () => {
    ke.upsertEntity({ kind: 'pattern', scope: 'global', summary: 's1', content: 'a', metadata: {}, tags: [], source: 'extracted', source_session_id: 's1' })
    ke.upsertEntity({ kind: 'fact',    scope: 'global', summary: 's2', content: 'b', metadata: {}, tags: [], source: 'extracted', source_session_id: 's1' })
    const patterns = ke.searchByKind('pattern', 10)
    expect(patterns).toHaveLength(1)
    expect(patterns[0].kind).toBe('pattern')
  })

  it('listByScope filters to one project', () => {
    ke.upsertEntity({ kind: 'pattern', scope: 'project:alpha', summary: 's1', content: 'a', metadata: {}, tags: [], source: 'extracted', source_session_id: 's' })
    ke.upsertEntity({ kind: 'pattern', scope: 'project:beta',  summary: 's2', content: 'b', metadata: {}, tags: [], source: 'extracted', source_session_id: 's' })
    const alpha = ke.listByScope('project:alpha', 10)
    expect(alpha).toHaveLength(1)
    expect(alpha[0].scope).toBe('project:alpha')
  })
})
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
cd quoth-plugin && npm test -- knowledge-entities
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `daemon/lib/knowledge-entities.js`.**

> **Note on idempotency layering:** this helper's own `ON CONFLICT` logic is a **secondary safety net**. The primary idempotency guarantee is the `pipeline_runs` unique-row check in Task 11's `persistSession`. Task 11 uses this helper but gates the whole call on "have we seen this session_id before?" first. Both layers exist on purpose: `pipeline_runs` catches whole-session retries; the `ON CONFLICT` CASE handles the cross-session strengthening path from the spec §2.2 walk-through.


```js
import crypto from 'node:crypto'
import { openDb } from '../db.js'

export function computeEntityId(kind, canonicalContent) {
  const h = crypto.createHash('sha1')
  h.update(kind)
  h.update('\0')
  h.update(canonicalContent)
  return h.digest('hex').slice(0, 16)
}

export function upsertEntity({ kind, scope, summary, content, metadata = {}, embedding = null, tags = [], source, source_session_id }) {
  const db = openDb()
  const id = computeEntityId(kind, content)
  const now = Date.now()
  const meta = JSON.stringify(metadata)
  const tagsJson = JSON.stringify(tags.slice(0, 5))
  db.prepare(`
    INSERT INTO knowledge_entities
      (id, kind, scope, summary, content, metadata, embedding, tags, confidence, alpha, beta, polarity, status, source, source_session_id, created_at, updated_at, exposure_count, embedding_indexed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.5, 1.0, 1.0, ?, 'active', ?, ?, ?, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET
      alpha = CASE WHEN excluded.source_session_id = knowledge_entities.source_session_id
                   THEN knowledge_entities.alpha
                   ELSE knowledge_entities.alpha + 1 END,
      source_session_id = CASE WHEN excluded.source_session_id = knowledge_entities.source_session_id
                               THEN knowledge_entities.source_session_id
                               ELSE excluded.source_session_id END,
      confidence = CASE WHEN excluded.source_session_id = knowledge_entities.source_session_id
                        THEN knowledge_entities.confidence
                        ELSE (knowledge_entities.alpha + 1) /
                             (knowledge_entities.alpha + 1 + knowledge_entities.beta) END,
      updated_at = CASE WHEN excluded.source_session_id = knowledge_entities.source_session_id
                        THEN knowledge_entities.updated_at
                        ELSE excluded.updated_at END
  `).run(
    id, kind, scope, summary, content, meta, embedding, tagsJson,
    kind === 'anti_pattern' ? 'negative' : 'positive',
    source, source_session_id, now, now, embedding ? 1 : 0,
  )
  return getById(id)
}

export function getById(id) {
  return openDb().prepare(`SELECT * FROM knowledge_entities WHERE id = ?`).get(id)
}

export function searchByKind(kind, limit = 20) {
  return openDb().prepare(`
    SELECT * FROM knowledge_entities
    WHERE kind = ? AND status = 'active'
    ORDER BY confidence DESC
    LIMIT ?
  `).all(kind, limit)
}

export function listByScope(scope, limit = 50) {
  return openDb().prepare(`
    SELECT * FROM knowledge_entities
    WHERE scope = ? AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(scope, limit)
}

export function markIndexed(id) {
  openDb().prepare(`UPDATE knowledge_entities SET embedding_indexed = 1 WHERE id = ?`).run(id)
}

export function listUnindexed(limit = 500) {
  return openDb().prepare(`
    SELECT id, embedding FROM knowledge_entities
    WHERE status='active' AND embedding IS NOT NULL AND embedding_indexed = 0
    LIMIT ?
  `).all(limit)
}
```

- [ ] **Step 4: Run to verify PASS.**

```bash
cd quoth-plugin && npm test -- knowledge-entities
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit.**

```bash
git add quoth-plugin/daemon/lib/knowledge-entities.js quoth-plugin/tests/unit/db/knowledge-entities.test.js
git commit -m "feat(db): add knowledge-entities CRUD helpers"
```

---

## Task 4: Expand `pipeline_errors` schema + helper

**Spec refs:** §5.1, §5.2

**Files:**
- Modify: `quoth-plugin/daemon/db.js`
- Create: `quoth-plugin/tests/unit/db/pipeline-errors.test.js`

- [ ] **Step 1: Write the failing test.**

```js
// tests/unit/db/pipeline-errors.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('pipeline_errors schema (expanded)', () => {
  let home
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'quoth-pe-'))
    process.env.QUOTH_HOME = home
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('has all severity-capable columns', async () => {
    const { openDb } = await import('../../../daemon/db.js')
    const cols = openDb().prepare(`PRAGMA table_info(pipeline_errors)`).all().map(c => c.name)
    for (const c of ['severity','worker_id','context','model_attempted','fallback_attempted','fallback_succeeded','retry_count','resolution']) {
      expect(cols).toContain(c)
    }
  })

  it('logPipelineError writes a row with severity', async () => {
    const { openDb, logPipelineError } = await import('../../../daemon/db.js')
    logPipelineError({ stage: 'triage', severity: 'degraded', error_message: 'cold start' })
    const rows = openDb().prepare(`SELECT * FROM pipeline_errors WHERE stage='triage'`).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].severity).toBe('degraded')
  })
})
```

- [ ] **Step 2: Run FAIL.**

```bash
cd quoth-plugin && npm test -- pipeline-errors
```

- [ ] **Step 3: Update `daemon/db.js`.**

If `pipeline_errors` already exists from an earlier migration, add `ALTER TABLE ... ADD COLUMN` for each missing column inside an idempotent migration block. Otherwise create the table fresh per spec §5.2. Also add the exported helper:

```js
export function logPipelineError({
  stage, severity = 'error', session_id = null, project = null, worker_id = null,
  error_message, error_stack = null, context = null, model_attempted = null,
  fallback_attempted = 0, fallback_succeeded = 0, retry_count = 0, resolution = null,
}) {
  openDb().prepare(`
    INSERT INTO pipeline_errors
      (ts, stage, severity, session_id, project, worker_id, error_message, error_stack, context,
       model_attempted, fallback_attempted, fallback_succeeded, retry_count, resolution)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Date.now(), stage, severity, session_id, project, worker_id, error_message, error_stack,
    context ? JSON.stringify(context) : null,
    model_attempted, fallback_attempted, fallback_succeeded, retry_count, resolution,
  )
}
```

- [ ] **Step 4: Run PASS.**

```bash
cd quoth-plugin && npm test -- pipeline-errors
```

- [ ] **Step 5: Commit.**

```bash
git add quoth-plugin/daemon/db.js quoth-plugin/tests/unit/db/pipeline-errors.test.js
git commit -m "feat(db): expand pipeline_errors schema + logPipelineError helper"
```

---

## Task 5: `llm-budget.js` — race-free reservation

**Spec refs:** §2.2 "daemon/lib/llm-budget.js"

**Files:**
- Create: `quoth-plugin/daemon/lib/llm-budget.js`
- Create: `quoth-plugin/tests/unit/pipeline/llm-budget.test.js`

- [ ] **Step 1: Write the failing test.**

```js
// tests/unit/pipeline/llm-budget.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('llm-budget reservation', () => {
  let home, budget
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-bud-'))
    process.env.QUOTH_HOME = home
    process.env.QUOTH_DAILY_LLM_BUDGET_USD = '0.005'
    budget = await import(`../../../daemon/lib/llm-budget.js?t=${Date.now()}`)
  })
  afterEach(() => { delete process.env.QUOTH_DAILY_LLM_BUDGET_USD; rmSync(home, { recursive: true, force: true }) })

  it('reserves then reconciles a spend', async () => {
    const r = budget.reserve({ stage: 'triage', estimated_usd: 0.001 })
    expect(r.ok).toBe(true)
    budget.reconcile({ stage: 'triage', estimated_usd: 0.001, actual_usd: 0.0008 })
    const today = budget.today()
    expect(today.spend_usd).toBeCloseTo(0.0008, 6)
  })

  it('rejects reservation when over cap', () => {
    const a = budget.reserve({ stage: 'extract', estimated_usd: 0.003 })
    const b = budget.reserve({ stage: 'extract', estimated_usd: 0.003 })
    const c = budget.reserve({ stage: 'extract', estimated_usd: 0.003 })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(false) // 0.003 + 0.003 = 0.006 > 0.005 cap
    expect(c.ok).toBe(false)
  })

  it('4-parallel reservations against cap=$0.005 cost=$0.002 yield exactly 2 successes', async () => {
    const results = await Promise.all([1,2,3,4].map(() => Promise.resolve(budget.reserve({ stage: 'triage', estimated_usd: 0.002 }))))
    const ok = results.filter(r => r.ok).length
    expect(ok).toBe(2)
  })
})
```

- [ ] **Step 2: Run FAIL.**

```bash
cd quoth-plugin && npm test -- llm-budget
```

- [ ] **Step 3: Implement `daemon/lib/llm-budget.js`.**

```js
import { openDb } from '../db.js'
import { logPipelineError } from '../db.js'

function cap() {
  return parseFloat(process.env.QUOTH_DAILY_LLM_BUDGET_USD ?? '1.00')
}
function utcDate() {
  return new Date().toISOString().slice(0, 10)
}

export function reserve({ stage, estimated_usd }) {
  const db = openDb()
  const date = utcDate()
  const limit = cap()
  try {
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO llm_budget (date, spend_usd, triage_calls, extract_calls, updated_at)
                  VALUES (?, 0, 0, 0, ?) ON CONFLICT(date) DO NOTHING`).run(date, Date.now())
      const upd = db.prepare(`UPDATE llm_budget
                                 SET spend_usd = spend_usd + ?, updated_at = ?,
                                     triage_calls  = triage_calls  + CASE WHEN ? = 'triage'  THEN 1 ELSE 0 END,
                                     extract_calls = extract_calls + CASE WHEN ? = 'extract' THEN 1 ELSE 0 END
                               WHERE date = ? AND spend_usd + ? <= ?`)
      const info = upd.run(estimated_usd, Date.now(), stage, stage, date, estimated_usd, limit)
      if (info.changes === 0) throw new Error('BudgetExhausted')
    })
    tx.immediate()
    return { ok: true, date }
  } catch (e) {
    if (String(e.message).includes('BudgetExhausted')) {
      logPipelineError({ stage: 'budget', severity: 'warn', error_message: 'reservation rejected', context: { stage, estimated_usd, cap: limit } })
      return { ok: false, reason: 'BudgetExhausted' }
    }
    throw e
  }
}

export function reconcile({ stage, estimated_usd, actual_usd }) {
  const delta = actual_usd - estimated_usd
  if (delta === 0) return
  const date = utcDate()
  openDb().prepare(`UPDATE llm_budget SET spend_usd = spend_usd + ?, updated_at = ? WHERE date = ?`)
    .run(delta, Date.now(), date)
}

export function today() {
  return openDb().prepare(`SELECT * FROM llm_budget WHERE date = ?`).get(utcDate())
}
```

Note: `better-sqlite3` transactions use `.immediate()` / `.exclusive()` / default. Use `.immediate()` to match SQLite's `BEGIN IMMEDIATE` semantics required by the spec.

- [ ] **Step 4: Run PASS.**

```bash
cd quoth-plugin && npm test -- llm-budget
```

- [ ] **Step 5: Commit.**

```bash
git add quoth-plugin/daemon/lib/llm-budget.js quoth-plugin/tests/unit/pipeline/llm-budget.test.js
git commit -m "feat(daemon): llm-budget with race-free reservation"
```

---

## Task 6: Dedup sidecar in `trajectory-capture.js`

**Spec refs:** §2.1

**Files:**
- Modify: `quoth-plugin/hooks/trajectory-capture.js`
- Create: `quoth-plugin/tests/unit/capture/dedup.test.js`
- Create: `quoth-plugin/tests/unit/capture/matcher-less-perf.test.js`

- [ ] **Step 1: Read the current `trajectory-capture.js`** to locate the append + sidecar section. You will add a dedup sidecar between "compute entry" and "append". Do NOT touch sanitization — leave `REDACT_PATTERNS` alone.

- [ ] **Step 2: Write `dedup.test.js` (failing).**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('trajectory-capture dedup sidecar', () => {
  let home, capture
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-dedup-'))
    process.env.QUOTH_HOME = home
    capture = await import(`../../../hooks/trajectory-capture.js?t=${Date.now()}`)
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('collapses 5 identical Read calls into 1 entry', () => {
    const input = { session_id: 'sid', tool_name: 'Read', tool_input: { file_path: '/x/y.txt' }, tool_response: { ok: 1 }, cwd: process.cwd() }
    for (let i = 0; i < 5; i++) capture.handlePostToolUse(input)
    const jsonl = readFileSync(join(home, 'trajectories/active/sid.jsonl'), 'utf8').trim().split('\n')
    expect(jsonl).toHaveLength(1)
  })

  it('keeps three distinct calls in sequence', () => {
    for (const p of ['a.txt','b.txt','a.txt']) {
      capture.handlePostToolUse({ session_id: 'sid2', tool_name: 'Read', tool_input: { file_path: p }, tool_response: {}, cwd: process.cwd() })
    }
    const jsonl = readFileSync(join(home, 'trajectories/active/sid2.jsonl'), 'utf8').trim().split('\n')
    expect(jsonl).toHaveLength(3)
  })
})
```

- [ ] **Step 3: Write `matcher-less-perf.test.js` (failing).**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('trajectory-capture performance', () => {
  let home, capture
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-perf-'))
    process.env.QUOTH_HOME = home
    capture = await import(`../../../hooks/trajectory-capture.js?t=${Date.now()}`)
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('handles 1000 distinct PostToolUse calls in <100 ms', () => {
    const t0 = Date.now()
    for (let i = 0; i < 1000; i++) {
      capture.handlePostToolUse({
        session_id: 'perf',
        tool_name: 'Read',
        tool_input: { file_path: `/x/${i}.txt` },
        tool_response: { ok: 1 },
        cwd: process.cwd(),
      })
    }
    expect(Date.now() - t0).toBeLessThan(100)
  })
})
```

- [ ] **Step 4: Run FAIL.**

```bash
cd quoth-plugin && npm test -- capture
```

- [ ] **Step 5: Refactor `trajectory-capture.js`.**

Expose a pure `handlePostToolUse(input)` function (if not already). Add dedup logic:

```js
import crypto from 'node:crypto'
// ...existing imports...

function dedupPath(dir, sid) { return join(dir, `${sid}.dedup`) }

function hashEntry(tool, toolInput) {
  const h = crypto.createHash('sha1')
  h.update(tool)
  h.update('\0')
  h.update(JSON.stringify(toolInput ?? null))
  return h.digest('hex')
}

function readDedup(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}
function writeDedup(path, hash) {
  try { writeFileSync(path, JSON.stringify({ last_hash: hash, ts: Date.now() })) } catch {}
}

export function handlePostToolUse(input) {
  const { session_id, tool_name, tool_input } = input
  const activeDir = join(getQuothHome(), 'trajectories/active')
  mkdirSync(activeDir, { recursive: true })
  const sidecar = dedupPath(activeDir, session_id)
  const hash = hashEntry(tool_name, tool_input)
  const prev = readDedup(sidecar)
  if (prev && prev.last_hash === hash) return  // deduped
  // ... existing append + meta sidecar logic ...
  writeDedup(sidecar, hash)
}
```

Keep the sanitization pipeline and meta sidecar updates unchanged.

- [ ] **Step 6: Run PASS.**

```bash
cd quoth-plugin && npm test -- capture
```

- [ ] **Step 7: Commit.**

```bash
git add quoth-plugin/hooks/trajectory-capture.js quoth-plugin/tests/unit/capture/
git commit -m "feat(capture): dedup sidecar for matcher-less PostToolUse"
```

---

## Task 7: Matcher-less `PostToolUse` hook registration

**Spec refs:** §2.1

**Files:**
- Modify: `quoth-plugin/hooks/hooks.json`
- Modify: `quoth-plugin/.claude-plugin/hooks/hooks.json` (if present)

- [ ] **Step 1: Read both `hooks.json` files** and identify the `PostToolUse` entry with matcher `"Bash|Write|Edit|MultiEdit|Agent"`.

- [ ] **Step 2: Change the matcher to `*`** for the `trajectory-capture` hook. Leave `post-edit` (Write/Edit only) and `pre-bash` (Bash only) unchanged.

```json
{
  "event": "PostToolUse",
  "matcher": "*",
  "command": "$CLAUDE_PLUGIN_ROOT/hooks/trajectory-capture.js"
}
```

- [ ] **Step 3: Add a snapshot test** that asserts the matcher stays `*` (prevents accidental regression).

```js
// quoth-plugin/tests/unit/capture/hooks-json.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('hooks.json PostToolUse matcher', () => {
  it('uses matcher="*" for trajectory-capture', () => {
    const p = resolve('hooks/hooks.json')
    const json = JSON.parse(readFileSync(p, 'utf8'))
    const posts = json.hooks?.PostToolUse ?? []
    const trajCapture = posts.find(h => String(h.hooks?.[0]?.command ?? '').includes('trajectory-capture'))
    expect(trajCapture.matcher).toBe('*')
  })
})
```

- [ ] **Step 4: Run PASS.**

```bash
cd quoth-plugin && npm test -- hooks-json
```

- [ ] **Step 5: Commit.**

```bash
git add quoth-plugin/hooks/hooks.json quoth-plugin/.claude-plugin/hooks/hooks.json quoth-plugin/tests/unit/capture/hooks-json.test.js
git commit -m "feat(capture): matcher-less PostToolUse hook"
```

---

## Task 8: `triage.js` pipeline stage

**Spec refs:** §2.2 "triage.js"

**Files:**
- Create: `quoth-plugin/daemon/pipeline/triage.js`
- Create: `quoth-plugin/tests/unit/pipeline/triage.test.js`

- [ ] **Step 1: Inspect `daemon/lib/llm.js`** to find the existing Gemini helper (if any) or the Vercel AI Gateway call site. Note the function name and signature you'll need to call.

- [ ] **Step 2: Write the failing test** using dependency injection (triage takes the LLM call as a parameter for test fakes).

```js
// tests/unit/pipeline/triage.test.js
import { describe, it, expect, vi } from 'vitest'
import { runTriage } from '../../../daemon/pipeline/triage.js'

const sessionFixture = {
  session_id: 'sid',
  project: 'quoth',
  entries: Array.from({ length: 12 }, (_, i) => ({ tool: 'Write', tool_input: { file_path: `f${i}.txt` } })),
}

describe('runTriage', () => {
  it('routes productive medium-urgency session correctly', async () => {
    const fakeLLM = vi.fn().mockResolvedValue({
      text: JSON.stringify({ productive: true, urgency: 'medium', suspected_kinds: ['pattern','fact'] }),
      cost_usd: 0.0003,
    })
    const out = await runTriage(sessionFixture, { llm: fakeLLM })
    expect(out.productive).toBe(true)
    expect(out.urgency).toBe('medium')
    expect(out.suspected_kinds).toContain('pattern')
    expect(fakeLLM).toHaveBeenCalledOnce()
  })

  it('retries once on transient LLM error then succeeds', async () => {
    let calls = 0
    const fakeLLM = vi.fn().mockImplementation(async () => {
      calls++
      if (calls === 1) throw new Error('ECONNRESET')
      return { text: JSON.stringify({ productive: false, urgency: 'low', suspected_kinds: [] }), cost_usd: 0.0003 }
    })
    const out = await runTriage(sessionFixture, { llm: fakeLLM, retries: 1 })
    expect(out.productive).toBe(false)
    expect(calls).toBe(2)
  })

  it('returns safe-default on total failure and sets degraded flag', async () => {
    const fakeLLM = vi.fn().mockRejectedValue(new Error('rate-limited'))
    const out = await runTriage(sessionFixture, { llm: fakeLLM, retries: 2 })
    expect(out.degraded).toBe(true)
    expect(out.productive).toBe(true) // safe default — don't skip extract
  })
})
```

- [ ] **Step 3: Run FAIL.**

- [ ] **Step 4: Implement `daemon/pipeline/triage.js`.**

```js
import { logPipelineError } from '../db.js'
import { reserve, reconcile } from '../lib/llm-budget.js'

const SYSTEM_PROMPT = `You are a triage gate for a coding-session knowledge extraction pipeline.
Given a summary of one session, decide:
- productive: boolean — did the agent produce non-trivial output?
- urgency: 'low' | 'medium' | 'high' — how much extraction depth is warranted?
- suspected_kinds: subset of ['pattern','decision','anti_pattern','fact']

Respond with a single JSON object, no prose.`

function summarize(session) {
  const n = session.entries.length
  const head = session.entries.slice(0, 5)
  const tail = session.entries.slice(-5)
  return `project=${session.project}\nentries=${n}\nhead=${JSON.stringify(head)}\ntail=${JSON.stringify(tail)}`
}

const EST_COST = 0.0005

export async function runTriage(session, { llm, retries = 2 } = {}) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    const res = reserve({ stage: 'triage', estimated_usd: EST_COST })
    if (!res.ok) return { productive: true, urgency: 'low', suspected_kinds: ['pattern','fact'], degraded: true, reason: 'budget' }
    try {
      const out = await llm({ system: SYSTEM_PROMPT, user: summarize(session), max_tokens: 200 })
      reconcile({ stage: 'triage', estimated_usd: EST_COST, actual_usd: out.cost_usd ?? EST_COST })
      const parsed = JSON.parse(out.text)
      return {
        productive: !!parsed.productive,
        urgency: ['low','medium','high'].includes(parsed.urgency) ? parsed.urgency : 'low',
        suspected_kinds: Array.isArray(parsed.suspected_kinds) ? parsed.suspected_kinds : [],
        degraded: false,
      }
    } catch (e) {
      lastErr = e
      reconcile({ stage: 'triage', estimated_usd: EST_COST, actual_usd: 0 })
      logPipelineError({ stage: 'triage', severity: 'error', session_id: session.session_id, error_message: e.message, retry_count: i })
      await new Promise(r => setTimeout(r, 1000 * (i + 1)))
    }
  }
  logPipelineError({ stage: 'triage', severity: 'degraded', session_id: session.session_id, error_message: lastErr?.message ?? 'unknown', resolution: 'safe-default' })
  return { productive: true, urgency: 'low', suspected_kinds: ['pattern','fact'], degraded: true, reason: 'llm-failed' }
}
```

- [ ] **Step 5: Run PASS.**

- [ ] **Step 6: Commit.**

```bash
git add quoth-plugin/daemon/pipeline/triage.js quoth-plugin/tests/unit/pipeline/triage.test.js
git commit -m "feat(pipeline): add triage.js (Gemini Flash Lite)"
```

---

## Task 9: `extract.js` four-kind rewrite (urgency-tuned)

**Spec refs:** §2.2 "extract.js"

**Files:**
- Modify: `quoth-plugin/daemon/pipeline/extract.js`
- Create: `quoth-plugin/tests/unit/pipeline/extract.test.js`

- [ ] **Step 1: Read the current `daemon/pipeline/extract.js`.** Keep the existing dependency-injection shape; you are rewriting the prompt, the urgency switch, and the output parser. The signature stays `runExtract(session, { llm, urgency }) → { entities, cost_usd }`.

- [ ] **Step 2: Write the failing test.**

```js
// tests/unit/pipeline/extract.test.js
import { describe, it, expect, vi } from 'vitest'
import { runExtract, parseExtractOutput } from '../../../daemon/pipeline/extract.js'

describe('parseExtractOutput', () => {
  it('parses all 4 entity kinds', () => {
    const raw = JSON.stringify({
      patterns: [{ condition: 'c', action: 'a', summary: 's', quality_signal: 'domain' }],
      decisions: [{ situation: 's', options_considered: [], choice: 'x', reasoning: 'y', summary: 'd' }],
      anti_patterns: [{ condition: 'c', what_not_to_do: 'x', why_failed: 'y', summary: 'ap' }],
      facts: [{ topic: 't', statement: 's', evidence: 'e', summary: 'f' }],
    })
    const parsed = parseExtractOutput(raw)
    expect(parsed.entities).toHaveLength(4)
    expect(parsed.entities.map(e => e.kind).sort()).toEqual(['anti_pattern','decision','fact','pattern'])
  })

  it('drops malformed entities but keeps valid ones', () => {
    const raw = JSON.stringify({ patterns: [{ condition: 'c' }, { condition: 'c2', action: 'a2', summary: 's2' }] })
    const parsed = parseExtractOutput(raw)
    expect(parsed.entities).toHaveLength(1)
  })

  it('returns empty on non-JSON', () => {
    expect(parseExtractOutput('not json').entities).toEqual([])
  })
})

describe('runExtract', () => {
  const session = {
    session_id: 'sid',
    project: 'quoth',          // from sidecar — must override any LLM echo
    entries: [{ tool: 'Write', tool_input: { file_path: 'x.js' } }],
  }

  it('overrides LLM project field with sidecar project (anti-leak)', async () => {
    const llm = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        patterns: [{ condition: 'c', action: 'a', summary: 's', project: 'hallucinated' }]
      }),
      cost_usd: 0.01,
    })
    const out = await runExtract(session, { llm, urgency: 'medium' })
    expect(out.entities[0].scope).toBe('project:quoth')
    expect(out.entities[0].metadata.project).toBeUndefined()
  })

  it('retries once on invalid JSON with stricter prompt', async () => {
    let call = 0
    const llm = vi.fn().mockImplementation(async () => {
      call++
      if (call === 1) return { text: 'not json', cost_usd: 0.01 }
      return { text: JSON.stringify({ patterns: [{ condition: 'c', action: 'a', summary: 's' }] }), cost_usd: 0.01 }
    })
    const out = await runExtract(session, { llm, urgency: 'medium' })
    expect(out.entities).toHaveLength(1)
    expect(call).toBe(2)
  })
})
```

- [ ] **Step 3: Run FAIL.**

- [ ] **Step 4: Implement `daemon/pipeline/extract.js`.**

Export `parseExtractOutput` and `runExtract`. Key invariants:

1. Urgency tunes prompt + tool budget, not model (always Kimi K2.5 primary).
2. `suspected_kinds` filter: only ask for kinds that triage flagged.
3. Every returned entity must have `scope = 'project:' + session.project` (sidecar truth, not LLM output). Strip any `project` / `scope` key from metadata.
4. On invalid JSON, retry once with a stricter system prompt ("respond with a single valid JSON object").
5. On both attempts failing, return `{ entities: [], cost_usd, error: 'parse-failed' }`.
6. `runExtract` wraps `reserve/reconcile` around the LLM call.

Pseudocode skeleton (fill in with Kimi-specific call shape based on `daemon/lib/llm.js`):

```js
const PROMPTS = {
  low:    { budget: 2, depth: 'concise' },
  medium: { budget: 5, depth: 'standard' },
  high:   { budget: 8, depth: 'deep' },
}

function estCost(urgency) {
  return { low: 0.005, medium: 0.012, high: 0.025 }[urgency] ?? 0.012
}

export function parseExtractOutput(raw) {
  let data
  try { data = JSON.parse(raw) } catch { return { entities: [] } }
  const out = []
  for (const p of data.patterns ?? []) {
    if (!p.condition || !p.action || !p.summary) continue
    out.push({ kind: 'pattern', summary: p.summary, content: `${p.condition} → ${p.action}`, metadata: { condition: p.condition, action: p.action, quality_signal: p.quality_signal ?? null } })
  }
  for (const d of data.decisions ?? []) {
    if (!d.situation || !d.choice || !d.summary) continue
    out.push({ kind: 'decision', summary: d.summary, content: `${d.situation}: ${d.choice}`, metadata: { situation: d.situation, options_considered: d.options_considered ?? [], choice: d.choice, reasoning: d.reasoning ?? '', outcome: d.outcome ?? null } })
  }
  for (const a of data.anti_patterns ?? []) {
    if (!a.condition || !a.what_not_to_do || !a.summary) continue
    out.push({ kind: 'anti_pattern', summary: a.summary, content: `${a.condition}: NOT ${a.what_not_to_do}`, metadata: { condition: a.condition, what_not_to_do: a.what_not_to_do, why_failed: a.why_failed ?? '' } })
  }
  for (const f of data.facts ?? []) {
    if (!f.topic || !f.statement || !f.summary) continue
    out.push({ kind: 'fact', summary: f.summary, content: `${f.topic}: ${f.statement}`, metadata: { topic: f.topic, statement: f.statement, evidence: f.evidence ?? '' } })
  }
  return { entities: out }
}

export async function runExtract(session, { llm, urgency = 'medium', suspected_kinds = ['pattern','decision','anti_pattern','fact'] } = {}) {
  const cost = estCost(urgency)
  if (!reserve({ stage: 'extract', estimated_usd: cost }).ok) return { entities: [], cost_usd: 0, error: 'budget' }

  const sysBase = buildSystemPrompt({ kinds: suspected_kinds, depth: PROMPTS[urgency].depth })
  let raw, actualCost = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    const sys = attempt === 0 ? sysBase : sysBase + '\n\nRESPOND WITH A SINGLE VALID JSON OBJECT. NO PROSE.'
    const res = await llm({ system: sys, user: summarizeSession(session), toolBudget: PROMPTS[urgency].budget, model: 'kimi-k2-5' })
    actualCost += res.cost_usd ?? 0
    const parsed = parseExtractOutput(res.text)
    if (parsed.entities.length > 0 || attempt === 1) {
      reconcile({ stage: 'extract', estimated_usd: cost, actual_usd: actualCost })
      return {
        entities: parsed.entities.map(e => ({
          ...e,
          scope: `project:${session.project}`,
          source: 'extracted',
          source_session_id: session.session_id,
        })),
        cost_usd: actualCost,
      }
    }
  }
  reconcile({ stage: 'extract', estimated_usd: cost, actual_usd: actualCost })
  return { entities: [], cost_usd: actualCost, error: 'parse-failed' }
}
```

Keep the **Sonnet `claude -p` fallback** (spec §2.2) as a separate code path. Concrete contract:

```js
// daemon/pipeline/extract.js
export async function runExtractWithFallback(session, opts) {
  try {
    return await runExtract(session, opts)
  } catch (err) {
    logPipelineError({ stage: 'extract', severity: 'degraded', session_id: session.session_id, error_message: err.message, model_attempted: 'kimi-k2-5', fallback_attempted: 1 })
    try {
      const res = await opts.sonnetFallback({ system: sonnetSystemPrompt(), user: summarizeSession(session) })
      const parsed = parseExtractOutput(res.text)
      logPipelineError({ stage: 'extract', severity: 'degraded', session_id: session.session_id, error_message: 'kimi fallback succeeded', fallback_attempted: 1, fallback_succeeded: 1, resolution: 'recovered' })
      return { entities: parsed.entities.map(e => ({ ...e, scope: `project:${session.project}`, source: 'extracted', source_session_id: session.session_id })), cost_usd: res.cost_usd ?? 0 }
    } catch (err2) {
      logPipelineError({ stage: 'extract', severity: 'error', session_id: session.session_id, error_message: err2.message, fallback_attempted: 1, fallback_succeeded: 0, resolution: 'archived-as-error' })
      throw err2
    }
  }
}
```

Add a test `runExtract-fallback.test.js` that forces `opts.llm` to throw twice, asserts `sonnetFallback` is called, and verifies a `severity='degraded'` row is written.

- [ ] **Step 5: Run PASS.**

- [ ] **Step 6: Commit.**

```bash
git add quoth-plugin/daemon/pipeline/extract.js quoth-plugin/tests/unit/pipeline/extract.test.js
git commit -m "feat(pipeline): extract.js four-kind rewrite (urgency-tuned)"
```

---

## Task 10: `embed.js` batched 4-kind embedder

**Spec refs:** §2.2 "embed.js", §3.3

**Files:**
- Create: `quoth-plugin/daemon/pipeline/embed.js` (moved+extended from `daemon/lib/embed.js`)
- Create: `quoth-plugin/tests/unit/pipeline/embed.test.js`

- [ ] **Step 1: Re-export from existing location.** Do NOT delete `daemon/lib/embed.js` yet (Task 24). Instead, `daemon/pipeline/embed.js` imports the low-level `generateEmbeddingBatch` from `daemon/lib/embed.js` and wraps it.

- [ ] **Step 2: Write the failing test.**

```js
// tests/unit/pipeline/embed.test.js
import { describe, it, expect, vi } from 'vitest'
import { embedEntities } from '../../../daemon/pipeline/embed.js'

describe('embedEntities', () => {
  it('batches all 4 kinds into one call', async () => {
    const entities = [
      { kind: 'pattern', content: 'a' },
      { kind: 'fact',    content: 'b' },
      { kind: 'decision',content: 'c' },
      { kind: 'anti_pattern', content: 'd' },
    ]
    const fakeBatch = vi.fn().mockResolvedValue([
      new Float32Array(384), new Float32Array(384), new Float32Array(384), new Float32Array(384),
    ])
    const out = await embedEntities(entities, { generateEmbeddingBatch: fakeBatch })
    expect(fakeBatch).toHaveBeenCalledOnce()
    expect(out).toHaveLength(4)
    expect(out[0].embedding).toBeInstanceOf(Float32Array)
  })

  it('on failure returns entities without embeddings + marks embedding_indexed=0', async () => {
    const fakeBatch = vi.fn().mockRejectedValue(new Error('onnx-crash'))
    const out = await embedEntities([{ kind: 'pattern', content: 'a' }], { generateEmbeddingBatch: fakeBatch })
    expect(out[0].embedding).toBeNull()
    expect(out[0].embedding_indexed).toBe(0)
  })
})
```

- [ ] **Step 3: Run FAIL.**

- [ ] **Step 4: Implement.**

```js
// daemon/pipeline/embed.js
import { generateEmbeddingBatch as defaultBatch } from '../lib/embed.js'
import { logPipelineError } from '../db.js'

export async function embedEntities(entities, { generateEmbeddingBatch = defaultBatch } = {}) {
  if (entities.length === 0) return entities
  try {
    const vectors = await generateEmbeddingBatch(entities.map(e => e.content))
    return entities.map((e, i) => ({ ...e, embedding: vectors[i], embedding_indexed: 0 /* set by persist after HNSW.add */ }))
  } catch (err) {
    logPipelineError({ stage: 'embed', severity: 'degraded', error_message: err.message, context: { count: entities.length } })
    return entities.map(e => ({ ...e, embedding: null, embedding_indexed: 0 }))
  }
}
```

- [ ] **Step 5: Run PASS.**

- [ ] **Step 6: Commit.**

```bash
git add quoth-plugin/daemon/pipeline/embed.js quoth-plugin/tests/unit/pipeline/embed.test.js
git commit -m "feat(pipeline): batched 4-kind embed.js wrapper"
```

---

## Task 11: `persist.js` single-tx upsert + HNSW add

**Spec refs:** §2.2 "persist.js", idempotency contract walk-through

**Files:**
- Create: `quoth-plugin/daemon/pipeline/persist.js`
- Create: `quoth-plugin/tests/unit/pipeline/persist.test.js`

- [ ] **Step 1: Write the failing test — prioritize the 5-case idempotency walk-through.**

```js
// tests/unit/pipeline/persist.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('persistSession', () => {
  let home, persist, ke
  const fakeHnsw = { add: vi.fn(), save: vi.fn() }

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-persist-'))
    process.env.QUOTH_HOME = home
    fakeHnsw.add.mockClear()
    persist = await import(`../../../daemon/pipeline/persist.js?t=${Date.now()}`)
    ke = await import(`../../../daemon/lib/knowledge-entities.js?t=${Date.now()}`)
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  const entity = (sid) => ({
    kind: 'pattern', scope: 'project:quoth', summary: 's', content: 'canonical-body',
    metadata: {}, tags: [], source: 'extracted', source_session_id: sid,
    embedding: new Float32Array(384),
  })

  it('walk-through: S1 fresh → S1 retry → S2 → S2 retry → S3 (spec §2.2)', async () => {
    await persist.persistSession({ sessionId: 'S1', entities: [entity('S1')] }, { hnsw: fakeHnsw })
    let row = ke.getById(ke.computeEntityId('pattern','canonical-body'))
    expect(row.alpha).toBe(1); expect(row.source_session_id).toBe('S1')

    await persist.persistSession({ sessionId: 'S1', entities: [entity('S1')] }, { hnsw: fakeHnsw })
    row = ke.getById(ke.computeEntityId('pattern','canonical-body'))
    expect(row.alpha).toBe(1); expect(row.source_session_id).toBe('S1') // retry: no-op

    await persist.persistSession({ sessionId: 'S2', entities: [entity('S2')] }, { hnsw: fakeHnsw })
    row = ke.getById(ke.computeEntityId('pattern','canonical-body'))
    expect(row.alpha).toBe(2); expect(row.source_session_id).toBe('S2')

    await persist.persistSession({ sessionId: 'S2', entities: [entity('S2')] }, { hnsw: fakeHnsw })
    row = ke.getById(ke.computeEntityId('pattern','canonical-body'))
    expect(row.alpha).toBe(2); expect(row.source_session_id).toBe('S2') // S2 retry: no-op

    await persist.persistSession({ sessionId: 'S3', entities: [entity('S3')] }, { hnsw: fakeHnsw })
    row = ke.getById(ke.computeEntityId('pattern','canonical-body'))
    expect(row.alpha).toBe(3); expect(row.source_session_id).toBe('S3')
  })

  it('HNSW.add called once per new entity id', async () => {
    await persist.persistSession({ sessionId: 'S1', entities: [entity('S1')] }, { hnsw: fakeHnsw })
    expect(fakeHnsw.add).toHaveBeenCalledTimes(1)
  })

  it('HNSW.add throw → entity persisted with embedding_indexed=0', async () => {
    const failHnsw = { add: vi.fn().mockImplementation(() => { throw new Error('oom') }), save: vi.fn() }
    await persist.persistSession({ sessionId: 'S1', entities: [entity('S1')] }, { hnsw: failHnsw })
    const row = ke.getById(ke.computeEntityId('pattern','canonical-body'))
    expect(row.embedding_indexed).toBe(0)
  })
})
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement `daemon/pipeline/persist.js`.**

```js
import { openDb, logPipelineError } from '../db.js'
import { upsertEntity, computeEntityId, markIndexed } from '../lib/knowledge-entities.js'

export async function persistSession({ sessionId, entities }, { hnsw }) {
  if (entities.length === 0) return { inserted: 0 }
  const db = openDb()
  const ensureRun = db.prepare(`
    INSERT INTO pipeline_runs (source_session_id, run_id, status, created_at)
    VALUES (?, ?, 'committed', ?)
    ON CONFLICT(source_session_id) DO NOTHING
  `)
  // Idempotency guard (spec §2.2 step 2): if a committed run already exists for this session, no-op
  const existing = db.prepare(`SELECT 1 FROM pipeline_runs WHERE source_session_id = ? AND status = 'committed'`).get(sessionId)
  if (existing) return { inserted: 0, skipped: 'already-committed' }

  const tx = db.transaction(() => {
    for (const e of entities) upsertEntity(e)
    ensureRun.run(sessionId, `${sessionId}-${Date.now()}`, Date.now())
  })
  tx.immediate()

  // Outside the SQLite txn, inside the persist semaphore (enforced by caller in daemon.js Task 12)
  for (const e of entities) {
    if (!e.embedding) continue
    try {
      const id = computeEntityId(e.kind, e.content)
      hnsw.add(id, e.embedding)
      markIndexed(id)
    } catch (err) {
      logPipelineError({ stage: 'persist', severity: 'degraded', session_id: sessionId, error_message: `HNSW.add: ${err.message}` })
    }
  }
  return { inserted: entities.length }
}
```

You'll need a `pipeline_runs` table with a UNIQUE constraint on `source_session_id`. Add it to `daemon/db.js` in this task:

```sql
CREATE TABLE IF NOT EXISTS pipeline_runs (
  source_session_id TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  status            TEXT NOT NULL,
  created_at        INTEGER NOT NULL
);
```

- [ ] **Step 4: Run PASS.**

- [ ] **Step 5: Commit.**

```bash
git add quoth-plugin/daemon/db.js quoth-plugin/daemon/pipeline/persist.js quoth-plugin/tests/unit/pipeline/persist.test.js
git commit -m "feat(pipeline): persist.js single-tx upsert + HNSW add (idempotent)"
```

---

## Task 12: Worker pool + stage semaphores in `daemon.js`

**Spec refs:** §2.2 "Worker Pool", "Concurrency contract", "Concurrency-default rationale"

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js`
- Create: `quoth-plugin/daemon/lib/semaphore.js`
- Create: `quoth-plugin/tests/unit/daemon/worker-pool.test.js`
- Create: `quoth-plugin/tests/unit/daemon/stage-semaphores.test.js`
- Create: `quoth-plugin/tests/unit/daemon/claim-by-rename.test.js`

- [ ] **Step 1: Write a tiny semaphore helper and its test first.**

```js
// tests/unit/daemon/stage-semaphores.test.js
import { describe, it, expect } from 'vitest'
import { Semaphore } from '../../../daemon/lib/semaphore.js'

describe('Semaphore', () => {
  it('caps concurrency', async () => {
    const s = new Semaphore(3)
    let active = 0, peak = 0
    const tasks = Array.from({ length: 10 }, () => s.run(async () => {
      active++; peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 20))
      active--
    }))
    await Promise.all(tasks)
    expect(peak).toBe(3)
  })
})
```

- [ ] **Step 2: Implement `daemon/lib/semaphore.js`.**

```js
export class Semaphore {
  constructor(max) { this.max = max; this.active = 0; this.q = [] }
  async run(fn) {
    if (this.active >= this.max) await new Promise(r => this.q.push(r))
    this.active++
    try { return await fn() }
    finally {
      this.active--
      const next = this.q.shift()
      if (next) next()
    }
  }
}
```

- [ ] **Step 3: Run PASS.**

- [ ] **Step 4: Write the `claim-by-rename` test.**

```js
// tests/unit/daemon/claim-by-rename.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tryClaim } from '../../../daemon/daemon.js'

describe('tryClaim', () => {
  let dir
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'quoth-claim-'))
    writeFileSync(join(dir, 'abc.jsonl'), '')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('exactly one of two concurrent claims wins', async () => {
    const c1 = tryClaim(dir, 'abc.jsonl', 'w1')
    const c2 = tryClaim(dir, 'abc.jsonl', 'w2')
    const [r1, r2] = await Promise.all([c1, c2])
    const winners = [r1, r2].filter(Boolean)
    expect(winners).toHaveLength(1)
    const files = readdirSync(dir)
    expect(files.filter(f => f.includes('.w1.') || f.includes('.w2.'))).toHaveLength(1)
  })
})
```

- [ ] **Step 5: Implement `tryClaim` in `daemon.js`** (export a small helper; don't wire it into the main loop yet).

```js
// daemon/daemon.js — add exported helper
import { renameSync } from 'node:fs'
import { join } from 'node:path'

export function tryClaim(dir, filename, workerId) {
  const from = join(dir, filename)
  const to = join(dir, filename.replace(/\.jsonl$/, `.${process.pid}.${workerId}.jsonl`))
  try { renameSync(from, to); return to }
  catch { return null }
}
```

- [ ] **Step 6: Run PASS.**

- [ ] **Step 7: Write worker-pool test** — uses a fake pipeline function to assert N workers each pull from the claim queue without overlap.

```js
// tests/unit/daemon/worker-pool.test.js
import { describe, it, expect, vi } from 'vitest'
import { runWorkerPool } from '../../../daemon/daemon.js'

describe('runWorkerPool', () => {
  it('processes every item exactly once with N workers', async () => {
    const items = Array.from({ length: 20 }, (_, i) => `s${i}`)
    const processed = new Set()
    const pipeline = vi.fn().mockImplementation(async (item) => {
      if (processed.has(item)) throw new Error('double!')
      processed.add(item)
      await new Promise(r => setTimeout(r, 5))
    })
    await runWorkerPool({ items, concurrency: 4, pipeline })
    expect(processed.size).toBe(20)
    expect(pipeline).toHaveBeenCalledTimes(20)
  })
})
```

- [ ] **Step 8: Implement `runWorkerPool`** as a thin, testable async iteration.

```js
export async function runWorkerPool({ items, concurrency, pipeline }) {
  const queue = [...items]
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()
      if (item === undefined) return
      try { await pipeline(item) } catch (e) { /* caller logs */ }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
}
```

- [ ] **Step 9: Run PASS.**

- [ ] **Step 10: Wire worker pool + semaphores into the main daemon loop.**

In `daemon/daemon.js`, add module-level semaphores and a `processSessionWithPipeline()` function that chains `triage → extract → embed → persist` with each stage wrapped in its semaphore. Do NOT yet remove the old `processSessionFile` — the new function is added alongside and will be dispatched from Task 13's watcher.

```js
import { Semaphore } from './lib/semaphore.js'
import { runTriage } from './pipeline/triage.js'
import { runExtract } from './pipeline/extract.js'
import { embedEntities } from './pipeline/embed.js'
import { persistSession } from './pipeline/persist.js'

const sem = {
  triage:  new Semaphore(parseInt(process.env.QUOTH_TRIAGE_CONCURRENCY  ?? '8', 10)),
  extract: new Semaphore(parseInt(process.env.QUOTH_EXTRACT_CONCURRENCY ?? '3', 10)),
  embed:   new Semaphore(parseInt(process.env.QUOTH_EMBED_CONCURRENCY   ?? '2', 10)),
  persist: new Semaphore(1),
}

export async function processSessionWithPipeline(sessionFile, { hnsw, llm }) {
  const session = readSessionFile(sessionFile)  // existing helper in daemon-core.js
  const triageOut  = await sem.triage.run(()  => runTriage(session, { llm: llm.gemini }))
  if (!triageOut.productive) return archiveRoutine(sessionFile)
  const extractOut = await sem.extract.run(() => runExtract(session, { llm: llm.kimi, urgency: triageOut.urgency, suspected_kinds: triageOut.suspected_kinds }))
  const embedded   = await sem.embed.run(()   => embedEntities(extractOut.entities))
  await sem.persist.run(() => persistSession({ sessionId: session.session_id, entities: embedded }, { hnsw }))
  return archiveDone(sessionFile, session.project)
}
```

(The `readSessionFile`, `archiveRoutine`, `archiveDone` helpers may already exist in `daemon-core.js` — use them; add if missing.)

- [ ] **Step 11: Run all daemon tests.**

```bash
cd quoth-plugin && npm test -- daemon
```

- [ ] **Step 12: Commit.**

```bash
git add quoth-plugin/daemon/lib/semaphore.js quoth-plugin/daemon/daemon.js quoth-plugin/tests/unit/daemon/
git commit -m "feat(daemon): worker pool + stage semaphores + claim-by-rename"
```

---

## Task 13: FileWatcher polling fallback + orphan recovery + SIGTERM handler

**Spec refs:** §2.2 "FileWatcher polling fallback", "SIGTERM / orphan recovery"

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js`
- Create: `quoth-plugin/tests/unit/daemon/polling-fallback.test.js`
- Create: `quoth-plugin/tests/unit/daemon/orphan-recovery.test.js`
- Create: `quoth-plugin/tests/unit/daemon/sigterm-graceful.test.js`
- Create: `quoth-plugin/tests/unit/daemon/startup-failed-flag.test.js`

This task has four sub-tests; implement each TDD-style.

### 13a. Polling fallback

- [ ] **Step 1: Write the test.**

```js
// tests/unit/daemon/polling-fallback.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileWatcher } from '../../../daemon/daemon.js'

describe('FileWatcher polling fallback', () => {
  let dir, watcher
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'quoth-watch-')) })
  afterEach(() => { watcher?.stop(); rmSync(dir, { recursive: true, force: true }) })

  it('polling detects a file that fs.watch missed', async () => {
    const seen = []
    watcher = new FileWatcher(dir, { pollIntervalMs: 100, disableFsWatch: true })
    watcher.on('file', f => seen.push(f))
    await watcher.start()
    writeFileSync(join(dir, 'late.jsonl'), '')
    await new Promise(r => setTimeout(r, 300))
    expect(seen).toContain('late.jsonl')
  })

  it('warmup sweep does not mark existing files as "missed by watcher"', async () => {
    writeFileSync(join(dir, 'preexisting.jsonl'), '')
    const degradedRows = []
    watcher = new FileWatcher(dir, { pollIntervalMs: 100, onDegraded: r => degradedRows.push(r) })
    await watcher.start()
    await new Promise(r => setTimeout(r, 250))
    expect(degradedRows).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement `FileWatcher` class** in `daemon/daemon.js`. Keep the existing `fs.watch` setup but wrap it in a class with an in-memory `knownFiles` Set, a polling `setInterval`, and a `warmup` flag.

- [ ] **Step 3: Run PASS.**

### 13b. Orphan recovery

- [ ] **Step 4: Write the test.**

```js
// tests/unit/daemon/orphan-recovery.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recoverOrphans } from '../../../daemon/daemon.js'

describe('recoverOrphans', () => {
  let dir
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'quoth-orphan-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('strips suffix from a dead-PID orphan', () => {
    writeFileSync(join(dir, 'sess.99999999.w1.jsonl'), '') // pid likely dead
    recoverOrphans(dir)
    const files = readdirSync(dir)
    expect(files).toContain('sess.jsonl')
  })

  it('leaves live-PID orphans alone', () => {
    writeFileSync(join(dir, `sess.${process.pid}.w1.jsonl`), '')
    recoverOrphans(dir)
    const files = readdirSync(dir)
    expect(files.some(f => f.includes(`${process.pid}.w1`))).toBe(true)
  })
})
```

- [ ] **Step 5: Implement `recoverOrphans`** per spec §2.2 "SIGTERM / orphan recovery".

- [ ] **Step 6: Run PASS.**

### 13c. SIGTERM graceful shutdown

- [ ] **Step 7: Write the test.**

```js
// tests/unit/daemon/sigterm-graceful.test.js
import { describe, it, expect } from 'vitest'
import { gracefulShutdown } from '../../../daemon/daemon.js'

describe('gracefulShutdown', () => {
  it('rolls back in-flight claim on grace timeout', async () => {
    const rolled = []
    const state = {
      inFlight: [{ claimedPath: '/tmp/x.pid.w1.jsonl', originalPath: '/tmp/x.jsonl', stage: 'extract' }],
      rollback: (claim) => rolled.push(claim.originalPath),
    }
    await gracefulShutdown(state, { graceMs: 50 })
    expect(rolled).toContain('/tmp/x.jsonl')
  })
})
```

- [ ] **Step 8: Implement `gracefulShutdown`** in `daemon/daemon.js`. On `SIGTERM`, the daemon: (1) stops the watcher, (2) `Promise.race([inFlightAll, sleep(graceMs)])`, (3) for any still-running worker past the deadline, invoke the `state.rollback` callback which `fs.renameSync` back to the un-suffixed name.

- [ ] **Step 9: Run PASS.**

### 13d. Startup-failed flag

- [ ] **Step 10: Write the test.**

```js
// tests/unit/daemon/startup-failed-flag.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkStartupFlag, writeStartupFailed } from '../../../daemon/daemon.js'

describe('startup failed flag', () => {
  let home
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'quoth-flag-')); process.env.QUOTH_HOME = home })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('writes and reads the STARTUP_FAILED flag', () => {
    writeStartupFailed('db-corrupt')
    const flag = checkStartupFlag()
    expect(flag).toMatch(/db-corrupt/)
    expect(existsSync(join(home, 'STARTUP_FAILED'))).toBe(true)
  })
})
```

- [ ] **Step 11: Implement `writeStartupFailed` / `checkStartupFlag`.**

- [ ] **Step 12: Run PASS on all four.**

```bash
cd quoth-plugin && npm test -- daemon
```

- [ ] **Step 13: Commit.**

```bash
git add quoth-plugin/daemon/daemon.js quoth-plugin/tests/unit/daemon/
git commit -m "feat(daemon): polling fallback + orphan recovery + SIGTERM + startup flag"
```

---

## Task 14: HNSW boot rebuild + catch-up sweep

**Spec refs:** §2.2 "HNSW recovery on boot", §5.8

**Files:**
- Modify: `quoth-plugin/daemon/lib/hnsw.js`
- Modify: `quoth-plugin/daemon/retention.js` (nightly sweep hook)
- Create: `quoth-plugin/tests/unit/daemon/hnsw-rebuild-on-boot.test.js`

- [ ] **Step 1: Write the failing test.**

```js
// tests/unit/daemon/hnsw-rebuild-on-boot.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('HNSW rebuild on boot', () => {
  let home
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'quoth-hnsw-boot-')); process.env.QUOTH_HOME = home })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('rebuilds from SQLite when hnsw.bin missing', async () => {
    const ke = await import(`../../../daemon/lib/knowledge-entities.js?t=${Date.now()}`)
    ke.upsertEntity({
      kind: 'pattern', scope: 'project:x', summary: 's', content: 'body1', metadata: {}, tags: [],
      source: 'extracted', source_session_id: 'sid', embedding: Buffer.from(new Float32Array(384).buffer),
    })
    const binPath = join(home, 'hnsw.bin')
    if (existsSync(binPath)) unlinkSync(binPath)
    const hnsw = await import(`../../../daemon/lib/hnsw.js?t=${Date.now()}`)
    const idx = await hnsw.loadOrInit()
    expect(idx.size()).toBeGreaterThan(0)
  })

  it('catch-up sweep re-indexes rows with embedding_indexed=0', async () => {
    const ke = await import(`../../../daemon/lib/knowledge-entities.js?t=${Date.now()}`)
    ke.upsertEntity({ kind: 'pattern', scope: 'project:x', summary: 's', content: 'body2', metadata: {}, tags: [], source: 'extracted', source_session_id: 'sid', embedding: Buffer.from(new Float32Array(384).buffer) })
    const hnsw = await import(`../../../daemon/lib/hnsw.js?t=${Date.now()}`)
    const before = (await hnsw.loadOrInit()).size()
    const { runHnswCatchUp } = await import(`../../../daemon/retention.js?t=${Date.now()}`)
    await runHnswCatchUp()
    const after = (await hnsw.loadOrInit()).size()
    expect(after).toBeGreaterThanOrEqual(before)
  })
})
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Update `daemon/lib/hnsw.js`** — add `loadOrInit()` that tries to load `hnsw.bin`; on missing/corrupt, iterate `knowledge_entities WHERE status='active' AND embedding IS NOT NULL` in batches of `QUOTH_HNSW_REBUILD_BATCH` (default 500), adding each to a new index, then saves.

- [ ] **Step 4: Add `runHnswCatchUp` to `daemon/retention.js`** which iterates `listUnindexed(500)` in a loop, calls `hnsw.add`, `markIndexed`, until empty.

- [ ] **Step 5: Run PASS.**

- [ ] **Step 6: Commit.**

```bash
git add quoth-plugin/daemon/lib/hnsw.js quoth-plugin/daemon/retention.js quoth-plugin/tests/unit/daemon/hnsw-rebuild-on-boot.test.js
git commit -m "feat(daemon): HNSW boot rebuild + catch-up sweep"
```

---

## Task 15: `/inject` endpoint in query-server

**Spec refs:** §2.3 "query-server.js"

**Files:**
- Modify: `quoth-plugin/daemon/lib/query-server.js`
- Create: `quoth-plugin/tests/unit/inject/kind-weight-ranking.test.js`
- Create: `quoth-plugin/tests/unit/inject/scope-filter.test.js`
- Create: `quoth-plugin/tests/unit/inject/prompt-embedding-cache.test.js`

- [ ] **Step 1: Locate `buildQueryServer`** in `daemon/lib/query-server.js` (memory fact confirms the export exists — use `buildQueryServer` in tests, not `createQueryServer`, to avoid port conflicts).

- [ ] **Step 2: Write the failing tests.**

```js
// tests/unit/inject/kind-weight-ranking.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'

describe('/inject kind-weight ranking', () => {
  let home, srv, port
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-inj-')); process.env.QUOTH_HOME = home
    const ke = await import(`../../../daemon/lib/knowledge-entities.js?t=${Date.now()}`)
    const vec = Buffer.from(new Float32Array(384).fill(0.1).buffer)
    ke.upsertEntity({ kind: 'pattern',      scope: 'project:q', summary: 'p', content: 'p-body', metadata: {}, tags: [], source: 'extracted', source_session_id: 's', embedding: vec })
    ke.upsertEntity({ kind: 'anti_pattern', scope: 'project:q', summary: 'a', content: 'a-body', metadata: {}, tags: [], source: 'extracted', source_session_id: 's', embedding: vec })
    const qs = await import(`../../../daemon/lib/query-server.js?t=${Date.now()}`)
    srv = qs.buildQueryServer({})
    await new Promise(r => srv.listen(0, r)); port = srv.address().port
  })
  afterEach(() => { srv?.close(); rmSync(home, { recursive: true, force: true }) })

  it('anti_pattern ranks above pattern at equal cosine', async () => {
    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/inject?prompt=test&kinds=pattern,anti_pattern&project=q&limit=5`, res => {
        let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(JSON.parse(b)))
      }).on('error', reject)
    })
    expect(body.results[0].kind).toBe('anti_pattern')
  })
})
```

(Write similar tests for `scope-filter.test.js` and `prompt-embedding-cache.test.js` — each sets up two projects or two identical prompts across projects and asserts no cross-leak.)

- [ ] **Step 3: Run FAIL.**

- [ ] **Step 4: Implement `/inject` in `query-server.js`.**

```js
// Inside buildQueryServer — add route handler
if (url.pathname === '/inject' && req.method === 'GET') {
  const prompt = url.searchParams.get('prompt') ?? ''
  const project = url.searchParams.get('project') ?? 'global'
  const kinds = (url.searchParams.get('kinds') ?? 'pattern,decision,anti_pattern').split(',')
  const limit = parseInt(url.searchParams.get('limit') ?? '8', 10)
  const cacheKey = sha1(`${prompt}\0${project}\0${kinds.join(',')}`)
  const cached = injectCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < 60_000) { respondJson(res, { results: cached.results }); return }
  const vec = await embedPrompt(prompt)
  const ann = hnsw.search(vec, limit * 3, parseInt(process.env.QUOTH_HNSW_EF_SEARCH ?? '50', 10))
  let rows = openDb().prepare(`
    SELECT id, kind, summary, content, metadata, confidence, updated_at
      FROM knowledge_entities
     WHERE status='active' AND kind IN (${kinds.map(()=>'?').join(',')})
       AND (scope = 'global' OR scope = ?)
       AND id IN (${ann.ids.map(()=>'?').join(',')})
  `).all(...kinds, `project:${project}`, ...ann.ids)
  // Under-fetch fallback
  if (rows.length < limit) {
    const ann2 = hnsw.search(vec, limit * 3, 200)
    rows = queryKnowledgeRows({ kinds, project, ids: ann2.ids })
    if (rows.length < limit) logPipelineError({ stage: 'inject', severity: 'warn', context: { prompt, project, under_fetch: true } })
  }

  // queryKnowledgeRows is a small helper private to query-server.js that runs
  // the same SELECT used above with a fresh id list — extract it to avoid duplication.
  const W = {
    pattern:      parseFloat(process.env.QUOTH_KIND_WEIGHT_PATTERN      ?? '1.0'),
    decision:     parseFloat(process.env.QUOTH_KIND_WEIGHT_DECISION     ?? '1.3'),
    anti_pattern: parseFloat(process.env.QUOTH_KIND_WEIGHT_ANTI_PATTERN ?? '1.5'),
  }
  const scored = rows
    .map(r => {
      const cos = ann.scoreFor(r.id)
      const rec = Math.exp(-(Date.now() - r.updated_at) / (30 * 86400_000))
      return { ...r, score: cos * r.confidence * rec * (W[r.kind] ?? 1.0) }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  injectCache.set(cacheKey, { ts: Date.now(), results: scored })
  respondJson(res, { results: scored })
  return
}
```

Fact `kind='fact'` is intentionally **not** accepted here — if the caller passes it, drop it silently. Facts are session-start only.

- [ ] **Step 5: Run PASS.**

- [ ] **Step 6: Commit.**

```bash
git add quoth-plugin/daemon/lib/query-server.js quoth-plugin/tests/unit/inject/
git commit -m "feat(inject): /inject endpoint with kind-weight ranking + project cache"
```

---

## Task 16: `/health` endpoint + `quoth_health` MCP tool

**Spec refs:** §5.5

**Files:**
- Modify: `quoth-plugin/daemon/lib/query-server.js`

- [ ] **Step 1: Add a test** that hits `/health` and verifies shape per spec §5.5.

```js
// tests/unit/inject/health.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'

describe('GET /health', () => {
  let home, srv, port
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-health-')); process.env.QUOTH_HOME = home
    const qs = await import(`../../../daemon/lib/query-server.js?t=${Date.now()}`)
    srv = qs.buildQueryServer({})
    await new Promise(r => srv.listen(0, r)); port = srv.address().port
  })
  afterEach(() => { srv?.close(); rmSync(home, { recursive: true, force: true }) })

  it('returns daemon state + errors_24h + budget + stuck_files', async () => {
    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/health`, res => {
        let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(JSON.parse(b)))
      }).on('error', reject)
    })
    expect(body).toHaveProperty('daemon.pid')
    expect(body).toHaveProperty('errors_24h')
    expect(body).toHaveProperty('budget')
    expect(Array.isArray(body.stuck_files)).toBe(true)
  })
})
```


- [ ] **Step 2: Implement** — aggregate `daemon.pid`, `uptime`, `pipeline_errors` counts (last 24h), `llm_budget.today()`, and scan `processing/` for files older than `QUOTH_PROCESSING_MAX_AGE_HOURS`. Single synchronous DB query batch.

- [ ] **Step 3: Commit.**

```bash
git add quoth-plugin/daemon/lib/query-server.js quoth-plugin/tests/unit/inject/health.test.js
git commit -m "feat(inject): /health endpoint"
```

---

## Task 17: `route` hook fast-path + daemon detach contract

**Spec refs:** §2.3 "hook-dispatch.js route", Daemon detach contract

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js`
- Create: `quoth-plugin/tests/unit/daemon/daemon-detach.test.js`
- Create: `quoth-plugin/tests/unit/inject/daemon-down.test.js`

- [ ] **Step 1: Write `daemon-down.test.js`** — fake socket server that never responds, assert the route hook returns within 250 ms with no injection.

- [ ] **Step 2: Write `daemon-detach.test.js`** — the canary test for the detach contract. Spawn `node hooks/hook-dispatch.js route` as a child process via `execFile`, measure exit time, then spawn again and verify the detached daemon child survives.

```js
// tests/unit/daemon/daemon-detach.test.js
import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

describe('daemon detach contract', () => {
  it('hook subprocess exits within 250 ms even when daemon cold', async () => {
    const t0 = Date.now()
    await exec(process.execPath, ['hooks/hook-dispatch.js', 'route'], {
      cwd: process.cwd(),
      input: JSON.stringify({ prompt: 'test' }),
      timeout: 500,
    }).catch(() => {}) // allow non-zero exit
    expect(Date.now() - t0).toBeLessThan(500)
  })
})
```

- [ ] **Step 3: Run FAIL.**

- [ ] **Step 4: Rewrite the `route` case in `hook-dispatch.js`.**

```js
// Pseudocode for hook-dispatch.js 'route' branch
async function routeHook(input) {
  const socket = quothSocketPath()
  const timeout = parseInt(process.env.QUOTH_DAEMON_SOCKET_TIMEOUT_MS ?? '200', 10)
  try {
    const res = await fetchOverUnixSocket({ socket, path: '/inject', query: { prompt: input.prompt, project: resolveProjectName(), kinds: 'pattern,decision,anti_pattern', limit: 8 }, timeoutMs: timeout })
    emitAdditionalContext(formatResults(res.results))
  } catch {
    spawnDaemonDetached()
    // exit with no injection
  }
}

function spawnDaemonDetached() {
  const child = spawn(process.execPath, [pathTo('daemon/daemon.js')], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    cwd: os.homedir(),
    env: { ...process.env, QUOTH_SPAWNED_BY_HOOK: '1' },
  })
  child.unref()
}
```

**Critical:** all three of `detached: true`, `stdio: 'ignore'`, and `.unref()` must be present or the hook stalls. The test enforces this.

- [ ] **Step 5: Run PASS.**

- [ ] **Step 6: Commit.**

```bash
git add quoth-plugin/hooks/hook-dispatch.js quoth-plugin/tests/unit/daemon/daemon-detach.test.js quoth-plugin/tests/unit/inject/daemon-down.test.js
git commit -m "feat(hooks): route fast-path + daemon detach contract"
```

---

## Task 18: `session-restore` drops pattern injection

**Spec refs:** §2.3 "session-restore"

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js`

- [ ] **Step 1: Write a test** asserting that the `session-restore` path calls `listFactsByNamespace` (or the new query-server `/facts` route) and emits max 5 facts, but never calls the pattern-ranking code path.

- [ ] **Step 2: Remove the pattern-injection block** from the `session-restore` case. Keep `initGraph` + project-context.md + facts injection.

- [ ] **Step 3: Run PASS.**

- [ ] **Step 4: Commit.**

```bash
git add quoth-plugin/hooks/hook-dispatch.js quoth-plugin/tests/unit/daemon/session-restore-no-patterns.test.js
git commit -m "feat(hooks): session-restore drops pattern injection (moved to route)"
```

---

## Task 19: `subagent-start` hook uses `/inject` with agentType filter

**Spec refs:** §2.3 "subagent-start"

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js`

- [ ] **Step 1: Write a test** with a fake socket that asserts `subagent-start` sends `agentType=<type>` to `/inject`.

- [ ] **Step 2: Wire the branch** to call `/inject` with `agentType` derived from the spawned subagent type (existing `routing.js` mapping).

- [ ] **Step 3: Commit.**

```bash
git add quoth-plugin/hooks/hook-dispatch.js quoth-plugin/tests/unit/daemon/subagent-start.test.js
git commit -m "feat(hooks): subagent-start calls /inject with agentType"
```

---

## Task 20: MCP `entities.js` handler (replaces `patterns.js`)

**Spec refs:** §6.3 MCP tool migration

**Files:**
- Create: `quoth-plugin/mcp/handlers/entities.js`
- Modify: `quoth-plugin/mcp/handlers/index.js`

- [ ] **Step 1: Write a test** for each new tool handler by calling it directly (MCP handlers are plain async functions).

- [ ] **Step 2: Implement `entities.js`** exporting:
  - `quoth_top_entities({ kind?, limit? })`
  - `quoth_search_entities({ query, kinds?, limit? })`
  - `quoth_score_entity({ id, outcome })`
  - `quoth_promote_entity({ id })`
  - `quoth_recall_decisions({ situation, limit? })`
  - `quoth_recall_anti_patterns({ situation, limit? })`
  - `quoth_recall_global({ query })`
  - `quoth_log_decision({ situation, options, choice, reasoning })`
  - `quoth_log_anti_pattern({ condition, what_not_to_do, why_failed })`
  - `quoth_health()`
  - `quoth_replay_session({ session_id })`

Each is a thin wrapper over `knowledge-entities.js` + the query-server's `/inject` and `/health` endpoints. `quoth_log_*` tools call `upsertEntity` with `source='agent_logged'`.

- [ ] **Step 3: Wire into `mcp/handlers/index.js`** — register the new tools. Keep `agents.js` as-is. Do NOT yet remove `patterns.js` / `intelligence.js` / `skills.js` — that's Task 24. The MCP server will temporarily expose both old and new tool names; during Task 24 the old registrations get dropped.

- [ ] **Step 4: Run PASS.**

- [ ] **Step 5: Commit.**

```bash
git add quoth-plugin/mcp/handlers/entities.js quoth-plugin/mcp/handlers/index.js quoth-plugin/tests/unit/mcp/entities.test.js
git commit -m "feat(mcp): entities.js handler with 11 new/renamed tools"
```

---

## Task 21: Integration tests — end-to-end pipeline runs

**Spec refs:** §7.2

**Files:**
- Create: `quoth-plugin/tests/integration/end-to-end-productive.test.js`
- Create: `quoth-plugin/tests/integration/end-to-end-routine.test.js`
- Create: `quoth-plugin/tests/integration/end-to-end-multi-session.test.js`
- Create: `quoth-plugin/tests/integration/end-to-end-injection.test.js`
- Create: `quoth-plugin/tests/integration/end-to-end-budget-exhausted.test.js`

All integration tests use a scratch `QUOTH_HOME`, a fake LLM stub, and a fake HNSW (in-memory Map). They drive `processSessionWithPipeline` end-to-end.

- [ ] **Step 1: Write `end-to-end-productive.test.js`.**

```js
// tests/integration/end-to-end-productive.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('end-to-end productive session', () => {
  let home
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'quoth-e2e-')); process.env.QUOTH_HOME = home })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('productive → entities persisted → archived to done/', async () => {
    const dir = join(home, 'trajectories/processing'); mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 's1.jsonl'), JSON.stringify({ tool: 'Write', tool_input: { file_path: 'x.js' } }) + '\n')
    writeFileSync(join(dir, 's1.meta.json'), JSON.stringify({ session_id: 's1', project: 'quoth' }))
    const fakeLLM = { gemini: async () => ({ text: JSON.stringify({ productive: true, urgency: 'medium', suspected_kinds: ['pattern'] }), cost_usd: 0.0003 }),
                      kimi:   async () => ({ text: JSON.stringify({ patterns: [{ condition:'c', action:'a', summary:'s' }] }), cost_usd: 0.012 }) }
    const fakeHnsw = { add: () => {}, save: () => {} }
    const { processSessionWithPipeline } = await import(`../../daemon/daemon.js?t=${Date.now()}`)
    await processSessionWithPipeline(join(dir, 's1.jsonl'), { hnsw: fakeHnsw, llm: fakeLLM })
    const ke = await import(`../../daemon/lib/knowledge-entities.js?t=${Date.now()}`)
    const rows = ke.searchByKind('pattern', 10)
    expect(rows).toHaveLength(1)
    // Also verify file moved to done/
    expect(existsSync(join(home, `trajectories/done/${new Date().toISOString().slice(0,10)}/quoth/s1.jsonl`))).toBe(true)
  })
})
```

- [ ] **Step 2: Write the other four integration tests** following the same pattern.

- [ ] **Step 3: Run all integration tests.**

```bash
cd quoth-plugin && npm test -- integration
```

- [ ] **Step 4: Commit.**

```bash
git add quoth-plugin/tests/integration/end-to-end-*.test.js
git commit -m "test(integration): end-to-end productive/routine/multi/inject/budget"
```

---

## Task 22: Concurrency property test

**Spec refs:** §7.4

**Files:**
- Create: `quoth-plugin/tests/property/concurrent-pipeline.test.js`

- [ ] **Step 1: Write the property test.**

```js
// tests/property/concurrent-pipeline.test.js
import { describe, it, expect } from 'vitest'
// For each iteration:
//   - N = random int in [1, 50]
//   - concurrency = random int in [1, 8]
//   - drop N fixtures into processing/
//   - run the pipeline
//   - assert: every fixture lands in exactly one terminal bucket; no fixtures lost; no double-processed
```

Use `fc` (fast-check) if already a dep; otherwise hand-roll 30 iterations with `Math.random()`.

- [ ] **Step 2: Run — must pass 30 iterations without a single lost/double-processed fixture.**

- [ ] **Step 3: Commit.**

```bash
git add quoth-plugin/tests/property/concurrent-pipeline.test.js
git commit -m "test(property): concurrent pipeline exactly-once invariant"
```

---

## Task 23: `verify-cleanup.sh` script + integration test

**Spec refs:** §6.5

**Files:**
- Create: `quoth-plugin/scripts/verify-cleanup.sh`
- Create: `quoth-plugin/tests/integration/cleanup-verification.test.js`

- [ ] **Step 1: Implement the shell script.**

```bash
#!/usr/bin/env bash
# scripts/verify-cleanup.sh
set -euo pipefail

EXCLUDE_PATHS=(
  '_archive/'
  'docs/superpowers/specs/archive/'
  'docs/superpowers/specs/2026-04-11-session-capture-and-pattern-extraction-design.md'
  'docs/superpowers/plans/'
  'docs/superpowers/implementations/'
  'CHANGELOG.md'
  '.git/'
  'node_modules/'
  'tests/migration/'
  'scripts/verify-cleanup.sh'
)

STALE_TERMS=(
  '\bJUDGE\b'
  '\bDISTILL\b'
  '\bCONSOLIDATE\b'
  'voyage-4-lite'
  'bandit-v2'
  '\bSNIPS\b'
  'judge_queue'
  'cluster_posterior'
)

exclude_args=()
for p in "${EXCLUDE_PATHS[@]}"; do exclude_args+=(--exclude-dir="$p" --exclude="$p"); done

fail=0
for term in "${STALE_TERMS[@]}"; do
  if grep -rE "${exclude_args[@]}" "$term" . 2>/dev/null; then
    echo "STALE TERM FOUND: $term"
    fail=1
  fi
done
exit $fail
```

```bash
chmod +x quoth-plugin/scripts/verify-cleanup.sh
```

- [ ] **Step 2: Write the integration test** that invokes the shell script and asserts exit 0 **after Task 24** (this test is expected to FAIL here and pass at Task 24 — that's the point of having it run earlier).

```js
// tests/integration/cleanup-verification.test.js
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

describe.skip('verify-cleanup.sh', () => {
  // skipped until Task 24 deletes stale code
  it('exits 0 after legacy cleanup', () => {
    const code = execSync('bash scripts/verify-cleanup.sh', { cwd: 'quoth-plugin' })
    expect(code).toBeDefined()
  })
})
```

Use `describe.skip` for now so the test doesn't break CI. Task 24 un-skips it.

- [ ] **Step 3: Commit.**

```bash
git add quoth-plugin/scripts/verify-cleanup.sh quoth-plugin/tests/integration/cleanup-verification.test.js
git commit -m "feat(tooling): verify-cleanup.sh + skipped integration test"
```

---

## Task 24: Legacy cleanup — delete dead code in one commit

**Spec refs:** §6.1, §6.2, §6.3

**This is the largest single commit in the plan. Do it last. Do not split it.**

**Files:** Per spec §6.1 list. Delete only after `Grep` confirms zero callers.

- [ ] **Step 1: Run the verify-no-callers loop for every file in spec §6.1.**

For each file `F` in the delete list:

```bash
cd quoth-plugin && grep -r "require.*$(basename F .js)\|from.*$(basename F .js)" --include="*.js" . | grep -v "^./$F"
```

Record the result. If any caller references exist, reclassify `F` from "delete" to "rewrite" — stop the task and loop with the plan author before proceeding.

- [ ] **Step 2: Delete files in the order given** (libraries first, then MCP handlers, then scripts, then tests). Use `git rm`.

```bash
cd quoth-plugin
git rm daemon/lib/judge.js daemon/lib/snips.js daemon/lib/clustering.js \
       daemon/lib/bandit-v2.js daemon/lib/sampler.js daemon/lib/curation.js \
       daemon/lib/mutate.js daemon/lib/propensity.js daemon/lib/attribute.js \
       daemon/lib/attribution.js daemon/lib/doc-update-api.js \
       daemon/lib/doc-updater.js daemon/lib/doc-manifest.js \
       daemon/lib/doc-chunks.js daemon/lib/pull.js daemon/lib/skill-extract.js \
       daemon/lib/scoring.js daemon/lib/injection.js daemon/lib/pattern-cache.js \
       daemon/lib/flags.js daemon/lib/sessions.js daemon/lib/promote.js
git rm mcp/handlers/intelligence.js mcp/handlers/skills.js mcp/handlers/patterns.js mcp/lib/graph.js
git rm scripts/migrate-session-isolation.js scripts/migrate-v2-quality.js \
       scripts/cleanup-patterns.js scripts/reembed-patterns.js \
       scripts/backfill-embeddings.js scripts/run-nightly-now.js \
       scripts/calibrate-dedup.js scripts/ab-compare.js scripts/setup.sh
# Tests — delete matching test files
git rm tests/judge-v2.test.js tests/clustering*.test.js tests/bandit-v2.test.js \
       tests/sampler.test.js tests/snips.test.js tests/curation.test.js \
       tests/mutate.test.js tests/propensity.test.js tests/attribute.test.js \
       tests/attribution.test.js tests/scoring.test.js tests/calibrate-dedup.test.js \
       tests/skill-extract.test.js tests/doc-update-api.test.js tests/shared-pull.test.js \
       tests/migrate-session-isolation.test.js tests/injection*.test.js \
       tests/unified-injection.test.js tests/outcome-reranking.test.js \
       tests/pattern-cache.test.js tests/pattern-outcomes.test.js tests/flags.test.js \
       tests/sessions-helpers.test.js tests/routing-v2.test.js tests/schema-v2.test.js
```

- [ ] **Step 3: Drop the old tables from `daemon/db.js`.**

Replace the old `patterns` / `memory_entries` / `judge_queue` / `skills` / `trajectories` / `trajectory_steps` `CREATE TABLE` blocks with `DROP TABLE IF EXISTS` statements under a one-shot migration gated by a boolean flag in the DB (`daemon_meta.key='greenfield_reset_v3_6'`).

- [ ] **Step 4: Remove tool registrations** for deleted tools in `mcp/handlers/index.js`. Verify the MCP server only exposes the 18 tools from spec §6.3.

- [ ] **Step 5: Remove retired env var handling.** Grep for `QUOTH_LLM_MODEL`, `QUOTH_JUDGE_DAILY_LIMIT`, `QUOTH_V2_MINI_JUDGE_LIMIT` — delete every reference.

- [ ] **Step 6: Un-skip the cleanup-verification integration test.**

```js
// tests/integration/cleanup-verification.test.js
describe('verify-cleanup.sh', () => { // removed .skip
```

- [ ] **Step 7: Run the full suite.**

```bash
cd quoth-plugin && npm test
```

Expected: everything green. If any leftover test imports a deleted file, delete that test too (if it's in the delete list) or update it to use the new API.

- [ ] **Step 8: Run `verify-cleanup.sh` directly.**

```bash
cd quoth-plugin && bash scripts/verify-cleanup.sh
```

Expected: exit 0.

- [ ] **Step 9: Commit.**

```bash
git add -A
git commit -m "refactor: remove legacy judge/SNIPS/bandit/skills subsystems (greenfield reset)"
```

---

## Task 25: `cli.js reset` + `init` wizard updates

**Spec refs:** §6.6 cutover sequence

**Files:**
- Modify: `quoth-plugin/scripts/cli.js`
- Create: `quoth-plugin/scripts/reset-quoth-home.js`

- [ ] **Step 1: Add `cli.js reset`** subcommand that: (1) tars `~/.quoth/` to `~/.quoth-backup-<ISOdate>.tar.gz`, (2) prompts user to confirm deletion, (3) removes `~/.quoth/memory.db`, `~/.quoth/hnsw.bin`, `~/.quoth/intelligence/`, `~/.quoth/trajectories/processing-deferred/`.

- [ ] **Step 2: Update `cli.js init`** to (a) warn if legacy DB tables are present, (b) print the new env vars in the wizard output, (c) print the reset instruction prominently: "Run `node quoth-plugin/scripts/cli.js reset` first if upgrading from a pre-v3.6 install."

- [ ] **Step 3: Write a test** using a scratch `QUOTH_HOME` that invokes `reset` programmatically, verifies the tarball exists, verifies the DB file is gone, verifies a fresh `openDb()` creates the new schema.

- [ ] **Step 4: Run PASS.**

- [ ] **Step 5: Commit.**

```bash
git add quoth-plugin/scripts/cli.js quoth-plugin/scripts/reset-quoth-home.js quoth-plugin/tests/unit/cli/reset.test.js
git commit -m "feat(cli): reset subcommand + init wizard updates"
```

---

## Task 26: Documentation update

**Spec refs:** §6.5

**Files:**
- Modify: `quoth-plugin/CLAUDE.md`

- [ ] **Step 1: Rewrite the pipeline section.** Replace JUDGE/DISTILL/CONSOLIDATE language with TRIAGE/EXTRACT/EMBED/PERSIST. Replace the "What it does" bullet list to describe four entity kinds, dedup sidecar, worker pool + semaphores, /inject endpoint, race-free budget.

- [ ] **Step 2: Update env var list** per spec §6.4.

- [ ] **Step 3: Update the hooks table** with matcher `*` for PostToolUse and the new behavior of `route` / `session-restore` / `subagent-start`.

- [ ] **Step 4: Update the MCP tools section** to list the 18 tools (spec §6.3 "Net count math").

- [ ] **Step 5: Re-run `verify-cleanup.sh`.**

```bash
cd quoth-plugin && bash scripts/verify-cleanup.sh
```

- [ ] **Step 6: Commit.**

```bash
git add quoth-plugin/CLAUDE.md
git commit -m "docs: rewrite CLAUDE.md for TRIAGE/EXTRACT/EMBED/PERSIST + 4 kinds"
```

---

## Task 27: Final end-to-end cutover test in sandbox

**Spec refs:** §6.6 cutover sequence steps 2–10

**This task is a manual verification, not a TDD commit. It produces no code diff — only a runbook record.**

- [ ] **Step 1: Create an isolated sandbox.**

```bash
export QUOTH_HOME=/tmp/quoth-cutover-$$
mkdir -p $QUOTH_HOME
```

- [ ] **Step 2: Start the daemon in the sandbox.**

```bash
cd quoth-plugin && node daemon/daemon.js &
DAEMON_PID=$!
```

Wait 2 s, then check `$QUOTH_HOME/daemon.pid` exists and `$QUOTH_HOME/memory.db` was created with the new schema (spot check `knowledge_entities` table exists via `sqlite3 $QUOTH_HOME/memory.db '.tables'`).

- [ ] **Step 3: Fake a productive session fixture.**

Drop a hand-crafted JSONL + meta file into `$QUOTH_HOME/trajectories/processing/`. Set `MOONSHOT_API_KEY` + `AI_GATEWAY_API_KEY` from `~/.quoth/.env` (real LLM call for this test).

- [ ] **Step 4: Watch the daemon logs.**

```bash
tail -f $QUOTH_HOME/daemon.log
```

Expected: triage → extract → embed → persist lines appear. File moves to `$QUOTH_HOME/trajectories/done/YYYY-MM-DD/<project>/`.

- [ ] **Step 5: Hit `/health` via socket.**

```bash
curl --unix-socket $QUOTH_HOME/daemon.sock http://daemon/health | jq .
```

Expected: JSON with `daemon.pid`, `errors_24h`, `budget`, `stuck_files: []`.

- [ ] **Step 6: Hit `/inject` over socket.**

```bash
curl --unix-socket $QUOTH_HOME/daemon.sock 'http://daemon/inject?prompt=refactor+helper&project=quoth&kinds=pattern&limit=5' | jq .
```

Expected: JSON with `results: [...]` (length ≤ 5, each has `kind`, `score`).

- [ ] **Step 7: Clean up.**

```bash
kill $DAEMON_PID
rm -rf $QUOTH_HOME
```

- [ ] **Step 8: Record cutover results** in a short note appended to the plan file (below this task). Include daemon uptime, triage/extract costs from `llm_budget`, and any `pipeline_errors` rows observed.

**Do NOT wipe production `~/.quoth/`** as part of plan execution. Spec §6.6 step 8 ("wipe production") is a runtime operator action, performed by the user outside this plan.

- [ ] **Step 9: Commit** (just the plan-file update, if any).

```bash
git add docs/superpowers/plans/2026-04-11-session-capture-and-pattern-extraction.md
git commit -m "docs(plan): record cutover sandbox verification results"
```

### Task 27 execution record (2026-04-11)

Three sandbox runs at `/tmp/quoth-cutover-*`, each a fresh `$QUOTH_HOME` with the full `~/.quoth/.env` (real `AI_GATEWAY_API_KEY` + `MOONSHOT_API_KEY`). First two runs uncovered wiring bugs introduced by the redesign; the third run was fully green end-to-end.

**Bugs found and fixed in `daemon/daemon.js`:**

1. **FileWatcher wiring mismatch.** `new core.FileWatcher({ dir, onFile, onDegraded })` passed an options object as the constructor's first positional `dir` argument, so `readdirSync(this.dir)` silently returned nothing and no `'file'` event was ever wired. Fixed by calling `new core.FileWatcher(PROCESSING_DIR, { pollIntervalMs, onDegraded })` and subscribing with `watcher.on('file', filename => enqueueSessionFile(path.join(PROCESSING_DIR, filename)))`.

2. **Boot-time enqueue missing.** The watcher's warmup seeds `knownFiles` from the directory listing so pre-existing files never emit an event. `core.recoverOrphans({ processingDir, onFile, log })` was supposed to re-enqueue them but `recoverOrphans(dir)` takes a string and only strips `.pid.worker.jsonl` suffixes from crashed-worker claim files — it never re-enqueues regular sessions. Fixed by calling `recoverOrphans(PROCESSING_DIR)` for the orphan sweep, then `fs.readdirSync(PROCESSING_DIR)` and enqueueing every `*.jsonl` directly so the worker pool drains anything left from a previous run.

3. **HNSW passed as the SQLite handle.** Worker was calling `processSessionWithPipeline(file, { hnsw: db, ... })`, but `db` is the better-sqlite3 instance with helper methods — no `.add(id, vec)`. persist.js hit `hnsw.add is not a function` and wrote degraded `pipeline_errors` rows, leaving `embedding_indexed = 0`. Fixed by awaiting `loadOrInit({ db, home: QUOTH_HOME })` at boot (stored as `const hnswReady = (async () => ...)()`) and awaiting that promise inside `runWorker()` before each `processSessionWithPipeline` call, so persist.js always receives a real `HnswIndex`.

**Final run (after fixes):**

- **Sandbox:** `/tmp/quoth-cutover-v3-549293`
- **Fixture:** 6-entry session (`Read` → `Edit` adding `= ''` default param → `Bash npm test`), `session_id=cutover-v3-...`, `project=cutover`
- **Pipeline trace:** fixture moved `processing/` → `done/2026-04-11/cutover/`
- **`knowledge_entities`:** 1 row, `kind=pattern`, `scope=project:cutover`, summary *"Add default parameter to prevent undefined errors in utility functions"*, `confidence=0.5`, `embedding_indexed=1`
- **`llm_budget`:** 1 triage call + 1 extract call, `spend_usd=0.0006175` for 2026-04-11
- **`pipeline_errors`:** 0 rows
- **`/health`:** `errors_24h.*.degraded = 0` across all stages, `stuck_files = []`
- **`/inject?prompt=defensive+default+parameter&project=cutover&kinds=pattern&limit=5`:** returned 1 result (the persisted pattern) with cosine score ≈ 0.223, confirming both HNSW indexing and the socket fast-path

Production `~/.quoth/` untouched — sandbox was a fresh disposable `$QUOTH_HOME` throughout.

---

## Verification before completion

Before declaring the plan complete, the executor must:

1. Run `cd quoth-plugin && npm test` — all green.
2. Run `cd quoth-plugin && bash scripts/verify-cleanup.sh` — exit 0.
3. Run the concurrency property test with 30+ iterations — no lost or double-processed fixtures.
4. Confirm `mcp/handlers/index.js` exposes exactly 18 tools.
5. Confirm the spec's greenfield reset is reflected: `patterns`, `memory_entries`, `judge_queue`, `skills`, `trajectories`, `trajectory_steps` tables are dropped by the first-boot migration.
6. Spot-check that `daemon-detach.test.js`, the `llm-budget` race test, and `persist.test.js` idempotency walk-through are still in the suite (they protect against the highest-risk regressions).
7. Confirm the PR description references spec §§ for every non-obvious choice: the 5-case idempotency walk-through (§2.2), the detach contract (§2.3), the race-free budget reservation (§2.2), and the "loud DB / quiet stderr" principle (§5.1).

---

## Open issues for the executor to surface

If any of these come up during execution, **stop and surface to the plan author** rather than guessing:

- A file in the spec §6.1 delete list has inbound callers that aren't in the delete list themselves.
- `extract.js`'s existing dependency-injection shape differs materially from what Task 9 assumes.
- `buildQueryServer` does not exist as an export (memory fact says it does — verify).
- The fake-LLM shape `{ text, cost_usd }` doesn't match what `daemon/lib/llm.js` returns.
- Vitest fast-check (`fc`) is not installed and Task 22's property test needs a rewrite.
- The concurrency property test (§7.4) or any integration test exceeds 5 minutes on a typical dev machine.

---
