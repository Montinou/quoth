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

const { callDocUpdateAPI } = require('../daemon/lib/doc-update-api.js')

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

describe('callDocUpdateAPI', () => {
  const doc = { filename: '01-overview.md', content: '# Overview', version: '1.0.0' }
  const sourceFiles = [{ path: 'src/main.js', content: 'const x = 1' }]

  it('returns null when QUOTH_API_KEY is not set', async () => {
    const result = await callDocUpdateAPI(doc, sourceFiles, 'test-project')
    expect(result).toBeNull()
    expect(requestSpy).not.toHaveBeenCalled()
  })

  it('sends request with correct auth headers', async () => {
    process.env.QUOTH_API_KEY = 'qth_test123'
    process.env.QUOTH_API_URL = 'https://test.example.com'

    const response = { updated_content: '# Updated', new_version: '1.0.1', changes_summary: 'minor' }
    mockResponse(200, response)

    const result = await callDocUpdateAPI(doc, sourceFiles, 'test-project')
    expect(result).toEqual(response)

    const callOpts = requestSpy.mock.calls[0][0]
    expect(callOpts.hostname).toBe('test.example.com')
    expect(callOpts.path).toBe('/api/v1/docs/update')
    expect(callOpts.headers.Authorization).toBe('Bearer qth_test123')
    expect(callOpts.method).toBe('POST')
  })

  it('defaults to quoth.triqual.dev when QUOTH_API_URL not set', async () => {
    process.env.QUOTH_API_KEY = 'qth_test'
    mockResponse(200, { updated_content: '# OK', new_version: '1.0.1' })

    await callDocUpdateAPI(doc, sourceFiles, 'test-project')
    const callOpts = requestSpy.mock.calls[0][0]
    expect(callOpts.hostname).toBe('quoth.triqual.dev')
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

    const result = await callDocUpdateAPI(doc, sourceFiles, 'test-project')
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

    const result = await callDocUpdateAPI(doc, sourceFiles, 'test-project')
    expect(result).toBeNull()
  })

  it('trims source files to max 10', async () => {
    process.env.QUOTH_API_KEY = 'qth_test'
    const manySources = Array(15).fill({ path: 'a.js', content: 'x' })
    mockResponse(200, { updated_content: '#', new_version: '1.0.1' })

    await callDocUpdateAPI(doc, manySources, 'test-project')
    const writtenBody = JSON.parse(requestSpy.mock.results[0]?.value?.write?.mock?.calls?.[0]?.[0] || '{}')
    expect((writtenBody.source_files || []).length).toBeLessThanOrEqual(10)
  })

  it('truncates source file content to 10K chars', async () => {
    process.env.QUOTH_API_KEY = 'qth_test'
    const longContent = 'x'.repeat(20000)
    mockResponse(200, { updated_content: '#', new_version: '1.0.1' })

    await callDocUpdateAPI(doc, [{ path: 'big.js', content: longContent }], 'test-project')
    const writtenBody = JSON.parse(requestSpy.mock.results[0]?.value?.write?.mock?.calls?.[0]?.[0] || '{}')
    const sentContent = writtenBody?.source_files?.[0]?.content || ''
    expect(sentContent.length).toBeLessThanOrEqual(10000)
  })
})
