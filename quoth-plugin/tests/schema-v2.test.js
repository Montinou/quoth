import { describe, it, expect, afterAll } from 'vitest'
import { createDb } from '../daemon/db.js'
import fs from 'fs'

const tmpDb = `/tmp/quoth-v2-schema-${Date.now()}.db`

describe('v2 schema migrations', () => {
  afterAll(() => { try { fs.unlinkSync(tmpDb) } catch {} })

  it('creates v2 columns on patterns table', () => {
    const db = createDb(tmpDb)
    const cols = db.prepare('PRAGMA table_info(patterns)').all().map(c => c.name)
    for (const c of ['cluster_id','cluster_rank_score','effective_exposures','distinctiveness','retired_at','retired_reason']) {
      expect(cols).toContain(c)
    }
  })

  it('creates cluster_stats, injection_log, judge_queue tables', () => {
    const db = createDb(tmpDb)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name)
    expect(tables).toContain('cluster_stats')
    expect(tables).toContain('injection_log')
    expect(tables).toContain('judge_queue')
  })

  it('migrations are idempotent', () => {
    const db = createDb(tmpDb)
    const cols1 = db.prepare('PRAGMA table_info(patterns)').all().length
    // Reopen same DB — should not throw
    const db2 = createDb(tmpDb)
    const cols2 = db2.prepare('PRAGMA table_info(patterns)').all().length
    expect(cols1).toBe(cols2)
  })

  it('injection_log accepts inserts', () => {
    const db = createDb(tmpDb)
    db.prepare(`
      INSERT INTO injection_log (session_id, namespace, pattern_id, cluster_id, rank, propensity, is_exploration, injected_at)
      VALUES ('s1', 'test', 'p1', 0, 1, 0.5, 0, strftime('%s','now')*1000)
    `).run()
    const r = db.prepare("SELECT * FROM injection_log WHERE session_id='s1'").get()
    expect(r.pattern_id).toBe('p1')
    expect(r.propensity).toBe(0.5)
  })
})
