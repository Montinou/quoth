import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createRequire } from 'module'

const requireCjs = createRequire(import.meta.url)

function setupHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-retention-test-'))
  for (const b of ['active', 'processing', 'done', 'routine', 'empty', 'error']) {
    fs.mkdirSync(path.join(tmp, 'trajectories', b), { recursive: true })
  }
  return tmp
}

function writeAged(dir, sid, ageDays) {
  const jsonl = path.join(dir, `${sid}.jsonl`)
  const meta = path.join(dir, `${sid}.meta.json`)
  fs.writeFileSync(jsonl, '{}\n')
  fs.writeFileSync(meta, '{}')
  const stamp = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000)
  fs.utimesSync(jsonl, stamp, stamp)
  fs.utimesSync(meta, stamp, stamp)
}

describe('runRetentionSweep', () => {
  let home
  beforeEach(() => { home = setupHome(); process.env.QUOTH_HOME = home })
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} })

  it('deletes done/ files older than QUOTH_RETENTION_DONE_DAYS (default 30)', () => {
    const doneDir = path.join(home, 'trajectories', 'done', '2026-03-01', 'quoth')
    fs.mkdirSync(doneDir, { recursive: true })
    writeAged(doneDir, 'old', 45)
    writeAged(doneDir, 'fresh', 5)

    const { runRetentionSweep } = requireCjs('../daemon/retention.js')
    const res = runRetentionSweep({ home })

    expect(fs.existsSync(path.join(doneDir, 'old.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(doneDir, 'fresh.jsonl'))).toBe(true)
    expect(res.deleted.done).toBe(1)
  })

  it('deletes routine/ files older than QUOTH_RETENTION_ROUTINE_DAYS (default 7)', () => {
    const rdir = path.join(home, 'trajectories', 'routine', '2026-04-01', 'quoth')
    fs.mkdirSync(rdir, { recursive: true })
    writeAged(rdir, 'old', 10)
    writeAged(rdir, 'fresh', 3)

    const { runRetentionSweep } = requireCjs('../daemon/retention.js')
    const res = runRetentionSweep({ home })

    expect(fs.existsSync(path.join(rdir, 'old.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(rdir, 'fresh.jsonl'))).toBe(true)
    expect(res.deleted.routine).toBe(1)
  })

  it('deletes empty/ files older than 3 days and error/ older than 14 days', () => {
    writeAged(path.join(home, 'trajectories', 'empty'), 'e-old', 5)
    writeAged(path.join(home, 'trajectories', 'empty'), 'e-fresh', 1)
    writeAged(path.join(home, 'trajectories', 'error'), 'err-old', 20)
    writeAged(path.join(home, 'trajectories', 'error'), 'err-fresh', 7)

    const { runRetentionSweep } = requireCjs('../daemon/retention.js')
    const res = runRetentionSweep({ home })

    expect(fs.existsSync(path.join(home, 'trajectories', 'empty', 'e-old.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'trajectories', 'empty', 'e-fresh.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'trajectories', 'error', 'err-old.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'trajectories', 'error', 'err-fresh.jsonl'))).toBe(true)
  })

  it('NEVER touches active/ or processing/', () => {
    writeAged(path.join(home, 'trajectories', 'active'), 'live', 100)
    writeAged(path.join(home, 'trajectories', 'processing'), 'claimed', 100)

    const { runRetentionSweep } = requireCjs('../daemon/retention.js')
    runRetentionSweep({ home })

    expect(fs.existsSync(path.join(home, 'trajectories', 'active', 'live.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', 'claimed.jsonl'))).toBe(true)
  })

  it('deletes the sidecar alongside the JSONL', () => {
    const doneDir = path.join(home, 'trajectories', 'done', '2026-03-01', 'quoth')
    fs.mkdirSync(doneDir, { recursive: true })
    writeAged(doneDir, 'both', 40)

    const { runRetentionSweep } = requireCjs('../daemon/retention.js')
    runRetentionSweep({ home })

    expect(fs.existsSync(path.join(doneDir, 'both.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(doneDir, 'both.meta.json'))).toBe(false)
  })

  it('respects env overrides', () => {
    process.env.QUOTH_RETENTION_DONE_DAYS = '1'
    try {
      const doneDir = path.join(home, 'trajectories', 'done', '2026-03-01', 'quoth')
      fs.mkdirSync(doneDir, { recursive: true })
      writeAged(doneDir, 'a', 2)

      const { runRetentionSweep } = requireCjs('../daemon/retention.js')
      runRetentionSweep({ home })
      expect(fs.existsSync(path.join(doneDir, 'a.jsonl'))).toBe(false)
    } finally {
      delete process.env.QUOTH_RETENTION_DONE_DAYS
    }
  })
})
