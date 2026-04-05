import { describe, it, expect, beforeEach } from 'vitest'
const { createDb } = require('../daemon/db.js')
const { tokenize, trigrams, jaccardSim, rankByTrigramSim, rankByThompson } = require('../daemon/lib/injection.js')
const path = require('path')
const os = require('os')

describe('trigram matching', () => {
  it('tokenize normalizes text', () => {
    const tokens = tokenize('Write React component for login')
    expect(tokens).toContain('write')
    expect(tokens).toContain('react')
    expect(tokens).toContain('component')
  })

  it('trigrams generates character 3-grams', () => {
    const t = trigrams('react')
    expect(t.has('rea')).toBe(true)
    expect(t.has('eac')).toBe(true)
    expect(t.has('act')).toBe(true)
  })

  it('jaccardSim is 1.0 for identical, 0 for disjoint', () => {
    const a = new Set(['abc', 'bcd'])
    const b = new Set(['abc', 'bcd'])
    const c = new Set(['xyz', 'yzw'])
    expect(jaccardSim(a, b)).toBe(1)
    expect(jaccardSim(a, c)).toBe(0)
  })

  it('rankByTrigramSim ranks relevant patterns higher', () => {
    const patterns = [
      { id: 'a', name: 'write react component', pattern_trigrams: JSON.stringify([...trigrams('write react component')]) },
      { id: 'b', name: 'deploy docker image', pattern_trigrams: JSON.stringify([...trigrams('deploy docker image')]) },
      { id: 'c', name: 'test react hooks', pattern_trigrams: JSON.stringify([...trigrams('test react hooks')]) },
    ]
    const ranked = rankByTrigramSim('create react component for login', patterns, 3)
    expect(ranked[0].id).toBe('a')
    expect(ranked[ranked.length - 1].id).toBe('b')
  })
})

describe('Thompson ranking for injection', () => {
  let db, tmpPath
  beforeEach(() => {
    tmpPath = path.join(os.tmpdir(), `quoth-inj-${Date.now()}-${Math.random()}.db`)
    db = createDb(tmpPath)
    for (let i = 0; i < 10; i++) {
      db.upsertPattern({
        id: `p${i}`,
        name: `pattern ${i}`,
        condition: 'always',
        action: 'do thing',
        confidence: 0.5 + i * 0.04,
        alpha: i + 1,
        beta: 1,
        namespace: 'default',
      })
    }
  })

  it('rankByThompson returns requested count', () => {
    const ranked = rankByThompson(db, 'default', 3)
    expect(ranked).toHaveLength(3)
  })

  it('rankByThompson respects min confidence filter', () => {
    const ranked = rankByThompson(db, 'default', 10, { minConfidence: 0.7, excludeRecentMinutes: 0 })
    expect(ranked.length).toBeLessThan(10)
    for (const p of ranked) expect(p.confidence).toBeGreaterThanOrEqual(0.7)
  })
})
