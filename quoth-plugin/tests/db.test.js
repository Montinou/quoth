// tests/db.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let tmpDir, db

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'quoth-test-'))
  process.env.QUOTH_HOME = tmpDir
  const { createDb } = require('../daemon/db.js')
  db = createDb(join(tmpDir, 'memory.db'))
})

afterEach(() => {
  try { db.close() } catch {}
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('db', () => {
  it('initializes schema tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all().map(r => r.name)
    expect(tables).toContain('patterns')
    expect(tables).toContain('trajectories')
    expect(tables).toContain('memory_entries')
  })

  it('upserts a pattern and reads it back', () => {
    db.upsertPattern({
      id: 'test-pat-1', name: 'visibility-filter', pattern_type: 'code-pattern',
      condition: 'multiple elements match', action: 'add :visible filter',
      confidence: 0.5, tags: ['selector', 'playwright'], source: 'distilled'
    })
    const p = db.getPattern('test-pat-1')
    expect(p.name).toBe('visibility-filter')
    expect(p.confidence).toBeCloseTo(0.5)
  })

  it('applies confidence delta correctly', () => {
    db.upsertPattern({ id: 'p1', name: 'p', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.5, tags: [], source: 'test' })
    db.applyConfidenceDelta('p1', 0.03)
    const p = db.getPattern('p1')
    expect(p.confidence).toBeCloseTo(0.53)
  })

  it('caps confidence at 1.0', () => {
    db.upsertPattern({ id: 'p2', name: 'p', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.99, tags: [], source: 'test' })
    db.applyConfidenceDelta('p2', 0.03)
    const p = db.getPattern('p2')
    expect(p.confidence).toBeLessThanOrEqual(1.0)
  })

  it('returns top patterns sorted by confidence', () => {
    db.upsertPattern({ id: 'low', name: 'l', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.3, tags: [], source: 'test' })
    db.upsertPattern({ id: 'high', name: 'h', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.9, tags: [], source: 'test' })
    const top = db.getTopPatterns(5)
    expect(top[0].id).toBe('high')
  })

  it('applies hourly decay to all patterns', () => {
    db.upsertPattern({ id: 'decay-p', name: 'p', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.8, tags: [], source: 'test' })
    db.applyHourlyDecay()
    const p = db.getPattern('decay-p')
    expect(p.confidence).toBeCloseTo(0.795)
  })

  it('floors confidence at 0.0', () => {
    db.upsertPattern({ id: 'floor-p', name: 'p', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.002, tags: [], source: 'test' })
    db.applyHourlyDecay()
    const p = db.getPattern('floor-p')
    expect(p.confidence).toBeGreaterThanOrEqual(0.0)
  })
})
