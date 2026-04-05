import { describe, it, expect, vi, afterEach } from 'vitest'
import { replaceWithExploration, EXPLORATION_RATE } from '../daemon/lib/propensity.js'

describe('exploration slot', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('replaces slot at given rate over many trials', () => {
    let replaced = 0
    for (let i = 0; i < 5000; i++) {
      const original = [{id:'a',rank:1},{id:'b',rank:2},{id:'c',rank:3}]
      const pool = [{id:'x'},{id:'y'},{id:'z'}]
      const result = replaceWithExploration(original, pool, EXPLORATION_RATE)
      if (result.some(r => r.is_exploration)) replaced++
    }
    const rate = replaced / 5000
    expect(rate).toBeGreaterThan(0.08)
    expect(rate).toBeLessThan(0.13)
  })

  it('never replaces when pool has no new items', () => {
    const original = [{id:'a',rank:1},{id:'b',rank:2}]
    const pool = [{id:'a'},{id:'b'}]
    for (let i = 0; i < 100; i++) {
      const result = replaceWithExploration(original, pool, 1.0)
      expect(result.some(r => r.is_exploration)).toBe(false)
    }
  })

  it('marks replacement with is_exploration and correct propensity', () => {
    const original = [{id:'a',rank:1}]
    const pool = [{id:'x'},{id:'y'}]
    vi.spyOn(Math, 'random').mockReturnValue(0.01)  // force exploration
    const result = replaceWithExploration(original, pool, 0.10)
    expect(result[0].is_exploration).toBe(true)
    expect(result[0].propensity).toBeCloseTo(0.10 / 2, 5)  // rate / |available|
  })

  it('handles empty inputs gracefully', () => {
    expect(replaceWithExploration([], [])).toEqual([])
    expect(replaceWithExploration(null, [{id:'x'}])).toBe(null)
  })
})
