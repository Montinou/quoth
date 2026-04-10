// tests/sessions-helpers.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
const { createDb } = require('../daemon/db.js')
import { readSidecar, writeSidecar, updateSidecar, readAllEntries, synthesizeSummaryFromEntries, moveSessionFile, TRAJECTORIES_SUBDIRS } from '../daemon/lib/sessions.js'

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

describe('sessions.js — sidecar helpers', () => {
  function tmpTrajDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-traj-'))
    for (const sub of TRAJECTORIES_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    return dir
  }

  it('writeSidecar writes via .tmp → rename (atomic)', () => {
    const dir = tmpTrajDir()
    const activeDir = path.join(dir, 'active')
    writeSidecar(activeDir, 'sid-1', { session_id: 'sid-1', project: 'quoth', first_seen_ts: 100, last_seen_ts: 200, tool_count: 3, closed_marker: false })
    const raw = fs.readFileSync(path.join(activeDir, 'sid-1.meta.json'), 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.session_id).toBe('sid-1')
    expect(parsed.tool_count).toBe(3)
    expect(fs.existsSync(path.join(activeDir, 'sid-1.meta.json.tmp'))).toBe(false)
  })

  it('readSidecar returns null when file is missing', () => {
    const dir = tmpTrajDir()
    expect(readSidecar(path.join(dir, 'active'), 'nope')).toBeNull()
  })

  it('updateSidecar is read-modify-write for the same session', () => {
    const dir = tmpTrajDir()
    const activeDir = path.join(dir, 'active')
    updateSidecar(activeDir, 'sid-2', { project: 'quoth', timestamp: 1000 })
    updateSidecar(activeDir, 'sid-2', { project: 'quoth', timestamp: 2000 })
    const meta = readSidecar(activeDir, 'sid-2')
    expect(meta.first_seen_ts).toBe(1000)
    expect(meta.last_seen_ts).toBe(2000)
    expect(meta.tool_count).toBe(2)
  })
})

describe('sessions.js — readAllEntries', () => {
  it('parses every non-empty line as JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-entries-'))
    const file = path.join(dir, 'x.jsonl')
    fs.writeFileSync(file, '{"a":1}\n{"b":2}\n\n{"c":3}\n')
    const entries = readAllEntries(file)
    expect(entries).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })

  it('returns [] if the file does not exist', () => {
    expect(readAllEntries('/tmp/does-not-exist-xyz.jsonl')).toEqual([])
  })

  it('skips malformed lines without throwing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-entries-'))
    const file = path.join(dir, 'x.jsonl')
    fs.writeFileSync(file, '{"a":1}\nnotjson\n{"b":2}\n')
    expect(readAllEntries(file)).toEqual([{ a: 1 }, { b: 2 }])
  })
})

describe('sessions.js — synthesizeSummaryFromEntries', () => {
  it('aggregates tool_use entries into a synthetic session_summary', () => {
    const entries = [
      { event: 'tool_use', tool: 'Read', outcome: 'success', user_intent: 'understand auth', llm_reasoning: 'read auth.js', session: 'sid', project: 'quoth' },
      { event: 'tool_use', tool: 'Read', outcome: 'success', user_intent: 'understand auth', session: 'sid', project: 'quoth' },
      { event: 'tool_use', tool: 'Edit', outcome: 'failure', user_intent: 'fix typo', session: 'sid', project: 'quoth' },
    ]
    const s = synthesizeSummaryFromEntries(entries, { session_id: 'sid', project: 'quoth' })
    expect(s.event).toBe('session_summary')
    expect(s.session).toBe('sid')
    expect(s.project).toBe('quoth')
    expect(s.total_calls).toBe(3)
    expect(s.tool_counts).toEqual({ Read: 2, Edit: 1 })
    expect(s.success_rate).toBeCloseTo(2 / 3, 2)
    expect(s.user_intents).toContain('understand auth')
    expect(s.outcome).toBe('partial')
    expect(s.source).toBe('synthetic-aggregator')
  })

  it('handles zero entries without crashing', () => {
    const s = synthesizeSummaryFromEntries([], { session_id: 'sid', project: 'quoth' })
    expect(s.total_calls).toBe(0)
    expect(s.success_rate).toBe(0)
  })
})

describe('sessions.js — moveSessionFile', () => {
  it('renames active/<sid>.jsonl + sidecar into processing/', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-move-'))
    for (const sub of TRAJECTORIES_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    const sid = 'sid-move'
    fs.writeFileSync(path.join(dir, 'active', `${sid}.jsonl`), '{"a":1}\n')
    writeSidecar(path.join(dir, 'active'), sid, { session_id: sid, project: 'p', first_seen_ts: 1, last_seen_ts: 2, tool_count: 1 })

    const result = moveSessionFile({ trajectoriesDir: dir, sessionId: sid, from: 'active', to: 'processing' })

    expect(result.jsonlPath).toBe(path.join(dir, 'processing', `${sid}.jsonl`))
    expect(fs.existsSync(path.join(dir, 'active', `${sid}.jsonl`))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'active', `${sid}.meta.json`))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'processing', `${sid}.jsonl`))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'processing', `${sid}.meta.json`))).toBe(true)
  })

  it('renames into a dated bucket (done/YYYY-MM-DD/<project>/)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-move-done-'))
    for (const sub of TRAJECTORIES_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    const sid = 'sid-done'
    fs.writeFileSync(path.join(dir, 'processing', `${sid}.jsonl`), '{"a":1}\n')
    writeSidecar(path.join(dir, 'processing'), sid, { session_id: sid, project: 'quoth', first_seen_ts: 1, last_seen_ts: 2, tool_count: 1 })

    const result = moveSessionFile({
      trajectoriesDir: dir, sessionId: sid,
      from: 'processing', to: 'done',
      dated: true, project: 'quoth', date: '2026-04-10',
    })

    expect(result.jsonlPath).toBe(path.join(dir, 'done', '2026-04-10', 'quoth', `${sid}.jsonl`))
    expect(fs.existsSync(result.jsonlPath)).toBe(true)
  })

  it('supports a custom filename (for the epoch suffix case)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-move-epoch-'))
    for (const sub of TRAJECTORIES_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    const sid = 'sid-ep'
    fs.writeFileSync(path.join(dir, 'processing', `${sid}.jsonl`), '{"a":1}\n')
    writeSidecar(path.join(dir, 'processing'), sid, { session_id: sid, project: 'quoth', first_seen_ts: 1, last_seen_ts: 2, tool_count: 1 })

    const result = moveSessionFile({
      trajectoriesDir: dir, sessionId: sid,
      from: 'processing', to: 'done',
      dated: true, project: 'quoth', date: '2026-04-10',
      filenameOverride: `${sid}-e2.jsonl`,
    })

    expect(fs.existsSync(path.join(dir, 'done', '2026-04-10', 'quoth', `${sid}-e2.jsonl`))).toBe(true)
  })

  // Dual-form contract: positional-path form used by daemon-core and stale detector
  it('accepts positional form: moveSessionFile(jsonlPath, "processing")', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-move-pos-'))
    for (const sub of TRAJECTORIES_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    const sid = 'sid-pos'
    const activePath = path.join(dir, 'active', `${sid}.jsonl`)
    fs.writeFileSync(activePath, '{"a":1}\n')
    writeSidecar(path.join(dir, 'active'), sid, { session_id: sid, project: 'quoth', first_seen_ts: 1, last_seen_ts: 2, tool_count: 1 })

    const result = moveSessionFile(activePath, 'processing')

    expect(result.jsonlPath).toBe(path.join(dir, 'processing', `${sid}.jsonl`))
    expect(fs.existsSync(activePath)).toBe(false)
    expect(fs.existsSync(path.join(dir, 'processing', `${sid}.jsonl`))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'processing', `${sid}.meta.json`))).toBe(true)
  })

  it('positional form defaults dated=true for terminal buckets and uses opts.project', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-move-pos-dated-'))
    for (const sub of TRAJECTORIES_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    const sid = 'sid-pos-done'
    const procPath = path.join(dir, 'processing', `${sid}.jsonl`)
    fs.writeFileSync(procPath, '{"a":1}\n')
    writeSidecar(path.join(dir, 'processing'), sid, { session_id: sid, project: 'quoth', first_seen_ts: 1, last_seen_ts: 2, tool_count: 1 })

    const result = moveSessionFile(procPath, 'done', { project: 'quoth', date: '2026-04-10' })

    expect(result.jsonlPath).toBe(path.join(dir, 'done', '2026-04-10', 'quoth', `${sid}.jsonl`))
    expect(fs.existsSync(result.jsonlPath)).toBe(true)
  })
})

describe('sessions.js — updateSidecar dual-form', () => {
  function tmpTrajDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-traj-patch-'))
    for (const sub of TRAJECTORIES_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    return dir
  }

  it('2-arg patch form stamps fields without incrementing tool_count', () => {
    const dir = tmpTrajDir()
    const activeDir = path.join(dir, 'active')
    const sid = 'sid-patch'
    // prime sidecar with counter=3 via 3-arg form
    updateSidecar(activeDir, sid, { project: 'quoth', timestamp: 1000 })
    updateSidecar(activeDir, sid, { project: 'quoth', timestamp: 2000 })
    updateSidecar(activeDir, sid, { project: 'quoth', timestamp: 3000 })
    expect(readSidecar(activeDir, sid).tool_count).toBe(3)

    // patch form: add status + empty_reason without bumping counter
    const sidecarFile = path.join(activeDir, `${sid}.meta.json`)
    updateSidecar(sidecarFile, { status: 'empty', empty_reason: 'no-entries' })

    const after = readSidecar(activeDir, sid)
    expect(after.tool_count).toBe(3) // unchanged
    expect(after.status).toBe('empty')
    expect(after.empty_reason).toBe('no-entries')
  })

  it('2-arg patch form is a no-op when the sidecar is missing', () => {
    const dir = tmpTrajDir()
    const sidecarFile = path.join(dir, 'active', 'ghost.meta.json')
    expect(() => updateSidecar(sidecarFile, { status: 'error' })).not.toThrow()
  })
})

describe('insertNewFact — scope → namespace mapping', () => {
  let db
  beforeEach(() => {
    db = createDb(':memory:')
  })

  it('maps scope=global → facts:global', () => {
    db.insertNewFact(
      { topic: 't1', statement: 's1', scope: 'global', tags: [] },
      { project: 'quoth', session_id: 'x' }
    )
    const rows = db.listFactsByNamespace('facts:global')
    expect(rows.length).toBe(1)
    expect(rows[0].key).toBe('t1')
  })

  it('maps scope=project → facts:proj:<project>', () => {
    db.insertNewFact(
      { topic: 't2', statement: 's2', scope: 'project', tags: [] },
      { project: 'quoth', session_id: 'x' }
    )
    const rows = db.listFactsByNamespace('facts:proj:quoth')
    expect(rows.length).toBe(1)
  })

  it('unknown scope defaults to project namespace (defensive)', () => {
    db.insertNewFact(
      { topic: 't3', statement: 's3', scope: 'something-else', tags: [] },
      { project: 'quoth', session_id: 'x' }
    )
    const rows = db.listFactsByNamespace('facts:proj:quoth')
    expect(rows.length).toBe(1)
    expect(rows[0].key).toBe('t3')
  })

  it('upserts on duplicate (namespace,key) — new statement replaces old', () => {
    db.insertNewFact({ topic: 't4', statement: 'v1', scope: 'project', tags: [] }, { project: 'quoth', session_id: 'a' })
    db.insertNewFact({ topic: 't4', statement: 'v2', scope: 'project', tags: [] }, { project: 'quoth', session_id: 'b' })
    const rows = db.listFactsByNamespace('facts:proj:quoth')
    expect(rows.length).toBe(1)
    expect(JSON.parse(rows[0].content).statement).toBe('v2')
  })
})
