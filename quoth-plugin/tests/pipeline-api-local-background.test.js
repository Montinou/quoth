import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'module'

const requireCjs = createRequire(import.meta.url)

describe('pipeline-api — runLocalBackground', () => {
  beforeEach(() => {
    process.env.QUOTH_MANAGED_LOCAL_BACKGROUND = 'true'
    process.env.QUOTH_API_KEY = 'qth_test'
    process.env.QUOTH_API_URL = 'https://quoth.test'
  })
  afterEach(() => {
    delete process.env.QUOTH_MANAGED_LOCAL_BACKGROUND
    delete process.env.QUOTH_API_KEY
    delete process.env.QUOTH_API_URL
  })

  it('calls local extract() and posts result as a confirmation', async () => {
    const api = requireCjs('../daemon/lib/pipeline-api.js')
    const localExtractMock = vi.fn(async () => ({
      patterns: [{ id: 'p1', condition: 'when a', action: 'do the specific thing that works', tags: [], quality_signal: 'project', embedding: null, source: 'distilled' }],
      facts: [{ topic: 'build', statement: 'pnpm test', scope: 'project', tags: [] }],
    }))
    const postSpy = vi.fn(async () => ({ patterns: [], facts: [], tokens_used: 0 }))

    const result = await api.runLocalBackground({
      summary: { session: 's1', project: 'quoth', total_calls: 5 },
      toolEntries: [{ tool: 'Bash', task: 'ls', outcome: 'success' }],
      db: { insertPipelineError: () => {} },
      _localExtract: localExtractMock,
      _postConfirmation: postSpy,
    })

    expect(localExtractMock).toHaveBeenCalledOnce()
    expect(postSpy).toHaveBeenCalledOnce()
    expect(result.patterns).toHaveLength(1)
    expect(result.facts).toHaveLength(1)
  })

  it('still resolves with local result even if cloud confirmation fails', async () => {
    const api = requireCjs('../daemon/lib/pipeline-api.js')
    const localExtractMock = vi.fn(async () => ({
      patterns: [{ id: 'p1', condition: 'when a', action: 'do the specific thing that works', tags: [], quality_signal: 'project', embedding: null, source: 'distilled' }],
      facts: [],
    }))
    const postSpy = vi.fn(async () => { throw new Error('cloud down') })

    const result = await api.runLocalBackground({
      summary: { session: 's2', project: 'quoth' },
      toolEntries: [{ tool: 'Bash' }],
      db: { insertPipelineError: () => {} },
      _localExtract: localExtractMock,
      _postConfirmation: postSpy,
    })

    expect(result.patterns).toHaveLength(1) // local won
    expect(result.facts).toHaveLength(0)
  })

  it('returns empty arrays and records pipeline error when local extract throws', async () => {
    const api = requireCjs('../daemon/lib/pipeline-api.js')
    const localExtractMock = vi.fn(async () => { throw new Error('moonshot down') })
    const errors = []
    const db = {
      insertPipelineError: (e) => { errors.push(e) },
    }

    const result = await api.runLocalBackground({
      summary: { session: 's3', project: 'quoth' },
      toolEntries: [],
      db,
      _localExtract: localExtractMock,
      _postConfirmation: async () => { throw new Error('should not be called') },
    })

    expect(result.patterns).toHaveLength(0)
    expect(result.facts).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0].stage).toBe('extract-local-background')
  })
})
