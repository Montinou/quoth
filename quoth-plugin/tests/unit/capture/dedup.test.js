import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('trajectory-capture dedup sidecar', () => {
  let home, capture
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-dedup-'))
    process.env.QUOTH_HOME = home
    vi.resetModules()
    capture = await import('../../../hooks/trajectory-capture.js')
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('collapses 5 identical Read calls into 1 entry', () => {
    const input = { session_id: 'sid', tool_name: 'Read', tool_input: { file_path: '/x/y.txt' }, tool_response: { ok: 1 }, cwd: process.cwd() }
    for (let i = 0; i < 5; i++) capture.handlePostToolUse(input)
    const jsonl = readFileSync(join(home, 'trajectories/active/sid.jsonl'), 'utf8').trim().split('\n')
    expect(jsonl).toHaveLength(1)
  })

  it('keeps three distinct calls in sequence', () => {
    for (const p of ['a.txt','b.txt','a.txt']) {
      capture.handlePostToolUse({ session_id: 'sid2', tool_name: 'Read', tool_input: { file_path: p }, tool_response: {}, cwd: process.cwd() })
    }
    const jsonl = readFileSync(join(home, 'trajectories/active/sid2.jsonl'), 'utf8').trim().split('\n')
    expect(jsonl).toHaveLength(3)
  })
})
