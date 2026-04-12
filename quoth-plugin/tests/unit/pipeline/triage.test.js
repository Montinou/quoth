import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sampleSession = () => ({
  session_id: 'sess-test-1',
  project: 'quoth',
  entries: [
    { tool: 'Read', input: { file_path: '/tmp/a.js' } },
    { tool: 'Edit', input: { file_path: '/tmp/a.js' } },
    { tool: 'Bash', input: { command: 'npm test' } },
    { tool: 'Write', input: { file_path: '/tmp/b.js' } },
    { tool: 'Grep', input: { pattern: 'foo' } },
    { tool: 'Bash', input: { command: 'git status' } },
  ],
})

describe('runTriage', () => {
  let home, triage

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-triage-'))
    process.env.QUOTH_HOME = home
    process.env.QUOTH_DAILY_LLM_BUDGET_USD = '1.00'
    vi.resetModules()
    triage = await import('../../../daemon/pipeline/triage.js')
  })

  afterEach(() => {
    delete process.env.QUOTH_DAILY_LLM_BUDGET_USD
    rmSync(home, { recursive: true, force: true })
  })

  it('returns productive medium-urgency routing from a clean llm response', async () => {
    const fakeLLM = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        productive: true,
        urgency: 'medium',
        suspected_kinds: ['pattern', 'fact'],
      }),
      cost_usd: 0.0003,
    })

    const out = await triage.runTriage(sampleSession(), { llm: fakeLLM })
    expect(out.productive).toBe(true)
    expect(out.urgency).toBe('medium')
    expect(out.suspected_kinds.includes('pattern')).toBe(true)
    expect(out.suspected_kinds.includes('fact')).toBe(true)
    expect(out.degraded).toBeUndefined()
    expect(fakeLLM).toHaveBeenCalledTimes(1)
  })

  it('retries once on a transient error then succeeds', async () => {
    const fakeLLM = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({
        text: JSON.stringify({
          productive: false,
          urgency: 'low',
          suspected_kinds: [],
        }),
        cost_usd: 0.0002,
      })

    const out = await triage.runTriage(sampleSession(), {
      llm: fakeLLM,
      retries: 1,
      sleep: async () => {},
    })

    expect(out.productive).toBe(false)
    expect(out.urgency).toBe('low')
    expect(fakeLLM).toHaveBeenCalledTimes(2)
  })

  it('falls back to safe default after exhausting retries', async () => {
    const fakeLLM = vi.fn().mockRejectedValue(new Error('rate-limited'))

    const out = await triage.runTriage(sampleSession(), {
      llm: fakeLLM,
      retries: 2,
      sleep: async () => {},
    })

    expect(out.degraded).toBe(true)
    expect(out.productive).toBe(true)
    expect(out.reason).toBe('llm-failed')
    expect(fakeLLM).toHaveBeenCalledTimes(3)
  })
})
