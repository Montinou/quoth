import { describe, it, expect, afterEach } from 'vitest'
import { isV2Enabled, isSubFlag } from '../daemon/lib/flags.js'

describe('feature flags', () => {
  const orig = { ...process.env }
  afterEach(() => { process.env = { ...orig } })

  it('returns false when no flags set', () => {
    delete process.env.QUOTH_LEARNING_V2
    delete process.env.QUOTH_V2_INJECTION
    expect(isV2Enabled()).toBe(false)
    expect(isSubFlag('injection')).toBe(false)
  })

  it('master flag enables all subflags', () => {
    process.env.QUOTH_LEARNING_V2 = 'true'
    expect(isV2Enabled()).toBe(true)
    expect(isSubFlag('injection')).toBe(true)
    expect(isSubFlag('judge')).toBe(true)
    expect(isSubFlag('curation')).toBe(true)
  })

  it('subflag works independently of master', () => {
    delete process.env.QUOTH_LEARNING_V2
    process.env.QUOTH_V2_INJECTION = 'true'
    expect(isSubFlag('injection')).toBe(true)
    expect(isSubFlag('judge')).toBe(false)
  })

  it('accepts multiple truthy values', () => {
    process.env.QUOTH_LEARNING_V2 = '1'
    expect(isV2Enabled()).toBe(true)
    process.env.QUOTH_LEARNING_V2 = 'yes'
    expect(isV2Enabled()).toBe(true)
    process.env.QUOTH_LEARNING_V2 = 'false'
    expect(isV2Enabled()).toBe(false)
  })
})
