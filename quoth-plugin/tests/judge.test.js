import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import childProcess from 'child_process'

let execSyncSpy

beforeEach(() => {
  execSyncSpy = vi.spyOn(childProcess, 'execSync')
})

afterEach(() => {
  vi.restoreAllMocks()
})

const { judge } = require('../daemon/pipeline/judge.js')

describe('judge', () => {
  it('returns effective:true for successful outcome', () => {
    execSyncSpy.mockReturnValue(
      JSON.stringify({ effective: true, reason: 'selector fixed', category: 'selector' })
    )
    const result = judge({ agent: 'test-healer', outcome: 'success', task: 'fix login' })
    expect(result.effective).toBe(true)
    expect(result.category).toBe('selector')
  })

  it('returns effective:false for failed outcome', () => {
    execSyncSpy.mockReturnValue(
      JSON.stringify({ effective: false, reason: 'timeout issue', category: 'wait' })
    )
    const result = judge({ agent: 'test-healer', outcome: 'failure', task: 'fix login' })
    expect(result.effective).toBe(false)
  })

  it('handles malformed JSON from claude gracefully', () => {
    execSyncSpy.mockReturnValue('not valid json at all')
    const result = judge({ agent: 'test-healer', outcome: 'success', task: 'fix login' })
    expect(result.effective).toBe(true)
    expect(result.fallback).toBe(true)
  })

  it('handles claude subprocess error gracefully', () => {
    execSyncSpy.mockImplementation(() => { throw new Error('claude not found') })
    const result = judge({ agent: 'test-healer', outcome: 'success', task: 'fix login' })
    expect(result.effective).toBe(true)
    expect(result.error).toBeDefined()
  })
})
