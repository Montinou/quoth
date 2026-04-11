# EXTRACT Pipeline — Phase 1B: Contextual Feedback

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add contextual feedback so patterns are scored per-intention (not just globally). A pattern that's great for refactoring but bad for debugging gets separate outcome records for each context, and injection ranking uses these outcomes to boost/penalize.

**Architecture:** New `pattern_outcomes` table records per-intention outcomes. Session-end hook writes outcomes. Injection pipeline reranks candidates by comparing the current prompt embedding against stored intention embeddings in `pattern_outcomes`. Nightly maintenance prunes stale outcomes and enriches tags.

**Tech Stack:** Node.js, SQLite, MiniLM-L6 384d embeddings, existing Thompson sampling

**Spec:** `docs/superpowers/specs/2026-04-09-intent-outcome-temporal.md` — Phase 1B sections

**Prerequisite:** Phase 1A must be completed and validated for at least 1 week. Validation gate: injection-to-use ratio should hold or improve vs v3.4 baseline.

---

## File Structure

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `quoth-plugin/daemon/db.js` | Add `pattern_outcomes` table + CRUD helpers |
| Modify | `quoth-plugin/hooks/hook-dispatch.js` | Extend session-end feedback to write contextual outcomes |
| Modify | `quoth-plugin/daemon/lib/query-server.js` | Add outcome reranking after Thompson selection |
| Modify | `quoth-plugin/daemon/daemon.js` | Extend nightly pipeline with outcome pruning + tag enrichment |
| Create | `quoth-plugin/tests/pattern-outcomes.test.js` | Tests for pattern_outcomes CRUD + feedback logic |
| Create | `quoth-plugin/tests/outcome-reranking.test.js` | Tests for injection outcome reranking |

---

### Task 1: DB — Add pattern_outcomes table

**Files:**
- Modify: `quoth-plugin/daemon/db.js` (after pipeline_errors section)
- Create: `quoth-plugin/tests/pattern-outcomes.test.js`

- [ ] **Step 1: Write the failing test**

Create `quoth-plugin/tests/pattern-outcomes.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let db, tmpDir

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'quoth-test-'))
  process.env.QUOTH_HOME = tmpDir
  const { createDb } = require('../daemon/db.js')
  db = createDb(join(tmpDir, 'memory.db'))
})

afterEach(() => {
  if (db) db.close()
  rmSync(tmpDir, { recursive: true, force: true })
  delete process.env.QUOTH_HOME
})

describe('pattern_outcomes table', () => {
  it('insertOutcome stores a contextual outcome', () => {
    db.insertOutcome({
      pattern_id: 'pat-001',
      intention: 'refactor auth middleware',
      intention_embedding: JSON.stringify(Array(384).fill(0.1)),
      outcome: 'success',
      session_context: JSON.stringify({ project: 'quoth', agent_type: 'coder' }),
      session_id: 'sess-abc',
    })

    const rows = db.prepare('SELECT * FROM pattern_outcomes WHERE pattern_id = ?').all('pat-001')
    expect(rows).toHaveLength(1)
    expect(rows[0].intention).toBe('refactor auth middleware')
    expect(rows[0].outcome).toBe('success')
    expect(rows[0].session_id).toBe('sess-abc')
    expect(rows[0].created_at).toBeGreaterThan(0)
  })

  it('getOutcomesForPattern returns outcomes ordered by recency', () => {
    for (let i = 0; i < 5; i++) {
      db.insertOutcome({
        pattern_id: 'pat-002',
        intention: `intent-${i}`,
        outcome: i % 2 === 0 ? 'success' : 'failure',
        session_id: `sess-${i}`,
      })
    }

    const outcomes = db.getOutcomesForPattern('pat-002')
    expect(outcomes).toHaveLength(5)
    // Most recent first
    expect(outcomes[0].intention).toBe('intent-4')
  })

  it('pruneOutcomes enforces rolling window of 20 per pattern', () => {
    // Insert 25 outcomes
    for (let i = 0; i < 25; i++) {
      db.insertOutcome({
        pattern_id: 'pat-003',
        intention: `intent-${i}`,
        outcome: 'success',
        session_id: `sess-${i}`,
      })
    }

    const beforePrune = db.prepare(
      'SELECT COUNT(*) as c FROM pattern_outcomes WHERE pattern_id = ?'
    ).get('pat-003')
    expect(beforePrune.c).toBe(25)

    db.pruneOutcomes('pat-003', 20)

    const afterPrune = db.prepare(
      'SELECT COUNT(*) as c FROM pattern_outcomes WHERE pattern_id = ?'
    ).get('pat-003')
    expect(afterPrune.c).toBe(20)

    // Oldest entries deleted, newest kept
    const remaining = db.getOutcomesForPattern('pat-003')
    expect(remaining[0].intention).toBe('intent-24')
    expect(remaining[remaining.length - 1].intention).toBe('intent-5')
  })

  it('pruneOutcomes is a no-op when count is within limit', () => {
    db.insertOutcome({
      pattern_id: 'pat-004',
      intention: 'solo intent',
      outcome: 'success',
      session_id: 'sess-1',
    })

    db.pruneOutcomes('pat-004', 20)

    const count = db.prepare(
      'SELECT COUNT(*) as c FROM pattern_outcomes WHERE pattern_id = ?'
    ).get('pat-004')
    expect(count.c).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd quoth-plugin && npx vitest run tests/pattern-outcomes.test.js`
Expected: FAIL — `db.insertOutcome is not a function`

- [ ] **Step 3: Add pattern_outcomes table and helpers to db.js**

In `quoth-plugin/daemon/db.js`, after the pipeline_errors section, add:

```js
  // --- pattern_outcomes table for contextual feedback ---
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pattern_outcomes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_id TEXT NOT NULL,
        intention TEXT NOT NULL,
        intention_embedding TEXT,
        outcome TEXT NOT NULL,
        session_context TEXT,
        session_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_po_pattern ON pattern_outcomes(pattern_id);
      CREATE INDEX IF NOT EXISTS idx_po_created ON pattern_outcomes(created_at);
    `)
  } catch (e) { console.error('[db] pattern_outcomes create failed:', e.message) }
```

Add helper methods:

```js
  db.insertOutcome = function(o) {
    db.prepare(`
      INSERT INTO pattern_outcomes
        (pattern_id, intention, intention_embedding, outcome, session_context, session_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      o.pattern_id,
      o.intention,
      o.intention_embedding || null,
      o.outcome,
      o.session_context || null,
      o.session_id || null,
    )
  }

  db.getOutcomesForPattern = function(patternId, limit = 20) {
    return db.prepare(`
      SELECT * FROM pattern_outcomes
      WHERE pattern_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(patternId, limit)
  }

  db.pruneOutcomes = function(patternId, maxCount = 20) {
    const count = db.prepare(
      'SELECT COUNT(*) as c FROM pattern_outcomes WHERE pattern_id = ?'
    ).get(patternId).c

    if (count <= maxCount) return 0

    const deleted = db.prepare(`
      DELETE FROM pattern_outcomes
      WHERE id IN (
        SELECT id FROM pattern_outcomes
        WHERE pattern_id = ?
        ORDER BY created_at ASC
        LIMIT ?
      )
    `).run(patternId, count - maxCount)

    return deleted.changes
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd quoth-plugin && npx vitest run tests/pattern-outcomes.test.js`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd quoth-plugin && npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
cd quoth-plugin
git add daemon/db.js tests/pattern-outcomes.test.js
git commit -m "feat(db): add pattern_outcomes table + CRUD helpers for contextual feedback"
```

---

### Task 2: DB — Outcome dedup helper

Before inserting an outcome, check if a semantically similar intention already exists for this pattern with the same result. This prevents redundant entries.

**Files:**
- Modify: `quoth-plugin/daemon/db.js`
- Modify: `quoth-plugin/tests/pattern-outcomes.test.js`

- [ ] **Step 1: Write the failing test**

Add to `quoth-plugin/tests/pattern-outcomes.test.js`:

```js
describe('outcome dedup', () => {
  it('isDuplicateOutcome returns true for similar intention + same result', () => {
    const vecA = Array(384).fill(0)
    vecA[0] = 1.0

    db.insertOutcome({
      pattern_id: 'pat-dup',
      intention: 'refactor auth middleware',
      intention_embedding: JSON.stringify(vecA),
      outcome: 'success',
      session_id: 'sess-1',
    })

    // Very similar embedding
    const vecB = Array(384).fill(0)
    vecB[0] = 0.99
    vecB[1] = 0.05

    const isDup = db.isDuplicateOutcome('pat-dup', vecB, 'success', 0.92)
    expect(isDup).toBe(true)
  })

  it('isDuplicateOutcome returns false for similar intention but different result', () => {
    const vecA = Array(384).fill(0)
    vecA[0] = 1.0

    db.insertOutcome({
      pattern_id: 'pat-dup2',
      intention: 'refactor auth middleware',
      intention_embedding: JSON.stringify(vecA),
      outcome: 'success',
      session_id: 'sess-1',
    })

    const isDup = db.isDuplicateOutcome('pat-dup2', vecA, 'failure', 0.92)
    expect(isDup).toBe(false)
  })

  it('isDuplicateOutcome returns false for different intention', () => {
    const vecA = Array(384).fill(0)
    vecA[0] = 1.0

    db.insertOutcome({
      pattern_id: 'pat-dup3',
      intention: 'refactor auth',
      intention_embedding: JSON.stringify(vecA),
      outcome: 'success',
      session_id: 'sess-1',
    })

    // Orthogonal embedding
    const vecB = Array(384).fill(0)
    vecB[1] = 1.0

    const isDup = db.isDuplicateOutcome('pat-dup3', vecB, 'success', 0.92)
    expect(isDup).toBe(false)
  })

  it('isDuplicateOutcome returns false when no outcomes exist', () => {
    const vec = Array(384).fill(0.1)
    const isDup = db.isDuplicateOutcome('pat-nonexistent', vec, 'success', 0.92)
    expect(isDup).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd quoth-plugin && npx vitest run tests/pattern-outcomes.test.js -t "outcome dedup"`
Expected: FAIL — `db.isDuplicateOutcome is not a function`

- [ ] **Step 3: Add isDuplicateOutcome helper to db.js**

Add after the other outcome helpers:

```js
  db.isDuplicateOutcome = function(patternId, intentionEmbedding, outcome, threshold = 0.92) {
    if (!intentionEmbedding) return false

    const existing = db.prepare(`
      SELECT intention_embedding, outcome FROM pattern_outcomes
      WHERE pattern_id = ? AND intention_embedding IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 20
    `).all(patternId)

    if (existing.length === 0) return false

    const queryVec = Array.isArray(intentionEmbedding) ? intentionEmbedding : JSON.parse(intentionEmbedding)

    for (const row of existing) {
      if (row.outcome !== outcome) continue
      try {
        const storedVec = JSON.parse(row.intention_embedding)
        const sim = cosineSimilarity(queryVec, storedVec)
        if (sim >= threshold) return true
      } catch {}
    }
    return false
  }
```

Note: `cosineSimilarity` is already defined at the top of `db.js` (line 105-114).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd quoth-plugin && npx vitest run tests/pattern-outcomes.test.js -t "outcome dedup"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd quoth-plugin && npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
cd quoth-plugin
git add daemon/db.js tests/pattern-outcomes.test.js
git commit -m "feat(db): add isDuplicateOutcome for intention dedup in pattern_outcomes"
```

---

### Task 3: Extend session-end hook — contextual feedback

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js` (session-end handler, ~line 476-548)

- [ ] **Step 1: Understand the current session-end feedback logic**

Current flow in `hook-dispatch.js:490-531`:
1. Get injected pattern IDs from session memory
2. Compute session reward via `sessionOutcomeReward()`
3. For each injected pattern:
   - If used: reward=1.0; else: reward=session outcome
   - Update `injection_log` outcome
   - Route Bayesian update to correct table (doc_chunks or patterns)

We need to ADD (not replace) contextual outcome recording after the Bayesian update.

- [ ] **Step 2: Make session-end handler async in hook-dispatch.js**

In `quoth-plugin/hooks/hook-dispatch.js`:

Change line 395:
```js
  'session-end': () => {
```
To:
```js
  'session-end': async () => {
```

Change line 729:
```js
        handlers[command]()
```
To:
```js
        await handlers[command]()
```

- [ ] **Step 3: Add the contextual feedback block**

Insert this code inside the `if (isSubFlag('injection') && db)` block, after the existing Bayesian update loop (after line 530, before the closing `}` of the `if` block).

Note: The `patternReward` variable used in the outcome label computation is defined per-pattern inside the existing loop. We need to move the contextual recording inside the same loop. Specifically, augment the existing for-loop:

```js
        for (const pid of injectedIds) {
          const wasUsed = state.injectedPatterns[pid]?.used
          const patternReward = wasUsed ? 1.0 : reward
          db.updateInjectionOutcome(sessionId, pid, patternReward)

          // Route Bayesian update to correct table
          if (pid.startsWith('doc:')) {
            const chunkId = pid.slice(4)
            if (patternReward >= 0.7) db.updateDocChunkAlphaBeta(chunkId, 'success')
            else if (patternReward <= 0.3) db.updateDocChunkAlphaBeta(chunkId, 'failure')
          } else {
            if (patternReward >= 0.7) db.applyBayesianUpdate(pid, 'success')
            else if (patternReward <= 0.3) db.applyBayesianUpdate(pid, 'failure')
          }

          // NEW: Contextual outcome recording (skip doc chunks)
          if (!pid.startsWith('doc:') && intentionText && intentionText.length >= 10) {
            // Outcome label uses session reward (not patternReward) for used+failed case:
            // - used + session succeeded (reward >= 0.7) → success
            // - not used → failure
            // - used + session failed/mixed (reward < 0.7) → partial
            let outcomeLabel
            if (wasUsed && reward >= 0.7) outcomeLabel = 'success'
            else if (!wasUsed) outcomeLabel = 'failure'
            else outcomeLabel = 'partial'

            // Half-penalty per spec: used + session failed → beta += 0.5
            if (outcomeLabel === 'partial') {
              try {
                const pat = db.prepare('SELECT beta FROM patterns WHERE id = ?').get(pid)
                if (pat) db.prepare('UPDATE patterns SET beta = ? WHERE id = ?').run(pat.beta + 0.5, pid)
              } catch {}
            }

            const isDup = db.isDuplicateOutcome
              ? db.isDuplicateOutcome(pid, intentionEmbedding, outcomeLabel)
              : false
            if (!isDup) {
              try {
                db.insertOutcome({
                  pattern_id: pid,
                  intention: intentionText,
                  intention_embedding: intentionEmbedding ? JSON.stringify(intentionEmbedding) : null,
                  outcome: outcomeLabel,
                  session_context: JSON.stringify({ project, agent_type: state.routingResult?.agent_type || 'unknown' }),
                  session_id: sessionId,
                })
                if (db.pruneOutcomes) db.pruneOutcomes(pid, 20)
              } catch {}
            }
          }
        }
```

The `intentionText` and `intentionEmbedding` variables must be computed BEFORE the loop. Add before the `for (const pid of injectedIds)` loop:

```js
        // Compute session intention for contextual outcomes
        let intentionText = ''
        let intentionEmbedding = null
        try {
          intentionText = (state.prompts || []).slice(0, 3).join(' ').slice(0, 200)
            || (summary && summary.user_intents ? summary.user_intents.join(' ').slice(0, 200) : '')
          if (intentionText.length >= 10) {
            const { generateEmbedding } = require(path.join(QUOTH_PLUGIN, 'daemon', 'lib', 'embed.js'))
            intentionEmbedding = await generateEmbedding(intentionText)
          }
        } catch {}
```

- [ ] **Step 4: Run full test suite**

Run: `cd quoth-plugin && npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
cd quoth-plugin
git add hooks/hook-dispatch.js
git commit -m "feat(hooks): contextual feedback in session-end — pattern_outcomes recording

For each injected pattern, records intention + outcome in pattern_outcomes table.
Uses MiniLM embedding for intention dedup (>0.92 similarity + same result → skip).
Enforces rolling window of 20 outcomes per pattern."
```

---

### Task 4: Outcome reranking in injection pipeline

**Files:**
- Modify: `quoth-plugin/daemon/lib/query-server.js` (~line 137-304)
- Create: `quoth-plugin/tests/outcome-reranking.test.js`

- [ ] **Step 1: Write the failing test**

Create `quoth-plugin/tests/outcome-reranking.test.js`:

```js
import { describe, it, expect } from 'vitest'

const { rerankByOutcomes } = require('../daemon/lib/query-server.js')

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1)
}

describe('rerankByOutcomes', () => {
  it('boosts pattern with similar successful outcome', () => {
    const queryEmbedding = Array(384).fill(0)
    queryEmbedding[0] = 1.0

    const intentEmbedding = Array(384).fill(0)
    intentEmbedding[0] = 0.99
    intentEmbedding[1] = 0.05

    const patterns = [
      { id: 'pat-A', confidence: 0.6, _score: 0.5 },
      { id: 'pat-B', confidence: 0.6, _score: 0.5 },
    ]

    const outcomes = {
      'pat-A': [
        { intention_embedding: JSON.stringify(intentEmbedding), outcome: 'success' },
      ],
      'pat-B': [], // no outcomes
    }

    const result = rerankByOutcomes(patterns, queryEmbedding, outcomes)

    // pat-A should be boosted (similar intention + success)
    const scoreA = result.find(p => p.id === 'pat-A')._outcomeScore
    const scoreB = result.find(p => p.id === 'pat-B')._outcomeScore
    expect(scoreA).toBeGreaterThan(scoreB)
  })

  it('penalizes pattern with similar failed outcome', () => {
    const queryEmbedding = Array(384).fill(0)
    queryEmbedding[0] = 1.0

    const intentEmbedding = Array(384).fill(0)
    intentEmbedding[0] = 0.98

    const patterns = [
      { id: 'pat-A', confidence: 0.6, _score: 0.5 },
      { id: 'pat-B', confidence: 0.6, _score: 0.5 },
    ]

    const outcomes = {
      'pat-A': [
        { intention_embedding: JSON.stringify(intentEmbedding), outcome: 'failure' },
      ],
      'pat-B': [],
    }

    const result = rerankByOutcomes(patterns, queryEmbedding, outcomes)

    const scoreA = result.find(p => p.id === 'pat-A')._outcomeScore
    const scoreB = result.find(p => p.id === 'pat-B')._outcomeScore
    expect(scoreA).toBeLessThan(scoreB)
  })

  it('returns neutral score when no similar outcomes exist', () => {
    const queryEmbedding = Array(384).fill(0)
    queryEmbedding[0] = 1.0

    // Orthogonal intention
    const intentEmbedding = Array(384).fill(0)
    intentEmbedding[100] = 1.0

    const patterns = [
      { id: 'pat-A', confidence: 0.6, _score: 0.5 },
    ]

    const outcomes = {
      'pat-A': [
        { intention_embedding: JSON.stringify(intentEmbedding), outcome: 'success' },
      ],
    }

    const result = rerankByOutcomes(patterns, queryEmbedding, outcomes)
    // Orthogonal intention → neutral (0.0 adjustment)
    expect(result[0]._outcomeScore).toBeCloseTo(0, 1)
  })

  it('handles patterns with no outcome data', () => {
    const patterns = [
      { id: 'pat-A', confidence: 0.6, _score: 0.5 },
    ]

    const result = rerankByOutcomes(patterns, Array(384).fill(0.1), {})
    expect(result).toHaveLength(1)
    expect(result[0]._outcomeScore).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd quoth-plugin && npx vitest run tests/outcome-reranking.test.js`
Expected: FAIL — `rerankByOutcomes` not exported from query-server.js

- [ ] **Step 3: Add rerankByOutcomes function to query-server.js**

In `quoth-plugin/daemon/lib/query-server.js`, add before `module.exports`:

```js
function cosineSim(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}

/**
 * Rerank patterns by contextual outcome data.
 *
 * For each candidate pattern, compare the current query embedding against
 * stored intention embeddings in pattern_outcomes:
 * - Similar intention + success → boost score
 * - Similar intention + failure → penalize score
 * - No similar intention → neutral (global confidence stands)
 *
 * @param {Object[]} patterns - candidate patterns (must have .id)
 * @param {number[]} queryEmbedding - current prompt embedding
 * @param {Object} outcomesMap - { patternId: [{intention_embedding, outcome}] }
 * @param {number} simThreshold - minimum similarity to count as "similar" (default 0.5)
 * @returns {Object[]} patterns with _outcomeScore added
 */
function rerankByOutcomes(patterns, queryEmbedding, outcomesMap, simThreshold = 0.5) {
  if (!queryEmbedding || queryEmbedding.length === 0) {
    return patterns.map(p => ({ ...p, _outcomeScore: 0 }))
  }

  return patterns.map(p => {
    const outcomes = outcomesMap[p.id] || []
    if (outcomes.length === 0) return { ...p, _outcomeScore: 0 }

    let score = 0
    let matchCount = 0

    for (const o of outcomes) {
      if (!o.intention_embedding) continue
      try {
        const intentVec = typeof o.intention_embedding === 'string'
          ? JSON.parse(o.intention_embedding)
          : o.intention_embedding
        const sim = cosineSim(queryEmbedding, intentVec)
        if (sim < simThreshold) continue

        matchCount++
        if (o.outcome === 'success') score += sim * 0.3
        else if (o.outcome === 'failure') score -= sim * 0.3
        else score += sim * 0.1 // partial
      } catch {}
    }

    // Normalize by match count to prevent patterns with many outcomes from dominating
    const normalizedScore = matchCount > 0 ? score / matchCount : 0
    return { ...p, _outcomeScore: normalizedScore }
  })
}
```

Update `module.exports`:
```js
module.exports = { createQueryServer, rerankByOutcomes }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd quoth-plugin && npx vitest run tests/outcome-reranking.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd quoth-plugin
git add daemon/lib/query-server.js tests/outcome-reranking.test.js
git commit -m "feat(injection): add rerankByOutcomes function for contextual reranking"
```

---

### Task 5: Wire outcome reranking into injection pipeline

**Files:**
- Modify: `quoth-plugin/daemon/lib/query-server.js` (`handleQuery` function, ~line 137)

- [ ] **Step 1: Add outcome reranking after pattern selection**

In `quoth-plugin/daemon/lib/query-server.js`, inside the `handleQuery` function, after patterns are selected (~line 228, after the `} catch` block that handles pattern injection failures) and before the injection logging loop (~line 232), add:

```js
    // Outcome reranking: boost/penalize based on contextual outcomes
    if (patterns.length > 0 && embedding) {
      try {
        const outcomesMap = {}
        for (const p of patterns) {
          if (p.id && !p.id.startsWith('doc:')) {
            const outcomes = db.getOutcomesForPattern
              ? db.getOutcomesForPattern(p.id, 10)
              : []
            if (outcomes.length > 0) outcomesMap[p.id] = outcomes
          }
        }
        if (Object.keys(outcomesMap).length > 0) {
          patterns = rerankByOutcomes(patterns, embedding, outcomesMap)
          // Re-sort by combined score: original score + outcome adjustment
          patterns.sort((a, b) => {
            const aTotal = (a._score || a._trigramSim || a._similarity || 0) + (a._outcomeScore || 0)
            const bTotal = (b._score || b._trigramSim || b._similarity || 0) + (b._outcomeScore || 0)
            return bTotal - aTotal
          })
          // Trim back to limit
          patterns = patterns.slice(0, limit)
        }
      } catch (err) {
        log('error', 'Outcome reranking failed', { error: err.message })
      }
    }
```

- [ ] **Step 2: Run full test suite**

Run: `cd quoth-plugin && npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
cd quoth-plugin
git add daemon/lib/query-server.js
git commit -m "feat(injection): wire outcome reranking into injection pipeline

After Thompson sampling selects candidates, outcomes are checked for similar
intentions. Patterns with matching success outcomes are boosted; failures are
penalized. Neutral when no similar outcomes exist."
```

---

### Task 6: Nightly maintenance — outcome pruning + tag enrichment

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js` (inside `runNightlyPipeline`, after Phase G)

- [ ] **Step 1: Add Phase H to nightly pipeline**

In `quoth-plugin/daemon/daemon.js`, inside `runNightlyPipeline()`, after Phase G (curation, ~line 741), add:

```js
  // Phase H: Outcome maintenance (pruning + tag enrichment + merge transfer)
  try {
    // H0: Transfer pattern_outcomes when nightly dedup merges patterns
    // (mergeLoserIntoWinner already handles alpha/beta/stats; this transfers contextual outcomes)
    // This runs AFTER the LLM dedup in Phase F, which calls mergeLoserIntoWinner().
    // We add one SQL to mergeLoserIntoWinner() in daemon.js — see note below.

    // H1: Prune stale outcomes (max 20 per pattern)
    const patternsWithOutcomes = db.prepare(`
      SELECT DISTINCT pattern_id FROM pattern_outcomes
    `).all()
    let pruned = 0
    for (const { pattern_id } of patternsWithOutcomes) {
      pruned += db.pruneOutcomes(pattern_id, 20)
    }
    if (pruned > 0) log('info', 'Outcome pruning', { pruned })

    // H2: Deduplicate outcomes (same pattern + similar intention + same result)
    // For each pattern, find outcome pairs with intention similarity > 0.92 and same result
    let dedupCount = 0
    for (const { pattern_id } of patternsWithOutcomes) {
      const outcomes = db.getOutcomesForPattern(pattern_id, 50) // get more for dedup scan
      const toDelete = new Set()
      for (let i = 0; i < outcomes.length; i++) {
        if (toDelete.has(outcomes[i].id)) continue
        if (!outcomes[i].intention_embedding) continue
        const vecA = JSON.parse(outcomes[i].intention_embedding)
        for (let j = i + 1; j < outcomes.length; j++) {
          if (toDelete.has(outcomes[j].id)) continue
          if (outcomes[j].outcome !== outcomes[i].outcome) continue
          if (!outcomes[j].intention_embedding) continue
          try {
            const vecB = JSON.parse(outcomes[j].intention_embedding)
            let dot = 0, magA = 0, magB = 0
            for (let k = 0; k < vecA.length; k++) {
              dot += vecA[k] * vecB[k]; magA += vecA[k] * vecA[k]; magB += vecB[k] * vecB[k]
            }
            const sim = dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1)
            if (sim > 0.92) toDelete.add(outcomes[j].id) // keep newer (i), delete older (j)
          } catch {}
        }
      }
      if (toDelete.size > 0) {
        const ids = [...toDelete]
        const placeholders = ids.map(() => '?').join(',')
        db.prepare(`DELETE FROM pattern_outcomes WHERE id IN (${placeholders})`).run(...ids)
        dedupCount += ids.length
      }
    }
    if (dedupCount > 0) log('info', 'Outcome dedup', { deleted: dedupCount })

    // H3: Tag enrichment — for patterns with >= 5 outcomes, add domain tags from successful outcomes
    const enrichCandidates = db.prepare(`
      SELECT pattern_id, COUNT(*) as total,
             SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as successes
      FROM pattern_outcomes
      GROUP BY pattern_id
      HAVING total >= 5
    `).all()

    let enriched = 0
    for (const { pattern_id, successes } of enrichCandidates) {
      if (successes < 3) continue
      const pattern = db.getPattern(pattern_id)
      if (!pattern) continue

      const successOutcomes = db.prepare(`
        SELECT session_context FROM pattern_outcomes
        WHERE pattern_id = ? AND outcome = 'success' AND session_context IS NOT NULL
      `).all(pattern_id)

      const agentTypes = new Map()
      for (const o of successOutcomes) {
        try {
          const ctx = JSON.parse(o.session_context)
          if (ctx.agent_type) agentTypes.set(ctx.agent_type, (agentTypes.get(ctx.agent_type) || 0) + 1)
        } catch {}
      }

      const currentTags = pattern.tags || []
      let tagsChanged = false
      for (const [agentType, count] of agentTypes) {
        if (count >= 3 && !currentTags.includes(`agent:${agentType}`)) {
          currentTags.push(`agent:${agentType}`)
          tagsChanged = true
        }
      }

      if (tagsChanged) {
        db.prepare('UPDATE patterns SET tags = ? WHERE id = ?').run(JSON.stringify(currentTags), pattern_id)
        enriched++
      }
    }
    if (enriched > 0) log('info', 'Tag enrichment from outcomes', { enriched })

    // H4: Flag old unresolved pipeline errors
    const oldErrors = db.prepare(`
      SELECT stage, error_message, COUNT(*) as c
      FROM pipeline_errors
      WHERE created_at < (strftime('%s','now') - 604800) * 1000
      GROUP BY stage, substr(error_message, 1, 50)
      HAVING c >= 3
    `).all()
    if (oldErrors.length > 0) {
      log('warn', 'Recurring pipeline errors (>7 days)', {
        errors: oldErrors.map(e => `${e.stage}: "${e.error_message.slice(0, 50)}" (${e.c}x)`),
      })
    }
  } catch (err) {
    log('error', 'Nightly Phase H (outcomes) failed', { error: err.message })
  }
```

- [ ] **Step 2: Transfer pattern_outcomes on nightly dedup merge**

In `quoth-plugin/daemon/daemon.js`, inside `mergeLoserIntoWinner()` (~line 766), after the existing alpha/beta/stats transfer and before the `DELETE FROM patterns WHERE id = ?` line, add:

```js
    // Transfer contextual outcomes from loser to winner
    try {
      db.prepare('UPDATE pattern_outcomes SET pattern_id = ? WHERE pattern_id = ?')
        .run(winner.id, loser.id)
    } catch {}
```

This ensures that when nightly LLM dedup merges two patterns, the loser's outcome history is preserved on the winner.

- [ ] **Step 3: Run full test suite**

Run: `cd quoth-plugin && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
cd quoth-plugin
git add daemon/daemon.js
git commit -m "feat(nightly): add Phase H — outcome pruning, dedup, tag enrichment, merge transfer

Prunes pattern_outcomes to max 20 per pattern.
Deduplicates outcomes with similar intention (>0.92) + same result.
Enriches tags from successful outcome contexts (>=3 successes in a domain).
Transfers pattern_outcomes on nightly dedup merge (loser → winner).
Flags recurring pipeline errors older than 7 days."
```

---

### Task 7: Final verification

**Files:**
- None modified (verification only)

- [ ] **Step 1: Run full test suite**

Run: `cd quoth-plugin && npx vitest run`
Expected: ALL tests pass

- [ ] **Step 2: Verify pattern_outcomes table works end-to-end**

Run: `cd quoth-plugin && node -e "
  const { createDb } = require('./daemon/db.js');
  const path = require('path');
  const os = require('os');
  const db = createDb(path.join(os.homedir(), '.quoth', 'memory.db'));
  // Check table exists
  const info = db.prepare('PRAGMA table_info(pattern_outcomes)').all();
  console.log('pattern_outcomes columns:', info.map(c => c.name).join(', '));
  // Check pipeline_errors table
  const errInfo = db.prepare('PRAGMA table_info(pipeline_errors)').all();
  console.log('pipeline_errors columns:', errInfo.map(c => c.name).join(', '));
  db.close();
"`
Expected: Both tables have their expected columns

- [ ] **Step 3: Verify rerankByOutcomes is accessible**

Run: `cd quoth-plugin && node -e "
  const { rerankByOutcomes } = require('./daemon/lib/query-server.js');
  console.log('rerankByOutcomes:', typeof rerankByOutcomes);
"`
Expected: `rerankByOutcomes: function`

- [ ] **Step 4: Verify the session-end hook is async-safe**

Run: `cd quoth-plugin && node -c hooks/hook-dispatch.js`
Expected: No syntax errors

- [ ] **Step 5: Commit any fixes**

If any issues were found, fix and commit. Otherwise skip.

---

## Summary of Changes After Phase 1B

| Component | Change |
|-----------|--------|
| `db.js` | New `pattern_outcomes` table + `insertOutcome()`, `getOutcomesForPattern()`, `pruneOutcomes()`, `isDuplicateOutcome()` |
| `hook-dispatch.js` | Session-end records contextual outcomes per injected pattern. Handler made async for MiniLM embedding. |
| `query-server.js` | New `rerankByOutcomes()` function. Injection pipeline reranks candidates by contextual outcome similarity. |
| `daemon.js` | Nightly Phase H: outcome pruning, dedup, tag enrichment, error flagging |
| Tests | 2 new: `pattern-outcomes.test.js`, `outcome-reranking.test.js` |

## Validation Criteria (measurable after 2 weeks)

1. **Contextual feedback reduces bad injections:** Patterns with >=3 contextual failures for an intention should rank lower for similar future prompts (spot-check injection logs)
2. **Outcome table stays lean:** Average outcomes per pattern < 10 (rolling window + dedup)
3. **Tag enrichment works:** Patterns with >=5 outcomes and >=3 successes in a domain get domain tag added
4. **No performance regression:** Hook latency stays under 500ms (embedding call adds ~5ms with warm MiniLM)
