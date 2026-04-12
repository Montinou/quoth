import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('trajectory-capture performance', () => {
  let home, capture
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-perf-'))
    process.env.QUOTH_HOME = home
    vi.resetModules()
    capture = await import('../../../hooks/trajectory-capture.js')
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  // Budget: spec §2.1 allows ~3ms/call on the hot path (3000ms for 1000 calls).
  // 1000ms is 3× stricter — catches order-of-magnitude regressions while
  // staying stable under full-suite I/O contention on WSL2 ext4.
  it('handles 1000 distinct PostToolUse calls in <1000 ms', () => {
    const t0 = Date.now()
    for (let i = 0; i < 1000; i++) {
      capture.handlePostToolUse({
        session_id: 'perf',
        tool_name: 'Read',
        tool_input: { file_path: `/x/${i}.txt` },
        tool_response: { ok: 1 },
        cwd: process.cwd(),
      })
    }
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})
