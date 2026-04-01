import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import childProcess from 'child_process'

let spawnSyncSpy

const existingPatterns = [
  { id: 'vis-1', name: 'visibility-filter', pattern_type: 'code-pattern',
    condition: 'multiple elements', action: 'use :visible', confidence: 0.7, tags: ['selector'] },
]

beforeEach(() => {
  spawnSyncSpy = vi.spyOn(childProcess, 'spawnSync')
})

afterEach(() => {
  vi.restoreAllMocks()
})

const { consolidate } = require('../daemon/pipeline/consolidate.js')

describe('consolidate', () => {
  it('returns "strengthen" when new pattern matches existing', () => {
    spawnSyncSpy.mockReturnValue({ status: 0, stdout: JSON.stringify({
      action: 'strengthen', targetId: 'vis-1',
      updated: { id: 'vis-1', action: 'use :visible filter for ambiguous selectors' }
    }) })
    const result = consolidate(
      { id: 'new-1', pattern: 'use :visible for buttons', tags: ['selector'] },
      existingPatterns
    )
    expect(result.action).toBe('strengthen')
    expect(result.targetId).toBe('vis-1')
  })

  it('returns "new" when no similar pattern exists', () => {
    spawnSyncSpy.mockReturnValue({ status: 0, stdout: JSON.stringify({
      action: 'new',
      updated: { id: 'auth-1', pattern: 'use storageState for auth' }
    }) })
    const result = consolidate(
      { id: 'auth-1', pattern: 'use storageState for auth', tags: ['auth'] },
      []
    )
    expect(result.action).toBe('new')
  })

  it('falls back to "new" on parse error', () => {
    spawnSyncSpy.mockReturnValue({ status: 0, stdout: 'garbage' })
    const result = consolidate(
      { id: 'x', pattern: 'some pattern', tags: [] },
      existingPatterns
    )
    expect(result.action).toBe('new')
    expect(result.fallback).toBe(true)
  })
})
