import { describe, it, expect, afterAll } from 'vitest'
import { isGenericName, distinctivenessScore, buildCommonTokens, passesQualityGate, backfillDistinctiveness } from '../daemon/lib/curation.js'
import { createDb } from '../daemon/db.js'
import fs from 'fs'

const tmpDb = `/tmp/quoth-curation-${Date.now()}.db`

describe('isGenericName', () => {
  it('flags generic openings', () => {
    expect(isGenericName('When editing a file, first read it')).toBe(true)
    expect(isGenericName('When no specific pattern was used')).toBe(true)
    expect(isGenericName('First read the file before editing')).toBe(true)
    expect(isGenericName('Always verify the output before proceeding')).toBe(true)
  })
  it('accepts specific names', () => {
    expect(isGenericName('Use Drizzle ANY() syntax for Postgres UUID arrays')).toBe(false)
    expect(isGenericName('Implement SNIPS estimator with weight clipping at 10x')).toBe(false)
  })
  it('flags short names', () => {
    expect(isGenericName('short')).toBe(true)
    expect(isGenericName('')).toBe(true)
    expect(isGenericName(null)).toBe(true)
  })
})

describe('distinctivenessScore', () => {
  it('low for generic text', () => {
    const corpus = new Set(['file','edit','read','when','use','for'])
    expect(distinctivenessScore('read file when edit for use', corpus)).toBeLessThan(0.2)
  })
  it('high for specific text', () => {
    const corpus = new Set(['file','edit','read','when','use','for'])
    expect(distinctivenessScore('Drizzle Postgres UUID ANY syntax', corpus)).toBeGreaterThan(0.6)
  })
  it('returns 0 on empty', () => {
    expect(distinctivenessScore('', new Set())).toBe(0)
  })
})

describe('buildCommonTokens', () => {
  it('returns top-N by frequency', () => {
    const patterns = [
      { name: 'file edit read', action: 'file edit' },
      { name: 'file file', action: 'file' },
      { name: 'rare unique', action: '' },
    ]
    const top = buildCommonTokens(patterns, 2)
    expect(top.has('file')).toBe(true)
    expect(top.has('edit')).toBe(true)
    expect(top.has('rare')).toBe(false)
  })
})

describe('passesQualityGate', () => {
  it('rejects generic + low distinctiveness', () => {
    const r = passesQualityGate({ name: 'When editing a file', distinctiveness: 0.1 })
    expect(r.pass).toBe(false)
    expect(r.reasons).toContain('generic-name')
    expect(r.reasons).toContain('low-distinctiveness')
  })
  it('passes specific high-distinctiveness', () => {
    const r = passesQualityGate({
      name: 'Use Drizzle ANY() syntax for Postgres UUID arrays in Neon',
      distinctiveness: 0.8,
    })
    expect(r.pass).toBe(true)
  })
  it('detects near-duplicates', () => {
    const r = passesQualityGate({
      name: 'A specific pattern name that is long enough',
      distinctiveness: 0.9,
      maxSim: 0.95,
    })
    expect(r.reasons).toContain('near-duplicate')
  })
})

describe('backfillDistinctiveness', () => {
  afterAll(() => { try { fs.unlinkSync(tmpDb) } catch {} })

  it('populates distinctiveness for all active patterns', () => {
    const db = createDb(tmpDb)
    db.prepare(`INSERT INTO patterns (id, name, condition, action, status, namespace) VALUES ('p1', 'specific UUID test', 'cond1', 'do specific thing', 'active', 'test')`).run()
    db.prepare(`INSERT INTO patterns (id, name, condition, action, status, namespace) VALUES ('p2', 'another file edit read', 'cond2', 'file edit read', 'active', 'test')`).run()
    const n = backfillDistinctiveness(db)
    expect(n).toBeGreaterThanOrEqual(2)
    const rows = db.prepare("SELECT distinctiveness FROM patterns WHERE id IN ('p1','p2')").all()
    expect(rows.every(r => r.distinctiveness != null)).toBe(true)
  })
})
