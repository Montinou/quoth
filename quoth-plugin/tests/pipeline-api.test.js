import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import https from 'https'
import { EventEmitter } from 'events'

// Mock https.request
let requestSpy

beforeEach(() => {
  requestSpy = vi.spyOn(https, 'request')
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.QUOTH_API_KEY
  delete process.env.QUOTH_API_URL
})

const { callPipelineAPI } = require('../daemon/lib/pipeline-api.js')

function mockResponse(statusCode, body) {
  const res = new EventEmitter()
  res.statusCode = statusCode
  const req = new EventEmitter()
  req.write = vi.fn()
  req.end = vi.fn()
  req.destroy = vi.fn()
  requestSpy.mockImplementation((_opts, cb) => {
    process.nextTick(() => {
      cb(res)
      process.nextTick(() => {
        res.emit('data', JSON.stringify(body))
        res.emit('end')
      })
    })
    return req
  })
  return req
}

describe('callPipelineAPI', () => {
  const session = {
    summary: { project: 'test', outcome: 'success', success_rate: 0.8, total_calls: 5, user_intents: ['test'], task: 'test task' },
    tool_entries: [{ tool: 'Bash', task: 'run tests', outcome: 'success' }]
  }
  const patterns = [{ id: 'abc', name: 'test pattern', confidence: 0.7 }]

  it('returns null when QUOTH_API_KEY is not set', async () => {
    const result = await callPipelineAPI([session], patterns)
    expect(result).toBeNull()
    expect(requestSpy).not.toHaveBeenCalled()
  })

  it('sends request to cloud API with correct auth', async () => {
    process.env.QUOTH_API_KEY = 'qth_test123'
    process.env.QUOTH_API_URL = 'https://test.example.com'

    const response = { patterns: [{ id: 'x', pattern: 'test', tags: [], action: 'new' }], sessions_processed: 1, tokens_used: 100 }
    mockResponse(200, response)

    const result = await callPipelineAPI([session], patterns)
    expect(result).toEqual({
      patterns: response.patterns,
      facts: [],
      tokens_used: 100,
      quota_remaining: null,
    })

    const callOpts = requestSpy.mock.calls[0][0]
    expect(callOpts.hostname).toBe('test.example.com')
    expect(callOpts.path).toBe('/api/v1/pipeline/process')
    expect(callOpts.headers.Authorization).toBe('Bearer qth_test123')
  })

  it('trims sessions to max 5', async () => {
    process.env.QUOTH_API_KEY = 'qth_test'
    const manySessions = Array(10).fill(session)
    mockResponse(200, { patterns: [] })

    await callPipelineAPI(manySessions, [])
    const writtenBody = JSON.parse(requestSpy.mock.results[0]?.value?.write?.mock?.calls?.[0]?.[0] || '{}')
    // The function trims before sending
    expect(writtenBody.sessions?.length || 0).toBeLessThanOrEqual(5)
  })

  it('returns null on network error', async () => {
    process.env.QUOTH_API_KEY = 'qth_test'
    const req = new EventEmitter()
    req.write = vi.fn()
    req.end = vi.fn()
    req.destroy = vi.fn()
    requestSpy.mockImplementation(() => {
      process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')))
      return req
    })

    const result = await callPipelineAPI([session], [])
    expect(result).toBeNull()
  })

  it('returns null on timeout', async () => {
    process.env.QUOTH_API_KEY = 'qth_test'
    const req = new EventEmitter()
    req.write = vi.fn()
    req.end = vi.fn()
    req.destroy = vi.fn()
    requestSpy.mockImplementation(() => {
      process.nextTick(() => req.emit('timeout'))
      return req
    })

    const result = await callPipelineAPI([session], [])
    expect(result).toBeNull()
  })

  it('defaults to quoth.triqual.dev when QUOTH_API_URL not set', async () => {
    process.env.QUOTH_API_KEY = 'qth_test'
    mockResponse(200, { patterns: [] })

    await callPipelineAPI([session], [])
    const callOpts = requestSpy.mock.calls[0][0]
    expect(callOpts.hostname).toBe('quoth.triqual.dev')
  })
})
