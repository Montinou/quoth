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

const { pullProjectPatterns, pullSharedPatterns } = require('../daemon/lib/pull.js')

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

describe('pullProjectPatterns', () => {
  it('returns empty patterns when no API key', async () => {
    const result = await pullProjectPatterns('my-project', 0, null)
    expect(result.patterns).toEqual([])
    expect(result.skipped).toBe('no API key')
    expect(requestSpy).not.toHaveBeenCalled()
  })

  it('returns patterns from cloud', async () => {
    const patterns = [{ id: 'p1', name: 'test', confidence: 0.9 }]
    mockResponse(200, { patterns })

    const result = await pullProjectPatterns('my-project', 0, 'qth_test')
    expect(result.patterns).toEqual(patterns)
    expect(result.status).toBe(200)

    const callOpts = requestSpy.mock.calls[0][0]
    expect(callOpts.headers.Authorization).toBe('Bearer qth_test')
    expect(callOpts.path).toContain('projectSlug=my-project')
  })

  it('handles network errors gracefully', async () => {
    const req = new EventEmitter()
    req.write = vi.fn()
    req.end = vi.fn()
    req.destroy = vi.fn()
    requestSpy.mockImplementation(() => {
      process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')))
      return req
    })

    const result = await pullProjectPatterns('my-project', 0, 'qth_test')
    expect(result.patterns).toEqual([])
    expect(result.error).toBe('ECONNREFUSED')
  })

  it('handles timeout gracefully', async () => {
    const req = new EventEmitter()
    req.write = vi.fn()
    req.end = vi.fn()
    req.destroy = vi.fn()
    requestSpy.mockImplementation(() => {
      process.nextTick(() => req.emit('timeout'))
      return req
    })

    const result = await pullProjectPatterns('my-project', 0, 'qth_test')
    expect(result.patterns).toEqual([])
    expect(result.error).toBe('timeout')
  })

  it('uses custom API URL when provided', async () => {
    mockResponse(200, { patterns: [] })

    await pullProjectPatterns('slug', 0, 'qth_test', 'https://custom.example.com')
    const callOpts = requestSpy.mock.calls[0][0]
    expect(callOpts.hostname).toBe('custom.example.com')
  })

  it('handles JSON parse errors', async () => {
    const res = new EventEmitter()
    res.statusCode = 200
    const req = new EventEmitter()
    req.write = vi.fn()
    req.end = vi.fn()
    req.destroy = vi.fn()
    requestSpy.mockImplementation((_opts, cb) => {
      process.nextTick(() => {
        cb(res)
        process.nextTick(() => {
          res.emit('data', 'not json')
          res.emit('end')
        })
      })
      return req
    })

    const result = await pullProjectPatterns('slug', 0, 'qth_test')
    expect(result.patterns).toEqual([])
    expect(result.error).toBe('parse error')
  })
})

describe('pullSharedPatterns', () => {
  function mockDb() {
    return {
      prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) }),
      findDuplicateByName: vi.fn().mockReturnValue(null),
      upsertPattern: vi.fn(),
    }
  }
  const log = vi.fn()

  afterEach(() => {
    log.mockClear()
  })

  it('returns 0 when no API key', async () => {
    const db = mockDb()
    const result = await pullSharedPatterns(db, log)
    expect(result).toBe(0)
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Shared pull skipped'))
    expect(requestSpy).not.toHaveBeenCalled()
  })

  it('inserts shared patterns with capped confidence', async () => {
    process.env.QUOTH_API_KEY = 'qth_test'
    const db = mockDb()
    const patterns = [{ id: 'sp1', name: 'shared rule', confidence: 0.95, condition: 'when X', action: 'do Y' }]
    mockResponse(200, { patterns })

    const result = await pullSharedPatterns(db, log)
    expect(result).toBe(1)
    expect(db.upsertPattern).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sp1',
      confidence: 0.6, // capped from 0.95
      source: 'shared-pull',
      tags: expect.arrayContaining(['shared']),
    }))
  })

  it('skips patterns that already exist by ID', async () => {
    process.env.QUOTH_API_KEY = 'qth_test'
    const db = mockDb()
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ id: 'sp1' }) })
    const patterns = [{ id: 'sp1', name: 'exists', confidence: 0.9 }]
    mockResponse(200, { patterns })

    const result = await pullSharedPatterns(db, log)
    expect(result).toBe(0)
    expect(db.upsertPattern).not.toHaveBeenCalled()
  })

  it('skips near-duplicate names', async () => {
    process.env.QUOTH_API_KEY = 'qth_test'
    const db = mockDb()
    db.findDuplicateByName.mockReturnValue({ id: 'existing', name: 'similar name' })
    const patterns = [{ id: 'sp2', name: 'similar name', confidence: 0.9 }]
    mockResponse(200, { patterns })

    const result = await pullSharedPatterns(db, log)
    expect(result).toBe(0)
    expect(db.upsertPattern).not.toHaveBeenCalled()
  })

  it('handles network errors gracefully', async () => {
    process.env.QUOTH_API_KEY = 'qth_test'
    const db = mockDb()
    const req = new EventEmitter()
    req.write = vi.fn()
    req.end = vi.fn()
    req.destroy = vi.fn()
    requestSpy.mockImplementation(() => {
      process.nextTick(() => req.emit('error', new Error('ENOTFOUND')))
      return req
    })

    const result = await pullSharedPatterns(db, log)
    expect(result).toBe(0)
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('Shared pattern pull failed'), expect.any(Object))
  })

  it('handles timeout gracefully', async () => {
    process.env.QUOTH_API_KEY = 'qth_test'
    const db = mockDb()
    const req = new EventEmitter()
    req.write = vi.fn()
    req.end = vi.fn()
    req.destroy = vi.fn()
    requestSpy.mockImplementation(() => {
      process.nextTick(() => req.emit('timeout'))
      return req
    })

    const result = await pullSharedPatterns(db, log)
    expect(result).toBe(0)
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('Shared pattern pull failed'), expect.any(Object))
  })
})
