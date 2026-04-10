'use strict'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import https from 'https'
import fs from 'fs'
import { EventEmitter } from 'events'

let requestSpy

beforeEach(() => {
  process.env.MOONSHOT_API_KEY = 'test-key'
  requestSpy = vi.spyOn(https, 'request')
})

afterEach(() => {
  delete process.env.MOONSHOT_API_KEY
  vi.restoreAllMocks()
})

const { callMoonshotWithTools } = require('../daemon/lib/llm.js')

function mockResponse(body) {
  const res = new EventEmitter()
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

describe('callMoonshotWithTools', () => {
  it('sends messages with tools and returns content response', async () => {
    mockResponse({
      choices: [{ message: { role: 'assistant', content: 'Hello world' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })

    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Say hello' },
    ]
    const tools = [{ type: 'function', function: { name: 'greet', parameters: {} } }]

    const result = await callMoonshotWithTools(messages, { tools })

    expect(result.content).toBe('Hello world')
    expect(result.tool_calls).toBeNull()
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 })
    expect(result.message).toBeDefined()
    expect(result.message.role).toBe('assistant')
  })

  it('returns tool_calls when model requests tools', async () => {
    const toolCalls = [
      { id: 'call_1', type: 'function', function: { name: 'greet', arguments: '{"name":"world"}' } },
    ]
    mockResponse({
      choices: [{ message: { role: 'assistant', content: null, tool_calls: toolCalls } }],
      usage: { prompt_tokens: 15, completion_tokens: 8 },
    })

    const result = await callMoonshotWithTools(
      [{ role: 'user', content: 'Greet the world' }],
      { tools: [{ type: 'function', function: { name: 'greet', parameters: {} } }] },
    )

    expect(result.tool_calls).toEqual(toolCalls)
    expect(result.content).toBeNull()
    expect(result.usage).toEqual({ prompt_tokens: 15, completion_tokens: 8 })
  })

  it('preserves reasoning_content from K2.5 thinking', async () => {
    mockResponse({
      choices: [{
        message: {
          role: 'assistant',
          content: 'The answer is 42',
          reasoning_content: 'Let me think step by step...',
        },
      }],
      usage: { prompt_tokens: 20, completion_tokens: 12 },
    })

    const result = await callMoonshotWithTools(
      [{ role: 'user', content: 'What is the meaning of life?' }],
    )

    expect(result.reasoning_content).toBe('Let me think step by step...')
    expect(result.content).toBe('The answer is 42')
  })

  it('throws without MOONSHOT_API_KEY', async () => {
    delete process.env.MOONSHOT_API_KEY
    // Also mock fs.readFileSync to prevent fallback to credentials file
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('no file') })

    await expect(
      callMoonshotWithTools([{ role: 'user', content: 'hi' }]),
    ).rejects.toThrow('No MOONSHOT_API_KEY')
  })

  it('does NOT include thinking: { type: "disabled" } in request body', async () => {
    const req = mockResponse({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })

    await callMoonshotWithTools([{ role: 'user', content: 'test' }])

    const writtenBody = req.write.mock.calls[0][0]
    const parsed = JSON.parse(writtenBody)
    expect(parsed.thinking).toBeUndefined()
    expect(parsed.model).toBe('kimi-k2.5')
    expect(parsed.temperature).toBe(0.6)
  })

  it('does not include tools/tool_choice when tools array is empty', async () => {
    const req = mockResponse({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })

    await callMoonshotWithTools([{ role: 'user', content: 'test' }], { tools: [] })

    const parsed = JSON.parse(req.write.mock.calls[0][0])
    expect(parsed.tools).toBeUndefined()
    expect(parsed.tool_choice).toBeUndefined()
  })

  it('includes prompt_cache_key and response_format when provided', async () => {
    const req = mockResponse({
      choices: [{ message: { role: 'assistant', content: '{}' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })

    await callMoonshotWithTools(
      [{ role: 'user', content: 'test' }],
      {
        tools: [{ type: 'function', function: { name: 'foo', parameters: {} } }],
        promptCacheKey: 'my-cache',
        responseFormat: { type: 'json_object' },
      },
    )

    const parsed = JSON.parse(req.write.mock.calls[0][0])
    expect(parsed.prompt_cache_key).toBe('my-cache')
    expect(parsed.response_format).toEqual({ type: 'json_object' })
    expect(parsed.tools).toHaveLength(1)
    expect(parsed.tool_choice).toBe('auto')
  })

  it('uses 120s timeout', async () => {
    mockResponse({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })

    await callMoonshotWithTools([{ role: 'user', content: 'test' }])

    const reqOpts = requestSpy.mock.calls[0][0]
    expect(reqOpts.timeout).toBe(120000)
    expect(reqOpts.hostname).toBe('api.moonshot.ai')
  })
})
