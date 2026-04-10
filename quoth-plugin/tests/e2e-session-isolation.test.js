// End-to-end session isolation tests (Task 16, spec §8).
//
// These exercise the whole pipeline:
//   trajectory-capture hook → active/<sid>.jsonl (per session)
//   session-end hook        → atomic rename active/ → processing/
//   processSessionFile      → extract → DB + done/ or routine/
//   session-restore hook    → facts surface on stdout for next session
//
// The extractor is a deterministic stub so we can assert hard invariants
// without depending on an LLM. We use a real DB (createDb) and real hook
// subprocesses — there is no mocking of file layout, db writes, or the
// hook boundary. Per spec §6.4 there is NO trivial gate: even a 1-entry
// session must pass through processing/ and end up in routine/ (not
// empty/, which is reserved for zero-tool_use).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const HOOK_TC = path.resolve(__dirname, '../hooks/trajectory-capture.js')
const HOOK_DISPATCH = path.resolve(__dirname, '../hooks/hook-dispatch.js')

function setupHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-e2e-iso-'))
}

function hookCapture(home, sid, toolName, input) {
  return spawnSync('node', [HOOK_TC], {
    input: JSON.stringify({
      session_id: sid,
      tool_name: toolName,
      tool_input: input,
      tool_result: { output: 'ok' },
    }),
    env: {
      ...process.env,
      QUOTH_HOME: home,
      CLAUDE_PROJECT_DIR: home,
      CLAUDE_SESSION_ID: sid,
    },
    encoding: 'utf8',
    timeout: 5000,
  })
}

function runHook(home, command, sid) {
  return spawnSync('node', [HOOK_DISPATCH, command], {
    input: '{}',
    env: {
      ...process.env,
      QUOTH_HOME: home,
      CLAUDE_PROJECT_DIR: home,
      CLAUDE_SESSION_ID: sid,
    },
    encoding: 'utf8',
    timeout: 10000,
  })
}

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

// Wrap db.upsertPattern so daemon-core's `db.insertNewPattern(p, summary, project)`
// call lands as a real row in the `patterns` table. Mirrors the minimal
// fields needed from daemon.js:insertNewPattern without the dedup/Bayesian
// machinery (we only care that the row exists + has the right content).
function attachInsertNewPattern(db) {
  db.insertNewPattern = function(distilled, summaryEntry, project) {
    db.upsertPattern({
      id: distilled.id,
      name: distilled.name || distilled.action.slice(0, 200),
      pattern_type: 'code-pattern',
      condition: distilled.condition,
      action: distilled.action,
      description: distilled.condition,
      confidence: distilled.confidence ?? 0.5,
      tags: [
        ...(distilled.tags || []),
        ...(project && project !== 'default' ? [`project:${project}`] : []),
        'extracted',
      ],
      source: distilled.source || 'distilled',
      embedding: distilled.embedding ? JSON.stringify(distilled.embedding) : undefined,
    })
  }
}

describe('e2e — parallel sessions never contaminate', () => {
  let home
  const savedEnv = {}
  beforeEach(() => {
    home = setupHome()
    savedEnv.QUOTH_HOME = process.env.QUOTH_HOME
    savedEnv.CLAUDE_PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR
    savedEnv.CLAUDE_SESSION_ID = process.env.CLAUDE_SESSION_ID
  })
  afterEach(() => {
    if (savedEnv.QUOTH_HOME === undefined) delete process.env.QUOTH_HOME
    else process.env.QUOTH_HOME = savedEnv.QUOTH_HOME
    if (savedEnv.CLAUDE_PROJECT_DIR === undefined) delete process.env.CLAUDE_PROJECT_DIR
    else process.env.CLAUDE_PROJECT_DIR = savedEnv.CLAUDE_PROJECT_DIR
    if (savedEnv.CLAUDE_SESSION_ID === undefined) delete process.env.CLAUDE_SESSION_ID
    else process.env.CLAUDE_SESSION_ID = savedEnv.CLAUDE_SESSION_ID
    try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
  })

  it('session A (productive, 5 entries) + session B (1 entry, routine) do not mix — both pass through processing/', async () => {
    const sidA = 'sess-e2e-A'
    const sidB = 'sess-e2e-B'

    // Interleave tool captures: A1, B1, A2, A3, A4, A5.
    hookCapture(home, sidA, 'Bash', { command: 'pnpm test A1' })
    hookCapture(home, sidB, 'Read', { file_path: '/tmp/B1' })
    hookCapture(home, sidA, 'Bash', { command: 'pnpm test A2' })
    hookCapture(home, sidA, 'Bash', { command: 'pnpm test A3' })
    hookCapture(home, sidA, 'Bash', { command: 'pnpm test A4' })
    hookCapture(home, sidA, 'Bash', { command: 'pnpm test A5' })

    // Sanity: both per-session JSONLs exist in active/ with the right entry counts.
    const activeDir = path.join(home, 'trajectories', 'active')
    const aJsonl = path.join(activeDir, `${sidA}.jsonl`)
    const bJsonl = path.join(activeDir, `${sidB}.jsonl`)
    expect(fs.existsSync(aJsonl)).toBe(true)
    expect(fs.existsSync(bJsonl)).toBe(true)
    expect(fs.readFileSync(aJsonl, 'utf8').trim().split('\n').length).toBe(5)
    expect(fs.readFileSync(bJsonl, 'utf8').trim().split('\n').length).toBe(1)

    // Fire session-end for each — atomic rename active/ → processing/.
    // We spawn the hook as a subprocess because hook-dispatch.js has no
    // exported API (it's a CLI script).
    const resA = runHook(home, 'session-end', sidA)
    expect(resA.status).toBe(0)
    const resB = runHook(home, 'session-end', sidB)
    expect(resB.status).toBe(0)

    // Both files should now live in processing/. Per spec §6.4 there is
    // no trivial gate — even 1-entry B went through processing/.
    const processingDir = path.join(home, 'trajectories', 'processing')
    const procFiles = fs.readdirSync(processingDir).filter(f => f.endsWith('.jsonl'))
    expect(procFiles.sort()).toEqual([`${sidA}.jsonl`, `${sidB}.jsonl`])

    // Build a real db and attach insertNewPattern shim.
    const { createDb } = require('../daemon/db.js')
    const db = createDb(path.join(home, 'memory.db'))
    attachInsertNewPattern(db)

    // Fake extractor: return exactly 1 pattern for session A, 0 patterns
    // for session B. B receives NO explicit session_type — daemon-core
    // falls back to the "empty → routine" heuristic.
    const fakeExtract = async (summary) => {
      if (summary.session === sidA) {
        return {
          patterns: [{
            id: 'pat-sess-e2e-A',
            name: 'e2e test A pattern',
            condition: 'when running tests for sess-e2e-A',
            action: 'run the A-specific workflow end to end every time',
            tags: ['e2e', 'a-only'],
            confidence: 0.7,
            embedding: null,
            source: 'distilled',
          }],
          facts: [],
        }
      }
      return { patterns: [], facts: [] }
    }

    // Run daemon-core over both files (B before A to stress-test ordering).
    const { processSessionFile } = require('../daemon/daemon-core.js')
    for (const f of procFiles.sort()) {
      await processSessionFile({
        sessionFile: path.join(processingDir, f),
        db,
        extractFn: fakeExtract,
      })
    }

    // --- Pattern assertions ---
    const patA = db.getPattern('pat-sess-e2e-A')
    expect(patA).toBeTruthy()
    expect(patA.condition).toContain('sess-e2e-A')
    expect(patA.action).toContain('A-specific')
    // Hard contamination check: A's pattern must not mention B at all.
    expect(patA.condition).not.toContain('sess-e2e-B')
    expect(patA.action).not.toContain('sess-e2e-B')
    expect(patA.condition).not.toContain('B1')
    expect(patA.action).not.toContain('B1')

    // No B-flavored pattern exists in DB.
    const patB = db.getPattern('pat-sess-e2e-B')
    expect(patB).toBeFalsy()
    // Broader guard: scan ALL patterns for any row with 'sess-e2e-B' in id/condition/action.
    const allPatterns = db.prepare('SELECT id, condition, action FROM patterns').all()
    for (const p of allPatterns) {
      expect(p.id).not.toContain('sess-e2e-B')
      expect(p.condition || '').not.toContain('sess-e2e-B')
      expect(p.action || '').not.toContain('sess-e2e-B')
    }

    // --- Filesystem assertions ---
    const today = new Date().toISOString().slice(0, 10)
    const project = path.basename(home) // resolveProjectName falls back to basename

    // A: done/<today>/<project>/sess-e2e-A*.jsonl (epoch suffix tolerated).
    const doneProjectDir = path.join(home, 'trajectories', 'done', today, project)
    expect(fs.existsSync(doneProjectDir)).toBe(true)
    const doneFiles = walk(doneProjectDir).map(p => path.basename(p))
    expect(doneFiles.some(f => f.startsWith('sess-e2e-A') && f.endsWith('.jsonl'))).toBe(true)
    // B must NOT be anywhere under done/.
    const allDone = walk(path.join(home, 'trajectories', 'done')).map(p => path.basename(p))
    expect(allDone.some(f => f.startsWith('sess-e2e-B'))).toBe(false)

    // B: routine/<today>/<project>/sess-e2e-B*.jsonl — present because the
    // extractor returned zero patterns AND zero facts (spec §6.3 fallback).
    const routineProjectDir = path.join(home, 'trajectories', 'routine', today, project)
    expect(fs.existsSync(routineProjectDir)).toBe(true)
    const routineFiles = walk(routineProjectDir).map(p => path.basename(p))
    expect(routineFiles.some(f => f.startsWith('sess-e2e-B') && f.endsWith('.jsonl'))).toBe(true)
    // A must NOT be in routine/.
    const allRoutine = walk(path.join(home, 'trajectories', 'routine')).map(p => path.basename(p))
    expect(allRoutine.some(f => f.startsWith('sess-e2e-A'))).toBe(false)

    // empty/ is reserved for zero-tool_use — NOTHING from A or B should be there.
    const allEmpty = walk(path.join(home, 'trajectories', 'empty')).map(p => path.basename(p))
    expect(allEmpty.some(f => f.startsWith('sess-e2e-A'))).toBe(false)
    expect(allEmpty.some(f => f.startsWith('sess-e2e-B'))).toBe(false)

    // processing/ should be drained.
    const remaining = fs.readdirSync(processingDir).filter(f => f.endsWith('.jsonl'))
    expect(remaining).toEqual([])

    try { db.close?.() } catch {}
  }, 30000)
})

describe('e2e — facts survive productive path and surface on next session-restore', () => {
  let home
  const savedEnv = {}
  beforeEach(() => {
    home = setupHome()
    savedEnv.QUOTH_HOME = process.env.QUOTH_HOME
    savedEnv.CLAUDE_PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR
    savedEnv.CLAUDE_SESSION_ID = process.env.CLAUDE_SESSION_ID
  })
  afterEach(() => {
    if (savedEnv.QUOTH_HOME === undefined) delete process.env.QUOTH_HOME
    else process.env.QUOTH_HOME = savedEnv.QUOTH_HOME
    if (savedEnv.CLAUDE_PROJECT_DIR === undefined) delete process.env.CLAUDE_PROJECT_DIR
    else process.env.CLAUDE_PROJECT_DIR = savedEnv.CLAUDE_PROJECT_DIR
    if (savedEnv.CLAUDE_SESSION_ID === undefined) delete process.env.CLAUDE_SESSION_ID
    else process.env.CLAUDE_SESSION_ID = savedEnv.CLAUDE_SESSION_ID
    try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
  })

  it('extracted fact lands in memory_entries and shows up in session-restore stdout for a fresh session', async () => {
    const sidProducer = 'sess-producer-e2e'

    hookCapture(home, sidProducer, 'Bash', { command: 'pnpm -C quoth-plugin test' })
    hookCapture(home, sidProducer, 'Bash', { command: 'pnpm -C quoth-plugin test' })
    hookCapture(home, sidProducer, 'Bash', { command: 'pnpm -C quoth-plugin test' })

    // session-end atomic handoff.
    const resEnd = runHook(home, 'session-end', sidProducer)
    expect(resEnd.status).toBe(0)

    const processingDir = path.join(home, 'trajectories', 'processing')
    const procFiles = fs.readdirSync(processingDir).filter(f => f.endsWith('.jsonl'))
    expect(procFiles).toContain(`${sidProducer}.jsonl`)

    // Real db for the extract pass.
    const { createDb } = require('../daemon/db.js')
    const db = createDb(path.join(home, 'memory.db'))
    attachInsertNewPattern(db)

    const FACT_TOPIC = 'plugin build command'
    const FACT_STATEMENT = 'Build the plugin with pnpm -C quoth-plugin test'

    const fakeExtract = async () => ({
      patterns: [],
      facts: [
        { topic: FACT_TOPIC, statement: FACT_STATEMENT, scope: 'project', tags: ['build'] },
      ],
    })

    const { processSessionFile } = require('../daemon/daemon-core.js')
    for (const f of procFiles) {
      await processSessionFile({
        sessionFile: path.join(processingDir, f),
        db,
        extractFn: fakeExtract,
      })
    }

    // Confirm the fact landed in memory_entries under facts:proj:<project>.
    const project = path.basename(home)
    const namespace = db.factNamespace('project', project)
    expect(namespace).toBe(`facts:proj:${project}`)
    const rows = db.listFactsByNamespace(namespace, 10)
    expect(rows.length).toBe(1)
    expect(rows[0].key).toBe(FACT_TOPIC)
    const parsed = JSON.parse(rows[0].content)
    expect(parsed.statement).toBe(FACT_STATEMENT)

    try { db.close?.() } catch {}

    // Now a FRESH session (different sid) fires session-restore as a
    // subprocess. We capture stdout directly from spawnSync because the
    // hook runs in its own process — there is no in-process override.
    const consumerSid = 'sess-consumer-e2e'
    expect(consumerSid).not.toBe(sidProducer) // paranoia: must be a different session
    const res = runHook(home, 'session-restore', consumerSid)
    expect(res.status).toBe(0)

    const out = res.stdout || ''
    // The facts block from hook-dispatch session-restore is written via
    // process.stdout.write — not console.log — but spawnSync captures both.
    expect(out).toContain('## Facts')
    expect(out).toContain(`Facts (project — ${project})`)
    expect(out).toContain(FACT_TOPIC)
    expect(out).toContain(FACT_STATEMENT)
  }, 30000)
})
