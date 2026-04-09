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

  it('does NOT decay never-exposed patterns (exposure-based, not temporal)', () => {
    db.upsertPattern({ id: 'no-exposure', name: 'p', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.5, tags: [], source: 'test' })
    db.prepare("UPDATE patterns SET alpha = 1, beta = 1 WHERE id = 'no-exposure'").run()
    db.applyHourlyDecay()
    const p = db.prepare("SELECT alpha, beta, confidence FROM patterns WHERE id = 'no-exposure'").get()
    expect(p.alpha).toBe(1)
    expect(p.beta).toBe(1)
    expect(p.confidence).toBeCloseTo(0.5)
  })

  it('decays exposed patterns with poor conversion (Tier 1)', () => {
    db.upsertPattern({ id: 'poor-conv', name: 'p', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.5, tags: [], source: 'test' })
    // 10 exposures, 0 successes → 0% conversion
    db.prepare("UPDATE patterns SET alpha = 1, beta = 1, exposure_count = 10, success_count = 0 WHERE id = 'poor-conv'").run()
    db.applyHourlyDecay()
    const p = db.prepare("SELECT beta, confidence FROM patterns WHERE id = 'poor-conv'").get()
    expect(p.beta).toBeCloseTo(1.05, 5)
    expect(p.confidence).toBeLessThan(0.5)
  })

  it('applies gentle alpha decay to high-exposure patterns (Tier 2)', () => {
    db.upsertPattern({ id: 'dominant', name: 'p', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.9, tags: [], source: 'test' })
    db.prepare("UPDATE patterns SET alpha = 10, beta = 2, exposure_count = 25 WHERE id = 'dominant'").run()
    db.applyHourlyDecay()
    const p = db.prepare("SELECT alpha FROM patterns WHERE id = 'dominant'").get()
    expect(p.alpha).toBeLessThan(10)
    expect(p.alpha).toBeGreaterThan(9.99) // very gentle: 10 * 0.9995 = 9.995
  })

  it('floors confidence at 0.05', () => {
    db.upsertPattern({ id: 'floor-p', name: 'p', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.06, tags: [], source: 'test' })
    db.prepare("UPDATE patterns SET alpha = 1, beta = 100, exposure_count = 10, success_count = 0 WHERE id = 'floor-p'").run()
    db.applyHourlyDecay()
    const p = db.getPattern('floor-p')
    expect(p.confidence).toBeGreaterThanOrEqual(0.05)
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

  it('has alpha and beta columns for Bayesian scoring', () => {
    const cols = db.prepare("PRAGMA table_info(patterns)").all().map(r => r.name)
    expect(cols).toContain('alpha')
    expect(cols).toContain('beta')
  })

  it('upsertPattern sets default alpha=1 beta=1 for new patterns', () => {
    db.upsertPattern({ id: 'bayes-1', name: 'b', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.5, tags: [], source: 'distilled' })
    const p = db.prepare("SELECT alpha, beta FROM patterns WHERE id = 'bayes-1'").get()
    expect(p.alpha).toBe(1)
    expect(p.beta).toBe(1)
  })

  it('applyBayesianUpdate increments alpha on success', () => {
    db.upsertPattern({ id: 'bayes-2', name: 'b', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.5, tags: [], source: 'distilled' })
    db.applyBayesianUpdate('bayes-2', 'success')
    const p = db.prepare("SELECT alpha, beta, confidence FROM patterns WHERE id = 'bayes-2'").get()
    expect(p.alpha).toBe(2)
    expect(p.beta).toBe(1)
    expect(p.confidence).toBeCloseTo(2 / 3)
  })

  it('applyBayesianUpdate increments beta on failure', () => {
    db.upsertPattern({ id: 'bayes-3', name: 'b', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.5, tags: [], source: 'distilled' })
    db.applyBayesianUpdate('bayes-3', 'failure')
    const p = db.prepare("SELECT alpha, beta, confidence FROM patterns WHERE id = 'bayes-3'").get()
    expect(p.alpha).toBe(1)
    expect(p.beta).toBe(2)
    expect(p.confidence).toBeCloseTo(1 / 3)
  })

  it('applyHourlyDecay only touches exposed patterns', () => {
    db.upsertPattern({ id: 'decay-bayes', name: 'b', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.9, tags: [], source: 'distilled' })
    // No exposure → no decay
    db.prepare("UPDATE patterns SET alpha = 10, beta = 2 WHERE id = 'decay-bayes'").run()
    db.applyHourlyDecay()
    const p = db.prepare("SELECT alpha, beta FROM patterns WHERE id = 'decay-bayes'").get()
    expect(p.alpha).toBe(10)
    expect(p.beta).toBe(2)
  })
})

describe('doc_chunks Thompson priors', () => {
  it('doc_chunks table has alpha and beta columns', () => {
    const cols = db.prepare("PRAGMA table_info(doc_chunks)").all().map(r => r.name)
    expect(cols).toContain('alpha')
    expect(cols).toContain('beta')
  })

  it('upsertDocChunk defaults alpha=1 beta=1', () => {
    db.upsertDocChunk({ id: 'test::Header', doc_file: 'test.md', section_header: 'Header', content: 'body', embedding: null, content_hash: 'abc' })
    const row = db.prepare('SELECT alpha, beta FROM doc_chunks WHERE id = ?').get('test::Header')
    expect(row.alpha).toBe(1)
    expect(row.beta).toBe(1)
  })

  it('updateDocChunkAlphaBeta increments alpha on success', () => {
    db.upsertDocChunk({ id: 'dc1', doc_file: 'a.md', section_header: 'S', content: 'c', embedding: null, content_hash: 'h1' })
    db.updateDocChunkAlphaBeta('dc1', 'success')
    const row = db.prepare('SELECT alpha, beta FROM doc_chunks WHERE id = ?').get('dc1')
    expect(row.alpha).toBe(2)
    expect(row.beta).toBe(1)
  })

  it('updateDocChunkAlphaBeta increments beta on failure', () => {
    db.upsertDocChunk({ id: 'dc2', doc_file: 'a.md', section_header: 'S', content: 'c', embedding: null, content_hash: 'h2' })
    db.updateDocChunkAlphaBeta('dc2', 'failure')
    const row = db.prepare('SELECT alpha, beta FROM doc_chunks WHERE id = ?').get('dc2')
    expect(row.alpha).toBe(1)
    expect(row.beta).toBe(2)
  })

  it('getDocChunksWithStats returns confidence field', () => {
    const emb = JSON.stringify(Array(384).fill(0.1))
    db.upsertDocChunk({ id: 'dc3', doc_file: 'b.md', section_header: 'S', content: 'c', embedding: emb, content_hash: 'h3' })
    db.updateDocChunkAlphaBeta('dc3', 'success') // alpha=2, beta=1 → confidence=0.667
    const results = db.getDocChunksWithStats(Array(384).fill(0.1), 5)
    expect(results.length).toBe(1)
    expect(results[0].confidence).toBeCloseTo(2 / 3)
    expect(results[0]._similarity).toBeGreaterThan(0.9)
  })

  describe('pipeline_errors', () => {
    it('insertPipelineError stores error with all fields', () => {
      db.insertPipelineError({
        stage: 'extract',
        error_message: 'JSON parse failed',
        error_stack: 'Error: JSON parse failed\n  at extract.js:42',
        context: JSON.stringify({ session_id: 'sess-1', model: 'claude-sonnet' }),
        model_attempted: 'claude-sonnet-4-6',
        fallback_attempted: 1,
        fallback_succeeded: 0,
      })

      const rows = db.prepare('SELECT * FROM pipeline_errors').all()
      expect(rows).toHaveLength(1)
      expect(rows[0].stage).toBe('extract')
      expect(rows[0].error_message).toBe('JSON parse failed')
      expect(rows[0].model_attempted).toBe('claude-sonnet-4-6')
      expect(rows[0].fallback_attempted).toBe(1)
      expect(rows[0].fallback_succeeded).toBe(0)
      expect(rows[0].created_at).toBeGreaterThan(0)
    })

    it('insertPipelineError works with minimal fields', () => {
      db.insertPipelineError({
        stage: 'embed',
        error_message: 'Model load failed',
      })
      const rows = db.prepare('SELECT * FROM pipeline_errors').all()
      expect(rows).toHaveLength(1)
      expect(rows[0].error_stack).toBeNull()
      expect(rows[0].fallback_attempted).toBe(0)
    })
  })

  describe('format_version', () => {
    it('patterns table has format_version column defaulting to 1', () => {
      db.upsertPattern({
        id: 'test-fv',
        name: 'test pattern',
        condition: 'test',
        action: 'test action',
        confidence: 0.5,
        tags: [],
        source: 'distilled',
      })

      const row = db.prepare('SELECT format_version FROM patterns WHERE id = ?').get('test-fv')
      expect(row.format_version).toBe(1)
    })

    it('format_version can be set to 2 for new-format patterns', () => {
      db.upsertPattern({
        id: 'test-fv2',
        name: 'rich pattern with context',
        condition: 'test',
        action: 'rich pattern text',
        confidence: 0.67,
        tags: [],
        source: 'distilled',
      })
      db.prepare('UPDATE patterns SET format_version = 2 WHERE id = ?').run('test-fv2')

      const row = db.prepare('SELECT format_version FROM patterns WHERE id = ?').get('test-fv2')
      expect(row.format_version).toBe(2)
    })
  })

  describe('findDuplicateByEmbedding configurable threshold', () => {
    it('uses QUOTH_DEDUP_THRESHOLD env var when set', () => {
      // Init HNSW so findDuplicateByEmbedding can search
      db.initHnsw()

      // Insert a pattern with a known embedding
      const vec = Array(384).fill(0)
      vec[0] = 1.0
      db.upsertPattern({
        id: 'dedup-test-1',
        name: 'test pattern',
        condition: 'test',
        action: 'test',
        confidence: 0.5,
        tags: [],
        embedding: JSON.stringify(vec),
      })

      // Create a slightly different vector (high similarity ~0.95 but below 1.0)
      const query = Array(384).fill(0)
      query[0] = 0.98
      query[1] = 0.2

      // With high threshold (0.99) → should NOT find duplicate
      process.env.QUOTH_DEDUP_THRESHOLD = '0.99'
      const noDup = db.findDuplicateByEmbedding(query)
      expect(noDup).toBeNull()

      // With low threshold (0.80) → should find duplicate
      process.env.QUOTH_DEDUP_THRESHOLD = '0.80'
      const yesDup = db.findDuplicateByEmbedding(query)
      expect(yesDup).not.toBeNull()
      expect(yesDup.id).toBe('dedup-test-1')

      // Cleanup
      delete process.env.QUOTH_DEDUP_THRESHOLD
    })
  })
})
