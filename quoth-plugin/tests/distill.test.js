import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import childProcess from 'child_process'

let spawnSyncSpy

beforeEach(() => {
  spawnSyncSpy = vi.spyOn(childProcess, 'spawnSync')
})

afterEach(() => {
  vi.restoreAllMocks()
})

const { distill } = require('../daemon/pipeline/distill.js')

describe('distill', () => {
  it('extracts a pattern from a successful entry', () => {
    spawnSyncSpy.mockReturnValue({ status: 0, stdout: JSON.stringify({
      pattern: 'Use :visible when multiple buttons match the same selector',
      tags: ['selector', 'playwright'],
      applicability: 'broad'
    }) })
    const result = distill({ agent: 'test-healer', task: 'fix button selector',
      outcome: 'success', pattern_used: 'visibility-filter' })
    expect(result.pattern).toContain(':visible')
    expect(result.tags).toContain('selector')
    expect(result.applicability).toBe('broad')
  })

  it('generates a stable id from the pattern content', () => {
    spawnSyncSpy.mockReturnValue({ status: 0, stdout: JSON.stringify({
      pattern: 'Always use data-testid for stable selectors',
      tags: ['selector'], applicability: 'broad'
    }) })
    const r1 = distill({ agent: 'test-healer', task: 'fix selector', outcome: 'success' })
    const r2 = distill({ agent: 'other-agent', task: 'different task', outcome: 'success' })
    expect(r1.id).toBe(r2.id) // same pattern content = same id
  })

  it('falls back gracefully on parse error', () => {
    spawnSyncSpy.mockReturnValue({ status: 0, stdout: 'unparseable output' })
    const result = distill({ agent: 'test-healer', task: 'fix selector',
      outcome: 'success', pattern_used: 'some-pattern' })
    expect(result.fallback).toBe(true)
    expect(result.pattern).toBeTruthy()
  })
})
