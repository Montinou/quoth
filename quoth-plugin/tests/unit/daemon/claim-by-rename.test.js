import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tryClaim } from '../../../daemon/daemon-core.js'

describe('tryClaim', () => {
  let dir
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'quoth-claim-'))
    writeFileSync(join(dir, 'abc.jsonl'), '')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('exactly one of two concurrent claims wins', async () => {
    const c1 = Promise.resolve().then(() => tryClaim(dir, 'abc.jsonl', 'w1'))
    const c2 = Promise.resolve().then(() => tryClaim(dir, 'abc.jsonl', 'w2'))
    const [r1, r2] = await Promise.all([c1, c2])
    const winners = [r1, r2].filter(Boolean)
    expect(winners).toHaveLength(1)
    const files = readdirSync(dir)
    const claimed = files.filter(f => f.includes('.w1.') || f.includes('.w2.'))
    expect(claimed).toHaveLength(1)
    expect(existsSync(join(dir, 'abc.jsonl'))).toBe(false)
  })

  it('returns the claimed path with pid + workerId suffix on success', () => {
    const result = tryClaim(dir, 'abc.jsonl', 'w9')
    expect(result).not.toBeNull()
    expect(result).toMatch(new RegExp(`abc\\.${process.pid}\\.w9\\.jsonl$`))
  })

  it('returns null when file does not exist', () => {
    const result = tryClaim(dir, 'nope.jsonl', 'w1')
    expect(result).toBeNull()
  })
})
