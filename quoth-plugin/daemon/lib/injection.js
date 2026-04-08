'use strict'

const { scoreWithThompson } = require('./sampler.js')

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2)
}

function trigrams(text) {
  const s = tokenize(text).join(' ')
  const grams = new Set()
  for (let i = 0; i <= s.length - 3; i++) grams.add(s.slice(i, i + 3))
  return grams
}

function jaccardSim(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const g of a) if (b.has(g)) inter++
  return inter / (a.size + b.size - inter)
}

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

function rankByThompson(db, namespace, limit, opts = {}) {
  const {
    minConfidence = 0.2,
    candidatePoolSize = Math.max(30, limit * 5),
    excludeRecentMinutes = 5,
    tags = [],
  } = opts

  const cutoff = Date.now() - excludeRecentMinutes * 60 * 1000
  // RANDOM() avoids biasing Thompson sampling toward already-proven patterns;
  // Thompson sampling itself should handle exploration vs exploitation via the
  // Beta distribution variance of each candidate.
  let sql = `
    SELECT * FROM patterns
    WHERE status = 'active'
      AND (namespace = ? OR namespace = 'global')
      AND confidence >= ?
      AND (last_exposed_at IS NULL OR last_exposed_at < ?)`
  const params = [namespace, minConfidence, cutoff]

  if (tags.length > 0) {
    const tagConditions = tags.map(() => `tags LIKE ?`).join(' OR ')
    sql += ` AND (${tagConditions})`
    tags.forEach(t => params.push(`%"${t}"%`))
  }

  sql += `\n    ORDER BY RANDOM()\n    LIMIT ?`
  params.push(candidatePoolSize)

  const rows = db.prepare(sql).all(...params)

  const patterns = rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }))
  const sampled = scoreWithThompson(patterns)
  sampled.sort((a, b) => b._sampled - a._sampled)
  return sampled.slice(0, limit)
}

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
