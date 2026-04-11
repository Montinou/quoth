import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sampleSession = (overrides = {}) => ({
  session_id: 'sess-extract-1',
  project: 'quoth',
  entries: [
    { tool: 'Read', input: { file_path: '/tmp/a.js' } },
    { tool: 'Edit', input: { file_path: '/tmp/a.js' } },
    { tool: 'Bash', input: { command: 'npm test' } },
  ],
  ...overrides,
})

describe('parseExtractEntities', () => {
  let extract
  beforeEach(async () => {
    vi.resetModules()
    extract = await import('../../../daemon/pipeline/extract.js')
  })

  it('parses all 4 entity kinds from valid JSON', () => {
    const raw = JSON.stringify({
      entities: [
        {
          kind: 'pattern',
          summary: 'use ripgrep',
          condition: 'when searching large codebases',
          action: 'use ripgrep instead of grep for speed',
          quality_signal: 'universal',
        },
        {
          kind: 'decision',
          summary: 'picked vitest',
          situation: 'choosing a test runner',
          options_considered: ['jest', 'vitest'],
          choice: 'vitest',
          reasoning: 'faster ESM support',
          outcome: 'tests run in 2s',
        },
        {
          kind: 'anti_pattern',
          summary: 'avoid sync fs in hot paths',
          condition: 'in a hot request handler',
          what_not_to_do: 'call fs.readFileSync',
          why_failed: 'blocks the event loop',
        },
        {
          kind: 'fact',
          summary: 'build command',
          topic: 'build',
          statement: 'the plugin builds with npm test',
          evidence: 'package.json scripts',
        },
      ],
    })
    const { entities } = extract.parseExtractEntities(raw)
    expect(entities).toHaveLength(4)
    const kinds = entities.map(e => e.kind).sort()
    expect(kinds).toEqual(['anti_pattern', 'decision', 'fact', 'pattern'])

    const pattern = entities.find(e => e.kind === 'pattern')
    expect(pattern.content).toBe('when searching large codebases → use ripgrep instead of grep for speed')
    expect(pattern.metadata.quality_signal).toBe('universal')

    const decision = entities.find(e => e.kind === 'decision')
    expect(decision.content).toBe('choosing a test runner: vitest')
    expect(decision.metadata.options_considered).toEqual(['jest', 'vitest'])

    const anti = entities.find(e => e.kind === 'anti_pattern')
    expect(anti.content).toBe('in a hot request handler: NOT call fs.readFileSync')

    const fact = entities.find(e => e.kind === 'fact')
    expect(fact.content).toBe('build: the plugin builds with npm test')
  })

  it('drops malformed entries but keeps valid ones', () => {
    const raw = JSON.stringify({
      entities: [
        {
          kind: 'pattern',
          summary: 'ok one',
          condition: 'when X',
          action: 'do Y',
          quality_signal: 'domain',
        },
        {
          kind: 'pattern',
          summary: 'missing action',
          condition: 'when Z',
          // action field missing
          quality_signal: 'project',
        },
      ],
    })
    const { entities } = extract.parseExtractEntities(raw)
    expect(entities).toHaveLength(1)
    expect(entities[0].metadata.condition).toBe('when X')
  })

  it('returns empty entities on non-JSON input', () => {
    const { entities } = extract.parseExtractEntities('not json at all')
    expect(entities).toEqual([])
  })
})

describe('runExtract', () => {
  let home, extract
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-extract-'))
    process.env.QUOTH_HOME = home
    process.env.QUOTH_DAILY_LLM_BUDGET_USD = '1.00'
    vi.resetModules()
    extract = await import('../../../daemon/pipeline/extract.js')
  })
  afterEach(() => {
    delete process.env.QUOTH_DAILY_LLM_BUDGET_USD
    delete process.env.QUOTH_HOME
    rmSync(home, { recursive: true, force: true })
  })

  it('stamps scope from sidecar project and strips LLM-injected project metadata (anti-leak)', async () => {
    const fakeLLM = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        entities: [
          {
            kind: 'pattern',
            summary: 'test pattern',
            condition: 'when testing',
            action: 'mock the llm with vi.fn()',
            quality_signal: 'domain',
            project: 'hallucinated',
            scope: 'project:hallucinated',
          },
        ],
      }),
      cost_usd: 0.004,
    })

    const out = await extract.runExtract(sampleSession({ project: 'quoth' }), {
      llm: fakeLLM,
      urgency: 'medium',
    })

    expect(out.entities).toHaveLength(1)
    expect(out.entities[0].scope).toBe('project:quoth')
    expect(out.entities[0].metadata.project).toBeUndefined()
    expect(out.entities[0].metadata.scope).toBeUndefined()
    expect(out.cost_usd).toBeCloseTo(0.004, 6)
    expect(fakeLLM).toHaveBeenCalledTimes(1)
  })

  it('retries once on invalid JSON with stricter prompt', async () => {
    const fakeLLM = vi.fn()
      .mockResolvedValueOnce({ text: 'not json at all', cost_usd: 0.001 })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          entities: [
            {
              kind: 'fact',
              summary: 'a fact',
              topic: 'runtime',
              statement: 'node 20 is LTS',
              evidence: 'nodejs.org',
            },
          ],
        }),
        cost_usd: 0.002,
      })

    const out = await extract.runExtract(sampleSession(), {
      llm: fakeLLM,
      urgency: 'low',
      sleep: async () => {},
    })

    expect(fakeLLM).toHaveBeenCalledTimes(2)
    expect(out.entities).toHaveLength(1)
    expect(out.entities[0].kind).toBe('fact')
    expect(out.entities[0].scope).toBe('project:quoth')
    expect(out.cost_usd).toBeCloseTo(0.003, 6)

    // Second call should have received a stricter system prompt.
    const secondSystem = fakeLLM.mock.calls[1][0].system
    expect(secondSystem).toContain('RESPOND WITH A SINGLE VALID JSON OBJECT. NO PROSE.')
  })

  it('returns budget error without calling llm when budget is exhausted', async () => {
    // Consume the daily cap first.
    const budget = await import('../../../daemon/lib/llm-budget.js')
    process.env.QUOTH_DAILY_LLM_BUDGET_USD = '0.001'
    vi.resetModules()
    const freshExtract = await import('../../../daemon/pipeline/extract.js')

    const fakeLLM = vi.fn()
    const out = await freshExtract.runExtract(sampleSession(), {
      llm: fakeLLM,
      urgency: 'high', // estimated 0.025, way over 0.001 cap
    })
    expect(out.error).toBe('budget')
    expect(out.cost_usd).toBe(0)
    expect(fakeLLM).not.toHaveBeenCalled()
    // Silence unused import lint.
    void budget
  })
})

describe('runExtractWithFallback', () => {
  let home, extract
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-extract-fb-'))
    process.env.QUOTH_HOME = home
    process.env.QUOTH_DAILY_LLM_BUDGET_USD = '1.00'
    vi.resetModules()
    extract = await import('../../../daemon/pipeline/extract.js')
  })
  afterEach(() => {
    delete process.env.QUOTH_DAILY_LLM_BUDGET_USD
    delete process.env.QUOTH_HOME
    rmSync(home, { recursive: true, force: true })
  })

  it('falls back to sonnetFallback when primary llm throws and logs degraded', async () => {
    const fakeLLM = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const sonnetFallback = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        entities: [
          {
            kind: 'pattern',
            summary: 'fallback pattern',
            condition: 'when primary fails',
            action: 'route to sonnet fallback for recovery',
            quality_signal: 'project',
          },
        ],
      }),
      cost_usd: 0,
    })

    const out = await extract.runExtractWithFallback(sampleSession(), {
      llm: fakeLLM,
      urgency: 'medium',
      sonnetFallback,
    })

    expect(out.entities).toHaveLength(1)
    expect(out.entities[0].scope).toBe('project:quoth')
    expect(sonnetFallback).toHaveBeenCalledTimes(1)

    // Verify a degraded row landed in pipeline_errors.
    const { openDb } = await import('../../../daemon/db.js')
    const rows = openDb().prepare(
      `SELECT * FROM pipeline_errors WHERE stage = 'extract' AND severity = 'degraded'`
    ).all()
    expect(rows.length).toBeGreaterThanOrEqual(1)
    const recovered = rows.find(r => r.resolution === 'recovered')
    expect(recovered).toBeTruthy()
    expect(recovered.fallback_succeeded).toBe(1)
  })
})
