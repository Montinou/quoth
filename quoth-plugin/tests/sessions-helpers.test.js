// tests/sessions-helpers.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
const { createDb } = require('../daemon/db.js')

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-sessions-test-'))
  const dbPath = path.join(dir, 'memory.db')
  const db = createDb(dbPath)
  db.initHnsw()
  return { db, dir }
}

describe('sessions table schema', () => {
  it('creates the sessions table with the expected columns', () => {
    const { db } = tmpDb()
    const cols = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining([
      'session_id', 'project', 'first_seen_ts', 'last_seen_ts',
      'tool_count', 'status', 'closed_marker', 'extracted_at',
      'pattern_count', 'fact_count', 'epoch',
    ]))
  })

  it('enforces status CHECK: active,processing,done,routine,empty,error', () => {
    const { db } = tmpDb()
    db.prepare(`
      INSERT INTO sessions (session_id, project, first_seen_ts, last_seen_ts, status)
      VALUES ('s1', 'quoth', 1, 2, 'active')
    `).run()
    expect(() => db.prepare(`
      INSERT INTO sessions (session_id, project, first_seen_ts, last_seen_ts, status)
      VALUES ('s2', 'quoth', 1, 2, 'trivial')
    `).run()).toThrow(/CHECK/)
  })
})

describe('sessions CRUD helpers', () => {
  it('upsertSession inserts then updates', () => {
    const { db } = tmpDb()
    db.upsertSession({
      session_id: 'sess-a', project: 'quoth',
      first_seen_ts: 1000, last_seen_ts: 1000, tool_count: 0,
      status: 'active', closed_marker: 0,
    })
    db.upsertSession({
      session_id: 'sess-a', project: 'quoth',
      first_seen_ts: 1000, last_seen_ts: 2000, tool_count: 5,
      status: 'active', closed_marker: 0,
    })
    const row = db.getSession('sess-a')
    expect(row.last_seen_ts).toBe(2000)
    expect(row.tool_count).toBe(5)
  })

  it('updateSessionStatus changes status and extracted_at on terminal states', () => {
    const { db } = tmpDb()
    db.upsertSession({
      session_id: 's', project: 'p', first_seen_ts: 1, last_seen_ts: 1,
      tool_count: 0, status: 'active', closed_marker: 0,
    })
    db.updateSessionStatus('s', 'processing')
    expect(db.getSession('s').status).toBe('processing')
    db.updateSessionStatus('s', 'done', { pattern_count: 2, fact_count: 1 })
    const row = db.getSession('s')
    expect(row.status).toBe('done')
    expect(row.pattern_count).toBe(2)
    expect(row.fact_count).toBe(1)
    expect(row.extracted_at).toBeGreaterThan(0)
  })

  it('listSessions filters by status and maxLastSeen', () => {
    const { db } = tmpDb()
    db.upsertSession({ session_id: 'a', project: 'p', first_seen_ts: 1, last_seen_ts: 100, tool_count: 1, status: 'active', closed_marker: 0 })
    db.upsertSession({ session_id: 'b', project: 'p', first_seen_ts: 1, last_seen_ts: 500, tool_count: 1, status: 'active', closed_marker: 0 })
    db.upsertSession({ session_id: 'c', project: 'p', first_seen_ts: 1, last_seen_ts: 100, tool_count: 1, status: 'done', closed_marker: 0 })
    const stale = db.listSessions({ status: 'active', maxLastSeen: 200 })
    expect(stale.map(r => r.session_id)).toEqual(['a'])
  })

  it('updateSessionStatus returns RunResult so callers can detect missing rows', () => {
    const { db } = tmpDb()
    db.upsertSession({
      session_id: 'present', project: 'p', first_seen_ts: 1, last_seen_ts: 1,
      tool_count: 0, status: 'active', closed_marker: 0,
    })
    const hit = db.updateSessionStatus('present', 'done')
    expect(hit.changes).toBe(1)
    const miss = db.updateSessionStatus('missing-sid', 'done')
    expect(miss.changes).toBe(0)
  })

  it('countSessionEpochs returns number of existing epochs for (session_id, bucket)', () => {
    const { db } = tmpDb()
    db.upsertSession({ session_id: 'sid', project: 'p', first_seen_ts: 1, last_seen_ts: 1, tool_count: 1, status: 'done', closed_marker: 1, epoch: 1 })
    db.upsertSession({ session_id: 'sid', project: 'p', first_seen_ts: 2, last_seen_ts: 2, tool_count: 1, status: 'done', closed_marker: 1, epoch: 2 })
    expect(db.countSessionEpochs('sid', 'done')).toBe(2)
    expect(db.countSessionEpochs('sid', 'routine')).toBe(0)
  })
})

describe('daemon_meta helpers', () => {
  it('setDaemonMeta + getDaemonMeta round-trip', () => {
    const { db } = tmpDb()
    db.setDaemonMeta('last_stale_scan_ts', '1234')
    expect(db.getDaemonMeta('last_stale_scan_ts')).toBe('1234')
    expect(db.getDaemonMeta('missing')).toBeNull()
  })
})
