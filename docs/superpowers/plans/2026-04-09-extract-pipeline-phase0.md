# EXTRACT Pipeline — Phase 0: Dedup Threshold Calibration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the cosine similarity dedup threshold for MiniLM-L6 384d embeddings before replacing the CONSOLIDATE LLM stage with embedding-only dedup.

**Architecture:** A standalone calibration script reads the current pattern library from `~/.quoth/memory.db`, computes pairwise cosine similarity for the top 100 patterns, and outputs borderline pairs (0.85-0.95 range) for manual review. The output recommends a threshold based on precision/recall tradeoff.

**Tech Stack:** Node.js, better-sqlite3, existing HNSW + cosine similarity from `db.js`

**Spec:** `docs/superpowers/specs/2026-04-09-intent-outcome-temporal.md` — "Dedup Threshold Calibration" section

---

## File Structure

| Action | Path | Purpose |
|--------|------|---------|
| Create | `quoth-plugin/scripts/calibrate-dedup.js` | Pairwise similarity analysis script |
| Create | `quoth-plugin/tests/calibrate-dedup.test.js` | Unit tests for calibration helpers |

No production code is modified in this phase. This is a read-only analysis that runs before any pipeline changes.

---

### Task 1: Write calibration helper tests

**Files:**
- Create: `quoth-plugin/tests/calibrate-dedup.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Will be implemented in the script as exported helpers
const { computePairwiseSimilarity, bucketPairs, recommendThreshold } = require('../scripts/calibrate-dedup.js')

describe('calibrate-dedup helpers', () => {
  describe('computePairwiseSimilarity', () => {
    it('returns pairs with similarity scores', () => {
      const patterns = [
        { id: 'a', embedding: [1, 0, 0] },
        { id: 'b', embedding: [0.9, 0.1, 0] },
        { id: 'c', embedding: [0, 1, 0] },
      ]
      const pairs = computePairwiseSimilarity(patterns)
      // 3 patterns → 3 pairs: (a,b), (a,c), (b,c)
      expect(pairs).toHaveLength(3)
      // a-b should be most similar
      const ab = pairs.find(p => (p.idA === 'a' && p.idB === 'b') || (p.idA === 'b' && p.idB === 'a'))
      expect(ab.similarity).toBeGreaterThan(0.9)
      // a-c should be orthogonal
      const ac = pairs.find(p => (p.idA === 'a' && p.idB === 'c') || (p.idA === 'c' && p.idB === 'a'))
      expect(ac.similarity).toBeCloseTo(0, 1)
    })

    it('returns empty array for fewer than 2 patterns', () => {
      expect(computePairwiseSimilarity([])).toEqual([])
      expect(computePairwiseSimilarity([{ id: 'a', embedding: [1, 0] }])).toEqual([])
    })

    it('skips patterns with null embeddings', () => {
      const patterns = [
        { id: 'a', embedding: [1, 0, 0] },
        { id: 'b', embedding: null },
        { id: 'c', embedding: [0.95, 0.05, 0] },
      ]
      const pairs = computePairwiseSimilarity(patterns)
      expect(pairs).toHaveLength(1) // only a-c
    })
  })

  describe('bucketPairs', () => {
    it('groups pairs into similarity buckets', () => {
      const pairs = [
        { idA: 'a', idB: 'b', similarity: 0.86 },
        { idA: 'c', idB: 'd', similarity: 0.89 },
        { idA: 'e', idB: 'f', similarity: 0.93 },
        { idA: 'g', idB: 'h', similarity: 0.75 }, // below range
        { idA: 'i', idB: 'j', similarity: 0.96 }, // above range
      ]
      const buckets = bucketPairs(pairs, 0.85, 0.95)
      expect(buckets['0.85-0.88']).toHaveLength(1)
      expect(buckets['0.88-0.90']).toHaveLength(1)
      expect(buckets['0.92-0.95']).toHaveLength(1)
      // 0.75 and 0.96 are outside the range
      expect(buckets['below']).toHaveLength(1)
      expect(buckets['above']).toHaveLength(1)
    })
  })

  describe('recommendThreshold', () => {
    it('recommends 0.92 when borderline pairs are scarce', () => {
      const buckets = {
        '0.85-0.88': [{ idA: 'a', idB: 'b', similarity: 0.86 }],
        '0.88-0.90': [],
        '0.90-0.92': [],
        '0.92-0.95': [],
      }
      const result = recommendThreshold(buckets)
      expect(result.threshold).toBe(0.92)
      expect(result.reason).toBeTruthy()
    })

    it('recommends lower threshold when many pairs cluster at 0.88-0.92', () => {
      const buckets = {
        '0.85-0.88': [],
        '0.88-0.90': Array(10).fill({ idA: 'x', idB: 'y', similarity: 0.89 }),
        '0.90-0.92': Array(8).fill({ idA: 'x', idB: 'y', similarity: 0.91 }),
        '0.92-0.95': Array(2).fill({ idA: 'x', idB: 'y', similarity: 0.93 }),
      }
      const result = recommendThreshold(buckets)
      // Many pairs at 0.88-0.92 means real dupes live there → lower threshold
      expect(result.threshold).toBeLessThanOrEqual(0.90)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd quoth-plugin && npx vitest run tests/calibrate-dedup.test.js`
Expected: FAIL — module `../scripts/calibrate-dedup.js` not found

- [ ] **Step 3: Commit test skeleton**

```bash
cd quoth-plugin
git add tests/calibrate-dedup.test.js
git commit -m "test(phase0): add calibration helper tests — TDD red"
```

---

### Task 2: Implement calibration script

**Files:**
- Create: `quoth-plugin/scripts/calibrate-dedup.js`

- [ ] **Step 1: Write the calibration script**

```js
#!/usr/bin/env node
'use strict'

/**
 * Dedup Threshold Calibration Script
 *
 * Analyzes pairwise cosine similarity among top patterns to determine
 * the optimal dedup threshold for MiniLM-L6 384d embeddings.
 *
 * Usage: node scripts/calibrate-dedup.js [--db PATH] [--top N] [--min 0.85] [--max 0.95]
 */

const path = require('path')
const os = require('os')

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}

function computePairwiseSimilarity(patterns) {
  const valid = patterns.filter(p => p.embedding && Array.isArray(p.embedding) && p.embedding.length > 0)
  if (valid.length < 2) return []

  const pairs = []
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const sim = cosineSimilarity(valid[i].embedding, valid[j].embedding)
      pairs.push({
        idA: valid[i].id,
        idB: valid[j].id,
        nameA: valid[i].name || valid[i].id,
        nameB: valid[j].name || valid[j].id,
        similarity: sim,
      })
    }
  }
  return pairs
}

function bucketPairs(pairs, min = 0.85, max = 0.95) {
  const buckets = {
    'below': [],
    '0.85-0.88': [],
    '0.88-0.90': [],
    '0.90-0.92': [],
    '0.92-0.95': [],
    'above': [],
  }
  for (const p of pairs) {
    if (p.similarity < min) buckets['below'].push(p)
    else if (p.similarity < 0.88) buckets['0.85-0.88'].push(p)
    else if (p.similarity < 0.90) buckets['0.88-0.90'].push(p)
    else if (p.similarity < 0.92) buckets['0.90-0.92'].push(p)
    else if (p.similarity < max) buckets['0.92-0.95'].push(p)
    else buckets['above'].push(p)
  }
  return buckets
}

function recommendThreshold(buckets) {
  const count88_90 = (buckets['0.88-0.90'] || []).length
  const count90_92 = (buckets['0.90-0.92'] || []).length
  const count92_95 = (buckets['0.92-0.95'] || []).length

  // If many pairs cluster below 0.92, real dupes exist there → lower threshold
  if (count88_90 + count90_92 > 10) {
    return {
      threshold: 0.88,
      reason: `${count88_90 + count90_92} pairs in 0.88-0.92 range — many near-dupes, lower threshold recommended`,
    }
  }
  if (count90_92 > 5) {
    return {
      threshold: 0.90,
      reason: `${count90_92} pairs in 0.90-0.92 range — moderate near-dupes, slightly lower threshold`,
    }
  }
  return {
    threshold: 0.92,
    reason: `Few pairs below 0.92 (${count88_90 + count90_92}) — default threshold is appropriate`,
  }
}

// --- CLI entry point ---
async function main() {
  const args = process.argv.slice(2)
  const dbFlag = args.indexOf('--db')
  const topFlag = args.indexOf('--top')

  const dbPath = dbFlag >= 0 ? args[dbFlag + 1] : path.join(os.homedir(), '.quoth', 'memory.db')
  const topN = topFlag >= 0 ? parseInt(args[topFlag + 1], 10) : 100

  const Database = require('better-sqlite3')
  const db = new Database(dbPath, { readonly: true })

  const rows = db.prepare(`
    SELECT id, name, action, embedding, confidence
    FROM patterns
    WHERE status = 'active' AND embedding IS NOT NULL
    ORDER BY confidence DESC
    LIMIT ?
  `).all(topN)

  console.log(`\nLoaded ${rows.length} patterns from ${dbPath}\n`)

  const patterns = rows.map(r => ({
    id: r.id,
    name: r.name,
    action: (r.action || '').slice(0, 80),
    confidence: r.confidence,
    embedding: JSON.parse(r.embedding),
  }))

  console.log('Computing pairwise similarity...')
  const pairs = computePairwiseSimilarity(patterns)
  console.log(`Total pairs: ${pairs.length}\n`)

  const buckets = bucketPairs(pairs)

  console.log('=== Similarity Distribution ===')
  console.log(`Below 0.85:  ${buckets['below'].length} pairs`)
  console.log(`0.85-0.88:   ${buckets['0.85-0.88'].length} pairs`)
  console.log(`0.88-0.90:   ${buckets['0.88-0.90'].length} pairs`)
  console.log(`0.90-0.92:   ${buckets['0.90-0.92'].length} pairs`)
  console.log(`0.92-0.95:   ${buckets['0.92-0.95'].length} pairs`)
  console.log(`Above 0.95:  ${buckets['above'].length} pairs`)

  // Show borderline pairs for manual review
  const borderline = [...(buckets['0.88-0.90'] || []), ...(buckets['0.90-0.92'] || []), ...(buckets['0.92-0.95'] || [])]
  borderline.sort((a, b) => b.similarity - a.similarity)

  if (borderline.length > 0) {
    console.log(`\n=== Borderline Pairs (0.88-0.95) — ${borderline.length} pairs ===`)
    console.log('Review these to classify as "same technique" or "different technique":\n')
    for (const p of borderline.slice(0, 30)) {
      console.log(`[${p.similarity.toFixed(4)}] "${p.nameA}" vs "${p.nameB}"`)
    }
    if (borderline.length > 30) {
      console.log(`  ... and ${borderline.length - 30} more`)
    }
  }

  const recommendation = recommendThreshold(buckets)
  console.log(`\n=== Recommendation ===`)
  console.log(`Threshold: ${recommendation.threshold}`)
  console.log(`Reason: ${recommendation.reason}`)
  console.log(`\nSet via: export QUOTH_DEDUP_THRESHOLD=${recommendation.threshold}`)

  db.close()
}

// Export helpers for testing
module.exports = { computePairwiseSimilarity, bucketPairs, recommendThreshold, cosineSimilarity }

// Run CLI if invoked directly
if (require.main === module) {
  main().catch(err => { console.error('Error:', err.message); process.exit(1) })
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd quoth-plugin && npx vitest run tests/calibrate-dedup.test.js`
Expected: PASS — all helper function tests green

- [ ] **Step 3: Commit implementation**

```bash
cd quoth-plugin
git add scripts/calibrate-dedup.js tests/calibrate-dedup.test.js
git commit -m "feat(phase0): dedup threshold calibration script + tests"
```

---

### Task 3: Run calibration against real data

**Files:**
- None modified (read-only analysis)

- [ ] **Step 1: Run the calibration script**

Run: `cd quoth-plugin && node scripts/calibrate-dedup.js`
Expected: Output showing similarity distribution and borderline pairs

- [ ] **Step 2: Review borderline pairs**

For each pair in the 0.88-0.95 range, manually classify:
- **Same technique**: patterns describe the same approach (should be deduped)
- **Different technique**: distinct patterns (should NOT be deduped)

Count: precision = (correctly flagged as dupe) / (total flagged). Target: >= 90%.

- [ ] **Step 3: Document findings**

Create a brief note at the bottom of this file recording:
- Total active patterns with embeddings
- Distribution across buckets
- Number of borderline pairs reviewed
- Precision at the recommended threshold
- Final chosen threshold value
- Any surprising findings

- [ ] **Step 4: Set threshold in environment**

Add to `~/.quoth/.env`:
```
QUOTH_DEDUP_THRESHOLD=0.92
```
(Or whatever value the calibration recommends)

- [ ] **Step 5: Commit findings**

```bash
git add docs/superpowers/plans/2026-04-09-extract-pipeline-phase0.md
git commit -m "docs(phase0): dedup calibration findings documented"
```

---

## Calibration Findings

- **Date:** 2026-04-09
- **Patterns analyzed:** 100 (top by confidence) / 497 active, 0 had stored embeddings (generated MiniLM-L6 384d on-the-fly)
- **Total pairs:** 4950
- **Distribution:** Below 0.85: 4940 | 0.85-0.88: 1 | 0.88-0.90: 5 | 0.90-0.92: 3 | 0.92-0.95: 1 | Above 0.95: 0
- **Borderline pairs (0.88-0.95):** 9
- **Pairs reviewed manually:** 9/9
- **Same technique / Different technique:** 8 / 1 (borderline case at 0.89: "Update documentation based on source code changes" vs "...schema changes")
- **Precision at 0.92:** 100% (1/1 true dupe)
- **Precision at 0.88:** 89% (8/9 true dupes)
- **Chosen threshold:** 0.92 (conservative default — only 1 pair above this, and it's a clear dupe)
- **Notes:** Pattern library is very well-differentiated — 99.8% of pairs fall below 0.85. The 9 borderline pairs are mostly trivial wording variants of the same technique ("map interaction" appears 3 times in different phrasings). A 0.88 threshold would also work (89% precision) and catch more dupes, but 0.92 is safer for Phase 0. Can lower later with more data.
