import { describe, it, expect, beforeEach } from 'vitest'
const { createDb } = require('../daemon/db.js')
const { loadPatternCache } = require('../daemon/lib/pattern-cache.js')
const path = require('path')
const os = require('os')

let db, tmpPath
beforeEach(() => {
  tmpPath = path.join(os.tmpdir(), `quoth-cache-${Date.now()}-${Math.random()}.db`)
  db = createDb(tmpPath)
  for (let i = 0; i < 50; i++) {
    db.upsertPattern({
      id: `p${i}`,
      name: `pattern ${i}`,
      condition: 'always',
      action: `do thing ${i}`,
      confidence: 0.5 + i * 0.01,
      alpha: i + 1,
      beta: 1,
      namespace: 'default',
      // manually set pattern_trigrams since upsertPattern doesn't compute them yet
    })
    // Pattern trigrams are not computed by upsertPattern in this task — Task 2.2 adds that
    // For the test, set them directly:
    db.prepare('UPDATE patterns SET pattern_trigrams = ? WHERE id = ?').run(
      JSON.stringify(['abc', 'bcd', 'cde']), `p${i}`
    )
  }
})

describe('pattern cache', () => {
  it('loads all active patterns with parsed trigrams', () => {
    const cache = loadPatternCache(db, 'default')
    expect(cache.patterns.length).toBe(50)
    expect(cache.patterns[0].trigramSet).toBeInstanceOf(Set)
    expect(cache.patterns[0].trigramSet.size).toBeGreaterThan(0)
  })

  it('load is under 100ms for 50 patterns', () => {
    const start = Date.now()
    loadPatternCache(db, 'default')
    expect(Date.now() - start).toBeLessThan(100)
  })

  it('filters by namespace (default + global)', () => {
    db.upsertPattern({
      id: 'other', name: 'x', condition: 'c', action: 'a',
      namespace: 'other-project', confidence: 0.8,
    })
    const cache = loadPatternCache(db, 'default')
    const ids = cache.patterns.map(p => p.id)
    expect(ids).not.toContain('other')
  })
})
