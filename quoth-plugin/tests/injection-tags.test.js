import { describe, it, expect, beforeEach } from 'vitest'
const { createDb } = require('../daemon/db.js')
const { rankByThompson, rankByThompsonAndTrigram } = require('../daemon/lib/injection.js')
const path = require('path')
const os = require('os')

function makeTmpDb() {
  const tmpPath = path.join(os.tmpdir(), `quoth-tags-${Date.now()}-${Math.random()}.db`)
  return createDb(tmpPath)
}

describe('tag-filtered injection', () => {
  let db

  beforeEach(() => {
    db = makeTmpDb()
    // Insert patterns with different agent tags
    db.upsertPattern({
      id: 'coder-1',
      name: 'use strict types',
      condition: 'writing code',
      action: 'always use TypeScript strict mode',
      confidence: 0.8,
      alpha: 10,
      beta: 2,
      namespace: 'test-project',
      tags: ['agent:coder', 'typescript'],
    })
    db.upsertPattern({
      id: 'coder-2',
      name: 'write tests first',
      condition: 'new feature',
      action: 'write tests before implementation',
      confidence: 0.7,
      alpha: 8,
      beta: 3,
      namespace: 'test-project',
      tags: ['agent:coder', 'testing'],
    })
    db.upsertPattern({
      id: 'reviewer-1',
      name: 'check error handling',
      condition: 'reviewing code',
      action: 'verify all error paths are handled',
      confidence: 0.75,
      alpha: 9,
      beta: 2,
      namespace: 'test-project',
      tags: ['agent:code-reviewer'],
    })
    db.upsertPattern({
      id: 'generic-1',
      name: 'follow conventions',
      condition: 'any task',
      action: 'follow project coding conventions',
      confidence: 0.6,
      alpha: 6,
      beta: 4,
      namespace: 'test-project',
      tags: [],
    })
  })

  describe('db.getTopPatterns with tags', () => {
    it('returns only patterns matching the agent tag', () => {
      const results = db.getTopPatterns(10, ['agent:coder'])
      expect(results.length).toBe(2)
      expect(results.every(p => p.tags.includes('agent:coder'))).toBe(true)
    })

    it('returns all active patterns when no tags specified', () => {
      const results = db.getTopPatterns(10, [])
      expect(results.length).toBe(4)
    })

    it('excludes non-matching agent tags', () => {
      const results = db.getTopPatterns(10, ['agent:code-reviewer'])
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('reviewer-1')
    })

    it('returns empty for non-existent tag', () => {
      const results = db.getTopPatterns(10, ['agent:nonexistent'])
      expect(results.length).toBe(0)
    })
  })

  describe('db.searchBySimilarity with tags', () => {
    it('filters by agent tag when embeddings exist', () => {
      // Insert patterns with embeddings
      const fakeEmb = new Array(384).fill(0).map((_, i) => Math.sin(i))
      const fakeEmb2 = new Array(384).fill(0).map((_, i) => Math.cos(i))

      db.prepare(`UPDATE patterns SET embedding = ? WHERE id = 'coder-1'`)
        .run(JSON.stringify(fakeEmb))
      db.prepare(`UPDATE patterns SET embedding = ? WHERE id = 'reviewer-1'`)
        .run(JSON.stringify(fakeEmb2))

      const results = db.searchBySimilarity(fakeEmb, 10, ['agent:coder'])
      expect(results.every(p => p.tags.includes('agent:coder'))).toBe(true)
      expect(results.some(p => p.id === 'reviewer-1')).toBe(false)
    })

    it('returns all embedded patterns when no tags', () => {
      const fakeEmb = new Array(384).fill(0).map((_, i) => Math.sin(i))
      db.prepare(`UPDATE patterns SET embedding = ? WHERE id = 'coder-1'`)
        .run(JSON.stringify(fakeEmb))
      db.prepare(`UPDATE patterns SET embedding = ? WHERE id = 'reviewer-1'`)
        .run(JSON.stringify(fakeEmb))

      const results = db.searchBySimilarity(fakeEmb, 10, [])
      expect(results.length).toBe(2)
    })
  })

  describe('rankByThompson with tags', () => {
    it('filters candidates by agent tag', () => {
      const results = rankByThompson(db, 'test-project', 10, {
        minConfidence: 0.3,
        excludeRecentMinutes: 0,
        tags: ['agent:coder'],
      })
      expect(results.length).toBe(2)
      expect(results.every(p => p.tags.includes('agent:coder'))).toBe(true)
    })

    it('returns all patterns when no tags', () => {
      const results = rankByThompson(db, 'test-project', 10, {
        minConfidence: 0.3,
        excludeRecentMinutes: 0,
        tags: [],
      })
      expect(results.length).toBe(4)
    })

    it('returns all patterns when tags option omitted', () => {
      const results = rankByThompson(db, 'test-project', 10, {
        minConfidence: 0.3,
        excludeRecentMinutes: 0,
      })
      expect(results.length).toBe(4)
    })
  })

  describe('rankByThompsonAndTrigram with tags', () => {
    it('passes tags through to Thompson ranking', () => {
      const results = rankByThompsonAndTrigram(db, 'test-project', 'writing code with types', 10, {
        minConfidence: 0.3,
        excludeRecentMinutes: 0,
        tags: ['agent:coder'],
      })
      expect(results.length).toBe(2)
      expect(results.every(p => p.tags.includes('agent:coder'))).toBe(true)
    })
  })
})
