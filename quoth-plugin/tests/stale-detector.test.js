import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
const { createDb } = require('../daemon/db.js')

// Helper: build a temp home with the trajectory layout.
function setupHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-stale-test-'))
  const traj = path.join(tmp, 'trajectories')
  for (const sub of ['active', 'processing', 'done', 'routine', 'empty', 'error']) {
    fs.mkdirSync(path.join(traj, sub), { recursive: true })
  }
  return tmp
}

// Seed an active session: jsonl entries + sidecar with back-dated last_seen_ts.
function seedActive(home, sid, { entries, ageMs, project = 'quoth' }) {
  const dir = path.join(home, 'trajectories', 'active')
  const jsonl = path.join(dir, `${sid}.jsonl`)
  const meta = path.join(dir, `${sid}.meta.json`)
  const lastSeen = Date.now() - ageMs
  fs.writeFileSync(
    jsonl,
    entries.length ? entries.map(e => JSON.stringify(e)).join('\n') + '\n' : ''
  )
  fs.writeFileSync(meta, JSON.stringify({
    session_id: sid,
    project,
    first_seen_ts: lastSeen - 1000,
    last_seen_ts: lastSeen,
    tool_count: entries.length,
    closed_marker: false,
  }))
  fs.utimesSync(jsonl, new Date(lastSeen), new Date(lastSeen))
  fs.utimesSync(meta, new Date(lastSeen), new Date(lastSeen))
}

describe('syncActiveSessionsToDb — sidecar → sessions table', () => {
  let home, db
  beforeEach(() => {
    home = setupHome()
    process.env.QUOTH_HOME = home
    db = createDb(path.join(home, 'stale.db'))
  })
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} ; delete process.env.QUOTH_HOME })

  it('upserts every sidecar in active/ into the sessions table with status=active', () => {
    seedActive(home, 'sA', { entries: [{ event: 'tool_use', tool: 'Bash' }], ageMs: 1000 })
    seedActive(home, 'sB', { entries: [{ event: 'tool_use', tool: 'Read' }, { event: 'tool_use', tool: 'Edit' }], ageMs: 2000 })

    const { syncActiveSessionsToDb } = require('../daemon/stale-detector.js')
    const n = syncActiveSessionsToDb(db, path.join(home, 'trajectories'))
    expect(n).toBe(2)

    const rows = db.listSessions({ status: 'active' })
    expect(rows.length).toBe(2)
    const sA = rows.find(r => r.session_id === 'sA')
    expect(sA.tool_count).toBe(1)
    expect(sA.project).toBe('quoth')
  })

  it('is a no-op when active/ is empty', () => {
    const { syncActiveSessionsToDb } = require('../daemon/stale-detector.js')
    expect(syncActiveSessionsToDb(db, path.join(home, 'trajectories'))).toBe(0)
    expect(db.listSessions({ status: 'active' }).length).toBe(0)
  })

  it('skips malformed sidecars without throwing', () => {
    fs.writeFileSync(path.join(home, 'trajectories', 'active', 'bad.meta.json'), '{not json')
    const { syncActiveSessionsToDb } = require('../daemon/stale-detector.js')
    expect(() => syncActiveSessionsToDb(db, path.join(home, 'trajectories'))).not.toThrow()
  })
})

describe('detectStaleSessions — NO trivial gate: every stale active → processing/', () => {
  let home, db
  beforeEach(() => {
    home = setupHome()
    process.env.QUOTH_HOME = home
    db = createDb(path.join(home, 'stale.db'))
  })
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} ; delete process.env.QUOTH_HOME })

  it('1-entry session idle > STALE_TTL → processing/ (spec §6.4: no trivial gate)', () => {
    const sid = 'sess-1entry-stale'
    seedActive(home, sid, {
      entries: [{ event: 'tool_use', session: sid, tool: 'Write', outcome: 'success', task: 'add feature flag' }],
      ageMs: 35 * 60 * 1000,
    })

    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })

    expect(fs.existsSync(path.join(home, 'trajectories', 'active', `${sid}.jsonl`))).toBe(false)
    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', `${sid}.jsonl`))).toBe(true)
    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', `${sid}.meta.json`))).toBe(true)
    expect(fs.readdirSync(path.join(home, 'trajectories', 'empty'))).not.toContain(`${sid}.jsonl`)
  })

  it('2-entry session idle > STALE_TTL → processing/ (no trivial gate)', () => {
    const sid = 'sess-2entry-stale'
    seedActive(home, sid, {
      entries: [
        { event: 'tool_use', session: sid, tool: 'Bash', outcome: 'success' },
        { event: 'tool_use', session: sid, tool: 'Read', outcome: 'success' },
      ],
      ageMs: 35 * 60 * 1000,
    })

    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })

    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', `${sid}.jsonl`))).toBe(true)
    expect(fs.readdirSync(path.join(home, 'trajectories', 'empty'))).not.toContain(`${sid}.jsonl`)
  })

  it('5-entry session idle > STALE_TTL → processing/', () => {
    const sid = 'sess-5entry-stale'
    const entries = Array.from({ length: 5 }, (_, i) => ({
      event: 'tool_use', session: sid, tool: 'Bash', outcome: 'success', task: `cmd ${i}`,
    }))
    seedActive(home, sid, { entries, ageMs: 35 * 60 * 1000 })

    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })

    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', `${sid}.jsonl`))).toBe(true)
    const row = db.getSession(sid)
    expect(row).toBeTruthy()
    expect(row.status).toBe('processing')
  })

  it('0-entry session idle > STALE_TTL → processing/ (daemon will route to empty/)', () => {
    const sid = 'sess-0entry'
    seedActive(home, sid, { entries: [], ageMs: 35 * 60 * 1000 })

    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })

    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', `${sid}.jsonl`))).toBe(true)
  })

  it('fresh 5-entry session (idle < STALE_TTL) is untouched', () => {
    const sid = 'sess-active-5'
    const entries = Array.from({ length: 5 }, () => ({
      event: 'tool_use', session: sid, tool: 'Read', outcome: 'success',
    }))
    seedActive(home, sid, { entries, ageMs: 5 * 60 * 1000 })

    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })

    expect(fs.existsSync(path.join(home, 'trajectories', 'active', `${sid}.jsonl`))).toBe(true)
    expect(fs.readdirSync(path.join(home, 'trajectories', 'processing'))).toHaveLength(0)
  })

  it('stale detector uses the SQL query path, NOT fs.readdir on active/', () => {
    // Regression guard. Seed the sessions table WITHOUT corresponding files —
    // the detector must skip such rows gracefully.
    db.upsertSession({
      session_id: 'ghost',
      project: 'quoth',
      first_seen_ts: Date.now() - 40 * 60 * 1000,
      last_seen_ts: Date.now() - 40 * 60 * 1000,
      tool_count: 3,
      status: 'active',
      closed_marker: 0,
      epoch: 1,
    })
    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    expect(() => detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })).not.toThrow()
    expect(db.getSession('ghost')).toBeTruthy()
  })
})

describe('detectStaleSessions — last_stale_scan_ts persistence', () => {
  let home, db
  beforeEach(() => {
    home = setupHome()
    process.env.QUOTH_HOME = home
    db = createDb(path.join(home, 'stale.db'))
  })
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} ; delete process.env.QUOTH_HOME })

  it('writes last_stale_scan_ts into daemon_meta on every run', () => {
    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    const before = Date.now()
    detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })
    const ts = db.getDaemonMeta('last_stale_scan_ts')
    expect(Number(ts)).toBeGreaterThanOrEqual(before)
  })

  it('getDaemonMeta returns null for unset keys', () => {
    expect(db.getDaemonMeta('never_set_key')).toBeNull()
  })

  it('persists across daemon restarts (same DB file)', () => {
    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    detectStaleSessions({ db, trajectoriesDir: path.join(home, 'trajectories') })
    const ts1 = db.getDaemonMeta('last_stale_scan_ts')

    // "Restart" — new createDb on the same file.
    const db2 = createDb(path.join(home, 'stale.db'))
    expect(db2.getDaemonMeta('last_stale_scan_ts')).toBe(ts1)
  })
})

describe('detectStaleSessions — race guard', () => {
  let home, db
  beforeEach(() => {
    home = setupHome()
    process.env.QUOTH_HOME = home
    db = createDb(path.join(home, 'stale.db'))
  })
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} ; delete process.env.QUOTH_HOME })

  it('aborts the move if the sidecar was touched between SQL snapshot and rename', () => {
    const sid = 'sess-race-1'
    const entries = Array.from({ length: 5 }, () => ({
      event: 'tool_use', session: sid, tool: 'Bash', outcome: 'success',
    }))
    seedActive(home, sid, { entries, ageMs: 35 * 60 * 1000 })

    const { detectStaleSessions } = require('../daemon/stale-detector.js')
    let aborted = false
    detectStaleSessions({
      db,
      trajectoriesDir: path.join(home, 'trajectories'),
      _onRaceAbort: () => { aborted = true },
      _raceSimulator: () => {
        fs.utimesSync(
          path.join(home, 'trajectories', 'active', `${sid}.meta.json`),
          new Date(), new Date()
        )
      },
    })

    expect(aborted).toBe(true)
    expect(fs.existsSync(path.join(home, 'trajectories', 'active', `${sid}.jsonl`))).toBe(true)
    expect(fs.readdirSync(path.join(home, 'trajectories', 'processing'))).toHaveLength(0)
  })
})
