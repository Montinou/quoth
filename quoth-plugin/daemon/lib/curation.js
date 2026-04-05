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

module.exports = {
  GENERIC_PATTERNS, isGenericName, distinctivenessScore, buildCommonTokens,
  passesQualityGate, backfillDistinctiveness,
}
