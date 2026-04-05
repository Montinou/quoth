import { describe, it, expect, afterAll } from 'vitest'
import { createDb } from '../daemon/db.js'
import fs from 'fs'

const tmpDb = `/tmp/quoth-injlog-${Date.now()}.db`

describe('injection_log', () => {
  afterAll(() => { try { fs.unlinkSync(tmpDb) } catch {} })

  it('logs injection and updates outcome', () => {
    const db = createDb(tmpDb)
    db.logInjection({
      session_id: 's1', namespace: 'test', pattern_id: 'p1',
      cluster_id: 2, rank: 1, propensity: 0.3, is_exploration: false,
      query_text: 'test query'
    })
    db.updateInjectionOutcome('s1', 'p1', 0.8)
    const r = db.prepare("SELECT * FROM injection_log WHERE session_id='s1'").get()
    expect(r.reward).toBe(0.8)
    expect(r.outcome_at).toBeGreaterThan(0)
    expect(r.is_exploration).toBe(0)
  })

  it('getPendingInjections returns old entries without outcome', () => {
    const db = createDb(tmpDb)
    // insert with old timestamp
    db.prepare(`
      INSERT INTO injection_log (session_id, namespace, pattern_id, rank, propensity, is_exploration, injected_at)
      VALUES ('s-old', 'test', 'p-old', 1, 0.5, 0, ?)
    `).run(Date.now() - 2 * 3600000)
    const pending = db.getPendingInjections(3600000)
    expect(pending.some(p => p.session_id === 's-old')).toBe(true)
  })

  it('getCompletedInjections filters by timestamp', () => {
    const db = createDb(tmpDb)
    const recent = db.getCompletedInjections(0, 100)
    expect(Array.isArray(recent)).toBe(true)
    expect(recent.every(r => r.outcome_at !== null)).toBe(true)
  })
})
