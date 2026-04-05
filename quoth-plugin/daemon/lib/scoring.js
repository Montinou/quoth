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
