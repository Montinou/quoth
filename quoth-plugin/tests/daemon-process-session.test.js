import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
const fs = require('fs')
const path = require('path')
const os = require('os')

function setupHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-daemon-test-'))
  fs.mkdirSync(path.join(tmp, 'trajectories', 'active'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'trajectories', 'processing'), { recursive: true })
  return tmp
}

function seedProcessing(home, sid, entries, summary) {
  const dir = path.join(home, 'trajectories', 'processing')
  const jsonl = path.join(dir, `${sid}.jsonl`)
  const meta = path.join(dir, `${sid}.meta.json`)
  const lines = entries.map(e => JSON.stringify(e))
  if (summary) lines.push(JSON.stringify(summary))
  fs.writeFileSync(jsonl, lines.join('\n') + '\n')
  fs.writeFileSync(meta, JSON.stringify({
    session_id: sid, project: 'quoth', status: 'terminated',
    first_seen_ts: Date.now() - 60_000, last_seen_ts: Date.now(),
    tool_count: entries.length, closed_marker: !!summary,
  }))
  return { jsonl, meta }
}

describe('processSessionFile — core dispatch', () => {
  let home
  beforeEach(() => { home = setupHome() })
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} })

  it('moves productive session with patterns to done/YYYY-MM-DD/<project>/', async () => {
    const sid = 'sess-productive-1'
    const summary = { event: 'session_summary', session: sid, project: 'quoth', total_calls: 5, tool_counts: { Bash: 5 }, success_rate: 1, outcome: 'success', timestamp: Date.now() }
    seedProcessing(home, sid, [
      { event: 'tool_use', session: sid, tool: 'Bash', outcome: 'success', task: 'ls' },
    ], summary)

    process.env.QUOTH_HOME = home
    const { processSessionFile } = require('../daemon/daemon-core.js')

    const fakeExtract = async () => ({
      patterns: [{ id: 'p1', condition: 'when X', action: 'do the specific Y that works every time', tags: [], quality_signal: 'project', embedding: null, source: 'distilled' }],
      facts: [],
    })
    const fakeDb = {
      insertNewPattern: vi.fn(),
      insertNewFact: vi.fn(),
      getSessionsByIds: () => [],
    }

    await processSessionFile({
      sessionFile: path.join(home, 'trajectories', 'processing', `${sid}.jsonl`),
      db: fakeDb,
      extractFn: fakeExtract,
    })

    const today = new Date().toISOString().slice(0, 10)
    const doneDir = path.join(home, 'trajectories', 'done', today, 'quoth')
    expect(fs.existsSync(path.join(doneDir, `${sid}.jsonl`))).toBe(true)
    expect(fs.existsSync(path.join(doneDir, `${sid}.meta.json`))).toBe(true)
    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', `${sid}.jsonl`))).toBe(false)
    expect(fakeDb.insertNewPattern).toHaveBeenCalledTimes(1)
  })

  it('routine session (no patterns, no facts) → routine/', async () => {
    const sid = 'sess-routine-1'
    const summary = { event: 'session_summary', session: sid, project: 'quoth', total_calls: 2, tool_counts: { Read: 2 }, success_rate: 1, outcome: 'success', timestamp: Date.now() }
    seedProcessing(home, sid, [
      { event: 'tool_use', session: sid, tool: 'Read', outcome: 'success', task: 'README' },
    ], summary)

    process.env.QUOTH_HOME = home
    const { processSessionFile } = require('../daemon/daemon-core.js')

    const fakeExtract = async () => ({ session_type: 'productive', patterns: [], facts: [] })
    const fakeDb = { insertNewPattern: vi.fn(), insertNewFact: vi.fn() }

    await processSessionFile({
      sessionFile: path.join(home, 'trajectories', 'processing', `${sid}.jsonl`),
      db: fakeDb,
      extractFn: fakeExtract,
    })

    const today = new Date().toISOString().slice(0, 10)
    const routineDir = path.join(home, 'trajectories', 'routine', today, 'quoth')
    const files = fs.readdirSync(routineDir)
    expect(files).toContain(`${sid}.jsonl`)
    expect(files).toContain(`${sid}.meta.json`)
  })

  it('LLM explicitly says session_type=routine → routine/ (spec §6.3 trust the verdict)', async () => {
    const sid = 'sess-routine-llm'
    const summary = { event: 'session_summary', session: sid, project: 'quoth', total_calls: 1, tool_counts: { Read: 1 }, success_rate: 1, outcome: 'success', timestamp: Date.now() }
    seedProcessing(home, sid, [
      { event: 'tool_use', session: sid, tool: 'Read', outcome: 'success', task: 'README' },
    ], summary)

    process.env.QUOTH_HOME = home
    const { processSessionFile } = require('../daemon/daemon-core.js')

    const fakeExtract = async () => ({
      session_type: 'routine',
      patterns: [{ id: 'leak', condition: 'leak condition hi', action: 'leak action text long enough to pass the 20 char filter' }],
      facts: [],
    })
    const fakeDb = { insertNewPattern: vi.fn(), insertNewFact: vi.fn() }

    await processSessionFile({
      sessionFile: path.join(home, 'trajectories', 'processing', `${sid}.jsonl`),
      db: fakeDb,
      extractFn: fakeExtract,
    })

    const today = new Date().toISOString().slice(0, 10)
    const routineDir = path.join(home, 'trajectories', 'routine', today, 'quoth')
    expect(fs.readdirSync(routineDir)).toContain(`${sid}.jsonl`)
  })

  it('empty session (no tool_use entries at all) → empty/', async () => {
    const sid = 'sess-empty-1'
    seedProcessing(home, sid, [], null)

    process.env.QUOTH_HOME = home
    const { processSessionFile } = require('../daemon/daemon-core.js')

    const fakeExtract = async () => { throw new Error('should not be called for empty session') }
    const fakeDb = { insertNewPattern: vi.fn(), insertNewFact: vi.fn() }

    await processSessionFile({
      sessionFile: path.join(home, 'trajectories', 'processing', `${sid}.jsonl`),
      db: fakeDb,
      extractFn: fakeExtract,
    })

    const emptyDir = path.join(home, 'trajectories', 'empty')
    // empty/ is dated per sessions.js moveSessionFile: look for today's subdir
    const today = new Date().toISOString().slice(0, 10)
    const datedDir = path.join(emptyDir, today)
    expect(fs.existsSync(datedDir)).toBe(true)
    expect(fs.readdirSync(datedDir)).toContain(`${sid}.jsonl`)
  })

  it('extract failure → error/', async () => {
    const sid = 'sess-err-1'
    const summary = { event: 'session_summary', session: sid, project: 'quoth', total_calls: 1, tool_counts: {}, success_rate: 0, outcome: 'failure', timestamp: Date.now() }
    seedProcessing(home, sid, [
      { event: 'tool_use', session: sid, tool: 'Bash', outcome: 'failure', task: 'boom' },
    ], summary)

    process.env.QUOTH_HOME = home
    const { processSessionFile } = require('../daemon/daemon-core.js')

    const fakeExtract = async () => { throw new Error('Moonshot exploded') }
    const fakeDb = { insertNewPattern: vi.fn(), insertNewFact: vi.fn(), insertPipelineError: vi.fn() }

    await processSessionFile({
      sessionFile: path.join(home, 'trajectories', 'processing', `${sid}.jsonl`),
      db: fakeDb,
      extractFn: fakeExtract,
    })

    const today = new Date().toISOString().slice(0, 10)
    const errorDir = path.join(home, 'trajectories', 'error', today)
    expect(fs.readdirSync(errorDir)).toContain(`${sid}.jsonl`)
  })

  it('inserts each fact via db.insertNewFact', async () => {
    const sid = 'sess-facts-1'
    const summary = { event: 'session_summary', session: sid, project: 'quoth', total_calls: 1, tool_counts: { Bash: 1 }, success_rate: 1, outcome: 'success', timestamp: Date.now() }
    seedProcessing(home, sid, [
      { event: 'tool_use', session: sid, tool: 'Bash', outcome: 'success', task: 'ls' },
    ], summary)

    process.env.QUOTH_HOME = home
    const { processSessionFile } = require('../daemon/daemon-core.js')

    const fakeExtract = async () => ({
      session_type: 'productive',
      patterns: [],
      facts: [
        { topic: 'build cmd', statement: 'pnpm -C quoth-plugin test', scope: 'project', tags: ['build'] },
        { topic: 'atomic rename', statement: 'fs.renameSync is atomic within the same filesystem on POSIX', scope: 'global', tags: ['posix'] },
      ],
    })
    const calls = []
    const fakeDb = {
      insertNewPattern: vi.fn(),
      insertNewFact: vi.fn((fact, meta) => { calls.push({ fact, meta }) }),
    }

    await processSessionFile({
      sessionFile: path.join(home, 'trajectories', 'processing', `${sid}.jsonl`),
      db: fakeDb,
      extractFn: fakeExtract,
    })

    expect(calls.length).toBe(2)
    expect(calls[0].fact.topic).toBe('build cmd')
    expect(calls[0].fact.scope).toBe('project')
    expect(calls[1].fact.scope).toBe('global')
    expect(calls[0].meta.project).toBe('quoth')
    expect(calls[0].meta.session_id).toBe(sid)
  })
})
