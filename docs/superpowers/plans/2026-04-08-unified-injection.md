# Unified Injection System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify patterns + doc chunks into a single ranked injection pipeline with working V2 feedback loop. Doc content stays fresh via cron — injection *selection* gets feedback.

**Architecture:** Doc chunks become virtual patterns with `doc:` prefixed IDs and Thompson priors. `hierarchicalSelect()` ranks both in a single pass. All 3 injection hooks (session-start, prompt-submit, subagent-start) consume unified results. Injection logging captures both with propensity scores. Session-end feedback routes through Bayesian updates. SNIPS closes the loop nightly. Daemon watches docs/ for changes and re-indexes automatically.

**Tech Stack:** Node.js (CommonJS), SQLite (better-sqlite3), Vitest

**Spec:** `docs/superpowers/specs/2026-04-08-unified-injection-design.md`

---

### Task 1: Fix Reward Signal (attribution.js)

**Files:**
- Modify: `quoth-plugin/daemon/lib/attribution.js`
- Modify: `quoth-plugin/tests/attribution.test.js`

- [ ] **Step 1: Read current implementation**

Read `quoth-plugin/daemon/lib/attribution.js` fully. The `sessionOutcomeReward(events)` function (lines 17-24) always returns 0.5 because `tool_use` events never carry `.outcome`.

- [ ] **Step 2: Replace sessionOutcomeReward with graded heuristic**

```javascript
function sessionOutcomeReward(events) {
  if (!events || events.length === 0) return 0.5

  // Priority 1: session_summary event with success_rate
  const summary = events.find(e => e.event === 'session_summary')
  if (summary && typeof summary.success_rate === 'number') {
    if (summary.success_rate >= 0.8) return 1.0
    if (summary.success_rate >= 0.5) return 0.7
    if (summary.success_rate > 0)    return 0.3
    return 0.0
  }

  // Priority 2: infer from tool mix
  const writes = events.filter(e => ['Write', 'Edit', 'MultiEdit'].includes(e.tool)).length
  const bashErrors = events.filter(e => e.tool === 'Bash' && e.exit_code > 0).length

  if (writes > 0 && bashErrors === 0) return 0.8
  if (writes > 0 && bashErrors > 0)   return 0.5
  if (bashErrors > 0 && writes === 0) return 0.2
  return 0.5
}
```

- [ ] **Step 3: Update tests**

In `tests/attribution.test.js`, add test cases for:
- Session summary with success_rate 0.9 → 1.0
- Session summary with success_rate 0.6 → 0.7
- Session summary with success_rate 0.1 → 0.3
- Session summary with success_rate 0 → 0.0
- Tool events with Write + no errors → 0.8
- Tool events with Write + Bash errors → 0.5
- Tool events with Bash errors only → 0.2
- Empty events → 0.5

- [ ] **Step 4: Run tests**

Run: `cd quoth-plugin && npm test -- tests/attribution.test.js`

---

### Task 2: Doc Chunk Thompson Priors (db.js)

**Files:**
- Modify: `quoth-plugin/daemon/db.js`
- Modify: `quoth-plugin/tests/db.test.js`

- [ ] **Step 1: Add runtime migration for alpha/beta columns**

In `db.js`, after existing v2Migrate blocks (~line 180):

```javascript
v2Migrate('add doc_chunks Thompson priors', () => {
  db.exec('ALTER TABLE doc_chunks ADD COLUMN alpha REAL NOT NULL DEFAULT 1')
  db.exec('ALTER TABLE doc_chunks ADD COLUMN beta REAL NOT NULL DEFAULT 1')
})
```

- [ ] **Step 2: Add updateDocChunkAlphaBeta method**

```javascript
db.updateDocChunkAlphaBeta = function(chunkId, outcome) {
  const col = outcome === 'success' ? 'alpha' : 'beta'
  db.prepare(`UPDATE doc_chunks SET ${col} = ${col} + 1 WHERE id = ?`).run(chunkId)
}
```

- [ ] **Step 3: Add getDocChunksWithStats method**

```javascript
db.getDocChunksWithStats = function(queryVector, limit = 10) {
  const rows = db.prepare('SELECT *, alpha/(alpha+beta) as confidence FROM doc_chunks WHERE embedding IS NOT NULL').all()
  if (rows.length === 0) return []
  const scored = rows.map(row => {
    let sim = 0
    try { sim = cosineSimilarity(queryVector, JSON.parse(row.embedding)) } catch {}
    return { ...row, _similarity: sim }
  })
  scored.sort((a, b) => b._similarity - a._similarity)
  return scored.slice(0, limit)
}
```

- [ ] **Step 4: Add tests**

In `tests/db.test.js`:
- Verify doc_chunks table has alpha/beta columns
- Test `updateDocChunkAlphaBeta` success increases alpha
- Test `updateDocChunkAlphaBeta` failure increases beta
- Test `getDocChunksWithStats` returns confidence field

- [ ] **Step 5: Run tests**

Run: `cd quoth-plugin && npm test -- tests/db.test.js`

---

### Task 3: Flags Diagnostic (flags.js)

**Files:**
- Modify: `quoth-plugin/daemon/lib/flags.js`

- [ ] **Step 1: Add getActiveFlags()**

```javascript
function getActiveFlags() {
  return {
    master: isV2Enabled(),
    injection: isSubFlag('injection'),
    exploration: isSubFlag('exploration'),
    judge: isSubFlag('judge'),
    curation: isSubFlag('curation'),
  }
}

module.exports = { isV2Enabled, isSubFlag, getActiveFlags }
```

---

### Task 4: recordExposure Routing (scoring.js)

**Files:**
- Modify: `quoth-plugin/daemon/lib/scoring.js`

- [ ] **Step 1: Filter doc: IDs in recordExposure**

`recordExposure(db, ids)` runs `UPDATE patterns SET exposure_count...` which silently does nothing for `doc:` prefixed IDs (no matching row in patterns table). Filter them out:

```javascript
function recordExposure(db, ids) {
  if (!ids || ids.length === 0) return
  const patternIds = ids.filter(id => !id.startsWith('doc:'))
  if (patternIds.length === 0) return
  const stmt = db.prepare(`
    UPDATE patterns
    SET exposure_count = exposure_count + 1,
        last_exposed_at = strftime('%s','now') * 1000
    WHERE id = ?
  `)
  const run = db.transaction((batch) => {
    for (const id of batch) stmt.run(id)
  })
  run(patternIds)
}
```

Doc chunk exposures are tracked via `injection_log` (logged in query-server.js) — no separate counter needed on the doc_chunks table.

---

### Task 5: Unified Ranking (query-server.js)

**Files:**
- Modify: `quoth-plugin/daemon/lib/query-server.js`

- [ ] **Step 1: Read current handleQuery implementation**

Read `query-server.js` fully. Understand the V1/V2 branching (lines 162-193) and doc chunk search (lines 223-233).

- [ ] **Step 2: Define constants**

At top of file:
```javascript
const DOC_CLUSTER_ID = -1
```

- [ ] **Step 3: Modify V2 path to include doc chunks**

In the `isSubFlag('injection') && embedding` branch (lines 169-180), after fetching pattern candidates:

```javascript
// V2: unified ranking with doc chunks
const { hierarchicalSelect } = require('./bandit-v2.js')
const candidates = db.searchBySimilarity(embedding, 20, tags)

// Fetch doc chunk candidates and transform to pattern shape
const docCandidates = db.getDocChunksWithStats(embedding, 10)
const docAsPatterns = docCandidates.map(c => ({
  id: `doc:${c.id}`,
  name: c.section_header,
  action: (c.content || '').slice(0, 200),
  condition: c.doc_file,
  confidence: c.confidence || 0.5,
  alpha: c.alpha || 1,
  beta: c.beta || 1,
  cluster_id: DOC_CLUSTER_ID,
  embedding: typeof c.embedding === 'string' ? JSON.parse(c.embedding) : c.embedding,
  tags: JSON.stringify([`doc:${(c.doc_file || '').replace('.md', '')}`]),
  _isDocChunk: true,
  _similarity: c._similarity || 0,
}))

// Merge candidates
const allCandidates = [...candidates, ...docAsPatterns]

// Build cluster map including synthetic doc cluster
const clusterMap = new Map()
for (const c of allCandidates) {
  if (c.cluster_id != null) {
    const stats = c.cluster_id === DOC_CLUSTER_ID
      ? { alpha: 1, beta: 1, attempts: docCandidates.length }  // neutral doc cluster prior
      : db.getClusterStats(c.cluster_id, ns)
    if (stats) clusterMap.set(c.cluster_id, stats)
  }
}

// Unified hierarchical selection
const selected = hierarchicalSelect(allCandidates, clusterMap, limit, embedding)

// Split back into patterns and doc chunks
patterns = selected.filter(s => !s.id.startsWith('doc:'))
const docResults = selected.filter(s => s.id.startsWith('doc:'))
```

- [ ] **Step 4: Update injection logging to include doc chunks**

After existing pattern logging loop, add doc chunk logging:
```javascript
for (let i = 0; i < docResults.length; i++) {
  try {
    db.logInjection({
      session_id: session_id || 'daemon-query',
      namespace: ns,
      pattern_id: docResults[i].id,
      cluster_id: DOC_CLUSTER_ID,
      rank: patterns.length + i + 1,
      propensity: docResults[i].propensity || 1.0,
      is_exploration: 0,
      query_text: (prompt || '').slice(0, 200),
    })
  } catch {}
}
```

- [ ] **Step 5: Update doc_chunks result format**

Replace the old separate doc chunk search (lines 223-233) with unified result:
```javascript
// Doc chunks already included in unified result (V2)
if (isSubFlag('injection') && docResults) {
  result.doc_chunks = docResults.map(c => ({
    title: c.name || c.section_header || '',
    content: (c.action || c.content || '').slice(0, 500),
    score: c._similarity || c.propensity || 0,
    doc_file: c.condition || c.doc_file || '',
  }))
} else {
  // V1 fallback: separate doc chunk search (existing code)
  try {
    if (embedding) {
      const chunks = db.searchDocChunks(embedding, 3)
      result.doc_chunks = chunks.map(c => ({
        title: c.title || c.doc_path || '',
        content: (c.content || '').slice(0, 500),
        score: c._similarity || 0,
      }))
    }
  } catch { result.doc_chunks = [] }
}
```

- [ ] **Step 6: V1 fallback also logs doc chunks**

In the V1 else branch, after searching doc chunks, add injection logging for them (same as Step 4 pattern).

---

### Task 6: All Injection Hooks Consume Doc Chunks (hook-dispatch.js)

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js`

- [ ] **Step 1: Session-restore: inject doc chunks at session start**

In the `session-restore` handler, after pattern injection (line ~360), add doc chunk consumption from `resp.doc_chunks`:

```javascript
// Doc chunk injection at session start
const docChunks = resp.doc_chunks || []
const relevantDocs = docChunks.filter(c => c.score > 0.2)
if (relevantDocs.length > 0) {
  const lines = ['[Quoth Docs] Session context:']
  for (const c of relevantDocs) {
    const label = (c.doc_file || c.title || '').replace('.md', '').replace(/^\d+-/, '')
    lines.push(`  • [${label}] ${(c.content || '').slice(0, 150)}`)
  }
  console.log(lines.join('\n'))
  // Record in session memory for feedback tracking
  const docIds = relevantDocs.filter(c => c.id).map(c => c.id)
  if (docIds.length > 0) sm.recordInjection(docIds)
}
```

Note: This requires query-server to include `id` in doc_chunks response (done in Task 5, Step 5).

- [ ] **Step 2: Subagent-start: append doc chunks to additionalContext**

In the `subagent-start` handler, after building pattern `additionalContext` (line ~631), append doc chunks:

```javascript
const docChunks = resp.doc_chunks || []
const relevantDocs = docChunks.filter(c => c.score > 0.2)
if (relevantDocs.length > 0) {
  const docContext = relevantDocs
    .map(c => `- [doc] ${c.title || ''}: ${(c.content || '').slice(0, 100)}`)
    .join('\n')
  output.additionalContext += `\n\n[Quoth Docs] Relevant documentation:\n${docContext}`
  // Record doc chunk exposures
  const docIds = relevantDocs.filter(c => c.id).map(c => c.id)
  if (docIds.length > 0) sm.recordInjection(docIds)
}
```

- [ ] **Step 3: Route handler: record doc chunk IDs in session memory**

In the `route` handler, after recording pattern injections, add doc chunks:

```javascript
if (resp.doc_chunks) {
  const docIds = resp.doc_chunks.filter(c => c.id).map(c => c.id)
  if (docIds.length > 0) sm.recordInjection(docIds)
}
```

---

### Task 7: Feedback Closure (hook-dispatch.js)

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js`

- [ ] **Step 1: Read session-end and post-task handlers**

Read hook-dispatch.js lines 449-576.

- [ ] **Step 2: Route doc: IDs in session-end V2 feedback**

In the session-end V2 feedback loop (~line 487), after `db.updateInjectionOutcome(sessionId, pid, patternReward)`:

```javascript
// Route feedback to correct table
if (pid.startsWith('doc:')) {
  const chunkId = pid.slice(4)
  if (patternReward >= 0.7) {
    db.updateDocChunkAlphaBeta(chunkId, 'success')
  } else if (patternReward <= 0.3) {
    db.updateDocChunkAlphaBeta(chunkId, 'failure')
  }
  // 0.3-0.7 = neutral, no Bayesian update (avoid noise)
} else {
  // Existing pattern Bayesian update
  if (patternReward >= 0.7) db.applyBayesianUpdate(pid, 'success')
  else if (patternReward <= 0.3) db.applyBayesianUpdate(pid, 'failure')
}
```

- [ ] **Step 3: Route doc: IDs in post-task feedback**

In post-task handler (~line 565), same pattern: check `doc:` prefix before calling Bayesian update.

- [ ] **Step 4: Record doc chunk injections in session memory**

In the route handler, after receiving daemon response, check if doc chunk IDs need recording:
```javascript
// After pattern injection recording
if (resp.doc_chunks) {
  for (const c of resp.doc_chunks) {
    if (c.id) sm.recordInjection(c.id)
  }
}
```

Note: This requires query-server to include `id` in the doc_chunks response. Add `id: c.id` to the doc_chunks mapping in Task 4.

---

### Task 8: SNIPS Cold-Start Fix + Doc Re-Indexing (daemon.js)

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js`

- [ ] **Step 1: Fix updateClusterPosteriors minimum observations**

In `updateClusterPosteriors()` (~line 857):

```javascript
// Before:
if (obs.length < 3) continue

// After:
if (obs.length === 0) continue
const { effectiveSampleSize } = require('./lib/snips.js')
const ess = effectiveSampleSize(obs)
const n = Math.min(ess, obs.length, obs.length < 3 ? 2 : 10)
```

- [ ] **Step 2: Seed synthetic doc cluster in rebuildClusters**

In `rebuildClusters()`, after k-means clustering of patterns, upsert the synthetic doc cluster:

```javascript
// Seed synthetic doc cluster for doc_chunks
const docCount = db.prepare("SELECT COUNT(*) as c FROM doc_chunks WHERE embedding IS NOT NULL").get().c
if (docCount > 0) {
  db.upsertClusterStats(-1, namespace, null, docCount)
}
```

- [ ] **Step 3: Add file watcher for docs/project/ auto re-indexing**

In daemon.js, after the existing trajectory file watcher setup:

```javascript
// Watch docs/project/ for changes — re-index on modify (debounced 5s)
const docsDir = path.join(PROJECT_ROOT, 'docs', 'project')
if (fs.existsSync(docsDir)) {
  let docReindexTimer = null
  fs.watch(docsDir, { persistent: false }, () => {
    clearTimeout(docReindexTimer)
    docReindexTimer = setTimeout(async () => {
      try {
        const { indexDocs } = require('./lib/doc-chunks.js')
        const result = await indexDocs(PROJECT_ROOT, db, log)
        if (result.indexed > 0) log('info', 'Doc chunks re-indexed (file change)', result)
      } catch (err) {
        log('error', 'Doc chunk re-index failed', { error: err.message })
      }
    }, 5000)
  })
  log('info', 'Watching docs/project/ for doc chunk re-indexing')
}
```

- [ ] **Step 4: Add SIGUSR2 handler for manual re-index**

```javascript
process.on('SIGUSR2', async () => {
  log('info', 'SIGUSR2 received — re-indexing doc chunks')
  try {
    const { indexDocs } = require('./lib/doc-chunks.js')
    const result = await indexDocs(PROJECT_ROOT, db, log)
    log('info', 'Doc chunks re-indexed (SIGUSR2)', result)
  } catch (err) {
    log('error', 'Doc chunk re-index failed', { error: err.message })
  }
})
```

This allows `kill -USR2 $(cat ~/.quoth/daemon.pid)` to trigger immediate re-indexing after the doc-update cron pushes changes.

---

### Task 9: End-to-End Tests

**Files:**
- Create: `quoth-plugin/tests/unified-injection.test.js`

- [ ] **Step 1: Write test file**

```javascript
import { describe, it, expect, beforeEach } from 'vitest'

let db
beforeEach(() => {
  db = require('../daemon/db.js').createDb(':memory:')
})

describe('unified injection', () => {
  it('doc_chunks table has alpha/beta columns', () => {
    const info = db.prepare("PRAGMA table_info(doc_chunks)").all()
    const cols = info.map(c => c.name)
    expect(cols).toContain('alpha')
    expect(cols).toContain('beta')
  })

  it('updateDocChunkAlphaBeta increments alpha on success', () => {
    db.upsertDocChunk({ id: 'test::Header', doc_file: 'test.md', section_header: 'Header', content: 'test', embedding: null, content_hash: 'abc' })
    db.updateDocChunkAlphaBeta('test::Header', 'success')
    const row = db.prepare('SELECT alpha, beta FROM doc_chunks WHERE id = ?').get('test::Header')
    expect(row.alpha).toBe(2)
    expect(row.beta).toBe(1)
  })

  it('updateDocChunkAlphaBeta increments beta on failure', () => {
    db.upsertDocChunk({ id: 'test::Header', doc_file: 'test.md', section_header: 'Header', content: 'test', embedding: null, content_hash: 'abc' })
    db.updateDocChunkAlphaBeta('test::Header', 'failure')
    const row = db.prepare('SELECT alpha, beta FROM doc_chunks WHERE id = ?').get('test::Header')
    expect(row.alpha).toBe(1)
    expect(row.beta).toBe(2)
  })

  it('injection_log accepts doc: prefixed pattern_id', () => {
    db.logInjection({
      session_id: 'test-session',
      namespace: 'quoth',
      pattern_id: 'doc:05-daemon-pipeline.md::Batch JUDGE',
      cluster_id: -1,
      rank: 1,
      propensity: 0.15,
      is_exploration: 0,
      query_text: 'how does batch judge work',
    })
    const row = db.prepare("SELECT * FROM injection_log WHERE pattern_id LIKE 'doc:%'").get()
    expect(row).toBeDefined()
    expect(row.pattern_id).toBe('doc:05-daemon-pipeline.md::Batch JUDGE')
    expect(row.cluster_id).toBe(-1)
  })
})

describe('graded reward signal', () => {
  it('returns 1.0 for high success_rate session summary', () => {
    const { sessionOutcomeReward } = require('../daemon/lib/attribution.js')
    expect(sessionOutcomeReward([{ event: 'session_summary', success_rate: 0.9 }])).toBe(1.0)
  })

  it('returns 0.8 for writes with no errors', () => {
    const { sessionOutcomeReward } = require('../daemon/lib/attribution.js')
    const events = [
      { tool: 'Edit', event: 'tool_use' },
      { tool: 'Write', event: 'tool_use' },
      { tool: 'Bash', event: 'tool_use', exit_code: 0 },
    ]
    expect(sessionOutcomeReward(events)).toBe(0.8)
  })

  it('returns 0.2 for bash errors only', () => {
    const { sessionOutcomeReward } = require('../daemon/lib/attribution.js')
    const events = [
      { tool: 'Bash', event: 'tool_use', exit_code: 1 },
      { tool: 'Bash', event: 'tool_use', exit_code: 127 },
    ]
    expect(sessionOutcomeReward(events)).toBe(0.2)
  })
})
```

- [ ] **Step 2: Run all tests**

Run: `cd quoth-plugin && npm test`

---

### Task 10: Enable V2 and Verify

- [ ] **Step 1: Set environment variable**

Add to `~/.quoth/.env`:
```
QUOTH_V2_INJECTION=true
```

- [ ] **Step 2: Restart daemon**

```bash
kill $(cat ~/.quoth/daemon.pid) 2>/dev/null
# Daemon auto-restarts on next session via session-restore hook
```

- [ ] **Step 3: Verify in new session**

Start a new Claude Code session and check:
- `[Quoth]` + `[Quoth Docs]` blocks appear at **session-start** (not just prompt submit)
- Submit a prompt → unified ranked results with both patterns and doc chunks
- Spawn a subagent → `additionalContext` includes both patterns and doc chunks
- `quoth_daemon_status` shows V2 flags active
- After session-end: `SELECT pattern_id, reward FROM injection_log ORDER BY injected_at DESC LIMIT 10` shows both pattern and `doc:` entries with non-0.5 rewards

- [ ] **Step 4: Verify doc re-indexing**

- Edit any file in `docs/project/` → daemon log shows re-indexing within 5s
- `kill -USR2 $(cat ~/.quoth/daemon.pid)` → daemon log shows manual re-index
- After nightly: `SELECT * FROM cluster_stats WHERE cluster_id = -1` → doc cluster has updated posteriors
