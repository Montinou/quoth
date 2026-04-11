import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkStartupFlag, writeStartupFailed } from '../../../daemon/daemon-core.js'

describe('startup failed flag', () => {
  let home
  let prevHome
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'quoth-flag-'))
    prevHome = process.env.QUOTH_HOME
    process.env.QUOTH_HOME = home
  })
  afterEach(() => {
    if (prevHome === undefined) delete process.env.QUOTH_HOME
    else process.env.QUOTH_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it('writes and reads the STARTUP_FAILED flag', () => {
    writeStartupFailed('db-corrupt')
    const flag = checkStartupFlag()
    expect(flag).toMatch(/db-corrupt/)
    expect(existsSync(join(home, 'STARTUP_FAILED'))).toBe(true)
  })
})
