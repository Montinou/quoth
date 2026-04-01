import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { attributeOutcome } = require('../daemon/lib/attribute.js')

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('attributeOutcome', () => {
  it('returns attributions array for each pattern', async () => {
    vi.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      status: 0,
      stdout: JSON.stringify([
        { patternId: 'pat-1', attribution: 'success', reason: 'helped' },
        { patternId: 'pat-2', attribution: 'irrelevant', reason: 'not used' }
      ])
    })
    const result = await attributeOutcome({
      patterns: [{ id: 'pat-1', name: 'p1' }, { id: 'pat-2', name: 'p2' }],
      outcome: 'success',
      feature: 'login',
      agent: 'test-healer',
      errorSummary: null
    })
    expect(result).toHaveLength(2)
    expect(result[0].patternId).toBe('pat-1')
    expect(result[0].attribution).toBe('success')
  })

  it('returns empty array when no patterns provided', async () => {
    const result = await attributeOutcome({
      patterns: [],
      outcome: 'success',
      feature: 'login',
      agent: 'test-healer'
    })
    expect(result).toEqual([])
  })

  it('returns empty array on subprocess failure', async () => {
    vi.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      status: 1, stdout: ''
    })
    const result = await attributeOutcome({
      patterns: [{ id: 'pat-1', name: 'p1' }],
      outcome: 'failure',
      feature: 'login',
      agent: 'test-healer',
      errorSummary: 'timeout'
    })
    expect(result).toEqual([])
  })
})
