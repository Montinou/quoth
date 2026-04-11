// tests/unit/cli/reset.test.js
//
// Task 25 / spec §6.6 cutover sequence. The `reset-quoth-home.js` helper
// must:
//   1. Tar the entire QUOTH_HOME to a sibling `~/.quoth-backup-<ISO>.tar.gz`
//      tarball before touching anything.
//   2. Remove memory.db, hnsw.bin, intelligence/, and
//      trajectories/processing-deferred/ — the canonical "wipe" set from
//      spec §6.6 that the greenfield reset v3_6 migration depends on
//      being absent on first boot.
//   3. Leave the rest of QUOTH_HOME untouched (configs, credentials,
//      trajectories/{active,done,routine,empty,error}/ all survive).
//   4. Be a no-op when confirm !== true.
//   5. After reset, openDb() on the fresh path creates the new v3.6
//      schema (knowledge_entities, llm_budget, pipeline_errors, etc).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

const { resetQuothHome } = require('../../../scripts/reset-quoth-home.js')
const { createDb } = require('../../../daemon/db.js')

let home
let backupDir

function seedLegacyHome(dir) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'memory.db'), 'fake legacy db bytes')
  fs.writeFileSync(path.join(dir, 'hnsw.bin'), 'fake hnsw index')
  fs.mkdirSync(path.join(dir, 'intelligence'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'intelligence', 'graph.json'), '{}')
  fs.mkdirSync(path.join(dir, 'trajectories', 'processing-deferred'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'trajectories', 'processing-deferred', 'stuck.jsonl'), 'leftover\n')
  // Things that should survive:
  fs.writeFileSync(path.join(dir, '.env'), 'QUOTH_MODE=local\n')
  fs.mkdirSync(path.join(dir, 'trajectories', 'active'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'trajectories', 'active', 'sess-1.jsonl'), '{}\n')
}

beforeEach(() => {
  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-reset-test-'))
  home = path.join(backupDir, '.quoth')
  seedLegacyHome(home)
})

afterEach(() => {
  try { fs.rmSync(backupDir, { recursive: true, force: true }) } catch {}
})

describe('resetQuothHome', () => {
  it('is a no-op when confirm is not passed', () => {
    const result = resetQuothHome({ home })
    expect(result.wiped).toBe(false)
    expect(fs.existsSync(path.join(home, 'memory.db'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'hnsw.bin'))).toBe(true)
  })

  it('creates a timestamped tarball before wiping', () => {
    const result = resetQuothHome({ home, confirm: true })
    expect(result.wiped).toBe(true)
    expect(fs.existsSync(result.backupPath)).toBe(true)
    expect(result.backupPath).toMatch(/\.quoth-backup-\d{4}-\d{2}-\d{2}T[\d-]+\.tar\.gz$/)
    const stat = fs.statSync(result.backupPath)
    expect(stat.size).toBeGreaterThan(0)
    // The tarball must contain the legacy files
    const listing = execSync(`tar -tzf "${result.backupPath}"`, { encoding: 'utf8' })
    expect(listing).toContain('memory.db')
    expect(listing).toContain('hnsw.bin')
    expect(listing).toContain('intelligence/')
  })

  it('removes exactly the greenfield reset file set', () => {
    resetQuothHome({ home, confirm: true })
    expect(fs.existsSync(path.join(home, 'memory.db'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'hnsw.bin'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'intelligence'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'trajectories', 'processing-deferred'))).toBe(false)
  })

  it('leaves the rest of QUOTH_HOME untouched', () => {
    resetQuothHome({ home, confirm: true })
    expect(fs.existsSync(path.join(home, '.env'))).toBe(true)
    expect(fs.readFileSync(path.join(home, '.env'), 'utf8')).toContain('QUOTH_MODE=local')
    expect(fs.existsSync(path.join(home, 'trajectories', 'active', 'sess-1.jsonl'))).toBe(true)
  })

  it('post-reset, createDb() creates the v3.6 schema', () => {
    resetQuothHome({ home, confirm: true })
    const dbPath = path.join(home, 'memory.db')
    const db = createDb(dbPath)
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all().map(r => r.name)
    expect(tables).toContain('knowledge_entities')
    expect(tables).toContain('llm_budget')
    expect(tables).toContain('pipeline_errors')
    expect(tables).toContain('sessions')
    // Greenfield reset marker must be set on the fresh DB
    const marker = db.prepare("SELECT value FROM daemon_meta WHERE key = 'greenfield_reset_v3_6'").get()
    expect(marker).toBeTruthy()
    db.close()
  })
})
