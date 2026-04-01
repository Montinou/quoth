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

  it('stores and retrieves embedding in upsertPattern', () => {
    const vec = [1, 0, 0]
    db.upsertPattern({ id: 'emb-1', name: 'e', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.5, tags: [], source: 'test',
      embedding: JSON.stringify(vec) })
    const p = db.getPattern('emb-1')
    expect(JSON.parse(p.embedding)).toEqual(vec)
  })

  it('searchBySimilarity returns closest vector match', () => {
    db.upsertPattern({ id: 'vec-1', name: 'v1', pattern_type: 'code-pattern',
      condition: 'c', action: 'use :visible', confidence: 0.5, tags: [], source: 'test',
      embedding: JSON.stringify([1, 0, 0]) })
    db.upsertPattern({ id: 'vec-2', name: 'v2', pattern_type: 'code-pattern',
      condition: 'c', action: 'use data-testid', confidence: 0.5, tags: [], source: 'test',
      embedding: JSON.stringify([0, 1, 0]) })
    const results = db.searchBySimilarity([0.9, 0.1, 0], 5)
    expect(results[0].id).toBe('vec-1')
  })

  it('searchBySimilarity falls back to confidence sort when no embeddings stored', () => {
    db.upsertPattern({ id: 'no-emb-hi', name: 'h', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.9, tags: [], source: 'test' })
    db.upsertPattern({ id: 'no-emb-lo', name: 'l', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.3, tags: [], source: 'test' })
    const results = db.searchBySimilarity([1, 0, 0], 5)
    expect(results[0].id).toBe('no-emb-hi')
  })

  it('has promoted_at, cloud_document_id, promoted_confidence, applicability columns', () => {
    const cols = db.prepare("PRAGMA table_info(patterns)").all().map(r => r.name)
    expect(cols).toContain('promoted_at')
    expect(cols).toContain('cloud_document_id')
    expect(cols).toContain('promoted_confidence')
    expect(cols).toContain('applicability')
  })

  it('markPromoted sets all three promotion fields', () => {
    db.upsertPattern({ id: 'promo-1', name: 'p', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.9, tags: [], source: 'distilled' })
    db.markPromoted('promo-1', 'doc-uuid-123', 0.9)
    const p = db.getPattern('promo-1')
    expect(p.cloud_document_id).toBe('doc-uuid-123')
    expect(p.promoted_confidence).toBeCloseTo(0.9)
    expect(p.promoted_at).toBeGreaterThan(0)
  })

  it('getPromotionCandidates returns patterns above threshold', () => {
    db.upsertPattern({ id: 'cand-1', name: 'p', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.85, tags: [], source: 'distilled' })
    db.prepare("UPDATE patterns SET success_count = 8, failure_count = 3 WHERE id = 'cand-1'").run()
    const candidates = db.getPromotionCandidates()
    expect(candidates.find(c => c.id === 'cand-1')).toBeTruthy()
  })

  it('getPromotionCandidates returns parsed tags array', () => {
    db.upsertPattern({ id: 'cand-2', name: 'p', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.85, tags: ['foo', 'bar'], source: 'distilled' })
    db.prepare("UPDATE patterns SET success_count = 8, failure_count = 3 WHERE id = 'cand-2'").run()
    const candidates = db.getPromotionCandidates()
    const c = candidates.find(c => c.id === 'cand-2')
    expect(Array.isArray(c.tags)).toBe(true)
    expect(c.tags).toContain('foo')
  })
})
