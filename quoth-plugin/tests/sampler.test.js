import { describe, it, expect } from 'vitest'
import { sampleBeta, scoreWithThompson } from '../daemon/lib/sampler.js'

describe('Thompson sampler', () => {
  it('sampleBeta respects mean for proven pattern', () => {
    // Beta(20,2): mean=20/22=0.909
    const samples = Array.from({length: 1000}, () => sampleBeta(20, 2))
    const mean = samples.reduce((a,b)=>a+b, 0) / samples.length
    expect(mean).toBeGreaterThan(0.85)
    expect(mean).toBeLessThan(0.96)
  })

  it('sampleBeta has high variance for unproven pattern', () => {
    // Beta(1,1) = uniform
    const samples = Array.from({length: 1000}, () => sampleBeta(1, 1))
    const mean = samples.reduce((a,b)=>a+b, 0) / samples.length
    expect(mean).toBeGreaterThan(0.4)
    expect(mean).toBeLessThan(0.6)
    const over07 = samples.filter(s => s > 0.7).length / samples.length
    expect(over07).toBeGreaterThan(0.15)
  })

  it('scoreWithThompson ranks differ from pure confidence', () => {
    const patterns = [
      { id: 'a', alpha: 20, beta: 2 },
      { id: 'b', alpha: 1, beta: 1 },
      { id: 'c', alpha: 8, beta: 2 },
    ]
    let bBeatsC = 0
    for (let i = 0; i < 200; i++) {
      const scored = scoreWithThompson(patterns)
      const rankedIds = scored.sort((x,y) => y._sampled - x._sampled).map(p => p.id)
      if (rankedIds.indexOf('b') < rankedIds.indexOf('c')) bBeatsC++
    }
    expect(bBeatsC).toBeGreaterThan(20)
    expect(bBeatsC).toBeLessThan(180)
  })
})
