import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let db, tmpDir

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'quoth-test-'))
  process.env.QUOTH_HOME = tmpDir
  const { createDb } = require('../daemon/db.js')
  db = createDb(join(tmpDir, 'memory.db'))
})

afterEach(() => {
  if (db) db.close()
  rmSync(tmpDir, { recursive: true, force: true })
  delete process.env.QUOTH_HOME
})

describe('pattern_outcomes table', () => {
  it('insertOutcome stores a contextual outcome', () => {
    db.insertOutcome({
      pattern_id: 'pat-001',
      intention: 'refactor auth middleware',
      intention_embedding: JSON.stringify(Array(384).fill(0.1)),
      outcome: 'success',
      session_context: JSON.stringify({ project: 'quoth', agent_type: 'coder' }),
      session_id: 'sess-abc',
    })

    const rows = db.prepare('SELECT * FROM pattern_outcomes WHERE pattern_id = ?').all('pat-001')
    expect(rows).toHaveLength(1)
    expect(rows[0].intention).toBe('refactor auth middleware')
    expect(rows[0].outcome).toBe('success')
    expect(rows[0].session_id).toBe('sess-abc')
    expect(rows[0].created_at).toBeGreaterThan(0)
  })

  it('getOutcomesForPattern returns outcomes ordered by recency', () => {
    for (let i = 0; i < 5; i++) {
      db.insertOutcome({
        pattern_id: 'pat-002',
        intention: `intent-${i}`,
        outcome: i % 2 === 0 ? 'success' : 'failure',
        session_id: `sess-${i}`,
      })
    }

    const outcomes = db.getOutcomesForPattern('pat-002')
    expect(outcomes).toHaveLength(5)
    // Most recent first
    expect(outcomes[0].intention).toBe('intent-4')
  })

  it('pruneOutcomes enforces rolling window of 20 per pattern', () => {
    // Insert 25 outcomes
    for (let i = 0; i < 25; i++) {
      db.insertOutcome({
        pattern_id: 'pat-003',
        intention: `intent-${i}`,
        outcome: 'success',
        session_id: `sess-${i}`,
      })
    }

    const beforePrune = db.prepare(
      'SELECT COUNT(*) as c FROM pattern_outcomes WHERE pattern_id = ?'
    ).get('pat-003')
    expect(beforePrune.c).toBe(25)

    db.pruneOutcomes('pat-003', 20)

    const afterPrune = db.prepare(
      'SELECT COUNT(*) as c FROM pattern_outcomes WHERE pattern_id = ?'
    ).get('pat-003')
    expect(afterPrune.c).toBe(20)

    // Oldest entries deleted, newest kept
    const remaining = db.getOutcomesForPattern('pat-003')
    expect(remaining[0].intention).toBe('intent-24')
    expect(remaining[remaining.length - 1].intention).toBe('intent-5')
  })

  it('pruneOutcomes is a no-op when count is within limit', () => {
    db.insertOutcome({
      pattern_id: 'pat-004',
      intention: 'solo intent',
      outcome: 'success',
      session_id: 'sess-1',
    })

    db.pruneOutcomes('pat-004', 20)

    const count = db.prepare(
      'SELECT COUNT(*) as c FROM pattern_outcomes WHERE pattern_id = ?'
    ).get('pat-004')
    expect(count.c).toBe(1)
  })
})
