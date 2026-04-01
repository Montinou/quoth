import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { promotePattern } = require('../daemon/lib/promote.js')

const fakePattern = {
  id: 'abc123',
  name: 'Use :visible for ambiguous selectors',
  condition: 'multiple elements match selector',
  action: 'Add :visible filter to disambiguate',
  confidence: 0.87,
  success_count: 12,
  failure_count: 2,
  tags: ['selector', 'playwright'],
  applicability: 'narrow',
  embedding: JSON.stringify([0.1, 0.2, 0.3])
}

beforeEach(() => {
  process.env.QUOTH_API_KEY = 'qth_testkey123'
  process.env.QUOTH_API_URL = 'https://test.quoth.dev'
  process.env.QUOTH_PROJECT_ID = 'project-uuid-abc'
})

afterEach(() => {
  delete process.env.QUOTH_API_KEY
  delete process.env.QUOTH_API_URL
  delete process.env.QUOTH_PROJECT_ID
  vi.restoreAllMocks()
})

describe('promotePattern', () => {
  it('returns null when QUOTH_API_KEY is not set', async () => {
    delete process.env.QUOTH_API_KEY
    const result = await promotePattern(fakePattern)
    expect(result).toBeNull()
  })

  it('POSTs to /api/v1/patterns/promote with correct headers', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ documentId: 'doc-1', version: 1, status: 'created' })
    })
    await promotePattern(fakePattern)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://test.quoth.dev/api/v1/patterns/promote',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer qth_testkey123',
          'Content-Type': 'application/json'
        })
      })
    )
  })

  it('sends correct body shape', async () => {
    let capturedBody
    vi.spyOn(global, 'fetch').mockImplementation(async (_, opts) => {
      capturedBody = JSON.parse(opts.body)
      return { ok: true, json: async () => ({ documentId: 'doc-1', version: 1, status: 'created' }) }
    })
    await promotePattern(fakePattern)
    expect(capturedBody.patternId).toBe('abc123')
    expect(capturedBody.confidence).toBeCloseTo(0.87)
    expect(capturedBody.successCount).toBe(12)
    expect(capturedBody.failureCount).toBe(2)
    expect(capturedBody.applicability).toBe('narrow')
    expect(capturedBody.tags).toEqual(['selector', 'playwright'])
  })

  it('returns null on non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 401 })
    const result = await promotePattern(fakePattern)
    expect(result).toBeNull()
  })

  it('returns null on network error without throwing', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await promotePattern(fakePattern)
    expect(result).toBeNull()
  })

  it('returns documentId and version on success', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ documentId: 'doc-uuid-1', version: 2, status: 'updated' })
    })
    const result = await promotePattern(fakePattern)
    expect(result.documentId).toBe('doc-uuid-1')
    expect(result.version).toBe(2)
    expect(result.status).toBe('updated')
  })

  it('uses default QUOTH_API_URL when env var not set', async () => {
    delete process.env.QUOTH_API_URL
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ documentId: 'x', version: 1, status: 'created' })
    })
    await promotePattern(fakePattern)
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toContain('quoth.triqual.dev')
  })
})
