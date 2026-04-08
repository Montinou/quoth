'use strict'

/**
 * Exposure tracking and soft-negative feedback.
 * Separates "what was shown to the agent" from "what the agent actually used".
 */

const SOFT_NEGATIVE_BETA_DELTA = 0.1

function recordExposure(db, ids) {
  if (!ids || ids.length === 0) return
  // Filter out doc: prefixed IDs — they don't exist in patterns table.
  // Doc chunk exposure is tracked via injection_log instead.
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
  SOFT_NEGATIVE_BETA_DELTA, MAX_HISTORY,
}
