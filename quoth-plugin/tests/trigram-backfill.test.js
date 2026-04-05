import { describe, it, expect, beforeEach } from 'vitest'
const { createDb } = require('../daemon/db.js')
const path = require('path')
const os = require('os')

describe('upsertPattern trigram precomputation', () => {
  let db, tmpPath

  beforeEach(() => {
    tmpPath = path.join(os.tmpdir(), `quoth-trigram-${Date.now()}-${Math.random()}.db`)
    db = createDb(tmpPath)
  })

  it('stores pattern_trigrams on insert', () => {
    db.upsertPattern({
      id: 'p1', name: 'write react component', condition: 'when', action: 'create file',
      confidence: 0.7,
    })
    const row = db.prepare('SELECT pattern_trigrams FROM patterns WHERE id=?').get('p1')
    expect(row.pattern_trigrams).not.toBeNull()
    const grams = JSON.parse(row.pattern_trigrams)
    expect(Array.isArray(grams)).toBe(true)
    expect(grams.length).toBeGreaterThan(0)
    expect(grams).toContain('rea')  // from "react"
  })

  it('updates pattern_trigrams on text change', () => {
    db.upsertPattern({
      id: 'p2', name: 'original text', condition: 'c', action: 'a',
      confidence: 0.5,
    })
    const before = JSON.parse(db.prepare('SELECT pattern_trigrams FROM patterns WHERE id=?').get('p2').pattern_trigrams)

    db.upsertPattern({
      id: 'p2', name: 'completely different content', condition: 'c', action: 'a',
      confidence: 0.5,
    })
    const after = JSON.parse(db.prepare('SELECT pattern_trigrams FROM patterns WHERE id=?').get('p2').pattern_trigrams)

    expect(before).not.toEqual(after)
    expect(after).toContain('com')  // from "completely"/"content"
  })
})
