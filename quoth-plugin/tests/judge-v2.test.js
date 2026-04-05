import { describe, it, expect } from 'vitest'
import {
  betaCredibleInterval, betaCredibleWidth, selectUncertainPairs,
  buildPairwisePrompt, parseJudgeVerdict,
} from '../daemon/lib/judge.js'

describe('Beta credible intervals', () => {
  it('Beta(1,1) has wide CI', () => {
    expect(betaCredibleWidth(1, 1)).toBeGreaterThan(0.7)
  })

  it('Beta(50,10) has narrow CI', () => {
    expect(betaCredibleWidth(50, 10)).toBeLessThan(0.25)
  })

  it('Beta(0,0) returns full interval', () => {
    const { lower, upper } = betaCredibleInterval(0, 0)
    expect(lower).toBe(0); expect(upper).toBe(1)
  })
})

describe('uncertainty sampling', () => {
  it('flags only uncertain clusters', () => {
    const clusters = [
      { cluster_id: 0, alpha: 1, beta: 1 },
      { cluster_id: 1, alpha: 50, beta: 10 },   // confident
      { cluster_id: 2, alpha: 2, beta: 2 },
    ]
    const pairs = selectUncertainPairs(clusters, { maxPairs: 10, widthThreshold: 0.3 })
    expect(pairs.length).toBeGreaterThan(0)
    for (const p of pairs) {
      expect(p.a.cluster_id).not.toBe(1)
      expect(p.b.cluster_id).not.toBe(1)
    }
  })

  it('respects maxPairs limit', () => {
    const clusters = Array.from({length: 10}, (_, i) => ({ cluster_id: i, alpha: 1, beta: 1 }))
    const pairs = selectUncertainPairs(clusters, { maxPairs: 5 })
    expect(pairs).toHaveLength(5)
  })
})

describe('pairwise prompt', () => {
  it('builds prompt with both patterns', () => {
    const r = buildPairwisePrompt('session did x y z', {id:'p1', name:'Pattern 1', action:'do thing 1'}, {id:'p2', name:'Pattern 2', action:'do thing 2'})
    expect(r.prompt).toContain('Pattern A')
    expect(r.prompt).toContain('Pattern B')
    expect(r.prompt).toContain('session did x y z')
    expect(r.prompt).toContain('do thing 1')
    expect(r.prompt).toContain('do thing 2')
    // positionMap maps A/B → actual IDs
    expect([r.positionMap.A, r.positionMap.B].sort()).toEqual(['p1','p2'].sort())
  })

  it('position randomization produces both orderings over trials', () => {
    const seen = new Set()
    for (let i = 0; i < 50; i++) {
      const r = buildPairwisePrompt('', {id:'p1', name:'Pattern 1', action:''}, {id:'p2', name:'Pattern 2', action:''})
      seen.add(r.positionMap.A)
    }
    expect(seen.size).toBe(2)
  })
})

describe('verdict parsing', () => {
  const pm = { A: 'p1', B: 'p2' }

  it('parses A/B to actual ids', () => {
    expect(parseJudgeVerdict('A', pm)).toBe('p1')
    expect(parseJudgeVerdict('B', pm)).toBe('p2')
    expect(parseJudgeVerdict(' A\n', pm)).toBe('p1')
  })

  it('parses NEITHER', () => {
    expect(parseJudgeVerdict('NEITHER', pm)).toBe('NEITHER')
    expect(parseJudgeVerdict('N', pm)).toBe('NEITHER')
  })

  it('returns UNPARSEABLE on junk', () => {
    expect(parseJudgeVerdict('', pm)).toBe('UNPARSEABLE')
    expect(parseJudgeVerdict(null, pm)).toBe('UNPARSEABLE')
    expect(parseJudgeVerdict('???', pm)).toBe('UNPARSEABLE')
  })
})
