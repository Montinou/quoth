// Integration test for session-end hook atomic handoff.
// Spawns hook-dispatch.js as a child process (the dispatcher is a CLI
// script — no exported API), sets up an active/<sid>.jsonl fixture,
// and asserts the filesystem state after the hook runs.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DISPATCH = path.resolve(__dirname, '../hooks/hook-dispatch.js')

function makeTmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-session-end-test-'))
}

function writeActiveSession(tmpHome, sid, entries) {
  const dir = path.join(tmpHome, 'trajectories', 'active')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${sid}.jsonl`),
    entries.map(e => JSON.stringify(e)).join('\n') + '\n'
  )
  fs.writeFileSync(
    path.join(dir, `${sid}.meta.json`),
    JSON.stringify({
      session_id: sid,
      project: 'quoth',
      status: 'active',
      first_seen_ts: Date.now() - 60_000,
      last_seen_ts: Date.now(),
      tool_count: entries.length,
      closed_marker: false,
      source: 'hook',
    })
  )
}

function runHook(tmpHome, sid) {
  return spawnSync('node', [DISPATCH, 'session-end'], {
    env: {
      ...process.env,
      QUOTH_HOME: tmpHome,
      CLAUDE_PROJECT_DIR: tmpHome,   // avoid git resolution
      CLAUDE_SESSION_ID: sid,
    },
    encoding: 'utf8',
    timeout: 10000,
    input: '{}',
  })
}

function makeToolEntry(sid, tool, outcome = 'success') {
  return {
    event: 'tool_use',
    agent: 'claude-code',
    project: 'quoth',
    session: sid,
    task: `${tool} fixture`,
    tool,
    tool_input: null,
    tool_output: null,
    outcome,
    user_intent: null,
    conversation_context: null,
    llm_reasoning: null,
    pattern_used: null,
    source: 'claude-code',
    timestamp: Date.now(),
  }
}

describe('session-end hook — atomic handoff active/ → processing/', () => {
  let tmpHome
  beforeEach(() => { tmpHome = makeTmpHome() })
  afterEach(() => { try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch {} })

  it('moves jsonl + sidecar from active/ to processing/', () => {
    const sid = 'sess-end-0001'
    writeActiveSession(tmpHome, sid, [
      makeToolEntry(sid, 'Bash'),
      makeToolEntry(sid, 'Bash'),
      makeToolEntry(sid, 'Read'),
    ])

    const res = runHook(tmpHome, sid)
    expect(res.status).toBe(0)

    const activeJsonl = path.join(tmpHome, 'trajectories', 'active', `${sid}.jsonl`)
    const activeMeta = path.join(tmpHome, 'trajectories', 'active', `${sid}.meta.json`)
    const processingJsonl = path.join(tmpHome, 'trajectories', 'processing', `${sid}.jsonl`)
    const processingMeta = path.join(tmpHome, 'trajectories', 'processing', `${sid}.meta.json`)

    expect(fs.existsSync(activeJsonl)).toBe(false)
    expect(fs.existsSync(activeMeta)).toBe(false)
    expect(fs.existsSync(processingJsonl)).toBe(true)
    expect(fs.existsSync(processingMeta)).toBe(true)
  })

  it('appends a session_summary entry with aggregated tool counts', () => {
    const sid = 'sess-end-0002'
    writeActiveSession(tmpHome, sid, [
      makeToolEntry(sid, 'Bash', 'success'),
      makeToolEntry(sid, 'Bash', 'failure'),
      makeToolEntry(sid, 'Read', 'success'),
    ])

    runHook(tmpHome, sid)

    const processingJsonl = path.join(tmpHome, 'trajectories', 'processing', `${sid}.jsonl`)
    const lines = fs.readFileSync(processingJsonl, 'utf8').split('\n').filter(Boolean)
    const summaryLine = lines.map(l => JSON.parse(l)).find(e => e.event === 'session_summary')

    expect(summaryLine).toBeTruthy()
    expect(summaryLine.source).toBe('session-end')
    expect(summaryLine.total_calls).toBe(3)
    expect(summaryLine.tool_counts).toEqual({ Bash: 2, Read: 1 })
  })

  it('flips sidecar to status=terminated, closed_marker=true, tool_count>=1', () => {
    const sid = 'sess-end-0003'
    writeActiveSession(tmpHome, sid, [
      makeToolEntry(sid, 'Bash'),
      makeToolEntry(sid, 'Read'),
    ])

    runHook(tmpHome, sid)

    const processingMeta = path.join(tmpHome, 'trajectories', 'processing', `${sid}.meta.json`)
    expect(fs.existsSync(processingMeta)).toBe(true)
    const meta = JSON.parse(fs.readFileSync(processingMeta, 'utf8'))

    expect(meta.status).toBe('terminated')
    expect(meta.closed_marker).toBe(true)
    expect(meta.tool_count).toBeGreaterThanOrEqual(1)
    expect(typeof meta.last_seen_ts).toBe('number')
    expect(meta.summary).toBeTruthy()
    expect(meta.summary.total_calls).toBe(2)
  })

  it('is a no-op when active/<sid>.jsonl is missing', () => {
    const sid = 'sess-end-0004-missing'
    // Do NOT write any active session.

    const res = runHook(tmpHome, sid)
    expect(res.status).toBe(0)

    const processingJsonl = path.join(tmpHome, 'trajectories', 'processing', `${sid}.jsonl`)
    expect(fs.existsSync(processingJsonl)).toBe(false)
  })
})
