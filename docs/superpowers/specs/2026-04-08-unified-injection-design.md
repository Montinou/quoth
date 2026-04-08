# Unified Injection System — Design Spec

**Date:** 2026-04-08
**Version:** Quoth v3.4.0
**Scope:** Unified patterns + doc chunks injection, V2 activation, feedback loop closure, graded reward signal

## Problem

Three separate problems compound into a non-learning system:

1. **Two disconnected injection streams**: Patterns (754 active, Thompson-sampled) and doc chunks (133, linear-scanned) are searched, ranked, and injected independently. No unified relevance signal determines the optimal mix per query.

2. **V2 built but disabled**: All V2 flags are `false`. Hierarchical Thompson sampling, clustering, propensity scoring, SNIPS — all implemented, zero production usage. The system runs V1 (flat Thompson + trigram) which works but can't leverage cluster-level learning.

3. **Dead feedback loop**: `injection_log` has 1,236 entries but rewards are always 0.5. `sessionOutcomeReward()` checks for `e.outcome === 'success'/'failure'` on trajectory events, but `tool_use` events never carry an `outcome` field. The signal is always null (0.5). Without real reward data, SNIPS can't debias, clusters can't learn, and Thompson sampling is just random noise on uniform priors.

Additionally: `memory_entries` table has 0 rows and zero code paths write to it. It's vestigial.

## Solution

1. **Unified ranking**: Doc chunks become "virtual patterns" with `doc:` prefixed IDs, Thompson priors (alpha/beta), and a synthetic cluster. They participate in the same `hierarchicalSelect()` as patterns.
2. **Fix reward signal**: Replace binary `sessionOutcomeReward` with a graded heuristic that reads `session_summary.success_rate` and infers from tool mix (writes vs errors).
3. **Enable V2 injection**: Set `QUOTH_V2_INJECTION=true` — activates hierarchical selection, injection logging, SNIPS feedback loop.
4. **Doc chunk feedback**: Route `doc:` prefixed IDs through the same injection_log → session-end → Bayesian update path as patterns.
5. **SNIPS cold-start fix**: Lower minimum observations from 3 to 1 with scaled pseudo-trials.
6. **All 3 injection hooks unified**: session-restore, route (UserPromptSubmit), and subagent-start all consume both `resp.patterns` and `resp.doc_chunks` from the daemon. Currently session-restore and subagent-start ignore doc chunks.
7. **Doc chunk re-indexing**: Daemon watches `docs/project/` for changes and re-indexes on modify. Also re-indexes on `SIGUSR2` signal for manual trigger after doc-update cron pushes.

## Architecture

### Current Flow (Two Separate Streams)

```
UserPromptSubmit → daemon query-server
  ├─ Pattern stream: embed → V1 rankByThompsonAndTrigram → top 7
  └─ Doc chunk stream: embed → linear scan cosine → top 3
  
Hook stdout: two separate blocks
  [Quoth] patterns...
  [Quoth Docs] doc chunks...

Feedback: patterns only (V1 soft-negative on stale)
Doc chunks: zero feedback
```

### New Flow (Unified Ranking)

```
UserPromptSubmit → daemon query-server
  ├─ Pattern candidates: embed → HNSW search → 20 candidates
  ├─ Doc chunk candidates: embed → linear scan → 10 candidates
  ├─ Transform doc chunks → pattern-shaped objects (doc: prefix, alpha/beta)
  ├─ Merge into single candidate pool
  └─ hierarchicalSelect(allCandidates, clusterMap, limit, embedding)
      ├─ Cluster Thompson sampling (patterns in learned clusters, docs in cluster -1)
      ├─ Within-cluster ranking: simWeight × cosine + postWeight × posterior mean
      └─ Propensity scores assigned to every selected item

Split output for hook stdout:
  result.patterns → [Quoth] block (items without doc: prefix)
  result.doc_chunks → [Quoth Docs] block (items with doc: prefix)

Both logged to injection_log with propensity scores

Session-end feedback:
  ├─ Compute graded reward from session_summary + tool mix
  ├─ Pattern IDs → updateInjectionOutcome() + applyBayesianUpdate()
  └─ doc: IDs → updateInjectionOutcome() + updateDocChunkAlphaBeta()

Nightly Phase E:
  └─ SNIPS reads injection_log (patterns + doc: entries) → updates cluster posteriors
```

### Reward Signal (Before vs After)

**Before (`attribution.js:sessionOutcomeReward`):**
```javascript
// Always returns 0.5 because tool_use events never have .outcome field
if (hasFailure) return 0.0
if (hasSuccess) return 1.0
return 0.5  // ← always hits this
```

**After:**
```javascript
function sessionOutcomeReward(events) {
  if (!events || events.length === 0) return 0.5

  // Priority 1: session_summary event (written by session-end before feedback)
  const summary = events.find(e => e.event === 'session_summary')
  if (summary && typeof summary.success_rate === 'number') {
    if (summary.success_rate >= 0.8) return 1.0
    if (summary.success_rate >= 0.5) return 0.7
    if (summary.success_rate > 0)    return 0.3
    return 0.0
  }

  // Priority 2: tool-level signals
  const writes = events.filter(e => ['Write', 'Edit', 'MultiEdit'].includes(e.tool)).length
  const bashErrors = events.filter(e => e.tool === 'Bash' && e.exit_code > 0).length
  const total = events.length

  if (writes > 0 && bashErrors === 0) return 0.8   // productive, clean
  if (writes > 0 && bashErrors > 0)   return 0.5   // productive but messy
  if (bashErrors > 0 && writes === 0) return 0.2   // errors, no output
  return 0.5  // read-only session, genuinely unknown
}
```

### Doc Chunk Virtual Pattern Shape

```javascript
// Transform doc chunk → pattern-shaped object for hierarchicalSelect()
{
  id: `doc:${chunk.id}`,                    // e.g. "doc:05-daemon-pipeline.md::Batch JUDGE"
  name: chunk.section_header,               // "Batch JUDGE"
  action: chunk.content.slice(0, 200),      // first 200 chars of chunk
  condition: chunk.doc_file,                // "05-daemon-pipeline.md"
  confidence: chunk.alpha / (chunk.alpha + chunk.beta),  // Thompson posterior mean
  alpha: chunk.alpha || 1,                  // from doc_chunks table (default 1)
  beta: chunk.beta || 1,                    // from doc_chunks table (default 1)
  cluster_id: DOC_CLUSTER_ID,              // -1 (synthetic doc cluster)
  embedding: JSON.parse(chunk.embedding),   // 384d MiniLM-L6
  tags: [`doc:${chunk.doc_file.replace('.md', '')}`],  // e.g. ["doc:05-daemon-pipeline"]
  _isDocChunk: true,                        // internal flag for output splitting
  _similarity: chunk._similarity,           // from linear scan cosine
}
```

### Injection Log Schema (No Change)

The existing `injection_log` table works as-is:
```sql
-- pattern_id accepts doc:chunk-id strings
INSERT INTO injection_log (session_id, namespace, pattern_id, cluster_id, rank, propensity, ...)
VALUES (?, ?, 'doc:05-daemon-pipeline.md::Batch JUDGE', -1, 3, 0.15, ...)
```

### SNIPS Cold-Start Fix

```javascript
// Before: skips clusters with < 3 observations
if (obs.length < 3) continue

// After: allows 1+ observations with scaled pseudo-trials
if (obs.length === 0) continue
const estimate = snipsEstimate(obs)
const { effectiveSampleSize } = require('./lib/snips.js')
const ess = effectiveSampleSize(obs)
const n = Math.min(ess, obs.length, obs.length < 3 ? 2 : 10)
// n=1-2 for cold clusters, up to 10 for well-observed
```

### Session-Start Injection (Currently Broken for Doc Chunks)

The `session-restore` hook calls daemon with `type: 'inject'`. The daemon returns both `resp.patterns` and `resp.doc_chunks`. But the hook only reads `resp.patterns` (line 346) and ignores `resp.doc_chunks`.

**Fix in hook-dispatch.js session-restore handler:**
```javascript
// After pattern injection (line ~360), add doc chunk injection:
const docChunks = resp.doc_chunks || []
if (docChunks.length > 0) {
  const relevant = docChunks.filter(c => c.score > 0.2)
  if (relevant.length > 0) {
    const lines = ['[Quoth Docs] Session context:']
    for (const c of relevant) {
      const label = (c.doc_file || '').replace('.md', '').replace(/^\d+-/, '')
      lines.push(`  • [${label}] ${c.title}: ${(c.content || '').slice(0, 150)}`)
    }
    console.log(lines.join('\n'))
    // Record doc chunk exposures in session memory
    if (sm && docChunks.some(c => c.id)) {
      sm.recordInjection(docChunks.filter(c => c.id).map(c => c.id))
    }
  }
}
```

### Subagent-Start Injection (Currently Broken for Doc Chunks)

Same issue: `subagent-start` calls daemon with `type: 'inject'`, reads `resp.patterns` (line 614), ignores `resp.doc_chunks`.

**Fix in hook-dispatch.js subagent-start handler:**
```javascript
// After pattern additionalContext (line ~632), append doc chunks:
const docChunks = resp.doc_chunks || []
if (docChunks.length > 0) {
  const docContext = docChunks
    .filter(c => c.score > 0.2)
    .map(c => `- [doc] ${c.title}: ${(c.content || '').slice(0, 100)}`)
    .join('\n')
  if (docContext) {
    output.additionalContext += `\n\n[Quoth Docs] Relevant documentation:\n${docContext}`
  }
}
```

### Doc Chunk Re-Indexing

Currently `indexDocs()` runs once at daemon startup (line 1471). After the doc-update cron pushes new/updated docs, the daemon must restart to re-index.

**Fix: File watcher + SIGUSR2 in daemon.js:**
```javascript
// Watch docs/project/ for changes (alongside existing trajectory watcher)
const docsDir = path.join(PROJECT_ROOT, 'docs', 'project')
if (fs.existsSync(docsDir)) {
  let docReindexTimer = null
  fs.watch(docsDir, { persistent: false }, () => {
    // Debounce 5s (doc updates often touch multiple files)
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
}

// SIGUSR2: manual re-index trigger
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

### recordExposure Routing for doc: IDs

`recordExposure(db, ids)` runs `UPDATE patterns SET exposure_count...` which silently fails for `doc:` IDs (no matching row). Must route separately:

```javascript
// In scoring.js — split IDs by type
function recordExposure(db, ids) {
  if (!ids || ids.length === 0) return
  const patternIds = ids.filter(id => !id.startsWith('doc:'))
  const docIds = ids.filter(id => id.startsWith('doc:')).map(id => id.slice(4))

  if (patternIds.length > 0) {
    const stmt = db.prepare('UPDATE patterns SET exposure_count = exposure_count + 1, last_exposed_at = strftime(\'%s\',\'now\') * 1000 WHERE id = ?')
    const run = db.transaction((batch) => { for (const id of batch) stmt.run(id) })
    run(patternIds)
  }
  // Doc chunk exposure tracked via injection_log only (no separate counter needed)
}
```

## Schema Changes

### doc_chunks — Add Thompson Priors (Runtime Migration)

```javascript
v2Migrate('add doc_chunks Thompson priors', () => {
  db.exec(`ALTER TABLE doc_chunks ADD COLUMN alpha REAL NOT NULL DEFAULT 1`)
  db.exec(`ALTER TABLE doc_chunks ADD COLUMN beta REAL NOT NULL DEFAULT 1`)
})
```

### New db.js Methods

```javascript
// Update doc chunk Bayesian posterior
db.updateDocChunkAlphaBeta = function(chunkId, outcome) {
  const col = outcome === 'success' ? 'alpha' : 'beta'
  db.prepare(`UPDATE doc_chunks SET ${col} = ${col} + 1 WHERE id = ?`).run(chunkId)
}

// Get doc chunk with stats for injection
db.getDocChunkWithStats = function(chunkId) {
  return db.prepare('SELECT *, alpha/(alpha+beta) as confidence FROM doc_chunks WHERE id = ?').get(chunkId)
}
```

### Constants

```javascript
const DOC_CLUSTER_ID = -1           // Synthetic cluster for all doc chunks
const DOC_CLUSTER_NAMESPACE = 'docs' // Namespace in cluster_stats
```

## Files to Modify

| File | Changes |
|------|---------|
| `daemon/lib/attribution.js` | Replace `sessionOutcomeReward()` with graded heuristic |
| `daemon/db.js` | Runtime migration: alpha/beta on doc_chunks. New methods: `updateDocChunkAlphaBeta()`, `getDocChunksWithStats()` |
| `daemon/lib/flags.js` | Add `getActiveFlags()` diagnostic |
| `daemon/lib/query-server.js` | Unified ranking in `handleQuery()`: merge doc chunks as virtual patterns, pass to `hierarchicalSelect()`, split output, log all injections. Include `id` field in doc_chunks response |
| `daemon/lib/scoring.js` | `recordExposure()`: filter out `doc:` prefixed IDs (they don't exist in patterns table) |
| `hooks/hook-dispatch.js` | **4 handlers modified:** (1) session-restore: consume `resp.doc_chunks`, inject to stdout, record in session memory. (2) route: record doc chunk IDs in session memory. (3) session-end: route `doc:` IDs to `updateDocChunkAlphaBeta()`. (4) post-task: same `doc:` routing. (5) subagent-start: append doc chunks to `additionalContext` |
| `daemon/daemon.js` | `updateClusterPosteriors()`: lower min obs to 1. Seed synthetic doc cluster in `rebuildClusters()`. Add `fs.watch` on `docs/project/` for auto re-index. Add `SIGUSR2` handler for manual re-index trigger |

## New Files

| File | Purpose |
|------|---------|
| `tests/unified-injection.test.js` | End-to-end: mixed ranking, injection logging, feedback, graded reward, doc chunk alpha/beta |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Doc chunks dominate ranking (high cosine, neutral prior) | Patterns pushed out | Initialize doc chunk beta=1.5 (slight pessimistic prior) so patterns with proven track records rank higher |
| Exploration injects random doc chunk during unrelated task | Confusing context | Keep `QUOTH_V2_EXPLORATION` off initially. Enable after 1 week of injection data |
| Reward signal still noisy (session-level, not per-injection) | Slow learning | SNIPS is designed for noisy bandit feedback. Propensity weighting debiases. Key is non-degenerate rewards (fixed by graded heuristic) |
| SNIPS with 1 observation per cluster is high-variance | Wild posterior swings | Cap pseudo-trials at 2 for clusters with <3 observations |
| Linear scan for 133 doc chunks | Latency | <1ms currently. Add HNSW guard at >500 chunks (future) |

## Implementation Order (10 Tasks)

1. **attribution.js** — Fix reward signal (everything else is sampling on noise without it)
2. **db.js** — Doc chunk alpha/beta migration + methods
3. **flags.js** — `getActiveFlags()` diagnostic
4. **scoring.js** — Route `doc:` IDs in `recordExposure()`
5. **query-server.js** — Unified ranking (core architectural change)
6. **hook-dispatch.js (session-restore + subagent-start)** — Consume doc chunks from daemon response at all 3 injection points
7. **hook-dispatch.js (session-end + post-task)** — Feedback closure: route `doc:` IDs through Bayesian updates
8. **daemon.js** — SNIPS cold-start fix + synthetic doc cluster + doc watcher + SIGUSR2
9. **unified-injection.test.js** — End-to-end tests
10. **Enable V2** — `QUOTH_V2_INJECTION=true` in `~/.quoth/.env`

## Verification

1. `npm test` — all existing + new tests pass
2. Set `QUOTH_V2_INJECTION=true`, restart daemon
3. New session → `[Quoth]` + `[Quoth Docs]` output both appear at session-start (not just prompt submit)
4. Submit a prompt → `[Quoth]` + `[Quoth Docs]` show unified ranked results
5. Spawn a subagent → `additionalContext` includes both patterns and doc chunks
6. After session-end: `SELECT pattern_id, reward FROM injection_log WHERE pattern_id LIKE 'doc:%' ORDER BY injected_at DESC LIMIT 5` → rewards should be non-0.5
7. Modify a doc file → daemon log shows re-indexing within 5s
8. `kill -USR2 $(cat ~/.quoth/daemon.pid)` → daemon log shows manual re-index
9. After nightly: `SELECT * FROM cluster_stats WHERE cluster_id = -1` → doc cluster has updated posteriors
10. `quoth_daemon_status` → shows active V2 flags in response
