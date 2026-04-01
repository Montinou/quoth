import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import childProcess from 'child_process'

let spawnSyncSpy

beforeEach(() => {
  spawnSyncSpy = vi.spyOn(childProcess, 'spawnSync')
})

afterEach(() => {
  vi.restoreAllMocks()
})

const { judge } = require('../daemon/pipeline/judge.js')

describe('judge', () => {
  it('returns effective:true for successful outcome', () => {
    spawnSyncSpy.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ effective: true, reason: 'selector fixed', category: 'selector' })
    })
    const result = judge({ agent: 'test-healer', outcome: 'success', task: 'fix login' })
    expect(result.effective).toBe(true)
    expect(result.category).toBe('selector')
  })

  it('returns effective:false for failed outcome', () => {
    spawnSyncSpy.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ effective: false, reason: 'timeout issue', category: 'wait' })
    })
    const result = judge({ agent: 'test-healer', outcome: 'failure', task: 'fix login' })
    expect(result.effective).toBe(false)
  })

  it('handles malformed JSON from claude gracefully', () => {
    spawnSyncSpy.mockReturnValue({ status: 0, stdout: 'not valid json at all' })
    const result = judge({ agent: 'test-healer', outcome: 'success', task: 'fix login' })
    expect(result.effective).toBe(true)
    expect(result.fallback).toBe(true)
  })

  it('handles claude subprocess error gracefully', () => {
    spawnSyncSpy.mockReturnValue({ status: 1, stdout: '' })
    const result = judge({ agent: 'test-healer', outcome: 'success', task: 'fix login' })
    expect(result.effective).toBe(true)
    expect(result.error).toBeDefined()
  })
})
