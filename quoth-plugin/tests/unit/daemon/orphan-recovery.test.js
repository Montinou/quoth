import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recoverOrphans } from '../../../daemon/daemon-core.js'

describe('recoverOrphans', () => {
  let dir
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'quoth-orphan-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('strips suffix from a dead-PID orphan', () => {
    writeFileSync(join(dir, 'sess.99999999.w1.jsonl'), '')
    recoverOrphans(dir)
    const files = readdirSync(dir)
    expect(files).toContain('sess.jsonl')
  })

  it('leaves live-PID orphans alone', () => {
    writeFileSync(join(dir, `sess.${process.pid}.w1.jsonl`), '')
    recoverOrphans(dir)
    const files = readdirSync(dir)
    expect(files.some(f => f.includes(`${process.pid}.w1`))).toBe(true)
  })
})
