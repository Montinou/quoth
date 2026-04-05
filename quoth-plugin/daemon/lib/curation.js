'use strict'

/**
 * Knowledge-base curation: quality gates + dedup + retirement.
 *
 * Prevents pattern bloat and maintains signal-to-noise by filtering at
 * ingestion, merging near-duplicates, and retiring clearly-bad patterns.
 */

const GENERIC_PATTERNS = [
  /^When \w+ing a file/i,
  /^When no specific pattern/i,
  /^Use [\w ]+ to \w+ (file|command|code|files)/i,
  /^Direct \w+ing without/i,
  /^First read the file/i,
  /^Always (read|check|verify)/i,
  /^When editing code/i,
  /^Default to \w+ing/i,
]

function isGenericName(name) {
  if (!name || name.length < 25) return true
  return GENERIC_PATTERNS.some(re => re.test(name))
}

/**
 * Distinctiveness: fraction of unique tokens outside the corpus-common set.
 * Rare tokens = distinctive = worth keeping. Common tokens = generic = reject.
 */
function distinctivenessScore(text, commonTokens) {
  if (!text) return 0
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 3)
  const unique = new Set(tokens)
  if (unique.size === 0) return 0
  let rare = 0
  for (const t of unique) if (!commonTokens.has(t)) rare++
  return rare / unique.size
}

/**
 * Build the set of top-N most common tokens across active patterns.
 */
function buildCommonTokens(patterns, topN = 1000) {
  const counts = new Map()
  for (const p of patterns) {
    const text = `${p.name || ''} ${p.action || ''}`.toLowerCase()
    const toks = text.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 3)
    for (const t of toks) counts.set(t, (counts.get(t) || 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
  return new Set(sorted.map(([t]) => t))
}

/**
 * Quality gate: returns { pass: boolean, reasons: string[] }.
 */
function passesQualityGate(pattern, opts = {}) {
  const { minDistinctiveness = 0.3, minNameLen = 25, maxSimilarity = 0.85 } = opts
  const reasons = []
  if (!pattern.name || pattern.name.length < minNameLen) reasons.push('name-too-short')
  if (isGenericName(pattern.name)) reasons.push('generic-name')
  if (pattern.distinctiveness != null && pattern.distinctiveness < minDistinctiveness) reasons.push('low-distinctiveness')
  if (pattern.maxSim != null && pattern.maxSim > maxSimilarity) reasons.push('near-duplicate')
  return { pass: reasons.length === 0, reasons }
}

/**
 * Batch-compute distinctiveness for all active patterns.
 * Returns number of patterns updated.
 */
function backfillDistinctiveness(db) {
  const patterns = db.prepare("SELECT id, name, action FROM patterns WHERE status='active'").all()
  if (patterns.length === 0) return 0
  const common = buildCommonTokens(patterns, 1000)
  const stmt = db.prepare('UPDATE patterns SET distinctiveness = ? WHERE id = ?')
  const tx = db.transaction((rows) => {
    for (const p of rows) {
      const d = distinctivenessScore(`${p.name || ''} ${p.action || ''}`, common)
      stmt.run(d, p.id)
    }
  })
  tx(patterns)
  return patterns.length
}

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na*nb) : 0
}

/**
 * Find near-duplicate pattern pairs by cosine similarity of embeddings.
 * O(N²) — acceptable at <10k patterns; supplement with HNSW neighbor pruning above that.
 */
function findNearDuplicates(db, threshold = 0.92, maxPairs = 100) {
  const rows = db.prepare("SELECT id, embedding, confidence FROM patterns WHERE status='active' AND embedding IS NOT NULL").all()
  const parsed = []
  for (const r of rows) {
    try { parsed.push({ id: r.id, confidence: r.confidence, vec: JSON.parse(r.embedding) }) } catch {}
  }
  const pairs = []
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const sim = cosineSim(parsed[i].vec, parsed[j].vec)
      if (sim >= threshold) {
        // Winner = higher confidence
        const [a, b] = parsed[i].confidence >= parsed[j].confidence
          ? [parsed[i], parsed[j]]
          : [parsed[j], parsed[i]]
        pairs.push({ keep: a.id, archive: b.id, similarity: sim })
      }
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity).slice(0, maxPairs)
}

/**
 * Enqueue near-duplicate pairs into judge_queue for LLM verification.
 */
function enqueueDedupPairs(db, pairs) {
  const stmt = db.prepare(`
    INSERT INTO judge_queue (session_id, pattern_a_id, pattern_b_id, trajectory_summary, priority)
    VALUES ('dedup', ?, ?, ?, 0.9)
  `)
  let enqueued = 0
  for (const p of pairs) {
    stmt.run(p.keep, p.archive, `Near-duplicate detection (cosine=${p.similarity.toFixed(3)})`)
    enqueued++
  }
  return enqueued
}

/**
 * Retire patterns with poor performance or staleness.
 * Uses Beta credible interval upper bound from judge.js.
 */
function retirePoorPatterns(db, opts = {}) {
  const {
    ciUpperThreshold = 0.4, stalenessDays = 90, minAttempts = 20,
    minDistinctiveness = 0.05, distinctivenessStalenessDays = 30,
  } = opts
  const { betaCredibleInterval } = require('./judge.js')
  const rows = db.prepare(`
    SELECT id, alpha, beta, distinctiveness, last_matched_at, created_at FROM patterns
    WHERE status='active' AND retired_at IS NULL
  `).all()
  const now = Date.now()
  const staleCutoff = stalenessDays * 24 * 60 * 60 * 1000
  const distinctStaleCutoff = distinctivenessStalenessDays * 24 * 60 * 60 * 1000
  let retired = 0
  const tx = db.transaction(() => {
    for (const p of rows) {
      const attempts = Math.round(Math.max(0, (p.alpha - 1)) + Math.max(0, (p.beta - 1)))
      const { upper } = betaCredibleInterval(p.alpha, p.beta)
      const lastTouch = p.last_matched_at || p.created_at || now
      let reason = null
      if (attempts >= minAttempts && upper < ciUpperThreshold) reason = 'low-ci-upper'
      else if ((now - lastTouch) > staleCutoff) reason = `stale-${stalenessDays}d`
      else if (
        p.distinctiveness != null &&
        p.distinctiveness < minDistinctiveness &&
        (now - lastTouch) > distinctStaleCutoff
      ) reason = 'low-distinctiveness'
      if (reason) {
        db.prepare(`
          UPDATE patterns SET status='archived', retired_at=?, retired_reason=? WHERE id=?
        `).run(now, reason, p.id)
        retired++
      }
    }
  })
  tx()
  return retired
}

module.exports = {
  GENERIC_PATTERNS, isGenericName, distinctivenessScore, buildCommonTokens,
  passesQualityGate, backfillDistinctiveness, findNearDuplicates, enqueueDedupPairs, cosineSim,
  retirePoorPatterns,
}
