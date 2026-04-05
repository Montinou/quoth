import { describe, it, expect, beforeEach } from 'vitest'
const { createDb } = require('../daemon/db.js')
const { recordExposure, applySoftNegative, conversionRate } = require('../daemon/lib/scoring.js')
const path = require('path')
const os = require('os')

let db, tmpPath
beforeEach(() => {
  tmpPath = path.join(os.tmpdir(), `quoth-scoring-${Date.now()}-${Math.random()}.db`)
  db = createDb(tmpPath)
  db.upsertPattern({ id: 'p1', name: 'x', condition: 'test', action: 'act', confidence: 0.7 })
  db.upsertPattern({ id: 'p2', name: 'y', condition: 'test', action: 'act', confidence: 0.5 })
})

describe('exposure tracking', () => {
  it('recordExposure increments counters', () => {
    recordExposure(db, ['p1', 'p2'])
    const p1 = db.prepare('SELECT exposure_count, last_exposed_at FROM patterns WHERE id=?').get('p1')
    expect(p1.exposure_count).toBe(1)
    expect(p1.last_exposed_at).toBeGreaterThan(0)
  })

  it('recordExposure is safe with empty array', () => {
    expect(() => recordExposure(db, [])).not.toThrow()
    expect(() => recordExposure(db, null)).not.toThrow()
  })

  it('applySoftNegative increases beta and decreases confidence', () => {
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
    expect(rate).toBeGreaterThanOrEqual(0)
    expect(rate).toBeLessThanOrEqual(1)
  })
})

describe('quality history', () => {
  beforeEach(() => {
    // db and p1 already set up by outer beforeEach
  })

  it('recordQuality bounds history to last 20 entries', () => {
    const { recordQuality } = require('../daemon/lib/scoring.js')
    for (let i = 0; i < 30; i++) recordQuality(db, 'p1', 0.5 + i * 0.01)
    const row = db.prepare('SELECT quality_history FROM patterns WHERE id=?').get('p1')
    const history = JSON.parse(row.quality_history)
    expect(history.length).toBe(20)
    // Last entry should be latest score
    expect(history[19].score).toBeCloseTo(0.79, 2)
  })

  it('getTrend detects improvement', () => {
    const { recordQuality, getTrend } = require('../daemon/lib/scoring.js')
    for (let i = 0; i < 10; i++) recordQuality(db, 'p1', 0.3)
    for (let i = 0; i < 10; i++) recordQuality(db, 'p1', 0.8)
    const trend = getTrend(db, 'p1')
    expect(trend.trend).toBe('improving')
    expect(trend.delta).toBeGreaterThan(0.3)
  })
})
