import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import https from 'https'
import { Readable } from 'stream'
import { createRequire } from 'module'

const requireCjs = createRequire(import.meta.url)

function fakeRes(body) {
  const stream = Readable.from([JSON.stringify(body)])
  stream.statusCode = 200
  stream.headers = {}
  return stream
}

function stubHttps(response) {
  const orig = https.request
  https.request = (_opts, cb) => {
    setImmediate(() => cb(fakeRes(response)))
    return { on: () => {}, write: () => {}, end: () => {}, destroy: () => {} }
  }
  return () => { https.request = orig }
}

describe('pipeline-api — tolerate facts[] in response', () => {
  beforeEach(() => { process.env.QUOTH_API_KEY = 'qth_test' })
  afterEach(() => { delete process.env.QUOTH_API_KEY })

  it('returns facts alongside patterns when server includes them', async () => {
    const restore = stubHttps({
      patterns: [{ id: 'p1', pattern: 'x', action: 'new', targetId: null }],
      facts: [{ topic: 'build', statement: 'pnpm test', scope: 'project', tags: [] }],
      tokens_used: 1234,
    })
    try {
      const { callPipelineAPI } = requireCjs('../daemon/lib/pipeline-api.js')
      const result = await callPipelineAPI([{ summary: {}, tool_entries: [] }], [])
      expect(result).not.toBeNull()
      expect(Array.isArray(result.patterns)).toBe(true)
      expect(Array.isArray(result.facts)).toBe(true)
      expect(result.facts[0].topic).toBe('build')
      expect(result.patterns).toHaveLength(1)
    } finally { restore() }
  })

  it('defaults facts to [] when server omits them (back-compat)', async () => {
    const restore = stubHttps({ patterns: [], tokens_used: 0 })
    try {
      const { callPipelineAPI } = requireCjs('../daemon/lib/pipeline-api.js')
      const result = await callPipelineAPI([], [])
      expect(result).not.toBeNull()
      expect(Array.isArray(result.facts)).toBe(true)
      expect(result.facts).toHaveLength(0)
    } finally { restore() }
  })
})
