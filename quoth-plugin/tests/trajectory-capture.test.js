// Integration test for trajectory-capture.js per-session file layout.
// Runs the hook as a child process with hook data piped to stdin, then
// asserts the filesystem looks the way the spec demands.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '../hooks/trajectory-capture.js')

function makeTmpHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-hook-test-'))
  return tmp
}

function runHook(tmpHome, payload) {
  const res = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    env: {
      ...process.env,
      QUOTH_HOME: tmpHome,
      CLAUDE_PROJECT_DIR: tmpHome,        // avoid git shenanigans
      CLAUDE_SESSION_ID: payload.session_id,
    },
    encoding: 'utf8',
    timeout: 5000,
  })
  return res
}

function makeEntry(sessionId, toolName, command) {
  return {
    session_id: sessionId,
    tool_name: toolName,
    tool_input: { command },
    tool_result: { output: 'ok' },
  }
}

describe('trajectory-capture — per-session files', () => {
  let tmpHome
  beforeEach(() => { tmpHome = makeTmpHome() })
  afterEach(() => { try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch {} })

  it('creates trajectories/active/ on first run', () => {
    const sid = 'sess-alpha-0001'
    const res = runHook(tmpHome, makeEntry(sid, 'Bash', 'ls'))
    expect(res.status).toBe(0)
    expect(fs.existsSync(path.join(tmpHome, 'trajectories', 'active'))).toBe(true)
  })

  it('writes tool entry to active/<sid>.jsonl (not project-date.jsonl)', () => {
    const sid = 'sess-alpha-0002'
    runHook(tmpHome, makeEntry(sid, 'Bash', 'ls'))

    const activeDir = path.join(tmpHome, 'trajectories', 'active')
    const sessionFile = path.join(activeDir, `${sid}.jsonl`)
    expect(fs.existsSync(sessionFile)).toBe(true)

    // The old per-date file pattern must NOT exist.
    const dated = fs.readdirSync(activeDir).filter(f => /^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    expect(dated).toEqual([])

    const line = fs.readFileSync(sessionFile, 'utf8').trim()
    const parsed = JSON.parse(line)
    expect(parsed.event).toBe('tool_use')
    expect(parsed.session).toBe(sid)
    expect(parsed.tool).toBe('Bash')
  })

  it('writes sidecar <sid>.meta.json with first_seen_ts on first entry', () => {
    const sid = 'sess-alpha-0003'
    const before = Date.now()
    runHook(tmpHome, makeEntry(sid, 'Bash', 'ls'))
    const after = Date.now()

    const meta = path.join(tmpHome, 'trajectories', 'active', `${sid}.meta.json`)
    expect(fs.existsSync(meta)).toBe(true)
    const parsed = JSON.parse(fs.readFileSync(meta, 'utf8'))
    expect(parsed.session_id).toBe(sid)
    expect(parsed.status).toBe('active')
    expect(parsed.first_seen_ts).toBeGreaterThanOrEqual(before)
    expect(parsed.first_seen_ts).toBeLessThanOrEqual(after)
    expect(parsed.last_seen_ts).toBeGreaterThanOrEqual(parsed.first_seen_ts)
    expect(parsed.tool_count).toBe(1)
    expect(parsed.closed_marker).toBe(false)
    expect(typeof parsed.project).toBe('string')
  })

  it('updates sidecar last_seen_ts and tool_count on subsequent entries', () => {
    const sid = 'sess-alpha-0004'
    runHook(tmpHome, makeEntry(sid, 'Bash', 'ls'))
    const meta = path.join(tmpHome, 'trajectories', 'active', `${sid}.meta.json`)
    const first = JSON.parse(fs.readFileSync(meta, 'utf8'))

    runHook(tmpHome, makeEntry(sid, 'Read', 'README.md'))
    const second = JSON.parse(fs.readFileSync(meta, 'utf8'))

    expect(second.first_seen_ts).toBe(first.first_seen_ts)
    expect(second.last_seen_ts).toBeGreaterThanOrEqual(first.last_seen_ts)
    expect(second.tool_count).toBe(2)
  })

  it('two parallel sessions do NOT contaminate each other', () => {
    const sidA = 'sess-parallel-A'
    const sidB = 'sess-parallel-B'
    // Interleave 3 writes each.
    runHook(tmpHome, makeEntry(sidA, 'Bash', 'ls A1'))
    runHook(tmpHome, makeEntry(sidB, 'Bash', 'ls B1'))
    runHook(tmpHome, makeEntry(sidA, 'Bash', 'ls A2'))
    runHook(tmpHome, makeEntry(sidB, 'Bash', 'ls B2'))
    runHook(tmpHome, makeEntry(sidA, 'Bash', 'ls A3'))
    runHook(tmpHome, makeEntry(sidB, 'Bash', 'ls B3'))

    const dir = path.join(tmpHome, 'trajectories', 'active')
    const files = fs.readdirSync(dir).sort()
    expect(files).toContain(`${sidA}.jsonl`)
    expect(files).toContain(`${sidB}.jsonl`)

    const linesA = fs.readFileSync(path.join(dir, `${sidA}.jsonl`), 'utf8').split('\n').filter(Boolean)
    const linesB = fs.readFileSync(path.join(dir, `${sidB}.jsonl`), 'utf8').split('\n').filter(Boolean)
    expect(linesA.length).toBe(3)
    expect(linesB.length).toBe(3)

    // No cross-contamination.
    for (const l of linesA) expect(JSON.parse(l).session).toBe(sidA)
    for (const l of linesB) expect(JSON.parse(l).session).toBe(sidB)

    // Sidecars agree.
    const metaA = JSON.parse(fs.readFileSync(path.join(dir, `${sidA}.meta.json`), 'utf8'))
    const metaB = JSON.parse(fs.readFileSync(path.join(dir, `${sidB}.meta.json`), 'utf8'))
    expect(metaA.tool_count).toBe(3)
    expect(metaB.tool_count).toBe(3)
  })
})
