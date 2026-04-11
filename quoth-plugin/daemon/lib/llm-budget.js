'use strict'

const { openDb, logPipelineError } = require('../db.js')

function cap() {
  return parseFloat(process.env.QUOTH_DAILY_LLM_BUDGET_USD ?? '1.00')
}

function utcDate() {
  return new Date().toISOString().slice(0, 10)
}

function reserve({ stage, estimated_usd }) {
  const db = openDb()
  const date = utcDate()
  const limit = cap()
  try {
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO llm_budget (date, spend_usd, triage_calls, extract_calls, updated_at)
                  VALUES (?, 0, 0, 0, ?) ON CONFLICT(date) DO NOTHING`).run(date, Date.now())
      const upd = db.prepare(`UPDATE llm_budget
                                 SET spend_usd = spend_usd + ?, updated_at = ?,
                                     triage_calls  = triage_calls  + CASE WHEN ? = 'triage'  THEN 1 ELSE 0 END,
                                     extract_calls = extract_calls + CASE WHEN ? = 'extract' THEN 1 ELSE 0 END
                               WHERE date = ? AND spend_usd + ? <= ?`)
      const info = upd.run(estimated_usd, Date.now(), stage, stage, date, estimated_usd, limit)
      if (info.changes === 0) throw new Error('BudgetExhausted')
    })
    tx.immediate()
    return { ok: true, date }
  } catch (e) {
    if (String(e.message).includes('BudgetExhausted')) {
      logPipelineError({ stage: 'budget', severity: 'warn', error_message: 'reservation rejected', context: { stage, estimated_usd, cap: limit } })
      return { ok: false, reason: 'BudgetExhausted' }
    }
    throw e
  }
}

function reconcile({ stage, estimated_usd, actual_usd }) {
  const delta = actual_usd - estimated_usd
  if (delta === 0) return
  const date = utcDate()
  openDb().prepare(`UPDATE llm_budget SET spend_usd = spend_usd + ?, updated_at = ? WHERE date = ?`)
    .run(delta, Date.now(), date)
}

function today() {
  return openDb().prepare(`SELECT * FROM llm_budget WHERE date = ?`).get(utcDate())
}

module.exports = { reserve, reconcile, today }
