import { describe, it, expect } from 'vitest'
import { snipsEstimate, snipsVariance, effectiveSampleSize, clipWeight } from '../daemon/lib/snips.js'

describe('SNIPS estimator', () => {
  it('returns reward mean when propensities uniform', () => {
    const obs = [
      { reward: 1.0, propensity: 0.5 },
      { reward: 0.0, propensity: 0.5 },
      { reward: 1.0, propensity: 0.5 },
    ]
    expect(snipsEstimate(obs)).toBeCloseTo(2/3, 2)
  })

  it('amplifies low-propensity positive rewards', () => {
    const obs = [
      { reward: 1.0, propensity: 0.01 },   // amplified (capped at 10)
      { reward: 0.0, propensity: 0.5 },
    ]
    const est = snipsEstimate(obs)
    expect(est).toBeGreaterThan(0.8)
  })

  it('clips weights at cap', () => {
    expect(clipWeight(0.001, 10)).toBe(10)
    expect(clipWeight(0.5, 10)).toBe(2)
    expect(clipWeight(0.1, 100)).toBe(10)
  })

  it('returns 0.5 prior when no observations', () => {
    expect(snipsEstimate([])).toBe(0.5)
    expect(snipsEstimate(null)).toBe(0.5)
  })

  it('variance shrinks with more data', () => {
    const few = [{reward:1, propensity:0.5}, {reward:0, propensity:0.5}]
    const many = []
    for (let i = 0; i < 100; i++) many.push({reward: i%2, propensity: 0.5})
    expect(snipsVariance(few)).toBeGreaterThan(snipsVariance(many))
  })

  it('ESS equals n when weights equal', () => {
    const obs = [
      { reward:1, propensity:0.5 },
      { reward:0, propensity:0.5 },
      { reward:1, propensity:0.5 },
    ]
    expect(effectiveSampleSize(obs)).toBeCloseTo(3, 5)
  })

  it('ESS < n when weights varied', () => {
    const obs = [
      { reward:1, propensity:0.01 },  // weight 10 (clipped)
      { reward:0, propensity:0.5 },   // weight 2
    ]
    expect(effectiveSampleSize(obs)).toBeLessThan(2)
  })
})
