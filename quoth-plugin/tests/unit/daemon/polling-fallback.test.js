import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileWatcher } from '../../../daemon/daemon-core.js'

describe('FileWatcher polling fallback', () => {
  let dir, watcher
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'quoth-watch-'))
  })
  afterEach(() => {
    watcher?.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('polling detects a file that fs.watch missed', async () => {
    const seen = []
    watcher = new FileWatcher(dir, { pollIntervalMs: 100, disableFsWatch: true })
    watcher.on('file', f => seen.push(f))
    await watcher.start()
    writeFileSync(join(dir, 'late.jsonl'), '')
    await new Promise(r => setTimeout(r, 300))
    expect(seen).toContain('late.jsonl')
  })

  it('warmup sweep does not mark existing files as "missed by watcher"', async () => {
    writeFileSync(join(dir, 'preexisting.jsonl'), '')
    const degradedRows = []
    watcher = new FileWatcher(dir, {
      pollIntervalMs: 100,
      onDegraded: r => degradedRows.push(r),
    })
    await watcher.start()
    await new Promise(r => setTimeout(r, 250))
    expect(degradedRows).toHaveLength(0)
  })
})
