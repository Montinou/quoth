import { describe, it, expect, afterAll } from 'vitest'
import { isGenericName, distinctivenessScore, buildCommonTokens, passesQualityGate, backfillDistinctiveness, findNearDuplicates, cosineSim, retirePoorPatterns } from '../daemon/lib/curation.js'
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

describe('cosineSim', () => {
  it('returns 1 for identical', () => expect(cosineSim([1,0,0], [1,0,0])).toBeCloseTo(1, 5))
  it('returns 0 for orthogonal', () => expect(cosineSim([1,0,0], [0,1,0])).toBeCloseTo(0, 5))
  it('returns 0 for empty', () => expect(cosineSim([], [])).toBe(0))
})

describe('findNearDuplicates', () => {
  const tmpDup = `/tmp/quoth-dup-${Date.now()}.db`
  it('finds pairs above threshold', () => {
    const db = createDb(tmpDup)
    db.prepare("INSERT INTO patterns (id, name, condition, action, status, namespace, confidence, embedding) VALUES ('a','name a','c','act','active','test',0.7,?)").run(JSON.stringify([1,0,0]))
    db.prepare("INSERT INTO patterns (id, name, condition, action, status, namespace, confidence, embedding) VALUES ('b','name b','c','act','active','test',0.5,?)").run(JSON.stringify([0.99,0.01,0]))
    db.prepare("INSERT INTO patterns (id, name, condition, action, status, namespace, confidence, embedding) VALUES ('c','name c','c','act','active','test',0.5,?)").run(JSON.stringify([0,0,1]))
    const dups = findNearDuplicates(db, 0.9)
    expect(dups.length).toBe(1)
    expect(dups[0].keep).toBe('a')  // higher confidence wins
    expect(dups[0].archive).toBe('b')
    fs.unlinkSync(tmpDup)
  })
})

describe('retirePoorPatterns', () => {
  const tmpRet = `/tmp/quoth-retire-${Date.now()}.db`
  it('retires patterns with low CI upper after many attempts', () => {
    const db = createDb(tmpRet)
    db.prepare("INSERT INTO patterns (id, name, condition, action, alpha, beta, confidence, status, namespace) VALUES ('p1','bad pattern very long name','c','act',1,100,0.01,'active','test')").run()
    db.prepare("INSERT INTO patterns (id, name, condition, action, alpha, beta, confidence, status, namespace) VALUES ('p2','good pattern very long name','c','act',50,5,0.91,'active','test')").run()
    const n = retirePoorPatterns(db, { ciUpperThreshold: 0.2, stalenessDays: 365, minAttempts: 20 })
    expect(n).toBe(1)
    const r1 = db.prepare("SELECT status, retired_reason FROM patterns WHERE id='p1'").get()
    const r2 = db.prepare("SELECT status FROM patterns WHERE id='p2'").get()
    expect(r1.status).toBe('archived')
    expect(r1.retired_reason).toBe('low-ci-upper')
    expect(r2.status).toBe('active')
    fs.unlinkSync(tmpRet)
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
