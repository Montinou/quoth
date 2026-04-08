// tests/unified-injection.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let tmpDir, db

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'quoth-unified-'))
  process.env.QUOTH_HOME = tmpDir
  const { createDb } = require('../daemon/db.js')
  db = createDb(join(tmpDir, 'memory.db'))
})

afterEach(() => {
  try { db.close() } catch {}
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('doc_chunks Thompson priors', () => {
  it('doc_chunks table has alpha/beta columns', () => {
    const info = db.prepare("PRAGMA table_info(doc_chunks)").all()
    const cols = info.map(c => c.name)
    expect(cols).toContain('alpha')
    expect(cols).toContain('beta')
  })

  it('new doc chunks default to alpha=1 beta=1', () => {
    db.upsertDocChunk({ id: 'test::Header', doc_file: 'test.md', section_header: 'Header', content: 'body text', embedding: null, content_hash: 'abc' })
    const row = db.prepare('SELECT alpha, beta FROM doc_chunks WHERE id = ?').get('test::Header')
    expect(row.alpha).toBe(1)
    expect(row.beta).toBe(1)
  })

  it('updateDocChunkAlphaBeta increments alpha on success', () => {
    db.upsertDocChunk({ id: 'dc-s', doc_file: 'a.md', section_header: 'S', content: 'c', embedding: null, content_hash: 'h1' })
    db.updateDocChunkAlphaBeta('dc-s', 'success')
    const row = db.prepare('SELECT alpha, beta FROM doc_chunks WHERE id = ?').get('dc-s')
    expect(row.alpha).toBe(2)
    expect(row.beta).toBe(1)
  })

  it('updateDocChunkAlphaBeta increments beta on failure', () => {
    db.upsertDocChunk({ id: 'dc-f', doc_file: 'a.md', section_header: 'S', content: 'c', embedding: null, content_hash: 'h2' })
    db.updateDocChunkAlphaBeta('dc-f', 'failure')
    const row = db.prepare('SELECT alpha, beta FROM doc_chunks WHERE id = ?').get('dc-f')
    expect(row.alpha).toBe(1)
    expect(row.beta).toBe(2)
  })

  it('getDocChunksWithStats returns confidence and similarity', () => {
    const emb = JSON.stringify(Array(384).fill(0.1))
    db.upsertDocChunk({ id: 'dc-stats', doc_file: 'b.md', section_header: 'S', content: 'c', embedding: emb, content_hash: 'h3' })
    db.updateDocChunkAlphaBeta('dc-stats', 'success') // alpha=2, beta=1
    const results = db.getDocChunksWithStats(Array(384).fill(0.1), 5)
    expect(results.length).toBe(1)
    expect(results[0].confidence).toBeCloseTo(2 / 3)
    expect(results[0]._similarity).toBeGreaterThan(0.9)
  })
})

describe('injection_log accepts doc: prefixed IDs', () => {
  it('logs doc chunk injection with cluster -1', () => {
    db.logInjection({
      session_id: 'test-session',
      namespace: 'quoth',
      pattern_id: 'doc:05-daemon-pipeline.md::Batch JUDGE',
      cluster_id: -1,
      rank: 1,
      propensity: 0.15,
      is_exploration: 0,
      query_text: 'how does batch judge work',
    })
    const row = db.prepare("SELECT * FROM injection_log WHERE pattern_id LIKE 'doc:%'").get()
    expect(row).toBeDefined()
    expect(row.pattern_id).toBe('doc:05-daemon-pipeline.md::Batch JUDGE')
    expect(row.cluster_id).toBe(-1)
  })

  it('updateInjectionOutcome works for doc: IDs', () => {
    db.logInjection({
      session_id: 'sess-1',
      namespace: 'quoth',
      pattern_id: 'doc:10-local-database.md::Patterns Table',
      cluster_id: -1,
      rank: 2,
      propensity: 0.20,
      is_exploration: 0,
      query_text: 'sqlite schema',
    })
    db.updateInjectionOutcome('sess-1', 'doc:10-local-database.md::Patterns Table', 0.8)
    const row = db.prepare("SELECT reward, outcome_at FROM injection_log WHERE pattern_id = ?")
      .get('doc:10-local-database.md::Patterns Table')
    expect(row.reward).toBeCloseTo(0.8)
    expect(row.outcome_at).toBeTruthy()
  })
})

describe('graded reward signal', () => {
  it('returns 1.0 for high success_rate session summary', () => {
    const { sessionOutcomeReward } = require('../daemon/lib/attribution.js')
    expect(sessionOutcomeReward([{ event: 'session_summary', success_rate: 0.9 }])).toBe(1.0)
  })

  it('returns 0.7 for moderate success_rate', () => {
    const { sessionOutcomeReward } = require('../daemon/lib/attribution.js')
    expect(sessionOutcomeReward([{ event: 'session_summary', success_rate: 0.6 }])).toBe(0.7)
  })

  it('returns 0.8 for writes with no errors', () => {
    const { sessionOutcomeReward } = require('../daemon/lib/attribution.js')
    const events = [
      { tool: 'Edit' },
      { tool: 'Write' },
      { tool: 'Bash', exit_code: 0 },
    ]
    expect(sessionOutcomeReward(events)).toBe(0.8)
  })

  it('returns 0.2 for bash errors only', () => {
    const { sessionOutcomeReward } = require('../daemon/lib/attribution.js')
    const events = [
      { tool: 'Bash', exit_code: 1 },
      { tool: 'Bash', exit_code: 127 },
    ]
    expect(sessionOutcomeReward(events)).toBe(0.2)
  })

  it('returns 0.5 for empty events', () => {
    const { sessionOutcomeReward } = require('../daemon/lib/attribution.js')
    expect(sessionOutcomeReward([])).toBe(0.5)
  })
})

describe('recordExposure filters doc: IDs', () => {
  it('does not crash on doc: prefixed IDs', () => {
    const { recordExposure } = require('../daemon/lib/scoring.js')
    // Should not throw — doc: IDs are filtered out before UPDATE
    expect(() => recordExposure(db, ['doc:test.md::Header', 'doc:other.md::Section'])).not.toThrow()
  })

  it('still records exposure for real pattern IDs', () => {
    const { recordExposure } = require('../daemon/lib/scoring.js')
    db.upsertPattern({ id: 'real-1', name: 'p', pattern_type: 'code-pattern',
      condition: 'c', action: 'a', confidence: 0.5, tags: [], source: 'test' })
    recordExposure(db, ['real-1', 'doc:test.md::Header'])
    const p = db.getPattern('real-1')
    expect(p.exposure_count).toBe(1)
  })
})

describe('flags diagnostic', () => {
  it('getActiveFlags returns all V2 flags', () => {
    const { getActiveFlags } = require('../daemon/lib/flags.js')
    const flags = getActiveFlags()
    expect(flags).toHaveProperty('master')
    expect(flags).toHaveProperty('injection')
    expect(flags).toHaveProperty('exploration')
    expect(flags).toHaveProperty('judge')
    expect(flags).toHaveProperty('curation')
  })
})
