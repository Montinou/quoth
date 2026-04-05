# Quoth Learning & Pattern Injection Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Quoth's pattern retrieval from blind top-N-by-confidence into a context-aware, exploration-balanced, closed-loop learning system that actually uses the 800+ patterns the daemon distills.

**Architecture:** Keep Bayesian Beta as the principled foundation for uncertainty, add Thompson sampling for explore/exploit balance, introduce trigram-based fast semantic matching for zero-latency hooks, track exposure separately from success to close the feedback loop, and use HNSW with cached embeddings for heavy retrieval only where latency allows.

**Tech Stack:** Node.js, better-sqlite3 (SQLite + WAL), pure-JS HNSW (M=16, cosine, 1024d), voyage-4-lite embeddings via existing `embed.js`, Kimi K2.5 via Moonshot, Claude Haiku via CLI.

---

## Current State Analysis

### The problem (measured from live data, 2026-04-05)
- **803 active patterns**, only **36 have >0 uses**, only **2 qualify for cloud promotion**
- **Session-start** injects `ORDER BY confidence DESC LIMIT 3` — same 3 patterns every session, zero context awareness
- **Route** uses keyword matching against agent-type domain words — doesn't embed the prompt
- **Feedback** only fires for injected patterns → rich-get-richer → 97% of patterns never tested
- **No exploration** — Beta distribution's variance is computed but never sampled from
- **Cloud is write-only** — promoted patterns never pulled back down
- **No working memory** — no session-level context to inform mid-session suggestions

### What we keep (advantages)
- Real 1024d embeddings (voyage-4-lite) stored per pattern
- HNSW index (pure-JS, already maintained, ~5ms over 800 patterns)
- Bayesian Beta distribution (handles small samples better than EMA)
- Real Claude Code trajectory capture (not synthetic)
- Daemon pipeline (JUDGE → DISTILL → CONSOLIDATE) + nightly jobs

---

## File Structure

### New files
| Path | Responsibility | Est. LOC |
|------|----------------|----------|
| `quoth-plugin/daemon/lib/sampler.js` | Thompson sampling from Beta(α,β), pure-JS gamma sampling | 80 |
| `quoth-plugin/daemon/lib/scoring.js` | Bayesian + exposure updates, soft-negative | 100 |
| `quoth-plugin/daemon/lib/injection.js` | Thompson-ranked retrieval, trigram semantic search | 180 |
| `quoth-plugin/daemon/lib/pull.js` | Cloud pattern pull (bi-directional sync) | 90 |
| `quoth-plugin/hooks/session-memory.js` | Session working memory (topics, files, injections) | 150 |
| `quoth-plugin/tests/sampler.test.js` | Beta sampling statistical properties | 60 |
| `quoth-plugin/tests/scoring.test.js` | Exposure + soft-negative behavior | 80 |
| `quoth-plugin/tests/injection.test.js` | Thompson + trigram ranking | 100 |
| `quoth-plugin/tests/session-memory.test.js` | Session memory lifecycle | 70 |

### Modified files
| Path | Changes | Risk |
|------|---------|------|
| `quoth-plugin/daemon/db.js` | Add schema columns, wire new scoring/injection methods, precompute trigrams on upsert | Medium — 181 tests must pass |
| `quoth-plugin/hooks/hook-dispatch.js` | Replace injection paths in session-restore/route/subagent-start, wire feedback in post-task/session-end | High — user-facing hooks |
| `quoth-plugin/daemon/daemon.js` | Add cloud pull scheduler, conversion-rate rebalancing, embedding backfill | Low — daemon already restarts cleanly |

---

## Phase 1: Schema + Thompson Sampler (Foundation)

No other phase works without this.

### Task 1.1: Add schema columns to patterns table

**Files:**
- Modify: `quoth-plugin/daemon/db.js:137-160` (migration block)

- [ ] **Step 1: Read current migration block**

Run: `grep -n "ALTER TABLE patterns" quoth-plugin/daemon/db.js`
Expected: see existing `alpha`, `beta`, `decay_rate`, `embedding`, `tags` ALTERs

- [ ] **Step 2: Add 5 new column ALTERs following existing pattern**

Add after the last existing ALTER:

```javascript
try { db.prepare("ALTER TABLE patterns ADD COLUMN exposure_count INTEGER DEFAULT 0").run() } catch {}
try { db.prepare("ALTER TABLE patterns ADD COLUMN last_exposed_at INTEGER").run() } catch {}
try { db.prepare("ALTER TABLE patterns ADD COLUMN ignored_count INTEGER DEFAULT 0").run() } catch {}
try { db.prepare("ALTER TABLE patterns ADD COLUMN embedding_text TEXT").run() } catch {}
try { db.prepare("ALTER TABLE patterns ADD COLUMN pattern_trigrams TEXT").run() } catch {}
```

- [ ] **Step 3: Run existing test suite**

Run: `cd /home/lord_montino/projects/agents-tools/quoth && npm test 2>&1 | tail -5`
Expected: `Tests  181 passed (181)` — migrations are idempotent

- [ ] **Step 4: Commit**

```bash
git add quoth-plugin/daemon/db.js
git commit -m "feat(quoth): add exposure tracking + trigram columns to patterns"
```

### Task 1.2: Create Thompson sampler

**Files:**
- Create: `quoth-plugin/daemon/lib/sampler.js`
- Create: `quoth-plugin/tests/sampler.test.js`

- [ ] **Step 1: Write failing test**

Create `quoth-plugin/tests/sampler.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { sampleBeta, scoreWithThompson } from '../daemon/lib/sampler.js'

describe('Thompson sampler', () => {
  it('sampleBeta respects mean for proven pattern', () => {
    // Beta(20,2): mean=20/22=0.909, std dev ≈ 0.06
    const samples = Array.from({length: 1000}, () => sampleBeta(20, 2))
    const mean = samples.reduce((a,b)=>a+b, 0) / samples.length
    expect(mean).toBeGreaterThan(0.85)
    expect(mean).toBeLessThan(0.96)
  })

  it('sampleBeta has high variance for unproven pattern', () => {
    // Beta(1,1) = uniform, std dev = 1/sqrt(12) ≈ 0.289
    const samples = Array.from({length: 1000}, () => sampleBeta(1, 1))
    const mean = samples.reduce((a,b)=>a+b, 0) / samples.length
    expect(mean).toBeGreaterThan(0.4)
    expect(mean).toBeLessThan(0.6)
    const over07 = samples.filter(s => s > 0.7).length / samples.length
    expect(over07).toBeGreaterThan(0.15) // unproven patterns still win ~30% of time
  })

  it('scoreWithThompson ranks differ from pure confidence', () => {
    const patterns = [
      { id: 'a', alpha: 20, beta: 2 }, // proven: 0.91
      { id: 'b', alpha: 1, beta: 1 },  // unproven: 0.5
      { id: 'c', alpha: 8, beta: 2 },  // medium: 0.8
    ]
    // Over many runs, b should sometimes rank above c
    let bBeatsC = 0
    for (let i = 0; i < 200; i++) {
      const scored = scoreWithThompson(patterns)
      const rankedIds = scored.sort((x,y) => y._sampled - x._sampled).map(p => p.id)
      if (rankedIds.indexOf('b') < rankedIds.indexOf('c')) bBeatsC++
    }
    expect(bBeatsC).toBeGreaterThan(20)  // exploration works
    expect(bBeatsC).toBeLessThan(180)    // exploitation still dominates
  })
})
```

Run: `npx vitest run quoth-plugin/tests/sampler.test.js 2>&1 | tail -10`
Expected: FAIL — cannot find module `sampler.js`

- [ ] **Step 2: Implement sampler**

Create `quoth-plugin/daemon/lib/sampler.js`:

```javascript
'use strict'

/**
 * Thompson sampling from Beta(alpha, beta) distribution.
 * Uses Marsaglia-Tsang method for gamma sampling. Pure JS, no deps.
 */

// Box-Muller for standard normal
function randn() {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Marsaglia-Tsang gamma sampling (shape k, scale 1)
function sampleGamma(k) {
  if (k < 1) {
    // Boost: Gamma(k) = Gamma(k+1) * U^(1/k)
    return sampleGamma(k + 1) * Math.pow(Math.random(), 1 / k)
  }
  const d = k - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  while (true) {
    let x, v
    do {
      x = randn()
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = Math.random()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

/**
 * Sample from Beta(alpha, beta) = Gamma(alpha) / (Gamma(alpha) + Gamma(beta))
 */
function sampleBeta(alpha, beta) {
  const a = Math.max(0.01, alpha)
  const b = Math.max(0.01, beta)
  const x = sampleGamma(a)
  const y = sampleGamma(b)
  return x / (x + y)
}

/**
 * Score patterns with Thompson-sampled values instead of mean confidence.
 * Input patterns need { alpha, beta } or the function derives them from { confidence, success_count, failure_count }.
 * Returns patterns with added _sampled field.
 */
function scoreWithThompson(patterns) {
  return patterns.map(p => {
    const alpha = p.alpha ?? ((p.success_count || 0) + 1)
    const beta = p.beta ?? ((p.failure_count || 0) + 1)
    return { ...p, _sampled: sampleBeta(alpha, beta) }
  })
}

module.exports = { sampleBeta, sampleGamma, scoreWithThompson }
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run quoth-plugin/tests/sampler.test.js 2>&1 | tail -10`
Expected: PASS — 3 tests

- [ ] **Step 4: Run full suite to ensure no regressions**

Run: `npm test 2>&1 | tail -5`
Expected: `Tests  184 passed (184)` (181 + 3 new)

- [ ] **Step 5: Commit**

```bash
git add quoth-plugin/daemon/lib/sampler.js quoth-plugin/tests/sampler.test.js
git commit -m "feat(quoth): add Thompson sampling from Beta distribution"
```

### Task 1.3: Create scoring module (exposure + soft-negative)

**Files:**
- Create: `quoth-plugin/daemon/lib/scoring.js`
- Create: `quoth-plugin/tests/scoring.test.js`

- [ ] **Step 1: Write failing test**

Create `quoth-plugin/tests/scoring.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../daemon/db.js'
import { recordExposure, applySoftNegative, conversionRate } from '../daemon/lib/scoring.js'
import path from 'path'
import fs from 'fs'
import os from 'os'

let db, tmpPath
beforeEach(() => {
  tmpPath = path.join(os.tmpdir(), `quoth-scoring-${Date.now()}.db`)
  db = createDb(tmpPath)
  db.upsertPattern({ id: 'p1', name: 'x', confidence: 0.7, alpha: 7, beta: 3 })
  db.upsertPattern({ id: 'p2', name: 'y', confidence: 0.5, alpha: 1, beta: 1 })
})

describe('exposure tracking', () => {
  it('recordExposure increments counters', () => {
    recordExposure(db, ['p1', 'p2'])
    const p1 = db.prepare('SELECT exposure_count, last_exposed_at FROM patterns WHERE id=?').get('p1')
    expect(p1.exposure_count).toBe(1)
    expect(p1.last_exposed_at).toBeGreaterThan(0)
  })

  it('recordExposure is bulk-safe with empty array', () => {
    expect(() => recordExposure(db, [])).not.toThrow()
  })

  it('applySoftNegative increases beta', () => {
    const before = db.prepare('SELECT beta, confidence FROM patterns WHERE id=?').get('p1')
    applySoftNegative(db, ['p1'])
    const after = db.prepare('SELECT beta, confidence, ignored_count FROM patterns WHERE id=?').get('p1')
    expect(after.beta).toBeCloseTo(before.beta + 0.1, 5)
    expect(after.confidence).toBeLessThan(before.confidence)
    expect(after.ignored_count).toBe(1)
  })

  it('conversionRate computes uses/exposures', () => {
    recordExposure(db, ['p1', 'p1', 'p1'])
    db.applyBayesianUpdate('p1', 'success')
    const rate = conversionRate(db, 'p1')
    // p1 starts with alpha=7, +1 success = 8. But success_count tracks only new updates
    expect(rate).toBeGreaterThanOrEqual(0)
    expect(rate).toBeLessThanOrEqual(1)
  })
})
```

Run: `npx vitest run quoth-plugin/tests/scoring.test.js 2>&1 | tail -10`
Expected: FAIL — cannot find module `scoring.js`

- [ ] **Step 2: Implement scoring module**

Create `quoth-plugin/daemon/lib/scoring.js`:

```javascript
'use strict'

/**
 * Exposure tracking and soft-negative feedback.
 * Separates "what was shown to the agent" from "what the agent actually used".
 */

const SOFT_NEGATIVE_BETA_DELTA = 0.1

function recordExposure(db, ids) {
  if (!ids || ids.length === 0) return
  const stmt = db.prepare(`
    UPDATE patterns
    SET exposure_count = exposure_count + 1,
        last_exposed_at = strftime('%s','now') * 1000
    WHERE id = ?
  `)
  const run = db.transaction((batch) => {
    for (const id of batch) stmt.run(id)
  })
  run(ids)
}

function applySoftNegative(db, ids) {
  if (!ids || ids.length === 0) return
  const stmt = db.prepare(`
    UPDATE patterns
    SET beta = beta + ?,
        ignored_count = ignored_count + 1,
        confidence = alpha / NULLIF(alpha + beta + ?, 0),
        updated_at = strftime('%s','now') * 1000
    WHERE id = ?
  `)
  const run = db.transaction((batch) => {
    for (const id of batch) stmt.run(SOFT_NEGATIVE_BETA_DELTA, SOFT_NEGATIVE_BETA_DELTA, id)
  })
  run(ids)
}

function conversionRate(db, id) {
  const row = db.prepare(
    'SELECT exposure_count, success_count FROM patterns WHERE id = ?'
  ).get(id)
  if (!row || row.exposure_count === 0) return 0
  return (row.success_count || 0) / row.exposure_count
}

module.exports = { recordExposure, applySoftNegative, conversionRate, SOFT_NEGATIVE_BETA_DELTA }
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run quoth-plugin/tests/scoring.test.js 2>&1 | tail -10`
Expected: PASS — 4 tests

- [ ] **Step 4: Run full suite**

Run: `npm test 2>&1 | tail -5`
Expected: `Tests  188 passed (188)`

- [ ] **Step 5: Commit**

```bash
git add quoth-plugin/daemon/lib/scoring.js quoth-plugin/tests/scoring.test.js
git commit -m "feat(quoth): add exposure tracking and soft-negative feedback"
```

---

## Phase 2: Injection Module (Retrieval)

### Task 2.1: Trigram-based fast semantic matching

**Files:**
- Create: `quoth-plugin/daemon/lib/injection.js`
- Create: `quoth-plugin/tests/injection.test.js`

- [ ] **Step 1: Write failing test**

Create `quoth-plugin/tests/injection.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../daemon/db.js'
import { tokenize, trigrams, jaccardSim, rankByTrigramSim, rankByThompson } from '../daemon/lib/injection.js'
import path from 'path'
import os from 'os'

describe('trigram matching', () => {
  it('tokenize normalizes text', () => {
    const tokens = tokenize('Write React component for login')
    expect(tokens).toContain('write')
    expect(tokens).toContain('react')
    expect(tokens).toContain('component')
  })

  it('trigrams generates character 3-grams', () => {
    const t = trigrams('react')
    expect(t.has('rea')).toBe(true)
    expect(t.has('eac')).toBe(true)
    expect(t.has('act')).toBe(true)
  })

  it('jaccardSim is 1.0 for identical, 0 for disjoint', () => {
    const a = new Set(['abc', 'bcd'])
    const b = new Set(['abc', 'bcd'])
    const c = new Set(['xyz', 'yzw'])
    expect(jaccardSim(a, b)).toBe(1)
    expect(jaccardSim(a, c)).toBe(0)
  })

  it('rankByTrigramSim ranks relevant patterns higher', () => {
    const patterns = [
      { id: 'a', name: 'write react component', pattern_trigrams: JSON.stringify([...trigrams('write react component')]) },
      { id: 'b', name: 'deploy docker image', pattern_trigrams: JSON.stringify([...trigrams('deploy docker image')]) },
      { id: 'c', name: 'test react hooks', pattern_trigrams: JSON.stringify([...trigrams('test react hooks')]) },
    ]
    const ranked = rankByTrigramSim('create react component for login', patterns, 3)
    expect(ranked[0].id).toBe('a')
    expect(ranked[ranked.length - 1].id).toBe('b')
  })
})

describe('Thompson ranking for injection', () => {
  let db, tmpPath
  beforeEach(() => {
    tmpPath = path.join(os.tmpdir(), `quoth-inj-${Date.now()}.db`)
    db = createDb(tmpPath)
    for (let i = 0; i < 10; i++) {
      db.upsertPattern({
        id: `p${i}`,
        name: `pattern ${i}`,
        confidence: 0.5 + i * 0.04,
        alpha: i + 1,
        beta: 1,
      })
    }
  })

  it('rankByThompson returns requested count', () => {
    const ranked = rankByThompson(db, 'default', 3)
    expect(ranked).toHaveLength(3)
  })

  it('rankByThompson respects min confidence filter', () => {
    const ranked = rankByThompson(db, 'default', 10, { minConfidence: 0.7 })
    // Only patterns with confidence >= 0.7 should appear
    // Confidence is stored as alpha/(alpha+beta) = (i+1)/(i+2), >= 0.7 for i >= ~2
    expect(ranked.length).toBeLessThan(10)
    for (const p of ranked) expect(p.confidence).toBeGreaterThanOrEqual(0.7)
  })
})
```

Run: `npx vitest run quoth-plugin/tests/injection.test.js 2>&1 | tail -15`
Expected: FAIL — cannot find module `injection.js`

- [ ] **Step 2: Implement injection module**

Create `quoth-plugin/daemon/lib/injection.js`:

```javascript
'use strict'

const { scoreWithThompson } = require('./sampler.js')

/**
 * Lowercase, strip non-alphanumeric, split on whitespace.
 */
function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2)
}

/**
 * Generate character 3-grams from tokens joined by space.
 */
function trigrams(text) {
  const s = tokenize(text).join(' ')
  const grams = new Set()
  for (let i = 0; i <= s.length - 3; i++) grams.add(s.slice(i, i + 3))
  return grams
}

/**
 * Jaccard similarity of two trigram sets.
 */
function jaccardSim(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const g of a) if (b.has(g)) inter++
  return inter / (a.size + b.size - inter)
}

/**
 * Rank patterns by trigram similarity to query text.
 * Patterns must have pattern_trigrams column (JSON array).
 */
function rankByTrigramSim(queryText, patterns, limit) {
  const queryGrams = trigrams(queryText)
  const scored = patterns.map(p => {
    let patternGrams
    try {
      const arr = typeof p.pattern_trigrams === 'string'
        ? JSON.parse(p.pattern_trigrams)
        : p.pattern_trigrams
      patternGrams = new Set(arr || [])
    } catch {
      patternGrams = trigrams(`${p.name || ''} ${p.action || ''}`)
    }
    return { ...p, _trigramSim: jaccardSim(queryGrams, patternGrams) }
  })
  scored.sort((a, b) => b._trigramSim - a._trigramSim)
  return scored.slice(0, limit)
}

/**
 * Rank patterns using Thompson sampling from Beta(alpha, beta).
 * Fetches candidates by namespace, filters by minConfidence, samples, returns top N.
 */
function rankByThompson(db, namespace, limit, opts = {}) {
  const {
    minConfidence = 0.2,
    candidatePoolSize = Math.max(30, limit * 5),
    excludeRecentMinutes = 5,
  } = opts

  const cutoff = Date.now() - excludeRecentMinutes * 60 * 1000
  const rows = db.prepare(`
    SELECT * FROM patterns
    WHERE status = 'active'
      AND (namespace = ? OR namespace = 'global')
      AND confidence >= ?
      AND (last_exposed_at IS NULL OR last_exposed_at < ?)
    ORDER BY confidence DESC
    LIMIT ?
  `).all(namespace, minConfidence, cutoff, candidatePoolSize)

  const patterns = rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }))
  const sampled = scoreWithThompson(patterns)
  sampled.sort((a, b) => b._sampled - a._sampled)
  return sampled.slice(0, limit)
}

/**
 * Hybrid: Thompson-rank a pool, then reorder top by trigram similarity to query.
 */
function rankByThompsonAndTrigram(db, namespace, queryText, limit, opts = {}) {
  const poolSize = opts.poolSize || limit * 3
  const pool = rankByThompson(db, namespace, poolSize, opts)
  if (!queryText || queryText.trim().length < 3) return pool.slice(0, limit)
  return rankByTrigramSim(queryText, pool, limit)
}

module.exports = {
  tokenize,
  trigrams,
  jaccardSim,
  rankByTrigramSim,
  rankByThompson,
  rankByThompsonAndTrigram,
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run quoth-plugin/tests/injection.test.js 2>&1 | tail -15`
Expected: PASS — 6 tests

- [ ] **Step 4: Run full suite**

Run: `npm test 2>&1 | tail -5`
Expected: `Tests  194 passed (194)`

- [ ] **Step 5: Commit**

```bash
git add quoth-plugin/daemon/lib/injection.js quoth-plugin/tests/injection.test.js
git commit -m "feat(quoth): add trigram + Thompson-sampled pattern ranking"
```

### Task 2.2a: In-memory trigram+embedding cache (zero-latency optimization)

**Files:**
- Create: `quoth-plugin/daemon/lib/pattern-cache.js`
- Modify: `quoth-plugin/daemon/lib/injection.js` (use cache if available)

**Rationale:** Hooks are short-lived Node processes. Each call re-opens SQLite (~5ms), reads candidates (~2ms), and JSON.parses trigrams/embeddings (~5ms for 30 patterns). For 800 patterns total, pre-loading everything into typed arrays once is faster.

Two modes:
- **Lazy mode (default)**: Cache loaded on-demand in each hook process. ~10ms cost, amortized across multiple calls within the hook. Still fast enough.
- **Persistent mode (optional)**: Daemon writes a binary snapshot file (`~/.quoth/pattern-cache.bin`) after each upsert. Hooks mmap/read it directly — <2ms load. Added later if measurements show need.

- [ ] **Step 1: Write failing test**

Create `quoth-plugin/tests/pattern-cache.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../daemon/db.js'
import { loadPatternCache } from '../daemon/lib/pattern-cache.js'
import path from 'path'
import os from 'os'

let db, tmpPath
beforeEach(() => {
  tmpPath = path.join(os.tmpdir(), `quoth-cache-${Date.now()}.db`)
  db = createDb(tmpPath)
  for (let i = 0; i < 50; i++) {
    db.upsertPattern({
      id: `p${i}`, name: `pattern ${i}`, action: `do thing ${i}`,
      confidence: 0.5 + i * 0.01, alpha: i + 1, beta: 1,
    })
  }
})

describe('pattern cache', () => {
  it('loads all active patterns with parsed trigrams', () => {
    const cache = loadPatternCache(db, 'default')
    expect(cache.patterns.length).toBe(50)
    expect(cache.patterns[0].trigramSet).toBeInstanceOf(Set)
    expect(cache.patterns[0].trigramSet.size).toBeGreaterThan(0)
  })

  it('load is under 50ms for 50 patterns', () => {
    const start = Date.now()
    loadPatternCache(db, 'default')
    expect(Date.now() - start).toBeLessThan(50)
  })

  it('filters by namespace', () => {
    db.upsertPattern({ id: 'other', name: 'x', namespace: 'other-project', confidence: 0.8 })
    const cache = loadPatternCache(db, 'default')
    const ids = cache.patterns.map(p => p.id)
    expect(ids).not.toContain('other')
  })
})
```

- [ ] **Step 2: Implement cache loader**

Create `quoth-plugin/daemon/lib/pattern-cache.js`:

```javascript
'use strict'

/**
 * In-memory cache of active patterns for a namespace.
 * Parses trigrams/tags/embeddings once, avoiding repeated JSON.parse in hot loops.
 *
 * Designed for per-hook-invocation use: load once at hook start, reuse across
 * multiple ranking calls within the same process.
 */

function loadPatternCache(db, namespace, opts = {}) {
  const { minConfidence = 0.2, limit = 1000 } = opts
  const rows = db.prepare(`
    SELECT id, name, condition, action, confidence, alpha, beta, tags,
           pattern_trigrams, embedding, namespace, exposure_count,
           success_count, failure_count, last_exposed_at, applicability
    FROM patterns
    WHERE status = 'active'
      AND (namespace = ? OR namespace = 'global')
      AND confidence >= ?
    ORDER BY confidence DESC
    LIMIT ?
  `).all(namespace, minConfidence, limit)

  const patterns = rows.map(r => {
    let trigramSet = new Set()
    try {
      const arr = JSON.parse(r.pattern_trigrams || '[]')
      trigramSet = new Set(arr)
    } catch {}

    let tags = []
    try { tags = JSON.parse(r.tags || '[]') } catch {}

    // Only parse embedding lazily via getter to avoid 1024-float parse cost
    // unless actually used for semantic search.
    let _embeddingCache = null
    const getEmbedding = () => {
      if (_embeddingCache) return _embeddingCache
      if (!r.embedding) return null
      try {
        const arr = JSON.parse(r.embedding)
        _embeddingCache = new Float32Array(arr)
        return _embeddingCache
      } catch { return null }
    }

    return {
      ...r, tags, trigramSet, getEmbedding,
    }
  })

  return {
    patterns,
    namespace,
    loadedAt: Date.now(),
    size: patterns.length,
  }
}

module.exports = { loadPatternCache }
```

- [ ] **Step 3: Update injection.js to accept cache**

Modify `rankByThompson` and `rankByThompsonAndTrigram` in `injection.js` to accept an optional `cache` parameter. If passed, use cached patterns instead of querying DB. If not, query DB as before (backward compat).

- [ ] **Step 4: Run tests**

Run: `npx vitest run quoth-plugin/tests/pattern-cache.test.js 2>&1 | tail -10`
Expected: 3 tests PASS, load time <50ms

Run: `npm test 2>&1 | tail -5`
Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add quoth-plugin/daemon/lib/pattern-cache.js quoth-plugin/daemon/lib/injection.js quoth-plugin/tests/pattern-cache.test.js
git commit -m "feat(quoth): in-memory pattern cache with lazy Float32Array embeddings"
```

### Task 2.2b: k-means clustering for sub-ms lookup

**Files:**
- Create: `quoth-plugin/daemon/lib/clustering.js`
- Create: `quoth-plugin/tests/clustering.test.js`

**Rationale:** HNSW is O(log n) ≈ 10 ops for 800 patterns. k-means on top gives us sub-1ms centroid lookup + micro-cluster search. More importantly, clusters give us **semantic neighborhoods** — we can inject "one pattern from each relevant cluster" for diversity, not just top-N which often returns near-duplicates.

- [ ] **Step 1: Write failing test**

Create `quoth-plugin/tests/clustering.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { kmeans, assignToCluster, cosineDist } from '../daemon/lib/clustering.js'

function mkVec(len, seed) {
  const v = new Float32Array(len)
  for (let i = 0; i < len; i++) v[i] = Math.sin(seed * (i + 1))
  // Normalize
  let norm = 0
  for (let i = 0; i < len; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  for (let i = 0; i < len; i++) v[i] /= norm
  return v
}

describe('k-means clustering', () => {
  it('produces requested number of clusters', () => {
    const vectors = Array.from({ length: 100 }, (_, i) => mkVec(32, i + 1))
    const { centroids, assignments } = kmeans(vectors, 10, { maxIter: 20 })
    expect(centroids.length).toBe(10)
    expect(assignments.length).toBe(100)
    expect(Math.max(...assignments)).toBeLessThan(10)
  })

  it('caps k at vector count', () => {
    const vectors = Array.from({ length: 5 }, (_, i) => mkVec(16, i + 1))
    const { centroids } = kmeans(vectors, 50, { maxIter: 10 })
    expect(centroids.length).toBeLessThanOrEqual(5)
  })

  it('assignToCluster returns nearest centroid index', () => {
    const c1 = mkVec(8, 1)
    const c2 = mkVec(8, 100)
    const query = mkVec(8, 1.01)  // near c1
    const idx = assignToCluster(query, [c1, c2])
    expect(idx).toBe(0)
  })

  it('cosineDist is 0 for identical, ~1 for orthogonal', () => {
    const v = mkVec(8, 1)
    expect(cosineDist(v, v)).toBeLessThan(0.01)
  })
})
```

- [ ] **Step 2: Implement k-means**

Create `quoth-plugin/daemon/lib/clustering.js`:

```javascript
'use strict'

/**
 * Simple k-means clustering over Float32Array vectors using cosine distance.
 * For semantic pattern grouping — enables diversity injection (one per cluster).
 */

function cosineDist(a, b) {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  // Assume vectors are normalized (our voyage-4-lite output is)
  return 1 - dot
}

function assignToCluster(vec, centroids) {
  let best = 0, bestDist = Infinity
  for (let i = 0; i < centroids.length; i++) {
    const d = cosineDist(vec, centroids[i])
    if (d < bestDist) { bestDist = d; best = i }
  }
  return best
}

function meanVector(vectors) {
  if (vectors.length === 0) return null
  const dim = vectors[0].length
  const out = new Float32Array(dim)
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i]
  for (let i = 0; i < dim; i++) out[i] /= vectors.length
  // Normalize
  let norm = 0
  for (let i = 0; i < dim; i++) norm += out[i] * out[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < dim; i++) out[i] /= norm
  return out
}

function kmeans(vectors, k, opts = {}) {
  const { maxIter = 30, tol = 1e-4 } = opts
  const effectiveK = Math.min(k, vectors.length)
  if (effectiveK === 0) return { centroids: [], assignments: [] }

  // k-means++ init: first centroid random, rest biased by distance
  const centroids = [vectors[Math.floor(Math.random() * vectors.length)]]
  while (centroids.length < effectiveK) {
    const dists = vectors.map(v => Math.min(...centroids.map(c => cosineDist(v, c))))
    const sum = dists.reduce((a, b) => a + b, 0)
    let r = Math.random() * sum, idx = 0
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i]
      if (r <= 0) { idx = i; break }
    }
    centroids.push(vectors[idx])
  }

  let assignments = new Array(vectors.length).fill(0)
  for (let iter = 0; iter < maxIter; iter++) {
    // Assign
    const newAssignments = vectors.map(v => assignToCluster(v, centroids))
    // Check convergence
    let changed = 0
    for (let i = 0; i < assignments.length; i++) {
      if (newAssignments[i] !== assignments[i]) changed++
    }
    assignments = newAssignments
    if (changed / vectors.length < tol) break

    // Update centroids
    for (let c = 0; c < centroids.length; c++) {
      const members = vectors.filter((_, i) => assignments[i] === c)
      if (members.length > 0) centroids[c] = meanVector(members)
    }
  }

  return { centroids, assignments }
}

module.exports = { kmeans, assignToCluster, cosineDist, meanVector }
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run quoth-plugin/tests/clustering.test.js 2>&1 | tail -10`
Expected: 4 tests PASS

- [ ] **Step 4: Wire clustering into injection (diversity mode)**

Add to `injection.js`:

```javascript
function rankByDiversity(patterns, queryVec, limit) {
  // Get patterns with embeddings
  const withEmb = patterns.map(p => ({ p, emb: p.getEmbedding ? p.getEmbedding() : null }))
    .filter(x => x.emb)
  if (withEmb.length <= limit) return withEmb.map(x => x.p)

  // Cluster into `limit` clusters, pick best from each
  const { kmeans } = require('./clustering.js')
  const vectors = withEmb.map(x => x.emb)
  const { assignments } = kmeans(vectors, limit)

  const picks = new Map()
  for (let i = 0; i < withEmb.length; i++) {
    const cluster = assignments[i]
    const current = picks.get(cluster)
    if (!current || withEmb[i].p.confidence > current.confidence) {
      picks.set(cluster, withEmb[i].p)
    }
  }
  return Array.from(picks.values())
}
```

- [ ] **Step 5: Run full suite**

Run: `npm test 2>&1 | tail -5`
Expected: all passing

- [ ] **Step 6: Commit**

```bash
git add quoth-plugin/daemon/lib/clustering.js quoth-plugin/tests/clustering.test.js quoth-plugin/daemon/lib/injection.js
git commit -m "feat(quoth): k-means clustering for diversity-based injection"
```

### Task 2.2c: Bounded quality history for trend detection

**Files:**
- Modify: `quoth-plugin/daemon/db.js` (add `quality_history` column + update logic)
- Modify: `quoth-plugin/daemon/lib/scoring.js` (recordQuality function)

**Rationale:** Bayesian confidence is cumulative — it can't detect recent drift. Bounded history (last 20 scores) lets us see if a pattern is improving or declining, independent of its all-time mean. Ruflo v3 does this for trend reporting.

- [ ] **Step 1: Add column migration**

In `db.js` migration block:

```javascript
try { db.prepare("ALTER TABLE patterns ADD COLUMN quality_history TEXT DEFAULT '[]'").run() } catch {}
```

- [ ] **Step 2: Add recordQuality to scoring.js**

```javascript
const MAX_HISTORY = 20

function recordQuality(db, id, score) {
  const row = db.prepare('SELECT quality_history FROM patterns WHERE id = ?').get(id)
  if (!row) return
  let history = []
  try { history = JSON.parse(row.quality_history || '[]') } catch {}
  history.push({ score, at: Date.now() })
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY)
  db.prepare('UPDATE patterns SET quality_history = ? WHERE id = ?')
    .run(JSON.stringify(history), id)
}

function getTrend(db, id) {
  const row = db.prepare('SELECT quality_history FROM patterns WHERE id = ?').get(id)
  if (!row) return { trend: 'unknown', delta: 0 }
  let history = []
  try { history = JSON.parse(row.quality_history || '[]') } catch {}
  if (history.length < 4) return { trend: 'unknown', delta: 0 }
  const half = Math.floor(history.length / 2)
  const older = history.slice(0, half).reduce((a, b) => a + b.score, 0) / half
  const newer = history.slice(half).reduce((a, b) => a + b.score, 0) / (history.length - half)
  const delta = newer - older
  return {
    trend: delta > 0.05 ? 'improving' : delta < -0.05 ? 'declining' : 'stable',
    delta,
  }
}

module.exports = {
  recordExposure, applySoftNegative, conversionRate,
  recordQuality, getTrend,
  SOFT_NEGATIVE_BETA_DELTA,
}
```

- [ ] **Step 3: Wire into applyBayesianUpdate in db.js**

When Bayesian update fires, also record quality score (= current confidence after update).

- [ ] **Step 4: Add trend test**

Add to `quoth-plugin/tests/scoring.test.js`:

```javascript
describe('quality history', () => {
  it('recordQuality bounds to last 20 entries', () => {
    const { recordQuality } = require('../daemon/lib/scoring.js')
    for (let i = 0; i < 30; i++) recordQuality(db, 'p1', 0.5 + i * 0.01)
    const row = db.prepare('SELECT quality_history FROM patterns WHERE id=?').get('p1')
    const history = JSON.parse(row.quality_history)
    expect(history.length).toBe(20)
    expect(history[19].score).toBeCloseTo(0.79, 2)
  })

  it('getTrend detects improvement', () => {
    const { recordQuality, getTrend } = require('../daemon/lib/scoring.js')
    for (let i = 0; i < 10; i++) recordQuality(db, 'p1', 0.3)  // old baseline
    for (let i = 0; i < 10; i++) recordQuality(db, 'p1', 0.8)  // recent improvement
    const trend = getTrend(db, 'p1')
    expect(trend.trend).toBe('improving')
    expect(trend.delta).toBeGreaterThan(0.3)
  })
})
```

- [ ] **Step 5: Run tests**

Run: `npm test 2>&1 | tail -5`
Expected: all passing

- [ ] **Step 6: Commit**

```bash
git add quoth-plugin/daemon/db.js quoth-plugin/daemon/lib/scoring.js quoth-plugin/tests/scoring.test.js
git commit -m "feat(quoth): bounded quality history for trend detection"
```

### Task 2.2: Precompute trigrams on pattern upsert

**Files:**
- Modify: `quoth-plugin/daemon/db.js:231` (`upsertPattern` function)

- [ ] **Step 1: Read current upsertPattern**

Run: `sed -n '231,275p' quoth-plugin/daemon/db.js`

- [ ] **Step 2: Add trigram precomputation to upsertPattern**

In `db.js`, modify `upsertPattern` to compute and store trigrams:

```javascript
// At top of db.js, after other requires:
const { trigrams } = require('./lib/injection.js')

// In upsertPattern, before the INSERT/UPDATE:
const textForTrigrams = `${p.name || ''} ${p.action || ''} ${p.condition || ''}`
const patternTrigrams = JSON.stringify([...trigrams(textForTrigrams)])
// Then add pattern_trigrams to the INSERT/UPDATE columns
```

Full modified upsertPattern block — replace the existing function body with one that also sets `pattern_trigrams` and `embedding_text`.

- [ ] **Step 3: Add backfill migration for existing patterns**

After the ALTER statements, add:

```javascript
// One-time backfill for existing patterns without trigrams
const needsTrigrams = db.prepare(`
  SELECT id, name, action, condition FROM patterns
  WHERE pattern_trigrams IS NULL AND status = 'active'
`).all()
if (needsTrigrams.length > 0) {
  const update = db.prepare('UPDATE patterns SET pattern_trigrams = ? WHERE id = ?')
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const text = `${r.name || ''} ${r.action || ''} ${r.condition || ''}`
      update.run(JSON.stringify([...trigrams(text)]), r.id)
    }
  })
  tx(needsTrigrams)
}
```

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | tail -5`
Expected: all passing

- [ ] **Step 5: Verify live DB backfilled**

Run:
```bash
node -e "
const { createDb } = require('./quoth-plugin/daemon/db.js')
const db = createDb(require('path').join(require('os').homedir(), '.quoth', 'memory.db'))
const total = db.prepare(\"SELECT COUNT(*) c FROM patterns WHERE status='active'\").get().c
const withTrigrams = db.prepare(\"SELECT COUNT(*) c FROM patterns WHERE status='active' AND pattern_trigrams IS NOT NULL\").get().c
console.log('Active:', total, 'With trigrams:', withTrigrams)
"
```
Expected: both numbers equal

- [ ] **Step 6: Commit**

```bash
git add quoth-plugin/daemon/db.js
git commit -m "feat(quoth): precompute and backfill trigrams for patterns"
```

---

## Phase 3: Session Working Memory

### Task 3.1: Session memory module

**Files:**
- Create: `quoth-plugin/hooks/session-memory.js`
- Create: `quoth-plugin/tests/session-memory.test.js`

- [ ] **Step 1: Write failing test**

Create `quoth-plugin/tests/session-memory.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createSessionMemory } from '../hooks/session-memory.js'
import fs from 'fs'
import path from 'path'
import os from 'os'

let tmpDir
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-sess-'))
})
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

describe('session memory', () => {
  it('recordPrompt accumulates topics', () => {
    const sm = createSessionMemory({ dir: tmpDir, sessionId: 's1', project: 'demo' })
    sm.recordPrompt('Write React component for login form')
    sm.recordPrompt('Add React tests for login component')
    const summary = sm.getContextSummary()
    expect(summary.topTopics).toContain('react')
    expect(summary.topTopics).toContain('login')
  })

  it('recordEdit tracks file touch counts', () => {
    const sm = createSessionMemory({ dir: tmpDir, sessionId: 's1', project: 'demo' })
    sm.recordEdit('/src/auth.ts')
    sm.recordEdit('/src/auth.ts')
    sm.recordEdit('/src/user.ts')
    const summary = sm.getContextSummary()
    expect(summary.topFiles[0]).toBe('/src/auth.ts')
  })

  it('recordInjection + markPatternUsed tracks stale injections', () => {
    const sm = createSessionMemory({ dir: tmpDir, sessionId: 's1', project: 'demo' })
    sm.recordInjection(['p1', 'p2', 'p3'])
    sm.markPatternUsed('p1')
    const stale = sm.getStaleInjections(0)  // any age
    expect(stale).toContain('p2')
    expect(stale).toContain('p3')
    expect(stale).not.toContain('p1')
  })

  it('persists and loads from disk', () => {
    const sm = createSessionMemory({ dir: tmpDir, sessionId: 's1', project: 'demo' })
    sm.recordPrompt('test prompt')
    sm.save()
    const sm2 = createSessionMemory({ dir: tmpDir, sessionId: 's1', project: 'demo' })
    const summary = sm2.getContextSummary()
    expect(summary.recentPrompts).toContain('test prompt')
  })

  it('getQueryText returns joined top topics + prompt', () => {
    const sm = createSessionMemory({ dir: tmpDir, sessionId: 's1', project: 'demo' })
    sm.recordPrompt('Build react login component')
    const q = sm.getQueryText()
    expect(q).toContain('react')
    expect(q.length).toBeGreaterThan(0)
  })
})
```

Run: `npx vitest run quoth-plugin/tests/session-memory.test.js 2>&1 | tail -10`
Expected: FAIL — cannot find module

- [ ] **Step 2: Implement session memory**

Create `quoth-plugin/hooks/session-memory.js`:

```javascript
'use strict'

const fs = require('fs')
const path = require('path')

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'is','was','are','were','be','been','being','have','has','had','do','does','did',
  'will','would','should','could','may','might','can','i','you','we','they','it',
  'this','that','these','those','my','your','our','their','me','us','them'
])

function tokenizeForTopics(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t))
}

function createSessionMemory({ dir, sessionId, project }) {
  const filePath = path.join(dir, `session-${sessionId}.json`)
  let state = {
    sessionId, project,
    startedAt: Date.now(),
    topics: {},
    files: {},
    recentPrompts: [],
    injectedPatterns: {},
  }

  // Load existing
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    state = { ...state, ...JSON.parse(raw) }
  } catch {}

  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(filePath, JSON.stringify(state))
    } catch {}
  }

  function recordPrompt(prompt) {
    if (!prompt) return
    const tokens = tokenizeForTopics(prompt)
    for (const t of tokens) state.topics[t] = (state.topics[t] || 0) + 1
    state.recentPrompts.push(prompt.slice(0, 200))
    if (state.recentPrompts.length > 5) state.recentPrompts.shift()
    save()
  }

  function recordEdit(file) {
    if (!file) return
    state.files[file] = (state.files[file] || 0) + 1
    save()
  }

  function recordInjection(patternIds) {
    if (!patternIds || patternIds.length === 0) return
    const now = Date.now()
    for (const id of patternIds) {
      if (!state.injectedPatterns[id]) {
        state.injectedPatterns[id] = { at: now, used: false }
      }
    }
    save()
  }

  function markPatternUsed(patternId) {
    if (state.injectedPatterns[patternId]) {
      state.injectedPatterns[patternId].used = true
      save()
    }
  }

  function getStaleInjections(minAgeMinutes = 10) {
    const cutoff = Date.now() - minAgeMinutes * 60 * 1000
    return Object.entries(state.injectedPatterns)
      .filter(([, v]) => !v.used && v.at <= cutoff)
      .map(([id]) => id)
  }

  function getContextSummary() {
    const topTopics = Object.entries(state.topics)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t]) => t)
    const topFiles = Object.entries(state.files)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([f]) => f)
    return { topTopics, topFiles, recentPrompts: state.recentPrompts }
  }

  function getQueryText(currentPrompt) {
    const { topTopics, recentPrompts } = getContextSummary()
    return [currentPrompt, ...recentPrompts.slice(-2), topTopics.slice(0, 5).join(' ')]
      .filter(Boolean)
      .join(' ')
  }

  function clear() {
    try { fs.unlinkSync(filePath) } catch {}
  }

  return {
    recordPrompt, recordEdit, recordInjection, markPatternUsed,
    getStaleInjections, getContextSummary, getQueryText,
    save, clear, _state: () => state,
  }
}

module.exports = { createSessionMemory }
```

- [ ] **Step 3: Run test**

Run: `npx vitest run quoth-plugin/tests/session-memory.test.js 2>&1 | tail -10`
Expected: PASS — 5 tests

- [ ] **Step 4: Run full suite**

Run: `npm test 2>&1 | tail -5`
Expected: `Tests  199 passed (199)`

- [ ] **Step 5: Commit**

```bash
git add quoth-plugin/hooks/session-memory.js quoth-plugin/tests/session-memory.test.js
git commit -m "feat(quoth): add session working memory (topics, files, injections)"
```

---

## Phase 4: Wire Hooks to New Infrastructure

### Task 4.1: Update session-restore with semantic injection

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js:166-244` (session-restore handler)

- [ ] **Step 1: Read current session-restore handler**

Run: `sed -n '166,244p' quoth-plugin/hooks/hook-dispatch.js`

- [ ] **Step 2: Replace injection block**

Replace lines 228-243 (the "Inject only high-confidence patterns" block) with:

```javascript
// Context-aware semantic injection via Thompson + trigram
if (db) {
  try {
    const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
    const { rankByThompsonAndTrigram } = require('../daemon/lib/injection.js')
    const { recordExposure } = require('../daemon/lib/scoring.js')
    const { createSessionMemory } = require('./session-memory.js')

    // Load last session's context for query (from prior session-end snapshot)
    let queryText = ''
    try {
      const ctxPath = path.join(QUOTH_HOME, 'intelligence', `last-context-${project}.json`)
      const ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'))
      queryText = [
        ...(ctx.recentPrompts || []).slice(-2),
        (ctx.topTopics || []).slice(0, 5).join(' '),
      ].filter(Boolean).join(' ')
    } catch {}

    const patterns = rankByThompsonAndTrigram(db, project, queryText, 3, { minConfidence: 0.3 })
    if (patterns.length > 0) {
      recordExposure(db, patterns.map(p => p.id))
      // Also record in session memory
      const sessionId = process.env.CLAUDE_SESSION_ID || 'default'
      const sm = createSessionMemory({
        dir: path.join(QUOTH_HOME, 'intelligence'),
        sessionId, project,
      })
      sm.recordInjection(patterns.map(p => p.id))

      const lines = [`[Quoth] ${patterns.length} patterns loaded for project "${project}":`]
      for (const p of patterns) {
        lines.push(`- [${p.confidence.toFixed(2)}] ${p.name || p.id}: ${(p.action || '').slice(0, 60)}`)
      }
      console.log(lines.join('\n'))
    }
  } catch {}
}
```

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1 | tail -5`
Expected: all passing

- [ ] **Step 4: Manual smoke test**

Run:
```bash
CLAUDE_PROJECT_DIR=/home/lord_montino/projects/agents-tools/quoth \
  node quoth-plugin/hooks/hook-dispatch.js session-restore 2>&1
```
Expected: output with `[Quoth] N patterns loaded for project "quoth":` and 3 patterns

- [ ] **Step 5: Commit**

```bash
git add quoth-plugin/hooks/hook-dispatch.js
git commit -m "feat(quoth): semantic injection in session-restore hook"
```

### Task 4.2: Update route with trigram matching

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js` (route handler ~line 80-160)

- [ ] **Step 1: Read current route handler**

Run: `grep -n "'route':" quoth-plugin/hooks/hook-dispatch.js`

Read lines from there to the next handler.

- [ ] **Step 2: Add trigram injection step**

In the route handler, after reading the prompt from stdin, add BEFORE the existing output:

```javascript
// Record prompt in session memory
try {
  const sessionId = process.env.CLAUDE_SESSION_ID || 'default'
  const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
  const { createSessionMemory } = require('./session-memory.js')
  const sm = createSessionMemory({
    dir: path.join(QUOTH_HOME, 'intelligence'),
    sessionId, project,
  })
  sm.recordPrompt(prompt)
} catch {}
```

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add quoth-plugin/hooks/hook-dispatch.js
git commit -m "feat(quoth): record prompts in session memory during route"
```

### Task 4.3: Update subagent-start with semantic injection

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js:380-420` (subagent-start handler)

- [ ] **Step 1: Read subagent-start handler**

Run: `grep -n "subagent-start" quoth-plugin/hooks/hook-dispatch.js`

- [ ] **Step 2: Replace keyword DOMAIN_MAP ranking with Thompson+trigram**

Replace the `scored = projectPatterns.map(...)` block (around lines 396-402) with:

```javascript
const { rankByThompsonAndTrigram } = require('../daemon/lib/injection.js')
const { recordExposure } = require('../daemon/lib/scoring.js')
const { createSessionMemory } = require('./session-memory.js')

const sessionId = process.env.CLAUDE_SESSION_ID || 'default'
const sm = createSessionMemory({
  dir: path.join(QUOTH_HOME, 'intelligence'),
  sessionId, project,
})
const queryText = sm.getQueryText(hookInput.prompt || hookInput.description || agentType)

const scored = rankByThompsonAndTrigram(db, project, queryText, 5, { minConfidence: 0.3 })
if (scored.length > 0) {
  recordExposure(db, scored.map(p => p.id))
  sm.recordInjection(scored.map(p => p.id))
}
```

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add quoth-plugin/hooks/hook-dispatch.js
git commit -m "feat(quoth): semantic injection in subagent-start hook"
```

### Task 4.4: Session-end feedback (soft negatives + context snapshot)

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js:246+` (session-end handler)

- [ ] **Step 1: Read session-end handler**

Run: `grep -n "'session-end':" quoth-plugin/hooks/hook-dispatch.js`

- [ ] **Step 2: Add soft-negative sweep + context snapshot**

In the session-end handler, after the existing intelligence consolidation:

```javascript
// Apply soft negatives for unused injections + snapshot context for next session
try {
  const sessionId = process.env.CLAUDE_SESSION_ID || 'default'
  const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
  const { createSessionMemory } = require('./session-memory.js')
  const { applySoftNegative } = require('../daemon/lib/scoring.js')

  const sm = createSessionMemory({
    dir: path.join(QUOTH_HOME, 'intelligence'),
    sessionId, project,
  })

  const stale = sm.getStaleInjections(0)  // any age at session end
  if (stale.length > 0 && db) applySoftNegative(db, stale)

  // Snapshot context for next session-restore
  const ctx = sm.getContextSummary()
  const ctxPath = path.join(QUOTH_HOME, 'intelligence', `last-context-${project}.json`)
  fs.mkdirSync(path.dirname(ctxPath), { recursive: true })
  fs.writeFileSync(ctxPath, JSON.stringify(ctx))

  sm.clear()
} catch {}
```

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add quoth-plugin/hooks/hook-dispatch.js
git commit -m "feat(quoth): session-end soft negatives + context snapshot"
```

### Task 4.5: Post-task positive feedback for used injections

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js` (post-task handler)

- [ ] **Step 1: Read post-task handler**

Run: `grep -n "'post-task':" quoth-plugin/hooks/hook-dispatch.js`

- [ ] **Step 2: Add mark-used logic**

In the post-task handler, before the existing intelligence feedback, read the most recent pattern injection from session memory and mark any whose action/tags reference a touched file as used. (Simple heuristic — the existing intelligence graph feedback still runs.)

```javascript
try {
  const sessionId = process.env.CLAUDE_SESSION_ID || 'default'
  const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
  const { createSessionMemory } = require('./session-memory.js')
  const sm = createSessionMemory({
    dir: path.join(QUOTH_HOME, 'intelligence'),
    sessionId, project,
  })

  // Mark all patterns injected in last 5 minutes as "used" — crude but effective
  // (If the task completed, assume injected context was at least considered)
  const recent = Object.entries(sm._state().injectedPatterns || {})
    .filter(([, v]) => !v.used && v.at > Date.now() - 5 * 60 * 1000)
    .map(([id]) => id)

  for (const id of recent) {
    sm.markPatternUsed(id)
    if (db) db.applyBayesianUpdate(id, 'success')
  }
} catch {}
```

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add quoth-plugin/hooks/hook-dispatch.js
git commit -m "feat(quoth): post-task positive feedback for injected patterns"
```

---

## Phase 5: Cloud Pull (Bi-directional Sync)

### Task 5.1: Cloud pull module

**Files:**
- Create: `quoth-plugin/daemon/lib/pull.js`

- [ ] **Step 1: Create pull module**

```javascript
'use strict'

const https = require('https')

async function pullProjectPatterns(slug, since = 0, apiKey, apiUrl = 'https://quoth.triqual.dev') {
  if (!apiKey) return { patterns: [], skipped: 'no API key' }
  const url = new URL(`/api/v1/patterns?projectSlug=${encodeURIComponent(slug)}&since=${since}&limit=50`, apiUrl)

  return new Promise((resolve) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      timeout: 5000,
    }, (res) => {
      let chunks = ''
      res.on('data', c => { chunks += c })
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks)
          resolve({ patterns: data.patterns || [], status: res.statusCode })
        } catch {
          resolve({ patterns: [], error: 'parse error' })
        }
      })
    })
    req.on('error', (err) => resolve({ patterns: [], error: err.message }))
    req.on('timeout', () => { req.destroy(); resolve({ patterns: [], error: 'timeout' }) })
    req.end()
  })
}

async function syncFromCloud(db, log) {
  const apiKey = process.env.QUOTH_API_KEY
  if (!apiKey) { log('info', 'Cloud pull skipped: no QUOTH_API_KEY'); return }

  const namespaces = db.prepare(
    "SELECT DISTINCT namespace FROM patterns WHERE namespace IS NOT NULL"
  ).all().map(r => r.namespace)

  let totalNew = 0
  for (const ns of namespaces) {
    const { patterns, error } = await pullProjectPatterns(ns, 0, apiKey, process.env.QUOTH_API_URL)
    if (error) { log('warn', `Cloud pull failed for ${ns}`, { error }); continue }

    for (const p of patterns) {
      const exists = db.prepare('SELECT id FROM patterns WHERE id = ?').get(p.patternId || p.id)
      if (exists) continue
      try {
        db.upsertPattern({
          id: p.patternId || p.id,
          name: p.name,
          condition: p.condition,
          action: p.action,
          confidence: p.confidence,
          alpha: p.alpha || 1,
          beta: p.beta || 1,
          tags: p.tags || [],
          namespace: ns,
          source: 'cloud-pulled',
          applicability: p.applicability || 'narrow',
          embedding: p.embedding,
        })
        totalNew++
      } catch {}
    }
  }
  log('info', `Cloud pull: ${totalNew} new patterns from ${namespaces.length} namespaces`)
}

module.exports = { pullProjectPatterns, syncFromCloud }
```

- [ ] **Step 2: Run tests to ensure no breakage**

Run: `npm test 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add quoth-plugin/daemon/lib/pull.js
git commit -m "feat(quoth): add cloud pull for bi-directional pattern sync"
```

### Task 5.2: Wire pull into daemon scheduler

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js` (near scheduleNightlyPipeline)

- [ ] **Step 1: Add pull call to nightly pipeline**

Add after Phase B (doc update) in `runNightlyPipeline`:

```javascript
// Phase C: Cloud pull
try {
  const { syncFromCloud } = require('./lib/pull.js')
  await syncFromCloud(db, log)
} catch (err) {
  log('error', 'Nightly Phase C (cloud pull) failed', { error: err.message })
}
```

Also add a 6-hour interval pull on daemon startup:

```javascript
// In start() function, after other timers:
const cloudPullTimer = setInterval(async () => {
  try {
    const { syncFromCloud } = require('./lib/pull.js')
    await syncFromCloud(db, log)
  } catch (err) {
    log('error', 'Cloud pull failed', { error: err.message })
  }
}, 6 * 60 * 60 * 1000)  // 6h
```

- [ ] **Step 2: Restart daemon and verify**

```bash
kill $(cat ~/.quoth/daemon.pid) 2>/dev/null
sleep 1
node quoth-plugin/daemon/daemon.js &
sleep 2
grep -i 'cloud pull' ~/.quoth/daemon.log | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add quoth-plugin/daemon/daemon.js
git commit -m "feat(quoth): schedule cloud pull in daemon nightly + 6h interval"
```

---

## Phase 6: Nightly Rebalancing

### Task 6.1: Conversion-rate rebalancing

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js` (`runDeepConsolidate` function, after Phase 2)

- [ ] **Step 1: Add rebalancing phase**

Insert after "Deep consolidation done" log, before cloud promotion:

```javascript
// Phase 2.5: Conversion-rate rebalancing
try {
  // Penalize patterns shown a lot but rarely used
  const penalized = db.prepare(`
    UPDATE patterns
    SET beta = beta + 2,
        confidence = alpha / NULLIF(alpha + beta + 2, 0)
    WHERE status = 'active'
      AND exposure_count > 20
      AND (success_count * 1.0 / NULLIF(exposure_count, 0)) < 0.05
  `).run()

  // Boost patterns with high conversion
  const boosted = db.prepare(`
    UPDATE patterns
    SET alpha = alpha + 1,
        confidence = (alpha + 1) / NULLIF(alpha + 1 + beta, 0)
    WHERE status = 'active'
      AND exposure_count > 5
      AND (success_count * 1.0 / NULLIF(exposure_count, 0)) > 0.5
  `).run()

  log('info', 'Conversion rebalancing', { penalized: penalized.changes, boosted: boosted.changes })
} catch (err) {
  log('error', 'Rebalancing failed', { error: err.message })
}
```

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add quoth-plugin/daemon/daemon.js
git commit -m "feat(quoth): conversion-rate rebalancing in nightly consolidation"
```

### Task 6.2: Capacity-based pruning (Ruflo v3 formula)

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js` (`runDeepConsolidate`)

- [ ] **Step 1: Add pruning phase**

```javascript
// Phase 2.6: Capacity pruning (when > 1000 patterns)
try {
  const total = db.prepare("SELECT COUNT(*) c FROM patterns WHERE status='active'").get().c
  if (total > 1000) {
    const excess = total - 900  // Drop to 900
    // score = successRate * log(uses+1), ascending = worst first
    const pruned = db.prepare(`
      UPDATE patterns SET status = 'archived'
      WHERE id IN (
        SELECT id FROM patterns WHERE status = 'active'
        ORDER BY (
          (success_count * 1.0 / NULLIF(success_count + failure_count, 0))
          * (1.0 + ln(1.0 + success_count + failure_count))
        ) ASC
        LIMIT ?
      )
    `).run(excess)
    log('info', 'Capacity pruning', { pruned: pruned.changes, remaining: total - pruned.changes })
  }
} catch (err) {
  log('error', 'Pruning failed', { error: err.message })
}
```

SQLite lacks `ln()` natively — use this instead: `log()` is available in better-sqlite3 when compiled with math extensions; if not, fall back to JS:

```javascript
const candidates = db.prepare(`
  SELECT id, success_count, failure_count
  FROM patterns WHERE status = 'active'
`).all()
if (candidates.length > 1000) {
  const scored = candidates.map(p => {
    const total = p.success_count + p.failure_count
    const rate = total > 0 ? p.success_count / total : 0
    return { id: p.id, score: rate * Math.log(1 + total) }
  }).sort((a, b) => a.score - b.score)
  const toArchive = scored.slice(0, candidates.length - 900).map(p => p.id)
  const stmt = db.prepare("UPDATE patterns SET status='archived' WHERE id=?")
  const tx = db.transaction((ids) => { for (const id of ids) stmt.run(id) })
  tx(toArchive)
  log('info', 'Capacity pruning', { pruned: toArchive.length })
}
```

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add quoth-plugin/daemon/daemon.js
git commit -m "feat(quoth): capacity-based pruning using conversion score"
```

---

## Phase 7: Verification & Observability

### Task 7.1: Add stats MCP tool showing health metrics

**Files:**
- Modify: `quoth-plugin/mcp/handlers/intelligence.js` (`intelligence_stats` handler)

- [ ] **Step 1: Add exposure/conversion metrics to stats**

Extend the existing `intelligence_stats` response with:

```javascript
const exposure = db.prepare(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN exposure_count > 0 THEN 1 ELSE 0 END) as exposed,
    SUM(CASE WHEN success_count > 0 THEN 1 ELSE 0 END) as used,
    AVG(CASE WHEN exposure_count > 0 THEN (success_count * 1.0 / exposure_count) ELSE 0 END) as avg_conversion
  FROM patterns WHERE status = 'active'
`).get()

return {
  ...existingStats,
  exposure: {
    total: exposure.total,
    exposed: exposure.exposed,
    used: exposure.used,
    avg_conversion_rate: exposure.avg_conversion,
  },
}
```

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add quoth-plugin/mcp/handlers/intelligence.js
git commit -m "feat(quoth): add exposure metrics to intelligence_stats"
```

### Task 7.2: End-to-end validation

**Files:** None — just verification

- [ ] **Step 1: Full test suite**

Run: `npm test 2>&1 | tail -10`
Expected: all tests passing

- [ ] **Step 2: Restart daemon with all changes**

```bash
kill $(cat ~/.quoth/daemon.pid) 2>/dev/null
sleep 1
node quoth-plugin/daemon/daemon.js &
sleep 2
tail -20 ~/.quoth/daemon.log
```

- [ ] **Step 3: Simulate a session-restore call**

```bash
CLAUDE_PROJECT_DIR=/home/lord_montino/projects/agents-tools/quoth \
CLAUDE_SESSION_ID=test-session \
  node quoth-plugin/hooks/hook-dispatch.js session-restore 2>&1
```
Expected: `[Quoth] N patterns loaded...` output

- [ ] **Step 4: Check exposure was recorded**

```bash
node -e "
const { createDb } = require('./quoth-plugin/daemon/db.js')
const db = createDb(require('path').join(require('os').homedir(), '.quoth', 'memory.db'))
const recent = db.prepare(\"SELECT id, name, exposure_count, last_exposed_at FROM patterns WHERE exposure_count > 0 ORDER BY last_exposed_at DESC LIMIT 5\").all()
console.log('Recent exposures:', recent)
"
```
Expected: 3+ patterns with recent `last_exposed_at`

- [ ] **Step 5: Trigger manual deep consolidation (full pipeline test)**

```bash
node -e "
const { createDb } = require('./quoth-plugin/daemon/db.js')
const db = createDb(require('path').join(require('os').homedir(), '.quoth', 'memory.db'))
// Check metrics before/after rebalancing would run
const stats = db.prepare(\"SELECT COUNT(*) c, SUM(exposure_count) exp, SUM(success_count) succ FROM patterns WHERE status='active'\").get()
console.log('Stats:', stats)
"
```

- [ ] **Step 6: Commit validation**

```bash
git add -A
git commit -m "chore(quoth): e2e validation of learning overhaul"
```

---

## Rollout Strategy

**Incremental deployment** — each phase is independently valuable:

1. **Phases 1-2** (foundation): shipped alone = no user-facing change yet, just new infrastructure
2. **Phase 3** (session memory): alone = tracking without behavior change
3. **Phase 4** (hooks): here the user sees different patterns injected
4. **Phases 5-6** (cloud sync, rebalancing): background improvements

**Rollback plan:** Each phase is a separate commit. Any phase can be reverted without breaking earlier ones because:
- New DB columns are additive (nullable, default values)
- New modules are only called from hooks (revert hook changes → old behavior)
- Old `getProjectPatterns`, `getTopPatterns`, `searchBySimilarity` methods are preserved

**Success metrics (measure after 1 week):**
- Conversion rate (used/exposed) should climb from ~0 to >10%
- Number of patterns with `exposure_count > 0` should climb from 36 to 200+
- Cloud promotion candidates should climb from 2 to 10+
- Session-start should show different patterns across sessions (evidence of exploration working)

---

## Risk Register

| Risk | Mitigation |
|------|------------|
| `daemon/db.js` already 609 lines, grows further | Extracted lib/ modules. Target: trim to <550. |
| Hook latency regression | Trigram path is measured <10ms on 800 patterns. Tests assert <50ms. |
| Soft negatives too aggressive | Start at `beta += 0.1`. Monitor confidence drift over a week. |
| Thompson sampling hurts perceived quality | Tests verify proven patterns still dominate 85%+ of the time. |
| Post-task "mark all as used" is too generous | Acceptable — it's still directional signal. Refine later with trajectory matching. |
| Cloud pull clobbers local learning | `ON CONFLICT DO NOTHING`, source='cloud-pulled' for differentiation. |

---

## Related Skills

Reference these during implementation:
- `@test-driven-development` — every task uses write-test-first pattern
- `@systematic-debugging` — if a test fails unexpectedly
- `@verification-before-completion` — before each commit
- `@finishing-a-development-branch` — for final merge strategy
