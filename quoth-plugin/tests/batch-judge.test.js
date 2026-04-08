import { describe, it, expect, vi, beforeEach } from 'vitest'

const { batchJudge } = require('../daemon/pipeline/batch-judge.js')

const mockCallLLMWithUsage = vi.fn()
const mockRouteTask = vi.fn((task) => {
  if (/test/i.test(task)) return { agent: 'tester', confidence: 0.8 }
  if (/deploy/i.test(task)) return { agent: 'devops', confidence: 0.8 }
  return { agent: 'coder', confidence: 0.5 }
})

const deps = { callLLMWithUsage: mockCallLLMWithUsage, routeTask: mockRouteTask }

const ENTRIES = [
  { agent: 'claude-code', task: 'fix auth bug', outcome: 'success', tool_calls: 5 },
  { agent: 'claude-code', task: 'write unit test', outcome: 'failure', tool_calls: 3 },
]

describe('batchJudge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('happy path — returns structured judgments from LLM', async () => {
    mockCallLLMWithUsage.mockResolvedValue({
      content: JSON.stringify({
        judgments: [
          { index: 0, effective: true, domain: 'coder', reason: 'fixed bug correctly' },
          { index: 1, effective: false, domain: 'tester', reason: 'test was flaky' },
        ],
      }),
      model: 'google/gemini-2.5-flash',
      input_tokens: 200,
      output_tokens: 80,
      estimated_cost_usd: 0.00026,
    })

    const result = await batchJudge(ENTRIES, deps)

    expect(result.judgments).toHaveLength(2)
    expect(result.judgments[0]).toEqual({
      index: 0, effective: true, domain: 'coder', reason: 'fixed bug correctly',
    })
    expect(result.judgments[1]).toEqual({
      index: 1, effective: false, domain: 'tester', reason: 'test was flaky',
    })
    expect(result.usage).toEqual({
      model: 'google/gemini-2.5-flash',
      input_tokens: 200,
      output_tokens: 80,
      estimated_cost_usd: 0.00026,
    })
    expect(mockCallLLMWithUsage).toHaveBeenCalledOnce()
    // Verify model param
    expect(mockCallLLMWithUsage.mock.calls[0][2]).toBe('google/gemini-2.5-flash')
  })

  it('LLM failure — falls back to outcome + routeTask', async () => {
    mockCallLLMWithUsage.mockRejectedValue(new Error('No API key'))

    const result = await batchJudge(ENTRIES, deps)

    expect(result.judgments).toHaveLength(2)
    expect(result.judgments[0]).toMatchObject({
      index: 0, effective: true, fallback: true,
    })
    expect(result.judgments[1]).toMatchObject({
      index: 1, effective: false, fallback: true,
    })
    expect(result.usage).toEqual({
      model: 'google/gemini-2.5-flash',
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
    })
  })

  it('invalid domain — normalizes via routeTask', async () => {
    mockCallLLMWithUsage.mockResolvedValue({
      content: JSON.stringify({
        judgments: [
          { index: 0, effective: true, domain: 'wizard', reason: 'magic' },
          { index: 1, effective: false, domain: 'tester', reason: 'valid domain' },
        ],
      }),
      model: 'google/gemini-2.5-flash',
      input_tokens: 100,
      output_tokens: 50,
      estimated_cost_usd: 0.0002,
    })

    const result = await batchJudge(ENTRIES, deps)

    // 'wizard' is not valid → routeTask('fix auth bug') → 'coder'
    expect(result.judgments[0].domain).toBe('coder')
    // 'tester' is valid → kept
    expect(result.judgments[1].domain).toBe('tester')
  })

  it('partial response — fills missing entries with fallback', async () => {
    mockCallLLMWithUsage.mockResolvedValue({
      content: JSON.stringify({
        judgments: [
          { index: 0, effective: true, domain: 'coder', reason: 'ok' },
        ],
      }),
      model: 'google/gemini-2.5-flash',
      input_tokens: 100,
      output_tokens: 30,
      estimated_cost_usd: 0.0001,
    })

    const result = await batchJudge(ENTRIES, deps)

    expect(result.judgments).toHaveLength(2)
    expect(result.judgments[0]).toEqual({
      index: 0, effective: true, domain: 'coder', reason: 'ok',
    })
    expect(result.judgments[1]).toMatchObject({
      index: 1, effective: false, domain: 'tester', fallback: true,
    })
  })

  it('domain fallback routing — maps task text correctly', async () => {
    mockCallLLMWithUsage.mockRejectedValue(new Error('timeout'))

    const entries = [
      { agent: 'claude-code', task: 'write unit tests for auth', outcome: 'success', tool_calls: 4 },
      { agent: 'claude-code', task: 'deploy to production', outcome: 'failure', tool_calls: 2 },
    ]

    const result = await batchJudge(entries, deps)

    expect(result.judgments[0].domain).toBe('tester')
    expect(result.judgments[1].domain).toBe('devops')
  })
})
