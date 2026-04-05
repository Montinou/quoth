import { describe, it, expect } from 'vitest'
import { sessionOutcomeReward, extractSessionSignals, summarizeSession } from '../daemon/lib/attribution.js'

describe('attribution', () => {
  it('returns 1.0 for all-success', () => {
    const events = [{ outcome:'success', tool:'Edit' }, { outcome:'success', tool:'Bash' }]
    expect(sessionOutcomeReward(events)).toBe(1.0)
  })

  it('returns 0.0 when any failure', () => {
    const events = [{ outcome:'success' }, { outcome:'failure' }]
    expect(sessionOutcomeReward(events)).toBe(0.0)
  })

  it('returns 0.5 with no signal', () => {
    expect(sessionOutcomeReward([])).toBe(0.5)
    expect(sessionOutcomeReward([{tool:'Read'}])).toBe(0.5)
  })

  it('extracts tools and files', () => {
    const events = [
      { tool:'Edit', task:'Edit /src/app/route.ts' },
      { tool:'Bash', task:'Bash npm test' },
      { tool:'Read', task:'Read /docs/api.md' },
    ]
    const sig = extractSessionSignals(events)
    expect(sig.tools).toContain('Edit')
    expect(sig.tools).toContain('Bash')
    expect(sig.files).toContain('/src/app/route.ts')
    expect(sig.files).toContain('/docs/api.md')
    expect(sig.commands).toContain('npm')
  })

  it('summarizes within max length', () => {
    const events = [{ tool:'Edit', task:'Edit /a.ts', outcome:'success' }]
    const summary = summarizeSession(events, 200)
    expect(summary.length).toBeLessThanOrEqual(200)
    expect(summary).toContain('Outcome: 1.0')
  })
})
