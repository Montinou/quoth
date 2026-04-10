import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createRequire } from 'module'

const requireCjs = createRequire(import.meta.url)

function makeHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-migrate-test-'))
  fs.mkdirSync(path.join(tmp, 'trajectories'), { recursive: true })
  return tmp
}

function writeLegacy(home, filename, entries) {
  fs.writeFileSync(
    path.join(home, 'trajectories', filename),
    entries.map(e => JSON.stringify(e)).join('\n') + '\n'
  )
}

describe('migrate-session-isolation — legacy → per-session', () => {
  let home
  beforeEach(() => { home = makeHome(); process.env.QUOTH_HOME = home })
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} })

  it('splits a legacy multi-session file into per-session files (no trivial gate)', () => {
    writeLegacy(home, 'quoth-2026-04-08.jsonl', [
      { event: 'tool_use', session: 'A', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'A', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'A', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'A', project: 'quoth', tool: 'Bash' },
      { event: 'session_summary', session: 'A', project: 'quoth', total_calls: 4 },
      { event: 'tool_use', session: 'B', project: 'quoth', tool: 'Read' },
      { event: 'session_summary', session: 'B', project: 'quoth', total_calls: 1 },
    ])

    const { migrate } = requireCjs('../scripts/migrate-session-isolation.js')
    migrate({ home })

    const proc = path.join(home, 'trajectories', 'processing')
    const empty = path.join(home, 'trajectories', 'empty')

    // Session A had 4 entries + summary → processing/.
    expect(fs.existsSync(path.join(proc, 'A.jsonl'))).toBe(true)
    // Session B had 1 tool_use — there is NO trivial gate per spec §7.1.
    // Even a 1-entry legacy session goes to processing/ so the extractor
    // gets a chance to decide productive vs routine.
    expect(fs.existsSync(path.join(proc, 'B.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(empty, 'B.jsonl'))).toBe(false)

    // Legacy file moved to migrated-legacy/.
    expect(fs.existsSync(path.join(home, 'trajectories', 'migrated-legacy', 'quoth-2026-04-08.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'trajectories', 'quoth-2026-04-08.jsonl'))).toBe(false)
  })

  it('routes ONLY zero-tool_use sessions to empty/', () => {
    writeLegacy(home, 'quoth-2026-04-04.jsonl', [
      // Session Z has only a session_summary — no tool_use entries → empty/.
      { event: 'session_summary', session: 'Z', project: 'quoth', total_calls: 0 },
    ])

    const { migrate } = requireCjs('../scripts/migrate-session-isolation.js')
    migrate({ home })

    expect(fs.existsSync(path.join(home, 'trajectories', 'empty', 'Z.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', 'Z.jsonl'))).toBe(false)
  })

  it('synthesizes summary for a meaty session missing one', () => {
    writeLegacy(home, 'quoth-2026-04-07.jsonl', [
      { event: 'tool_use', session: 'C', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'C', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'C', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'C', project: 'quoth', tool: 'Bash' },
    ])

    const { migrate } = requireCjs('../scripts/migrate-session-isolation.js')
    migrate({ home })

    const jsonlPath = path.join(home, 'trajectories', 'processing', 'C.jsonl')
    expect(fs.existsSync(jsonlPath)).toBe(true)
    const lines = fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
    const summary = lines.find(l => l.event === 'session_summary')
    expect(summary).toBeTruthy()
    expect(summary.source).toBe('migration-synthesizer')
  })

  it('writes a sidecar for each migrated session', () => {
    writeLegacy(home, 'quoth-2026-04-06.jsonl', [
      { event: 'tool_use', session: 'D', project: 'quoth', tool: 'Bash' },
      { event: 'session_summary', session: 'D', project: 'quoth', total_calls: 1 },
    ])

    const { migrate } = requireCjs('../scripts/migrate-session-isolation.js')
    migrate({ home })

    // D has 1 tool_use + summary. Spec §7.1: NO trivial gate — it goes to
    // processing/ and the extractor decides productive vs routine.
    const meta = JSON.parse(fs.readFileSync(path.join(home, 'trajectories', 'processing', 'D.meta.json'), 'utf8'))
    expect(meta.session_id).toBe('D')
    expect(meta.source).toBe('migration')
    expect(meta.status).toBe('terminated')
    expect(meta.closed_marker).toBe(true)
    // No empty_reason: that field only exists for sessions that landed in empty/.
    expect(meta.empty_reason).toBeUndefined()
  })

  it('is idempotent — a second run is a no-op', () => {
    writeLegacy(home, 'quoth-2026-04-05.jsonl', [
      { event: 'tool_use', session: 'E', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'E', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'E', project: 'quoth', tool: 'Bash' },
      { event: 'session_summary', session: 'E', project: 'quoth', total_calls: 3 },
    ])

    const { migrate } = requireCjs('../scripts/migrate-session-isolation.js')
    const result1 = migrate({ home })
    const result2 = migrate({ home })

    expect(result1.migrated).toBe(1)
    expect(result2.migrated).toBe(0)
  })

  it('dry-run writes nothing and reports counts', () => {
    writeLegacy(home, 'quoth-2026-04-03.jsonl', [
      { event: 'tool_use', session: 'F', project: 'quoth', tool: 'Bash' },
      { event: 'tool_use', session: 'F', project: 'quoth', tool: 'Bash' },
      { event: 'session_summary', session: 'F', project: 'quoth', total_calls: 2 },
    ])

    const { migrate } = requireCjs('../scripts/migrate-session-isolation.js')
    const result = migrate({ home, dryRun: true })

    // Legacy file untouched.
    expect(fs.existsSync(path.join(home, 'trajectories', 'quoth-2026-04-03.jsonl'))).toBe(true)
    // No destination files created.
    expect(fs.existsSync(path.join(home, 'trajectories', 'processing', 'F.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'trajectories', 'empty', 'F.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'trajectories', 'migrated-legacy', 'quoth-2026-04-03.jsonl'))).toBe(false)
    // Counts still reflect the discovered work.
    expect(result.migrated).toBe(0)
    expect(result.sessions).toBe(1)
  })
})
