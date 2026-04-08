import { describe, it, expect } from 'vitest'
import { sessionOutcomeReward, extractSessionSignals, summarizeSession } from '../daemon/lib/attribution.js'

describe('attribution', () => {
  // Priority 1: session_summary with success_rate
  it('returns 1.0 for session_summary success_rate >= 0.8', () => {
    expect(sessionOutcomeReward([{ event: 'session_summary', success_rate: 0.9 }])).toBe(1.0)
    expect(sessionOutcomeReward([{ event: 'session_summary', success_rate: 0.8 }])).toBe(1.0)
  })

  it('returns 0.7 for session_summary success_rate >= 0.5', () => {
    expect(sessionOutcomeReward([{ event: 'session_summary', success_rate: 0.6 }])).toBe(0.7)
    expect(sessionOutcomeReward([{ event: 'session_summary', success_rate: 0.5 }])).toBe(0.7)
  })

  it('returns 0.3 for session_summary success_rate > 0 but < 0.5', () => {
    expect(sessionOutcomeReward([{ event: 'session_summary', success_rate: 0.1 }])).toBe(0.3)
    expect(sessionOutcomeReward([{ event: 'session_summary', success_rate: 0.49 }])).toBe(0.3)
  })

  it('returns 0.0 for session_summary success_rate === 0', () => {
    expect(sessionOutcomeReward([{ event: 'session_summary', success_rate: 0 }])).toBe(0.0)
  })

  // Priority 2: legacy outcome fields
  it('returns 1.0 for all-success (legacy outcome)', () => {
    const events = [{ outcome:'success', tool:'Edit' }, { outcome:'success', tool:'Bash' }]
    expect(sessionOutcomeReward(events)).toBe(1.0)
  })

  it('returns 0.0 when any failure (legacy outcome)', () => {
    const events = [{ outcome:'success' }, { outcome:'failure' }]
    expect(sessionOutcomeReward(events)).toBe(0.0)
  })

  // Priority 3: tool mix inference
  it('returns 0.8 for writes with no bash errors', () => {
    const events = [
      { tool: 'Edit' },
      { tool: 'Write' },
      { tool: 'Bash', exit_code: 0 },
    ]
    expect(sessionOutcomeReward(events)).toBe(0.8)
  })

  it('returns 0.5 for writes with bash errors', () => {
    const events = [
      { tool: 'Write' },
      { tool: 'Bash', exit_code: 1 },
    ]
    expect(sessionOutcomeReward(events)).toBe(0.5)
  })

  it('returns 0.2 for bash errors only (no writes)', () => {
    const events = [
      { tool: 'Bash', exit_code: 1 },
      { tool: 'Bash', exit_code: 127 },
    ]
    expect(sessionOutcomeReward(events)).toBe(0.2)
  })

  it('returns 0.5 with no signal (empty or read-only)', () => {
    expect(sessionOutcomeReward([])).toBe(0.5)
    expect(sessionOutcomeReward([{tool:'Read'}])).toBe(0.5)
  })

  // Priority order: session_summary wins over legacy outcome + tool mix
  it('session_summary takes priority over legacy outcome fields', () => {
    const events = [
      { event: 'session_summary', success_rate: 0.9 },
      { outcome: 'failure', tool: 'Bash' },
    ]
    expect(sessionOutcomeReward(events)).toBe(1.0)
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
