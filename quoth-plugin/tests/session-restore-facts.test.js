// Integration test for session-restore facts injection.
// Spawns hook-dispatch.js as a child process (no exported API).
// Seeds memory_entries via createDb, then asserts the hook emits
// a markdown facts block on stdout.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawnSync, execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DISPATCH = path.resolve(__dirname, '../hooks/hook-dispatch.js')
const require = createRequire(import.meta.url)

function runRestore(tmpHome) {
  return spawnSync('node', [DISPATCH, 'session-restore'], {
    env: {
      ...process.env,
      QUOTH_HOME: tmpHome,
      CLAUDE_PROJECT_DIR: tmpHome,
      CLAUDE_SESSION_ID: 'restore-test-sid',
    },
    encoding: 'utf8',
    timeout: 15000,
    input: '{}',
  })
}

function seedFacts(tmpHome, factList) {
  const { createDb } = require('../daemon/db.js')
  const dbPath = path.join(tmpHome, 'memory.db')
  const db = createDb(dbPath)
  const project = path.basename(tmpHome)
  for (const f of factList) {
    db.insertNewFact(
      { topic: f.topic, statement: f.statement, scope: f.scope, tags: [] },
      { project, session_id: 'seed' }
    )
  }
  db.close?.()
}

describe('session-restore — facts injection block', () => {
  let tmpHome
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-restore-facts-'))
  })
  afterEach(() => {
    try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch {}
  })

  it('renders a facts block with both global and project namespaces', () => {
    const project = path.basename(tmpHome)
    seedFacts(tmpHome, [
      { topic: 'build command', statement: 'pnpm -C quoth-plugin test', scope: 'project' },
      { topic: 'db primary key', statement: 'sessions uses compound (session_id, epoch)', scope: 'project' },
      { topic: 'llm rule', statement: 'never call openai without gateway', scope: 'global' },
    ])

    const res = runRestore(tmpHome)
    expect(res.status).toBe(0)
    const out = (res.stdout || '') + (res.stderr || '')

    expect(out).toContain('## Facts')
    expect(out).toContain(`Facts (project — ${project})`)
    expect(out).toContain('Facts (global)')
    expect(out).toContain('build command')
    expect(out).toContain('db primary key')
    expect(out).toContain('llm rule')
  }, 20000)

  it('caps facts per namespace to 5', () => {
    const facts = []
    for (let i = 0; i < 8; i++) {
      facts.push({ topic: `t${i}`, statement: `s${i}`, scope: 'project' })
    }
    seedFacts(tmpHome, facts)

    const res = runRestore(tmpHome)
    expect(res.status).toBe(0)
    const out = (res.stdout || '') + (res.stderr || '')

    const matches = out.match(/^- \*\*t\d+\*\*/gm) || []
    expect(matches.length).toBeLessThanOrEqual(5)
  }, 20000)

  it('silent when there are no facts (no block)', () => {
    // Create empty DB by touching createDb once with no inserts.
    const { createDb } = require('../daemon/db.js')
    const dbPath = path.join(tmpHome, 'memory.db')
    createDb(dbPath)

    const res = runRestore(tmpHome)
    expect(res.status).toBe(0)
    const out = (res.stdout || '') + (res.stderr || '')

    expect(out).not.toContain('## Facts')
  }, 20000)
})
