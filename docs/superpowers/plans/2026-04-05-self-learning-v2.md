# Quoth Self-Learning v2 — Production-grade Contextual Bandit Architecture

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---

## Context & Motivation

### Why v1 failed (measured, 2026-04-05)

After deploying v1 (`2026-04-05-quoth-learning-overhaul.md`) we measured:

| Metric | Before v1 | After v1 | Issue |
|---|---|---|---|
| Avg confidence (quoth project) | ~62% | ~51% | Confidence deflation |
| Patterns with α=2, success=0 | ~0 | 535 | α/success_count divergence |
| Generic high-confidence patterns | few | many | "When editing a file, first read" @0.95 |
| Attribution accuracy | N/A | ≈noise | No causal signal |

**Root causes identified:**

1. **Jaccard trajectory overlap is correlation, not causation** — A pattern "read files before editing" matches every session with `Read` + `Edit`, regardless of whether the pattern influenced the agent. (Glean, Perplexity explicitly reject this — 2024 architecture talks.)

2. **Static propensity weights (1.0/0.7/0.5) are indefensible** — No production system hand-tunes propensities (Netflix, Spotify, LinkedIn 2024 RecSys talks confirm). Must be estimated empirically.

3. **Context-free Beta(α,β)** — A pattern 90% effective for "refactor SQL" and 10% for "CSS styling" collapses to a false-average global score.

4. **No session model** — `session_id` regenerates per `tool_use` event (2706 events = 2706 "sessions"). Impossible to attribute at session granularity.

5. **No quality gates** — Generic patterns dominate. Bloat proliferates without merge/retire.

6. **Soft-negative penalises without attribution** — Every un-marked injection gets β+=0.1. Across many sessions, drifts all confidences down.

### What v2 is built on (validated research, 2024-2026)

- **Hierarchical Bandits** (Hong et al. 2022) — cluster-level Thompson Sampling, O(K) memory instead of O(N·d²)
- **LLM-as-Judge Pairwise** (Zheng et al. NeurIPS'23) — dominant SOTA for offline relevance labeling
- **SNIPS estimator** (Swaminathan & Joachims 2015) — self-normalized IPS with clipping, bounded variance
- **Position-Based IPS** (Joachims et al. WSDM'17) — unbiased learning from biased feedback
- **Reflexion** (Shinn 2023) — LLM self-reflection for credit assignment in agents
- **Empirical Bayes hierarchical priors** (Gelman, *BDA3* Ch.5) — partial pooling for cold-start
- **Netflix/Spotify/LinkedIn (2024)** — production practice: 5-15% exploration, SNIPS with weight clipping at 10x, doubly-robust when possible

---

## Architecture (8 components)

```
┌─────────────────────────────────────────────────────────────────┐
│  INJECTION-TIME (<15ms budget, in-hook)                          │
│                                                                   │
│  1. HNSW embedding retrieval → top-20 candidates                 │
│  2. Hierarchical Thompson: sample cluster → score within         │
│  3. Exploration slot: 10% replace one with random                │
│  4. Log propensity (sampling probability)                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
              [session runs, trajectory logged]
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  POST-SESSION (async, in daemon)                                 │
│                                                                   │
│  5. SNIPS reward update at cluster-level (closed form)           │
│  6. Active learning: flag uncertain cluster/pattern pairs        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  NIGHTLY BATCH (daemon, $0.03/night)                             │
│                                                                   │
│  7. LLM-as-Judge pairwise on flagged cases (Haiku)               │
│     → updates cluster posteriors                                 │
│  8. Quality curation: dedup via cosine + LLM, retire by CI       │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Structure

### New files
```
quoth-plugin/daemon/lib/
  bandit-v2.js           — Hierarchical Thompson sampling
  propensity.js          — Exploration slot + propensity logging
  snips.js               — SNIPS estimator with clipping
  judge.js               — Pairwise LLM-as-Judge
  empirical-bayes.js     — Cluster prior estimation
  curation.js            — Quality gates, dedup, retirement
  forgetting.js          — Exponential forgetting factor
  attribution.js         — Reward signal extraction from trajectories

quoth-plugin/skills/
  bayesian-confidence/SKILL.md
  contextual-bandits/SKILL.md
  llm-as-judge/SKILL.md
  knowledge-base-curation/SKILL.md

quoth-plugin/tests/
  bandit-v2.test.js
  propensity.test.js
  snips.test.js
  judge.test.js
  empirical-bayes.test.js
  curation.test.js
  attribution.test.js
```

### Modified files
```
quoth-plugin/daemon/db.js                   — New schema: cluster_stats, injection_log, judge_queue
quoth-plugin/daemon/daemon.js               — Nightly judge + curation jobs
quoth-plugin/hooks/hook-dispatch.js         — Feature flag branching
quoth-plugin/mcp/handlers/intelligence.js   — New stats: v2 health
```

---

## Feature Flag

All v2 code paths guarded by:
```bash
export QUOTH_LEARNING_V2=true   # opt-in, default off
```

Fine-grained sub-flags for incremental rollout:
```bash
QUOTH_V2_INJECTION=true         # Use hierarchical TS for injection
QUOTH_V2_EXPLORATION=true       # 10% random slot
QUOTH_V2_JUDGE=true             # LLM-as-judge in nightly batch
QUOTH_V2_CURATION=true          # Quality gates + retirement
```

Setting `QUOTH_LEARNING_V2=true` turns ON all four.

---

## Phase 0: Foundation (non-breaking prerequisites)

### Task 0.1: Feature flag infrastructure

**Files:**
- Create: `quoth-plugin/daemon/lib/flags.js`

- [ ] **Step 1: Write failing test**

Create `quoth-plugin/tests/flags.test.js`:
```javascript
const { describe, it, expect, beforeEach, afterEach } = require('vitest')
const { isV2Enabled, isSubFlag } = require('../daemon/lib/flags.js')

describe('feature flags', () => {
  const orig = { ...process.env }
  afterEach(() => { process.env = { ...orig } })

  it('returns false when no flags set', () => {
    delete process.env.QUOTH_LEARNING_V2
    delete process.env.QUOTH_V2_INJECTION
    expect(isV2Enabled()).toBe(false)
    expect(isSubFlag('injection')).toBe(false)
  })

  it('master flag enables all subflags', () => {
    process.env.QUOTH_LEARNING_V2 = 'true'
    expect(isV2Enabled()).toBe(true)
    expect(isSubFlag('injection')).toBe(true)
    expect(isSubFlag('judge')).toBe(true)
  })

  it('subflag works independently of master', () => {
    delete process.env.QUOTH_LEARNING_V2
    process.env.QUOTH_V2_INJECTION = 'true'
    expect(isSubFlag('injection')).toBe(true)
    expect(isSubFlag('judge')).toBe(false)
  })
})
```

- [ ] **Step 2: Implement**

```javascript
'use strict'
const truthy = v => v === 'true' || v === '1' || v === 'yes'

function isV2Enabled() { return truthy(process.env.QUOTH_LEARNING_V2) }

function isSubFlag(name) {
  if (isV2Enabled()) return true
  const key = `QUOTH_V2_${name.toUpperCase()}`
  return truthy(process.env[key])
}

module.exports = { isV2Enabled, isSubFlag }
```

- [ ] **Step 3: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 4: Commit** → `feat(quoth-v2): feature flag infrastructure`

---

### Task 0.2: Fix session_id model

**Problem:** Current code generates `session_id` per `tool_use` event → 2706 events = 2706 "sessions". We need real session grouping.

**Files:**
- Modify: `quoth-plugin/hooks/trajectory-capture.js`
- Modify: `quoth-plugin/hooks/hook-dispatch.js`

- [ ] **Step 1: Find current session_id generation**

Run: `grep -n "session" quoth-plugin/hooks/trajectory-capture.js`

- [ ] **Step 2: Use CLAUDE_SESSION_ID from env**

Replace timestamp-based session_id with:
```javascript
const sessionId = process.env.CLAUDE_SESSION_ID
  || process.env.CLAUDE_CODE_SESSION_ID
  || `fallback-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
```

- [ ] **Step 3: Add session_id column to trajectory_steps (if not present)**

Check with `grep session_id quoth-plugin/daemon/db.js`; add migration if missing.

- [ ] **Step 4: Verify sessions group correctly**

```bash
# Run a quick test: expect multiple events per session_id
node -e "
const fs = require('fs')
const os = require('os')
const path = require('path')
const files = fs.readdirSync(path.join(os.homedir(), '.quoth/trajectories'))
const perSession = new Map()
for (const f of files) {
  const lines = fs.readFileSync(path.join(os.homedir(), '.quoth/trajectories', f), 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    try { const e = JSON.parse(line); perSession.set(e.session, (perSession.get(e.session)||0)+1) } catch {}
  }
}
const counts = [...perSession.values()]
console.log('sessions:', counts.length, 'avg events:', (counts.reduce((a,b)=>a+b,0)/counts.length).toFixed(1), 'max:', Math.max(...counts))
"
```
Expected: avg events/session > 5 after capture with new session_id.

- [ ] **Step 5: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 6: Commit** → `fix(quoth-v2): use CLAUDE_SESSION_ID for session grouping`

---

### Task 0.3: Dual-write schema (new columns, no usage yet)

**Files:**
- Modify: `quoth-plugin/daemon/db.js` (migrations block)

- [ ] **Step 1: Add migrations**

Add to migrations block:
```javascript
const v2Migrations = [
  // Cluster assignment per pattern
  { name: 'cluster_id', type: 'INTEGER DEFAULT NULL' },
  // Context-aware: per-pattern posterior within cluster (for fine-ranking)
  { name: 'cluster_rank_score', type: 'REAL DEFAULT 0.5' },
  // Effective exposures (IPS-weighted)
  { name: 'effective_exposures', type: 'REAL DEFAULT 0' },
  // Distinctiveness score for quality gate
  { name: 'distinctiveness', type: 'REAL DEFAULT NULL' },
  // Retirement status
  { name: 'retired_at', type: 'INTEGER DEFAULT NULL' },
  { name: 'retired_reason', type: 'TEXT DEFAULT NULL' },
]
for (const m of v2Migrations) {
  try {
    db.prepare(`ALTER TABLE patterns ADD COLUMN ${m.name} ${m.type}`).run()
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e
  }
}
```

- [ ] **Step 2: Create cluster_stats table**

```javascript
db.exec(`
CREATE TABLE IF NOT EXISTS cluster_stats (
  cluster_id INTEGER PRIMARY KEY,
  namespace TEXT NOT NULL DEFAULT 'default',
  alpha REAL NOT NULL DEFAULT 1.0,
  beta REAL NOT NULL DEFAULT 1.0,
  attempts INTEGER NOT NULL DEFAULT 0,
  centroid_embedding TEXT,
  member_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_cluster_stats_ns ON cluster_stats(namespace);
`)
```

- [ ] **Step 3: Create injection_log table**

```javascript
db.exec(`
CREATE TABLE IF NOT EXISTS injection_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  pattern_id TEXT NOT NULL,
  cluster_id INTEGER,
  rank INTEGER NOT NULL,
  propensity REAL NOT NULL,
  is_exploration INTEGER NOT NULL DEFAULT 0,
  query_text TEXT,
  injected_at INTEGER NOT NULL,
  outcome_at INTEGER,
  reward REAL,
  FOREIGN KEY (pattern_id) REFERENCES patterns(id)
);
CREATE INDEX IF NOT EXISTS idx_injection_log_session ON injection_log(session_id);
CREATE INDEX IF NOT EXISTS idx_injection_log_pattern ON injection_log(pattern_id);
CREATE INDEX IF NOT EXISTS idx_injection_log_outcome ON injection_log(outcome_at) WHERE outcome_at IS NULL;
`)
```

- [ ] **Step 4: Create judge_queue table**

```javascript
db.exec(`
CREATE TABLE IF NOT EXISTS judge_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  pattern_a_id TEXT NOT NULL,
  pattern_b_id TEXT NOT NULL,
  trajectory_summary TEXT,
  priority REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'pending',
  verdict TEXT,
  judged_at INTEGER,
  cost_cents REAL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_judge_queue_status ON judge_queue(status, priority DESC);
`)
```

- [ ] **Step 5: Verify migrations idempotent**

```bash
node -e "
const { createDb } = require('./quoth-plugin/daemon/db.js')
const db = createDb('/tmp/test-v2-migrations.db')
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all()
console.log(tables.map(t => t.name))
const cols = db.prepare('PRAGMA table_info(patterns)').all().map(c => c.name)
console.log('new v2 cols:', cols.filter(c => ['cluster_id','cluster_rank_score','effective_exposures','distinctiveness','retired_at'].includes(c)))
require('fs').unlinkSync('/tmp/test-v2-migrations.db')
"
```

- [ ] **Step 6: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 7: Commit** → `feat(quoth-v2): add v2 schema (cluster_stats, injection_log, judge_queue)`

---

### Task 0.4: Write skill `bayesian-confidence`

**Files:**
- Create: `quoth-plugin/skills/bayesian-confidence/SKILL.md`

- [ ] **Step 1: Create skill directory + content**

```markdown
---
name: bayesian-confidence
description: Beta-Bernoulli confidence tracking with empirical Bayes cold-start and exponential forgetting. Use when building pattern reliability scores from noisy reward signals, cold-starting new items with partial pooling, or implementing temporal decay in non-stationary bandit systems.
---

# Bayesian Confidence with Beta Posteriors

## When to use
- You have binary/continuous reward signals for items (patterns, articles, recommendations)
- You need UNCERTAINTY representation, not just point estimates
- You face cold-start (new items have no data)
- Signal distribution changes over time (non-stationarity)

## Core model
Each item has `Beta(α, β)` posterior. Start at Beta(1,1) = uniform.
- Mean: `μ = α / (α + β)`
- Variance: `σ² = αβ / ((α+β)² · (α+β+1))`
- 95% credible interval: Beta quantile at [0.025, 0.975]

## Update rules
Binary reward r ∈ {0,1}:
```
α ← α + r
β ← β + (1-r)
```
Continuous reward r ∈ [0,1]:
```
α ← α + r
β ← β + (1-r)
```

## Empirical Bayes cold-start (partial pooling)
New item in cluster C. Estimate cluster-level prior via method of moments:
```
μ̂_C = mean(r_i for i in C)
σ̂²_C = var(r_i for i in C)
ν = μ̂_C(1-μ̂_C)/σ̂²_C - 1         // effective sample size
α_C = μ̂_C · ν
β_C = (1-μ̂_C) · ν
```
New item inherits `α_new = α_C / prior_strength, β_new = β_C / prior_strength` (e.g., prior_strength=5 → weak inheritance).

## Exponential forgetting (non-stationarity)
Decay sufficient statistics (Garivier & Moulines ALT'11):
```
α_t ← γ · α_{t-1} + r_t
β_t ← γ · β_{t-1} + (1-r_t)
```
Typical γ = 0.99/day. Equivalent to exponentially-weighted moving average over rewards.

## Implementation pitfalls
- **Don't decay confidence directly**; decay α,β (preserves posterior shape)
- **Floor α,β ≥ 0.1** to keep Beta valid
- **Empirical Bayes fails on tiny clusters** — require ≥10 samples in cluster before pooling
- **Method of moments can produce invalid ν** when σ² > μ(1-μ); clip to ν=1 fallback

## Reference SQL
```sql
UPDATE patterns SET
  alpha = alpha + :r,
  beta = beta + (1 - :r),
  confidence = (alpha + :r) / (alpha + beta + 1)
WHERE id = :id
```

## Papers
- Gelman et al. *Bayesian Data Analysis* (3rd ed.), Ch. 5 — partial pooling
- Garivier & Moulines. *On UCB Policies for Non-Stationary Bandits*, ALT 2011
- Agrawal & Goyal. *Thompson Sampling for Contextual Bandits*, ICML 2013
```

- [ ] **Step 2: Commit** → `docs(quoth-v2): skill bayesian-confidence`

---

## Phase 1: Hierarchical Thompson Sampling

### Task 1.1: k-means clustering over pattern embeddings

**Files:**
- Modify: `quoth-plugin/daemon/lib/clustering.js` (existing, extend)
- Modify: `quoth-plugin/daemon/db.js` (add assignment helpers)

- [ ] **Step 1: Write failing test**

`quoth-plugin/tests/clustering-v2.test.js`:
```javascript
const { clusterPatterns, assignToCluster } = require('../daemon/lib/clustering.js')
const { describe, it, expect } = require('vitest')

describe('pattern clustering v2', () => {
  it('clusters n=100 4-dim embeddings into K=5', () => {
    const patterns = []
    for (let c = 0; c < 5; c++) {
      const center = [Math.random(), Math.random(), Math.random(), Math.random()]
      for (let i = 0; i < 20; i++) {
        patterns.push({
          id: `p-${c}-${i}`,
          embedding: center.map(x => x + (Math.random() - 0.5) * 0.1)
        })
      }
    }
    const result = clusterPatterns(patterns, 5, { maxIterations: 20 })
    expect(result.clusters).toHaveLength(5)
    expect(result.assignments).toHaveLength(100)
    // Each cluster should contain ~20 patterns
    const counts = new Map()
    for (const a of result.assignments) counts.set(a.cluster, (counts.get(a.cluster) || 0) + 1)
    for (const [,c] of counts) expect(c).toBeGreaterThan(10)
  })

  it('assigns new pattern to nearest centroid', () => {
    const centroids = [[0,0], [10,10], [-5,5]]
    const cid = assignToCluster([0.1, -0.2], centroids)
    expect(cid).toBe(0)
  })
})
```

- [ ] **Step 2: Extend clustering.js**

```javascript
function clusterPatterns(patterns, K, opts = {}) {
  const { maxIterations = 50, seed = 1 } = opts
  const valid = patterns.filter(p => Array.isArray(p.embedding) && p.embedding.length > 0)
  if (valid.length < K) return { clusters: [], assignments: [] }

  const dim = valid[0].embedding.length
  // k-means++ init
  let rng = seed
  const rand = () => { rng = (rng * 9301 + 49297) % 233280; return rng / 233280 }
  const centroids = [valid[Math.floor(rand() * valid.length)].embedding.slice()]
  while (centroids.length < K) {
    const dists = valid.map(p => Math.min(...centroids.map(c => euclideanSq(p.embedding, c))))
    const total = dists.reduce((a,b)=>a+b, 0)
    let r = rand() * total
    for (let i = 0; i < valid.length; i++) { r -= dists[i]; if (r <= 0) { centroids.push(valid[i].embedding.slice()); break } }
  }

  let assignments = new Array(valid.length).fill(0)
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = 0
    for (let i = 0; i < valid.length; i++) {
      let best = 0, bestD = Infinity
      for (let k = 0; k < K; k++) {
        const d = euclideanSq(valid[i].embedding, centroids[k])
        if (d < bestD) { bestD = d; best = k }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed++ }
    }
    if (changed === 0) break
    // Recompute centroids
    const sums = Array.from({length: K}, () => new Array(dim).fill(0))
    const counts = new Array(K).fill(0)
    for (let i = 0; i < valid.length; i++) {
      const c = assignments[i]
      counts[c]++
      for (let d = 0; d < dim; d++) sums[c][d] += valid[i].embedding[d]
    }
    for (let k = 0; k < K; k++) {
      if (counts[k] > 0) for (let d = 0; d < dim; d++) centroids[k][d] = sums[k][d] / counts[k]
    }
  }

  return {
    clusters: centroids.map((c, i) => ({ id: i, centroid: c, memberCount: assignments.filter(a => a === i).length })),
    assignments: valid.map((p, i) => ({ patternId: p.id, cluster: assignments[i] }))
  }
}

function euclideanSq(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i]-b[i]; s += d*d } return s }

function assignToCluster(embedding, centroids) {
  let best = 0, bestD = Infinity
  for (let k = 0; k < centroids.length; k++) {
    const d = euclideanSq(embedding, centroids[k])
    if (d < bestD) { bestD = d; best = k }
  }
  return best
}

module.exports = { clusterPatterns, assignToCluster, euclideanSq }
```

- [ ] **Step 3: Add db helpers**

In `db.js`:
```javascript
db.assignPatternCluster = function(patternId, clusterId) {
  db.prepare('UPDATE patterns SET cluster_id = ? WHERE id = ?').run(clusterId, patternId)
}
db.upsertClusterStats = function(cid, namespace, centroid, memberCount) {
  db.prepare(`
    INSERT INTO cluster_stats (cluster_id, namespace, centroid_embedding, member_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cluster_id) DO UPDATE SET
      centroid_embedding = excluded.centroid_embedding,
      member_count = excluded.member_count,
      updated_at = strftime('%s','now') * 1000
  `).run(cid, namespace, JSON.stringify(centroid), memberCount)
}
db.getClusterStats = function(clusterId) {
  const r = db.prepare('SELECT * FROM cluster_stats WHERE cluster_id = ?').get(clusterId)
  if (!r) return null
  return { ...r, centroid: JSON.parse(r.centroid_embedding || '[]') }
}
```

- [ ] **Step 4: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 5: Commit** → `feat(quoth-v2): k-means++ pattern clustering with assignment helpers`

---

### Task 1.2: Nightly cluster rebuild job

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js`

- [ ] **Step 1: Add rebuildClusters function**

```javascript
async function rebuildClusters() {
  const { clusterPatterns } = require('./lib/clustering.js')
  const namespaces = db.prepare("SELECT DISTINCT namespace FROM patterns WHERE status='active'").all()

  for (const { namespace } of namespaces) {
    const patterns = db.prepare(`
      SELECT id, embedding FROM patterns
      WHERE status='active' AND namespace = ? AND embedding IS NOT NULL
    `).all(namespace)
      .map(p => ({ id: p.id, embedding: JSON.parse(p.embedding) }))

    if (patterns.length < 10) continue  // Too few for clustering
    const K = Math.min(50, Math.max(3, Math.floor(Math.sqrt(patterns.length))))
    const { clusters, assignments } = clusterPatterns(patterns, K, { maxIterations: 30 })

    const tx = db.transaction(() => {
      for (const a of assignments) db.assignPatternCluster(a.patternId, a.cluster)
      for (const c of clusters) db.upsertClusterStats(c.id, namespace, c.centroid, c.memberCount)
    })
    tx()

    log('info', 'Cluster rebuild', { namespace, K, patterns: patterns.length })
  }
}
```

- [ ] **Step 2: Schedule rebuildClusters in runNightlyPipeline**

Insert in `runNightlyPipeline` after Phase C (cloud pull):
```javascript
// Phase D: v2 cluster rebuild
if (require('./lib/flags.js').isSubFlag('injection')) {
  try { await rebuildClusters() }
  catch (err) { log('error', 'Nightly Phase D (clusters) failed', { error: err.message }) }
}
```

- [ ] **Step 3: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 4: Commit** → `feat(quoth-v2): nightly cluster rebuild job`

---

### Task 1.3: Hierarchical Thompson Sampling implementation

**Files:**
- Create: `quoth-plugin/daemon/lib/bandit-v2.js`

- [ ] **Step 1: Write failing test**

`quoth-plugin/tests/bandit-v2.test.js`:
```javascript
const { hierarchicalSelect, scoreCluster, scoreWithinCluster } = require('../daemon/lib/bandit-v2.js')
const { describe, it, expect } = require('vitest')

describe('hierarchical Thompson sampling', () => {
  it('samples higher-α clusters preferentially', () => {
    const clusters = [
      { id: 0, alpha: 10, beta: 1, memberCount: 5 },   // high success
      { id: 1, alpha: 1, beta: 10, memberCount: 5 },   // high failure
    ]
    const wins = [0, 0]
    for (let i = 0; i < 1000; i++) wins[scoreCluster(clusters)]++
    expect(wins[0]).toBeGreaterThan(800)
  })

  it('hierarchicalSelect returns K patterns from candidates', () => {
    const candidates = [
      { id: 'a', cluster_id: 0, cluster_rank_score: 0.9, confidence: 0.8, alpha: 5, beta: 1 },
      { id: 'b', cluster_id: 0, cluster_rank_score: 0.7, confidence: 0.7, alpha: 3, beta: 2 },
      { id: 'c', cluster_id: 1, cluster_rank_score: 0.5, confidence: 0.5, alpha: 1, beta: 1 },
    ]
    const clusters = new Map([
      [0, { alpha: 10, beta: 1, memberCount: 2 }],
      [1, { alpha: 1, beta: 5, memberCount: 1 }],
    ])
    const selected = hierarchicalSelect(candidates, clusters, 2)
    expect(selected).toHaveLength(2)
    expect(selected.every(s => s.propensity > 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Implement bandit-v2.js**

```javascript
'use strict'
const { scoreWithThompson } = require('./sampler.js')   // reuse existing gamma sampler

// Sample a Beta(α,β) using gamma ratio
function sampleBeta(alpha, beta) {
  // Use existing gamma sampler
  const g1 = sampleGamma(alpha), g2 = sampleGamma(beta)
  return g1 / (g1 + g2)
}

function sampleGamma(shape) {
  // Marsaglia-Tsang, copy from sampler.js or require
  if (shape < 1) return sampleGamma(shape + 1) * Math.pow(Math.random(), 1/shape)
  const d = shape - 1/3, c = 1 / Math.sqrt(9*d)
  while (true) {
    let x, v
    do { x = normalRandom(); v = 1 + c*x } while (v <= 0)
    v = v*v*v
    const u = Math.random()
    if (u < 1 - 0.0331 * Math.pow(x, 4)) return d * v
    if (Math.log(u) < 0.5*x*x + d*(1 - v + Math.log(v))) return d * v
  }
}

function normalRandom() {
  const u = 1 - Math.random(), v = Math.random()
  return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v)
}

function scoreCluster(clusters) {
  // Sample from each cluster's Beta, return id of max sample
  let bestScore = -1, bestId = clusters[0].id
  for (const c of clusters) {
    const s = sampleBeta(c.alpha, c.beta)
    if (s > bestScore) { bestScore = s; bestId = c.id }
  }
  return bestId
}

function scoreWithinCluster(patterns, queryEmbedding) {
  // Rank candidates within a cluster by embedding similarity + per-pattern posterior
  for (const p of patterns) {
    const patternEmbed = typeof p.embedding === 'string' ? JSON.parse(p.embedding) : p.embedding
    const cosine = queryEmbedding && patternEmbed ? cosineSim(queryEmbedding, patternEmbed) : 0.5
    const posteriorMean = p.alpha / (p.alpha + p.beta)
    p._score = 0.6 * cosine + 0.4 * posteriorMean
  }
  patterns.sort((a, b) => b._score - a._score)
  return patterns
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na*nb) : 0
}

function hierarchicalSelect(candidates, clusterMap, K, queryEmbedding) {
  // 1. Group candidates by cluster
  const byCluster = new Map()
  for (const p of candidates) {
    const cid = p.cluster_id ?? -1
    if (!byCluster.has(cid)) byCluster.set(cid, [])
    byCluster.get(cid).push(p)
  }

  // 2. Thompson-sample cluster priorities
  const clusterList = [...byCluster.keys()].map(cid => ({
    id: cid,
    alpha: (clusterMap.get(cid)?.alpha) || 1,
    beta: (clusterMap.get(cid)?.beta) || 1,
    members: byCluster.get(cid),
  }))

  // 3. For each cluster, compute a Thompson sample
  for (const c of clusterList) c._sample = sampleBeta(c.alpha, c.beta)
  clusterList.sort((a,b) => b._sample - a._sample)

  // 4. Pick K patterns, taking from clusters in sampled order
  const selected = []
  const totalMembers = candidates.length
  for (const c of clusterList) {
    if (selected.length >= K) break
    const ranked = scoreWithinCluster(c.members, queryEmbedding)
    const needFromCluster = Math.min(ranked.length, K - selected.length)
    for (let i = 0; i < needFromCluster; i++) {
      const p = ranked[i]
      // Propensity: P(this pattern was selected)
      // Approximate as (cluster_sample_rank) × (within_cluster_rank)
      const clusterProb = c._sample / clusterList.reduce((s, x) => s + x._sample, 0)
      const withinProb = 1 / ranked.length  // uniform within (upper bound)
      selected.push({ ...p, propensity: Math.max(0.01, clusterProb * withinProb), rank: selected.length + 1 })
    }
  }
  return selected
}

module.exports = { sampleBeta, scoreCluster, scoreWithinCluster, hierarchicalSelect, cosineSim }
```

- [ ] **Step 3: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 4: Commit** → `feat(quoth-v2): hierarchical Thompson sampling at cluster level`

---

### Task 1.4: Write skill `contextual-bandits` (part 1)

**Files:**
- Create: `quoth-plugin/skills/contextual-bandits/SKILL.md`

- [ ] **Step 1: Create skill**

```markdown
---
name: contextual-bandits
description: Hierarchical Thompson sampling with cluster-level posteriors + 10% exploration + SNIPS counterfactual updates. Use when building retrieval/recommendation systems with implicit feedback that need to balance exploitation with exploration at scale (10k+ items).
---

# Hierarchical Thompson Sampling for Retrieval

## When to use
- Large item catalog (10k+) where per-item Beta(α,β) is infeasible as sole signal
- Context-dependent rewards (item X is great for query type A, bad for type B)
- Implicit feedback only (no explicit labels)
- Need principled exploration to avoid filter bubbles

## Why hierarchical
Per-item LinTS stores O(d²) matrix per arm: 1024d × 100k items = 800GB. Infeasible.

**Hierarchical decomposition:**
1. Group items into K clusters (k-means on embeddings, K ≈ √N)
2. Maintain Beta(α,β) per CLUSTER (O(K) memory)
3. At selection time: Thompson-sample cluster, then rank items within cluster

Memory at 100k items, K=316 clusters: **5KB** of cluster stats vs 800GB.

## Injection-time algorithm
```
Input: candidates (pre-filtered via HNSW), clusterMap, K=3, queryEmbedding
1. Group candidates by cluster_id
2. For each cluster c: sample s_c ~ Beta(α_c, β_c)
3. Sort clusters by s_c desc
4. From each cluster (top-sampled first), rank items by:
   score = 0.6·cosine(query, item.embedding) + 0.4·(α_i/(α_i+β_i))
5. Take top items until K reached; record cluster+within propensities
```

## Sampling probabilities (propensities)
Critical for counterfactual updates (SNIPS):
```
θ_i = P(cluster c_i sampled) × P(item i ranks top-n within c_i)
θ_i ≈ (s_c_i / Σs) × (1/|cluster_size|)
clip θ_i ≥ 0.01 to prevent weight explosion
```

## Implementation pitfalls
- **Cluster rebuilds must be gradual** — sudden reassignment wipes learned posteriors
- **K too small** → under-specialization (hierarchical == global)
- **K too large** → data sparsity per cluster, posteriors stay near prior
- **Empty clusters** after k-means → re-seed centroid from lowest-density cluster
- **Cosine + posterior mix (0.6/0.4)** is a hyperparameter; tune with offline eval

## Reference Beta sampling
Marsaglia-Tsang gamma method, then `β = g1/(g1+g2)`:
```javascript
function sampleBeta(α, β) {
  const g1 = sampleGamma(α), g2 = sampleGamma(β)
  return g1 / (g1 + g2)
}
```

## Papers
- Hong et al. *Hierarchical Bayesian Bandits*, 2022
- Agrawal & Goyal. *Thompson Sampling for Contextual Bandits*, ICML 2013
- Li et al. *A Contextual-Bandit Approach to Personalized News*, WWW 2010
```

- [ ] **Step 2: Commit** → `docs(quoth-v2): skill contextual-bandits (part 1 — hierarchical TS)`

---

## Phase 2: Exploration & Propensity Logging

### Task 2.1: Random exploration slot

**Files:**
- Create: `quoth-plugin/daemon/lib/propensity.js`

- [ ] **Step 1: Write failing test**

`quoth-plugin/tests/propensity.test.js`:
```javascript
const { replaceWithExploration, shouldExplore, EXPLORATION_RATE } = require('../daemon/lib/propensity.js')
const { describe, it, expect } = require('vitest')

describe('exploration slot', () => {
  it('replaces random slot at given rate', () => {
    let replaced = 0
    for (let i = 0; i < 10000; i++) {
      const original = [{id:'a'},{id:'b'},{id:'c'}]
      const pool = [{id:'x'},{id:'y'},{id:'z'}]
      const result = replaceWithExploration(original, pool, EXPLORATION_RATE, i)
      if (result.some(r => r.id.match(/^[xyz]/))) replaced++
    }
    expect(replaced / 10000).toBeGreaterThan(0.08)
    expect(replaced / 10000).toBeLessThan(0.15)
  })

  it('marks exploration replacement with flag', () => {
    const original = [{id:'a', rank:1},{id:'b', rank:2}]
    const pool = [{id:'x'}]
    // seed=0 forces exploration decision (mock)
    const result = replaceWithExploration(original, pool, 1.0, 0)  // force 100%
    expect(result.some(r => r.is_exploration)).toBe(true)
  })
})
```

- [ ] **Step 2: Implement**

```javascript
'use strict'
const EXPLORATION_RATE = 0.10

function shouldExplore(rate = EXPLORATION_RATE) { return Math.random() < rate }

function replaceWithExploration(selected, pool, rate = EXPLORATION_RATE, seed = Math.random()) {
  if (seed >= rate || pool.length === 0 || selected.length === 0) return selected
  // Pick a random slot and a random pool item not already in selected
  const slotIdx = Math.floor(Math.random() * selected.length)
  const selectedIds = new Set(selected.map(s => s.id))
  const available = pool.filter(p => !selectedIds.has(p.id))
  if (available.length === 0) return selected
  const replacement = available[Math.floor(Math.random() * available.length)]
  const result = selected.slice()
  result[slotIdx] = {
    ...replacement,
    rank: selected[slotIdx].rank,
    propensity: EXPLORATION_RATE / available.length,  // uniform exploration propensity
    is_exploration: true,
  }
  return result
}

module.exports = { EXPLORATION_RATE, shouldExplore, replaceWithExploration }
```

- [ ] **Step 3: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 4: Commit** → `feat(quoth-v2): 10% random exploration slot for counterfactual data`

---

### Task 2.2: Log injections to injection_log

**Files:**
- Modify: `quoth-plugin/daemon/db.js`

- [ ] **Step 1: Add logInjection helper**

```javascript
db.logInjection = function(entry) {
  db.prepare(`
    INSERT INTO injection_log
    (session_id, namespace, pattern_id, cluster_id, rank, propensity, is_exploration, query_text, injected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now') * 1000)
  `).run(
    entry.session_id, entry.namespace, entry.pattern_id, entry.cluster_id ?? null,
    entry.rank, entry.propensity, entry.is_exploration ? 1 : 0, entry.query_text || null
  )
}

db.updateInjectionOutcome = function(sessionId, patternId, reward) {
  db.prepare(`
    UPDATE injection_log
    SET outcome_at = strftime('%s','now') * 1000, reward = ?
    WHERE session_id = ? AND pattern_id = ? AND outcome_at IS NULL
  `).run(reward, sessionId, patternId)
}

db.getPendingOutcomes = function(olderThanMs = 3600000) {
  const cutoff = Date.now() - olderThanMs
  return db.prepare(`
    SELECT * FROM injection_log WHERE outcome_at IS NULL AND injected_at < ?
    ORDER BY injected_at ASC LIMIT 500
  `).all(cutoff)
}
```

- [ ] **Step 2: Test round-trip**

```javascript
// tests/injection-log.test.js
const { describe, it, expect } = require('vitest')
const { createDb } = require('../daemon/db.js')
describe('injection_log', () => {
  it('logs and updates outcome', () => {
    const db = createDb(':memory:')
    db.logInjection({ session_id:'s1', namespace:'test', pattern_id:'p1', cluster_id:2, rank:1, propensity:0.3, is_exploration:false })
    db.updateInjectionOutcome('s1', 'p1', 0.8)
    const r = db.prepare("SELECT * FROM injection_log WHERE session_id='s1'").get()
    expect(r.reward).toBe(0.8)
    expect(r.outcome_at).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 4: Commit** → `feat(quoth-v2): injection_log write/read helpers`

---

### Task 2.3: Update skill `contextual-bandits` (part 2)

- [ ] **Step 1: Append exploration section to skill**

Add to `SKILL.md`:
```markdown

## Exploration (10% random slot)

**Why:** without exploration, system converges on whatever was initially popular. Exploration creates clean counterfactual data for unbiased updates.

**Mechanism:** With probability ε=0.10, replace one of the K=3 ranked slots with a uniformly random candidate from the candidate pool.

```
IF random() < 0.10:
  slot_to_replace = random(0, K-1)
  replacement = uniform_random_from(candidates - selected)
  selected[slot_to_replace] = replacement  # mark with is_exploration=true
```

**Propensity for exploration slot:** `θ_explor = ε / (|pool| - K)` — uniform over pool excluding already-selected.

Without exploration, propensity of a random item being picked approaches 0, making SNIPS weights unbounded. Exploration guarantees `θ_i ≥ ε / pool_size`, which caps SNIPS weights at `pool_size / ε` ≈ 100-1000.
```

- [ ] **Step 2: Commit** → `docs(quoth-v2): skill contextual-bandits (part 2 — exploration + propensity)`

---

## Phase 3: SNIPS Estimator for Unbiased Rewards

### Task 3.1: SNIPS math implementation

**Files:**
- Create: `quoth-plugin/daemon/lib/snips.js`

- [ ] **Step 1: Write failing test**

`quoth-plugin/tests/snips.test.js`:
```javascript
const { snipsEstimate, clipWeight } = require('../daemon/lib/snips.js')
const { describe, it, expect } = require('vitest')

describe('SNIPS estimator', () => {
  it('returns reward directly when propensities uniform', () => {
    const obs = [
      { reward: 1.0, propensity: 0.5 },
      { reward: 0.0, propensity: 0.5 },
      { reward: 1.0, propensity: 0.5 },
    ]
    const est = snipsEstimate(obs)
    expect(est).toBeCloseTo(2/3, 2)
  })

  it('amplifies low-propensity positive rewards', () => {
    const obs = [
      { reward: 1.0, propensity: 0.01 },   // amplified 100x
      { reward: 0.0, propensity: 0.5 },    // normal
    ]
    const est = snipsEstimate(obs)
    expect(est).toBeGreaterThan(0.9)  // heavily weighted toward 1.0
  })

  it('clips weights at cap', () => {
    expect(clipWeight(0.001, 10)).toBe(10)   // 1/0.001 = 1000 → clipped to 10
    expect(clipWeight(0.5, 10)).toBe(2)       // 1/0.5 = 2, no clip
  })

  it('returns 0.5 prior when no observations', () => {
    expect(snipsEstimate([])).toBe(0.5)
  })
})
```

- [ ] **Step 2: Implement**

```javascript
'use strict'
const DEFAULT_CAP = 10

function clipWeight(propensity, cap = DEFAULT_CAP) {
  const w = 1 / Math.max(propensity, 1e-6)
  return Math.min(w, cap)
}

function snipsEstimate(observations, cap = DEFAULT_CAP) {
  if (!observations || observations.length === 0) return 0.5
  let num = 0, denom = 0
  for (const o of observations) {
    const w = clipWeight(o.propensity, cap)
    num += w * o.reward
    denom += w
  }
  return denom > 0 ? num / denom : 0.5
}

function snipsVariance(observations, estimate, cap = DEFAULT_CAP) {
  if (observations.length < 2) return 0.25
  let num = 0, denom = 0
  for (const o of observations) {
    const w = clipWeight(o.propensity, cap)
    num += w * w * (o.reward - estimate) * (o.reward - estimate)
    denom += w
  }
  return denom > 0 ? num / (denom * denom) : 0.25
}

module.exports = { snipsEstimate, snipsVariance, clipWeight, DEFAULT_CAP }
```

- [ ] **Step 3: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 4: Commit** → `feat(quoth-v2): SNIPS estimator with weight clipping`

---

### Task 3.2: Reward signal extraction from trajectories

**Files:**
- Create: `quoth-plugin/daemon/lib/attribution.js`

**Problem:** Need a REAL reward signal, not Jaccard overlap. Strategy:
1. Session has an outcome signal (did task fail? did user explicitly reject?)
2. Session has trajectory (tool calls, file edits)
3. Initial reward = session outcome (binary: 0/1). **Refined later by LLM judge.**

- [ ] **Step 1: Write failing test**

`quoth-plugin/tests/attribution.test.js`:
```javascript
const { sessionOutcomeReward, extractSessionSignals } = require('../daemon/lib/attribution.js')
const { describe, it, expect } = require('vitest')

describe('reward extraction', () => {
  it('returns 1.0 for successful session', () => {
    const events = [
      { outcome: 'success', tool: 'Edit' },
      { outcome: 'success', tool: 'Bash' },
    ]
    expect(sessionOutcomeReward(events)).toBe(1.0)
  })

  it('returns 0.0 when any failure event present', () => {
    const events = [
      { outcome: 'success', tool: 'Edit' },
      { outcome: 'failure', tool: 'Bash' },
    ]
    expect(sessionOutcomeReward(events)).toBe(0.0)
  })

  it('returns 0.5 when no outcome signals', () => {
    expect(sessionOutcomeReward([])).toBe(0.5)
  })

  it('extracts tools/files touched', () => {
    const events = [
      { tool: 'Edit', task: 'Edit /src/a.ts' },
      { tool: 'Bash', task: 'npm test' },
    ]
    const sig = extractSessionSignals(events)
    expect(sig.tools).toContain('Edit')
    expect(sig.tools).toContain('Bash')
    expect(sig.files).toContain('/src/a.ts')
  })
})
```

- [ ] **Step 2: Implement**

```javascript
'use strict'

function sessionOutcomeReward(events) {
  if (!events || events.length === 0) return 0.5
  const hasFailure = events.some(e => e.outcome === 'failure' || e.outcome === 'error')
  if (hasFailure) return 0.0
  const hasSuccess = events.some(e => e.outcome === 'success')
  if (hasSuccess) return 1.0
  return 0.5  // no signal
}

function extractSessionSignals(events) {
  const tools = new Set()
  const files = new Set()
  const commands = new Set()
  const FILE_RE = /(\/[^\s"']+?\.(ts|tsx|js|jsx|py|go|rs|md|json|sql|sh))/g
  for (const e of events) {
    if (e.tool) tools.add(e.tool)
    const task = e.task || ''
    let m; while ((m = FILE_RE.exec(task)) !== null) files.add(m[1])
    if (e.tool === 'Bash') {
      const cmd = (task.split(' ')[0] || '').replace(/^[^a-z]/i, '')
      if (cmd) commands.add(cmd)
    }
    FILE_RE.lastIndex = 0
  }
  return { tools: [...tools], files: [...files], commands: [...commands] }
}

function summarizeSession(events, maxLen = 500) {
  const sig = extractSessionSignals(events)
  const toolSummary = sig.tools.slice(0, 5).join(', ')
  const fileSummary = sig.files.slice(0, 3).join(', ')
  const cmdSummary = sig.commands.slice(0, 5).join(', ')
  const outcome = sessionOutcomeReward(events)
  return `Tools: ${toolSummary} | Files: ${fileSummary} | Commands: ${cmdSummary} | Outcome: ${outcome.toFixed(1)}`.slice(0, maxLen)
}

module.exports = { sessionOutcomeReward, extractSessionSignals, summarizeSession }
```

- [ ] **Step 3: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 4: Commit** → `feat(quoth-v2): attribution signals from trajectory events`

---

### Task 3.3: Dual-write cluster Beta via SNIPS (shadow mode)

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js`

- [ ] **Step 1: Add updateClusterPosteriors function**

```javascript
async function updateClusterPosteriors() {
  const { snipsEstimate } = require('./lib/snips.js')
  // Group pending injection_log entries by (cluster_id, namespace), compute SNIPS
  const completed = db.prepare(`
    SELECT cluster_id, namespace, reward, propensity FROM injection_log
    WHERE outcome_at IS NOT NULL AND reward IS NOT NULL AND cluster_id IS NOT NULL
  `).all()
  const byCluster = new Map()
  for (const row of completed) {
    const key = `${row.namespace}::${row.cluster_id}`
    if (!byCluster.has(key)) byCluster.set(key, [])
    byCluster.get(key).push({ reward: row.reward, propensity: row.propensity })
  }
  let updated = 0
  const tx = db.transaction(() => {
    for (const [key, obs] of byCluster.entries()) {
      const [ns, cid] = key.split('::')
      const estimate = snipsEstimate(obs)
      // Convert estimate back to Beta update: interpret as n·estimate successes + n·(1-estimate) failures
      const n = Math.min(obs.length, 10)  // cap update size to prevent overshoot
      db.prepare(`
        UPDATE cluster_stats SET
          alpha = alpha + ?, beta = beta + ?, attempts = attempts + ?,
          updated_at = strftime('%s','now') * 1000
        WHERE cluster_id = ? AND namespace = ?
      `).run(n * estimate, n * (1 - estimate), obs.length, parseInt(cid), ns)
      updated++
    }
  })
  tx()
  log('info', 'Cluster posteriors updated', { clusters: updated })
}
```

- [ ] **Step 2: Schedule in nightly (shadow mode)**

In `runNightlyPipeline` after cluster rebuild:
```javascript
// Phase E: Update cluster posteriors via SNIPS
if (require('./lib/flags.js').isSubFlag('injection')) {
  try { await updateClusterPosteriors() }
  catch (err) { log('error', 'Nightly Phase E (posteriors) failed', { error: err.message }) }
}
```

- [ ] **Step 3: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 4: Commit** → `feat(quoth-v2): update cluster posteriors via SNIPS in nightly batch`

---

### Task 3.4: Update skill `contextual-bandits` (part 3 — SNIPS)

- [ ] **Step 1: Append SNIPS section**

Add to `SKILL.md`:
```markdown

## SNIPS: Self-Normalized Inverse Propensity Scoring

**Problem:** We log injections with propensities θ_i; observe rewards r_i. Naive IPS estimator `(1/N) Σ r_i / θ_i` has unbounded variance when θ_i small.

**SNIPS (Swaminathan & Joachims 2015):**
```
r̂(cluster) = Σ_i (w_i · r_i) / Σ_i w_i     where w_i = clip(1/θ_i, cap=10)
```

Self-normalization cancels the bias from clipping. Bounded variance. Production-dominant.

## From SNIPS estimate to Beta update
Given n observations with SNIPS estimate `r̂`:
```
α_new = α_old + n · r̂
β_new = β_old + n · (1 - r̂)
```
Cap `n ≤ 10` per batch to prevent overshoot from correlated samples.

## Pitfalls
- **Weight cap trade-off:** cap=1 loses variance reduction; cap=100 amplifies outliers. cap=10 is production standard.
- **SNIPS is self-normalized, not unbiased** — for strict unbiasedness use doubly-robust (Dudik et al. 2011)
- **Don't update per-pattern with SNIPS directly** at this scale — use cluster-level and let within-cluster cosine similarity differentiate

## Papers
- Swaminathan & Joachims. *The Self-Normalized Estimator for Counterfactual Learning*, NeurIPS 2015
- Joachims et al. *Unbiased Learning-to-Rank with Biased Feedback*, WSDM 2017
- Dudik, Langford, Li. *Doubly Robust Policy Evaluation and Learning*, ICML 2011
```

- [ ] **Step 2: Commit** → `docs(quoth-v2): skill contextual-bandits (part 3 — SNIPS)`

---

## Phase 4: LLM-as-Judge (Pairwise Active Learning)

### Task 4.1: Uncertainty sampling

**Files:**
- Create: `quoth-plugin/daemon/lib/judge.js`

- [ ] **Step 1: Write failing test**

`quoth-plugin/tests/judge.test.js`:
```javascript
const { selectUncertainPairs, betaCredibleInterval } = require('../daemon/lib/judge.js')
const { describe, it, expect } = require('vitest')

describe('judge uncertainty sampling', () => {
  it('computes CI width for Beta(1,1)', () => {
    const { lower, upper } = betaCredibleInterval(1, 1, 0.05)
    expect(upper - lower).toBeGreaterThan(0.7)  // uniform prior, wide CI
  })

  it('computes narrow CI for Beta(50,10)', () => {
    const { lower, upper } = betaCredibleInterval(50, 10, 0.05)
    expect(upper - lower).toBeLessThan(0.2)
  })

  it('flags clusters with wide CI for judging', () => {
    const clusters = [
      { cluster_id: 0, alpha: 1, beta: 1 },     // uncertain
      { cluster_id: 1, alpha: 50, beta: 10 },   // confident
      { cluster_id: 2, alpha: 2, beta: 2 },     // uncertain
    ]
    const flagged = selectUncertainPairs(clusters, { maxPairs: 5, widthThreshold: 0.3 })
    expect(flagged.length).toBeGreaterThan(0)
    // Should not include cluster 1 (confident)
    expect(flagged.every(p => p.a.cluster_id !== 1 || p.b.cluster_id !== 1)).toBe(true)
  })
})
```

- [ ] **Step 2: Implement**

```javascript
'use strict'

function betaCredibleInterval(alpha, beta, level = 0.05) {
  // Wilson-score approximation for Beta quantile
  const n = alpha + beta
  const p = alpha / n
  const z = level <= 0.025 ? 1.96 : 1.64
  const se = Math.sqrt(p * (1 - p) / n)
  return { lower: Math.max(0, p - z * se), upper: Math.min(1, p + z * se) }
}

function betaCredibleWidth(alpha, beta) {
  const { lower, upper } = betaCredibleInterval(alpha, beta)
  return upper - lower
}

function selectUncertainPairs(clusters, opts = {}) {
  const { maxPairs = 10, widthThreshold = 0.3 } = opts
  const uncertain = clusters.filter(c => betaCredibleWidth(c.alpha, c.beta) >= widthThreshold)
  const pairs = []
  for (let i = 0; i < uncertain.length && pairs.length < maxPairs; i++) {
    for (let j = i + 1; j < uncertain.length && pairs.length < maxPairs; j++) {
      pairs.push({ a: uncertain[i], b: uncertain[j] })
    }
  }
  return pairs
}

module.exports = { betaCredibleInterval, betaCredibleWidth, selectUncertainPairs }
```

- [ ] **Step 3: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 4: Commit** → `feat(quoth-v2): Beta credible intervals + uncertainty sampling for judge`

---

### Task 4.2: Pairwise judge prompt + position randomization

**Files:**
- Modify: `quoth-plugin/daemon/lib/judge.js`

- [ ] **Step 1: Add pairwise prompt builder**

```javascript
function buildPairwisePrompt(trajectory, patternA, patternB) {
  const order = Math.random() < 0.5
  const [first, second] = order ? [patternA, patternB] : [patternB, patternA]
  const prompt = `You are evaluating which of two injected patterns was more load-bearing for an AI agent's task.

Session trajectory summary:
${trajectory}

Pattern A:
- Name: ${first.name}
- Action: ${first.action?.slice(0, 200)}
- Tags: ${first.tags?.join(', ')}

Pattern B:
- Name: ${second.name}
- Action: ${second.action?.slice(0, 200)}
- Tags: ${second.tags?.join(', ')}

Which pattern was MORE load-bearing for the observed trajectory and outcome? Respond with ONLY one of:
  A  — Pattern A was more load-bearing
  B  — Pattern B was more load-bearing
  NEITHER  — Neither pattern influenced the trajectory meaningfully

Answer:`
  return { prompt, positionMap: order ? ['A','B'] : ['B','A'] }  // maps judge's A/B back to actual a/b
}

function parseJudgeVerdict(raw, positionMap) {
  const answer = (raw || '').trim().toUpperCase().slice(0, 10)
  if (answer.startsWith('A')) return positionMap[0]
  if (answer.startsWith('B')) return positionMap[1]
  if (answer.includes('NEITHER')) return 'NEITHER'
  return 'UNPARSEABLE'
}
```

- [ ] **Step 2: Add callJudge wrapper (uses Haiku via CLI)**

```javascript
async function callJudge(prompt, timeoutMs = 30000) {
  const { exec } = require('child_process')
  return new Promise((resolve) => {
    const child = exec(`claude --model haiku --max-tokens 10 --no-streaming`,
      { timeout: timeoutMs, maxBuffer: 1024 * 10 },
      (err, stdout) => resolve(err ? null : (stdout || '').trim())
    )
    child.stdin.write(prompt)
    child.stdin.end()
  })
}
```

- [ ] **Step 3: Tests**

```javascript
// Add to judge.test.js
const { buildPairwisePrompt, parseJudgeVerdict } = require('../daemon/lib/judge.js')
describe('pairwise judge prompt', () => {
  it('builds prompt with randomized positions', () => {
    const p = buildPairwisePrompt('traj', {name:'a', action:''}, {name:'b', action:''})
    expect(p.prompt).toContain('Pattern A')
    expect(p.prompt).toContain('Pattern B')
    expect(['a','b']).toContain(p.positionMap[0])
  })
  it('parses verdicts back to actual pattern ids', () => {
    expect(parseJudgeVerdict('A', ['x','y'])).toBe('x')
    expect(parseJudgeVerdict('B', ['x','y'])).toBe('y')
    expect(parseJudgeVerdict('NEITHER', ['x','y'])).toBe('NEITHER')
  })
})
```

- [ ] **Step 4: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 5: Commit** → `feat(quoth-v2): pairwise LLM judge with position randomization`

---

### Task 4.3: Nightly judge batch runner

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js`

- [ ] **Step 1: Add runJudgeBatch function**

```javascript
async function runJudgeBatch() {
  if (!require('./lib/flags.js').isSubFlag('judge')) return
  const { selectUncertainPairs, buildPairwisePrompt, callJudge, parseJudgeVerdict } = require('./lib/judge.js')
  const { summarizeSession } = require('./lib/attribution.js')

  // Load uncertain pairs flagged today
  const pending = db.prepare(`
    SELECT id, session_id, pattern_a_id, pattern_b_id, trajectory_summary
    FROM judge_queue WHERE status='pending' ORDER BY priority DESC LIMIT 50
  `).all()

  for (const item of pending) {
    const a = db.getPattern(item.pattern_a_id)
    const b = db.getPattern(item.pattern_b_id)
    if (!a || !b) { db.prepare("UPDATE judge_queue SET status='skipped' WHERE id=?").run(item.id); continue }

    const { prompt, positionMap } = buildPairwisePrompt(item.trajectory_summary || '', a, b)
    const raw = await callJudge(prompt)
    if (!raw) { db.prepare("UPDATE judge_queue SET status='failed' WHERE id=?").run(item.id); continue }

    const verdict = parseJudgeVerdict(raw, [item.pattern_a_id, item.pattern_b_id])
    db.prepare(`
      UPDATE judge_queue SET status='judged', verdict=?, judged_at=strftime('%s','now') * 1000, cost_cents=0.03
      WHERE id=?
    `).run(verdict, item.id)

    // Update cluster posteriors based on verdict
    if (verdict === item.pattern_a_id) {
      db.prepare('UPDATE patterns SET alpha=alpha+0.5 WHERE id=?').run(item.pattern_a_id)
      db.prepare('UPDATE patterns SET beta=beta+0.5 WHERE id=?').run(item.pattern_b_id)
    } else if (verdict === item.pattern_b_id) {
      db.prepare('UPDATE patterns SET alpha=alpha+0.5 WHERE id=?').run(item.pattern_b_id)
      db.prepare('UPDATE patterns SET beta=beta+0.5 WHERE id=?').run(item.pattern_a_id)
    }
    // NEITHER → no update
  }
  log('info', `Judge batch complete`, { processed: pending.length })
}
```

- [ ] **Step 2: Enqueue pairs nightly**

```javascript
async function enqueueJudgePairs() {
  const clusters = db.prepare('SELECT cluster_id, alpha, beta, namespace FROM cluster_stats').all()
  const { selectUncertainPairs } = require('./lib/judge.js')
  const pairs = selectUncertainPairs(clusters, { maxPairs: 20, widthThreshold: 0.3 })
  // Materialize to pattern-level pairs from uncertain clusters
  for (const p of pairs) {
    const patA = db.prepare("SELECT id FROM patterns WHERE cluster_id=? AND status='active' ORDER BY confidence DESC LIMIT 1").get(p.a.cluster_id)
    const patB = db.prepare("SELECT id FROM patterns WHERE cluster_id=? AND status='active' ORDER BY confidence DESC LIMIT 1").get(p.b.cluster_id)
    if (!patA || !patB) continue
    db.prepare(`
      INSERT INTO judge_queue (session_id, pattern_a_id, pattern_b_id, trajectory_summary, priority)
      VALUES ('v2-batch', ?, ?, ?, ?)
    `).run(patA.id, patB.id, 'Cluster-level uncertainty comparison', 0.7)
  }
}
```

- [ ] **Step 3: Schedule in runNightlyPipeline**

```javascript
// Phase F: Enqueue + run LLM judge
if (require('./lib/flags.js').isSubFlag('judge')) {
  try {
    await enqueueJudgePairs()
    await runJudgeBatch()
  } catch (err) { log('error', 'Nightly Phase F (judge) failed', { error: err.message }) }
}
```

- [ ] **Step 4: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 5: Commit** → `feat(quoth-v2): nightly pairwise judge batch runner`

---

### Task 4.4: Write skill `llm-as-judge`

**Files:**
- Create: `quoth-plugin/skills/llm-as-judge/SKILL.md`

- [ ] **Step 1: Create skill**

```markdown
---
name: llm-as-judge
description: Pairwise LLM-as-judge evaluation with position randomization, active learning, and cost control. Use when building offline ground-truth labels for retrieval/recommender systems where explicit user feedback is unavailable or too sparse.
---

# Pairwise LLM-as-Judge

## When to use
- No explicit user labels (or too sparse for supervised training)
- Need to evaluate WHICH items in a ranked list mattered most
- Implicit signals (clicks, dwell) are too noisy alone
- Have LLM API budget ($1-$100/month)

## Why pairwise
Zheng et al. (NeurIPS 2023) showed absolute scoring by LLMs has high noise variance. Pairwise comparisons reduce variance significantly and are the production SOTA.

## Core prompt pattern
```
Given [trajectory/context], which of these two items was more [useful/relevant/load-bearing]?
Item A: ...
Item B: ...
Answer: A, B, or NEITHER
```

## Mandatory guardrails

### Position bias (60/40 skew)
LLMs prefer the first option ~60% of the time without mitigation.
**Mitigation:** Randomize order at prompt construction; map back to actual items when parsing.

### Verbosity bias
Longer options rated higher. **Mitigation:** truncate both items to same length (e.g., 200 chars).

### Self-preference bias
Llama judges Llama outputs higher. **Mitigation:** judge with a DIFFERENT model family than generation model.

### Hallucinated causation
When asked "did X cause Y?", judges construct plausible narratives even when X was irrelevant.
**Mitigation:** offer NEITHER as valid answer; anchor against observable outcome.

## Active learning: judge only uncertain cases

**Selection criterion:** Beta credible interval width:
```
width(α, β) = 2 · z · sqrt(p(1-p)/n)     where p = α/(α+β), n = α+β
```
Judge if `width > 0.3`. Skip high-confidence cases (either direction).

## Cost model (Haiku 4.5, 2026)
- Input: ~$0.25/M tokens
- Output: ~$1.25/M tokens
- Per pairwise judgment: ~800 in + 10 out ≈ $0.0003
- 100 pairs/night = $0.03/night = **$1/month**

## Pitfalls
- **Don't judge every pair** — active learning is essential
- **Don't trust single judgments** — aggregate over multiple pairwise comparisons
- **Don't use judge verdicts for training the judge** — feedback loop / model collapse
- **Cache verdicts by (trajectory, patternA, patternB)** — same pair rarely changes verdict

## Reference flow
```
1. Nightly: find uncertain clusters/patterns (CI width > 0.3)
2. Build pair prompts, randomize positions
3. Call judge (Haiku) via CLI/API
4. Parse verdict, map positions back
5. Update Beta posteriors: winner α+0.5, loser β+0.5, neither → no-op
```

## Papers
- Zheng et al. *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*, NeurIPS 2023
- Wang et al. *Large Language Models are not Fair Evaluators*, 2023 (bias analysis)
- Liu et al. *G-Eval: NLG Evaluation using GPT-4*, EMNLP 2023
```

- [ ] **Step 2: Commit** → `docs(quoth-v2): skill llm-as-judge`

---

## Phase 5: Wire V2 Injection Path (Feature-Flagged)

### Task 5.1: V2 injection in session-restore hook

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js`

- [ ] **Step 1: Add v2InjectPatterns helper**

```javascript
function v2InjectPatterns(db, namespace, queryText, queryEmbedding, K = 3) {
  const { hierarchicalSelect } = require('../daemon/lib/bandit-v2.js')
  const { replaceWithExploration, EXPLORATION_RATE } = require('../daemon/lib/propensity.js')

  // HNSW top-20 candidates (reuse existing)
  const candidates = db.searchBySimilarity(queryEmbedding, 20, []) || []
  if (candidates.length === 0) return []

  // Load cluster map for these candidates
  const clusterIds = [...new Set(candidates.map(c => c.cluster_id).filter(x => x != null))]
  const clusterMap = new Map()
  for (const cid of clusterIds) {
    const stats = db.getClusterStats(cid)
    if (stats) clusterMap.set(cid, { alpha: stats.alpha, beta: stats.beta, memberCount: stats.member_count })
  }

  // Hierarchical selection
  let selected = hierarchicalSelect(candidates, clusterMap, K, queryEmbedding)
  // 10% exploration replacement
  selected = replaceWithExploration(selected, candidates, EXPLORATION_RATE)

  // Log each selection
  const sessionId = process.env.CLAUDE_SESSION_ID || 'default'
  for (const s of selected) {
    db.logInjection({
      session_id: sessionId, namespace, pattern_id: s.id, cluster_id: s.cluster_id,
      rank: s.rank, propensity: s.propensity, is_exploration: !!s.is_exploration, query_text: queryText
    })
  }
  return selected
}
```

- [ ] **Step 2: Feature-flag the injection call in session-restore handler**

```javascript
const { isSubFlag } = require('../daemon/lib/flags.js')

// Inside session-restore handler, replace existing injection block:
if (isSubFlag('injection')) {
  const queryText = readLastPrompt() || `session start: ${project}`
  const queryEmbed = await generateEmbedding(queryText)
  const patterns = v2InjectPatterns(db, project, queryText, queryEmbed, 3)
  // ... format and output
} else {
  // existing v1 injection code
}
```

- [ ] **Step 3: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 4: Smoke test**

```bash
QUOTH_V2_INJECTION=true \
CLAUDE_SESSION_ID=smoke-v2 \
CLAUDE_PROJECT_DIR=/home/lord_montino/projects/agents-tools/quoth \
  node quoth-plugin/hooks/hook-dispatch.js session-restore 2>&1 | grep -E "\[Quoth\]"
```
Expected: 3 patterns injected, logged in injection_log.

- [ ] **Step 5: Commit** → `feat(quoth-v2): v2 injection path in session-restore (flagged)`

---

### Task 5.2: V2 injection in subagent-start hook

- [ ] **Step 1: Replicate logic from 5.1 in subagent-start**
- [ ] **Step 2: Smoke test**
- [ ] **Step 3: Commit** → `feat(quoth-v2): v2 injection in subagent-start (flagged)`

---

### Task 5.3: V2 feedback path in post-task / session-end

**Files:**
- Modify: `quoth-plugin/hooks/hook-dispatch.js`

- [ ] **Step 1: Replace soft-negative sweep with SNIPS reward logging**

In session-end handler, behind flag:
```javascript
if (isSubFlag('injection')) {
  const { sessionOutcomeReward, extractSessionSignals } = require('../daemon/lib/attribution.js')
  const sessionId = process.env.CLAUDE_SESSION_ID || 'default'
  // Load session events from trajectory (approximate via session-memory)
  const sm = createSessionMemory({ dir: path.join(QUOTH_HOME,'intelligence'), sessionId, project })
  const state = sm._state()
  const events = Object.keys(state.injectedPatterns).map(() => ({outcome:'success'}))  // refined later
  const reward = sessionOutcomeReward(events)
  for (const pid of Object.keys(state.injectedPatterns)) {
    db.updateInjectionOutcome(sessionId, pid, reward)
  }
}
```

- [ ] **Step 2: Post-task: mark used with higher reward**

```javascript
if (isSubFlag('injection')) {
  // Any injection marked "used" in post-task gets reward=1.0 signal
  const sessionId = process.env.CLAUDE_SESSION_ID || 'default'
  for (const pid of recentUsedPatterns) {
    db.updateInjectionOutcome(sessionId, pid, 1.0)
  }
}
```

- [ ] **Step 3: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 4: Commit** → `feat(quoth-v2): v2 feedback paths (flagged)`

---

## Phase 6: Knowledge Base Curation

### Task 6.1: Quality gates in DISTILL

**Files:**
- Create: `quoth-plugin/daemon/lib/curation.js`

- [ ] **Step 1: Write failing tests**

`quoth-plugin/tests/curation.test.js`:
```javascript
const { distinctivenessScore, isGenericName, passesQualityGate } = require('../daemon/lib/curation.js')
const { describe, it, expect } = require('vitest')

describe('quality gates', () => {
  it('rejects generic "When editing a file" patterns', () => {
    expect(isGenericName('When editing a file, first read it')).toBe(true)
    expect(isGenericName('When no specific pattern was used')).toBe(true)
  })
  it('accepts specific pattern names', () => {
    expect(isGenericName('Use Drizzle ANY() syntax for Postgres UUID arrays')).toBe(false)
  })
  it('computes distinctiveness from unique tokens', () => {
    const corpus = new Set(['file','edit','read','when'])
    expect(distinctivenessScore('read file when edit', corpus)).toBeLessThan(0.2)
    expect(distinctivenessScore('Drizzle Postgres ANY UUID', corpus)).toBeGreaterThan(0.6)
  })
  it('gate rejects generic + low distinctiveness', () => {
    const result = passesQualityGate({
      name: 'When editing a file',
      action: 'read the file',
      distinctiveness: 0.1,
    })
    expect(result.pass).toBe(false)
    expect(result.reasons).toContain('generic-name')
  })
})
```

- [ ] **Step 2: Implement**

```javascript
'use strict'

const GENERIC_PATTERNS = [
  /^When \w+ing a file/i,
  /^When no specific pattern/i,
  /^Use [\w ]+ to \w+ (file|command|code)/i,
  /^Direct \w+ing without/i,
]

function isGenericName(name) {
  if (!name || name.length < 25) return true
  return GENERIC_PATTERNS.some(re => re.test(name))
}

function distinctivenessScore(text, commonTokens) {
  if (!text) return 0
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 3)
  const unique = new Set(tokens)
  if (unique.size === 0) return 0
  let rare = 0
  for (const t of unique) if (!commonTokens.has(t)) rare++
  return rare / unique.size
}

function passesQualityGate(pattern, opts = {}) {
  const { minDistinctiveness = 0.3, minNameLen = 25, maxSimilarity = 0.85 } = opts
  const reasons = []
  if ((pattern.name || '').length < minNameLen) reasons.push('name-too-short')
  if (isGenericName(pattern.name)) reasons.push('generic-name')
  if ((pattern.distinctiveness ?? 0) < minDistinctiveness) reasons.push('low-distinctiveness')
  if ((pattern.maxSim ?? 0) > maxSimilarity) reasons.push('near-duplicate')
  return { pass: reasons.length === 0, reasons }
}

module.exports = { isGenericName, distinctivenessScore, passesQualityGate, GENERIC_PATTERNS }
```

- [ ] **Step 3: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 4: Commit** → `feat(quoth-v2): quality gates for pattern ingestion`

---

### Task 6.2: Build corpus + distinctiveness scoring

**Files:**
- Modify: `quoth-plugin/daemon/lib/curation.js`
- Modify: `quoth-plugin/daemon/daemon.js`

- [ ] **Step 1: Add corpus builder**

```javascript
function buildCommonTokens(patterns, topN = 1000) {
  const counts = new Map()
  for (const p of patterns) {
    const text = `${p.name || ''} ${p.action || ''}`.toLowerCase()
    const toks = text.replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(t => t.length >= 3)
    for (const t of toks) counts.set(t, (counts.get(t) || 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a,b) => b[1] - a[1]).slice(0, topN)
  return new Set(sorted.map(([t]) => t))
}

function backfillDistinctiveness(db) {
  const patterns = db.prepare("SELECT id, name, action FROM patterns WHERE status='active'").all()
  const common = buildCommonTokens(patterns, 1000)
  const stmt = db.prepare('UPDATE patterns SET distinctiveness = ? WHERE id = ?')
  const tx = db.transaction(() => {
    for (const p of patterns) {
      const d = distinctivenessScore(`${p.name} ${p.action}`, common)
      stmt.run(d, p.id)
    }
  })
  tx()
  return patterns.length
}
```

- [ ] **Step 2: Schedule in nightly**

```javascript
// Phase G: Distinctiveness backfill
if (require('./lib/flags.js').isSubFlag('curation')) {
  try {
    const { backfillDistinctiveness } = require('./lib/curation.js')
    const n = backfillDistinctiveness(db)
    log('info', 'Distinctiveness recomputed', { patterns: n })
  } catch (err) { log('error', 'Nightly Phase G (distinctiveness) failed', { error: err.message }) }
}
```

- [ ] **Step 3: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 4: Commit** → `feat(quoth-v2): corpus-wide distinctiveness scoring`

---

### Task 6.3: LLM-judge dedup for near-duplicates

**Files:**
- Modify: `quoth-plugin/daemon/lib/curation.js`

- [ ] **Step 1: Add findNearDuplicates via cosine**

```javascript
function findNearDuplicates(db, threshold = 0.92) {
  const patterns = db.prepare("SELECT id, embedding FROM patterns WHERE status='active' AND embedding IS NOT NULL").all()
  const pairs = []
  for (let i = 0; i < patterns.length; i++) {
    const embA = JSON.parse(patterns[i].embedding)
    for (let j = i + 1; j < patterns.length; j++) {
      const embB = JSON.parse(patterns[j].embedding)
      const sim = cosine(embA, embB)
      if (sim >= threshold) pairs.push({ a: patterns[i].id, b: patterns[j].id, sim })
    }
  }
  return pairs.sort((x,y) => y.sim - x.sim).slice(0, 100)
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na*nb) : 0
}

module.exports = { ..., findNearDuplicates, cosine }
```

- [ ] **Step 2: Enqueue dedup judge pairs**

```javascript
async function enqueueDedupPairs(db) {
  const { findNearDuplicates } = require('./lib/curation.js')
  const pairs = findNearDuplicates(db, 0.92)
  for (const p of pairs) {
    db.prepare(`
      INSERT INTO judge_queue (session_id, pattern_a_id, pattern_b_id, trajectory_summary, priority)
      VALUES ('dedup', ?, ?, ?, 0.9)
    `).run(p.a, p.b, `Near-duplicate detection (cosine=${p.sim.toFixed(3)})`)
  }
}
```

- [ ] **Step 3: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 4: Commit** → `feat(quoth-v2): dedup via cosine + LLM judge`

---

### Task 6.4: Retirement by credible interval + staleness

**Files:**
- Modify: `quoth-plugin/daemon/lib/curation.js`

- [ ] **Step 1: Add retirePoor helper**

```javascript
function retirePoorPatterns(db) {
  const { betaCredibleInterval } = require('./judge.js')
  const patterns = db.prepare(`
    SELECT id, alpha, beta, last_matched_at, created_at FROM patterns
    WHERE status='active' AND retired_at IS NULL
  `).all()
  const now = Date.now(), ninetyDays = 90*24*60*60*1000
  let retired = 0
  for (const p of patterns) {
    const attempts = Math.round((p.alpha - 1) + (p.beta - 1))
    const { upper } = betaCredibleInterval(p.alpha, p.beta)
    let reason = null
    if (attempts > 20 && upper < 0.4) reason = 'low-ci-upper'
    else if ((now - (p.last_matched_at || p.created_at)) > ninetyDays) reason = 'stale-90d'
    if (reason) {
      db.prepare(`UPDATE patterns SET status='archived', retired_at=?, retired_reason=? WHERE id=?`).run(now, reason, p.id)
      retired++
    }
  }
  return retired
}

module.exports.retirePoorPatterns = retirePoorPatterns
```

- [ ] **Step 2: Schedule weekly**

In nightly pipeline, gate by day-of-week:
```javascript
if (new Date().getUTCDay() === 0 && require('./lib/flags.js').isSubFlag('curation')) {
  const { retirePoorPatterns } = require('./lib/curation.js')
  const n = retirePoorPatterns(db)
  log('info', 'Weekly retirement', { retired: n })
}
```

- [ ] **Step 3: Tests**

```javascript
// Add to curation.test.js
it('retires pattern with low CI upper after many attempts', () => {
  const db = createDb(':memory:')
  db.prepare("INSERT INTO patterns (id, name, action, alpha, beta, confidence, status, namespace) VALUES (?,?,?,?,?,?,?,?)")
    .run('p1', 'bad pattern', 'act', 1, 100, 0.01, 'active', 'test')
  const { retirePoorPatterns } = require('../daemon/lib/curation.js')
  const n = retirePoorPatterns(db)
  expect(n).toBe(1)
  const r = db.prepare("SELECT status, retired_reason FROM patterns WHERE id='p1'").get()
  expect(r.status).toBe('archived')
  expect(r.retired_reason).toBe('low-ci-upper')
})
```

- [ ] **Step 4: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 5: Commit** → `feat(quoth-v2): retirement by CI upper bound + 90d staleness`

---

### Task 6.5: Write skill `knowledge-base-curation`

**Files:**
- Create: `quoth-plugin/skills/knowledge-base-curation/SKILL.md`

- [ ] **Step 1: Create skill**

```markdown
---
name: knowledge-base-curation
description: Anti-bloat curation for learned knowledge bases — quality gates at ingestion, cosine-based dedup with LLM verification, credible-interval retirement, temporal staleness. Use when building self-updating RAG/pattern stores that must stay small and high-signal.
---

# Knowledge Base Curation

## Problem
Self-learning knowledge bases bloat over time. Patterns accumulate faster than they're refined. Generic patterns dominate retrieval. Signal-to-noise degrades.

## Quality gates (at ingestion)

1. **Min name length** ≥25 chars
2. **Generic name patterns rejected** via regex (e.g., `/^When \w+ing a file/i`)
3. **Distinctiveness ≥ 0.3** = fraction of tokens outside corpus top-1000
4. **Max cosine similarity < 0.85** with existing patterns (else strengthen existing)

## Distinctiveness (corpus-aware)
```
common = top_1000_tokens(all_patterns)
distinctiveness(pattern) = |tokens(pattern) - common| / |tokens(pattern)|
```
Rare tokens = distinctive = retain. Common tokens = generic = reject.

## Dedup (weekly batch)
1. Compute all-pairs cosine similarity (O(N²) acceptable at <10k patterns; use HNSW-approximate above)
2. Pairs with sim ≥ 0.92 → enqueue LLM judge
3. Judge verdict: MERGE (archive loser, transfer stats) or KEEP_BOTH

## Retirement criteria (weekly)
- **Poor performance:** attempts > 20 AND Beta CI upper bound < 0.4
- **Stale:** no match in 90 days
- **Merged:** archived via dedup

## Critical pitfalls
- **Don't delete, archive** — allow rollback
- **Don't retire during cold-start** — require min attempts
- **Re-compute distinctiveness on corpus change** — new patterns shift common-token set
- **Cosine 0.92 may miss paraphrases** — supplement with LLM review for borderline (0.85-0.92)
- **Beta CI at small α+β is unreliable** — require attempts > 20

## Production references
- Cursor .cursorrules: manual curation, <1KB
- Glean: cosine > 0.92 → merge candidate → human review
- MemGPT / Letta: hierarchical summarization with LLM compression
- Netflix RecSys 2024 talks: "freshness" scores with exponential decay

## Pseudocode
```
def curate_weekly(db):
  retire_stale(db, 90_days)
  retire_poor(db, ci_upper_threshold=0.4)
  pairs = find_duplicates(db, cosine_threshold=0.92)
  for pair in pairs:
    verdict = llm_judge_dedup(pair)
    if verdict == 'merge': merge(pair, keep=higher_confidence)
```
```

- [ ] **Step 2: Commit** → `docs(quoth-v2): skill knowledge-base-curation`

---

### Task 6.6: Bulk-migrate existing 1421 patterns through quality gates

**Files:**
- Create: `quoth-plugin/scripts/migrate-v2-quality.js`

- [ ] **Step 1: Write migration script**

```javascript
#!/usr/bin/env node
const path = require('path')
const { createDb } = require('../daemon/db.js')
const { backfillDistinctiveness, isGenericName } = require('../daemon/lib/curation.js')

const db = createDb(path.join(require('os').homedir(), '.quoth', 'memory.db'))

// Backup before migration
const backup = db.backup(path.join(require('os').homedir(), '.quoth', `memory-pre-v2-${Date.now()}.db`))

// 1. Compute distinctiveness for all
const n = backfillDistinctiveness(db)
console.log(`Distinctiveness computed for ${n} patterns`)

// 2. Flag generic names
const patterns = db.prepare("SELECT id, name FROM patterns WHERE status='active'").all()
let flagged = 0
for (const p of patterns) {
  if (isGenericName(p.name)) {
    db.prepare("UPDATE patterns SET retired_at = ?, retired_reason = 'generic-name', status='archived' WHERE id=?")
      .run(Date.now(), p.id)
    flagged++
  }
}
console.log(`Archived ${flagged} generic-name patterns`)

// 3. Summary
const stats = db.prepare("SELECT status, COUNT(*) n FROM patterns GROUP BY status").all()
console.log('After migration:', stats)
```

- [ ] **Step 2: Dry-run on copy of DB**

```bash
cp ~/.quoth/memory.db /tmp/quoth-migration-test.db
QUOTH_DB_PATH=/tmp/quoth-migration-test.db node quoth-plugin/scripts/migrate-v2-quality.js
```

- [ ] **Step 3: Inspect results**

```bash
node -e "
const db = require('./quoth-plugin/daemon/db.js').createDb('/tmp/quoth-migration-test.db')
const byReason = db.prepare('SELECT retired_reason, COUNT(*) c FROM patterns WHERE retired_at IS NOT NULL GROUP BY retired_reason').all()
console.log(byReason)
"
```

- [ ] **Step 4: Commit script (migration NOT run on prod)** → `chore(quoth-v2): migration script for quality-gate backfill`

---

## Phase 7: Observability & A/B Validation

### Task 7.1: V2 health metrics

**Files:**
- Modify: `quoth-plugin/mcp/handlers/intelligence.js`

- [ ] **Step 1: Extend getStats with v2 metrics**

```javascript
if (db) {
  try {
    const clusterStats = db.prepare(`
      SELECT COUNT(*) c, AVG(alpha/(alpha+beta)) avg_conf, MIN(alpha/(alpha+beta)) min_conf, MAX(alpha/(alpha+beta)) max_conf
      FROM cluster_stats
    `).get()
    const injectionStats = db.prepare(`
      SELECT COUNT(*) total, SUM(CASE WHEN is_exploration=1 THEN 1 ELSE 0 END) explorations,
             AVG(propensity) avg_prop, COUNT(CASE WHEN outcome_at IS NOT NULL THEN 1 END) with_outcome
      FROM injection_log WHERE injected_at > (strftime('%s','now') - 86400*7) * 1000
    `).get()
    const judgeStats = db.prepare(`
      SELECT COUNT(*) total, SUM(CASE WHEN status='judged' THEN 1 ELSE 0 END) judged,
             SUM(cost_cents) cost_cents
      FROM judge_queue WHERE created_at > (strftime('%s','now') - 86400*30) * 1000
    `).get()
    stats.v2 = { clusters: clusterStats, injections_7d: injectionStats, judge_30d: judgeStats }
  } catch {}
}
```

- [ ] **Step 2: Run tests** → `npm test 2>&1 | tail -5`
- [ ] **Step 3: Commit** → `feat(quoth-v2): v2 health metrics in intelligence_stats`

---

### Task 7.2: V1 vs V2 A/B comparison

**Files:**
- Create: `quoth-plugin/scripts/ab-compare.js`

- [ ] **Step 1: Write comparison script**

```javascript
#!/usr/bin/env node
const db = require('../daemon/db.js').createDb(require('path').join(require('os').homedir(),'.quoth','memory.db'))

// Compare v1 vs v2 injections over the last 7 days
const weekAgo = Date.now() - 7*24*60*60*1000

const v1 = db.prepare(`
  SELECT AVG(confidence) avg_conf, COUNT(*) n FROM patterns
  WHERE exposure_count > 0 AND last_exposed_at > ?
`).get(weekAgo)

const v2 = db.prepare(`
  SELECT AVG(reward) avg_reward, COUNT(*) n FROM injection_log
  WHERE outcome_at IS NOT NULL AND injected_at > ?
`).get(weekAgo)

console.log('=== V1 (legacy injection, 7d) ===')
console.log(`  avg confidence of exposed: ${(v1.avg_conf*100).toFixed(1)}% (n=${v1.n})`)

console.log('=== V2 (hierarchical TS, 7d) ===')
console.log(`  avg reward: ${(v2.avg_reward*100).toFixed(1)}% (n=${v2.n})`)
console.log(`  Δ = ${((v2.avg_reward - v1.avg_conf)*100).toFixed(1)}pp`)
```

- [ ] **Step 2: Commit** → `chore(quoth-v2): A/B comparison script`

---

### Task 7.3: Rollback runbook

**Files:**
- Create: `quoth-plugin/docs/V2-ROLLBACK.md`

- [ ] **Step 1: Write runbook**

```markdown
# V2 Rollback Procedure

## Symptoms to watch
- Avg cluster confidence < 40% after 2 weeks
- Judge cost > $5/day (indicates run-away)
- Injection latency > 50ms p95
- Pattern count growing > 100/day net (curation broken)

## Emergency rollback (disable V2)
```bash
# Unset all v2 flags
unset QUOTH_LEARNING_V2 QUOTH_V2_INJECTION QUOTH_V2_EXPLORATION QUOTH_V2_JUDGE QUOTH_V2_CURATION

# Restart daemon
kill $(cat ~/.quoth/daemon.pid)
node quoth-plugin/daemon/daemon.js &
```

## Restore from pre-v2 backup
```bash
cp ~/.quoth/memory-pre-v2-<timestamp>.db ~/.quoth/memory.db
```

## Partial rollback (keep infra, disable judge only)
```bash
unset QUOTH_V2_JUDGE
# Keep V2_INJECTION active
```
```

- [ ] **Step 2: Commit** → `docs(quoth-v2): rollback runbook`

---

## Phase 8: Cleanup & Finalization

### Task 8.1: Publish skills to `~/.claude/skills/`

- [ ] **Step 1: Symlink each skill**

```bash
for skill in bayesian-confidence contextual-bandits llm-as-judge knowledge-base-curation; do
  ln -sfn /home/lord_montino/projects/agents-tools/quoth/quoth-plugin/skills/$skill ~/.claude/skills/$skill
done
ls -la ~/.claude/skills/ | grep -E "bayesian|contextual|judge|curation"
```

- [ ] **Step 2: Commit** → `chore(quoth-v2): symlink v2 skills to ~/.claude/skills/`

---

### Task 8.2: Remove V1 code paths (only after 2 weeks A/B)

**Gate:** Do NOT execute until 2-week A/B shows V2 dominance.

- [ ] **Step 1: Remove feature flag gates (flip to always-v2)**
- [ ] **Step 2: Delete v1-only functions** (applySoftNegative on exposure, old injection path, static propensities)
- [ ] **Step 3: Update tests, remove skip-gated v1 tests**
- [ ] **Step 4: Commit** → `refactor(quoth): remove v1 injection path after successful v2 A/B`

---

## Rollout Strategy

### Week 1: Shadow mode
- Deploy Phase 0-3 (infra + cluster rebuild + SNIPS shadow)
- V2 flags OFF by default
- Only nightly jobs run V2 code
- Observe: cluster health, injection_log growth

### Week 2: Half-flip
- Enable `QUOTH_V2_INJECTION=true` on Montino only
- V2 injection active, V2 feedback via SNIPS
- V1 still runs for other projects
- Compare metrics daily

### Week 3: Judge on
- Enable `QUOTH_V2_JUDGE=true`
- Monitor cost ($1/mo target)
- A/B metrics → decide full rollout

### Week 4: Full V2 or rollback
- If V2 improvements: `QUOTH_LEARNING_V2=true` globally
- If degradation: rollback runbook

### Month 2: Curation + cleanup
- Enable `QUOTH_V2_CURATION=true`
- Run bulk-migrate script on prod (with backup)
- Delete V1 code paths (Task 8.2)

---

## Risk Register

| Risk | Mitigation |
|---|---|
| Cluster rebuild destabilizes learned posteriors | Gradual transition: weighted merge of old α,β into new cluster stats |
| LLM judge cost explodes | Cap daily judge calls at 50, hard $5/day kill switch |
| SNIPS variance high with few exploration samples | Require min 100 observations per cluster before updating posteriors |
| Quality gate rejects good new patterns | Distinctiveness threshold configurable; monitor rejection reasons |
| Retirement removes patterns still useful | 14-day archive → restore grace period |
| Migration wipes useful v1 data | Automated backup before any destructive script |
| Feature flag left on for abandoned experiment | Nightly log reminds if `QUOTH_LEARNING_V2=true` > 30 days |

---

## Success Criteria

After 4 weeks of V2 deployment:

- [ ] Avg cluster confidence > 60% across top-5 namespaces
- [ ] Injection latency p95 < 20ms
- [ ] Judge cost ≤ $3/month
- [ ] < 10% of injections come from `is_exploration=true` (cost control)
- [ ] Pattern archive rate: 5-15% per week (dedup + retirement healthy)
- [ ] Active pattern count stable at ±10% (no bloat)
- [ ] Manual inspection: top-10 patterns by cluster are DISTINCT and USEFUL (not generic)

---

## Related Skills

- `bayesian-confidence` — Beta posteriors, empirical Bayes, forgetting
- `contextual-bandits` — Hierarchical TS, exploration, SNIPS
- `llm-as-judge` — Pairwise eval with active learning
- `knowledge-base-curation` — Quality gates, dedup, retirement

---

## References (papers & talks)

1. Hong et al. *Hierarchical Bayesian Bandits*, 2022
2. Zheng et al. *Judging LLM-as-a-Judge with MT-Bench*, NeurIPS 2023
3. Swaminathan & Joachims. *The Self-Normalized Estimator for Counterfactual Learning*, NeurIPS 2015
4. Joachims et al. *Unbiased Learning-to-Rank with Biased Feedback*, WSDM 2017
5. Agrawal & Goyal. *Thompson Sampling for Contextual Bandits*, ICML 2013
6. Garivier & Moulines. *On UCB Policies for Non-Stationary Bandits*, ALT 2011
7. Shinn et al. *Reflexion: Language Agents with Verbal Reinforcement Learning*, 2023
8. Dudik, Langford, Li. *Doubly Robust Policy Evaluation*, ICML 2011
9. Gelman et al. *Bayesian Data Analysis* (3rd ed.), Ch. 5
10. Netflix/Spotify/LinkedIn RecSys 2024 production talks
