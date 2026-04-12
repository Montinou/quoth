'use strict'

/**
 * Daemon LLM calls via Vercel AI Gateway (OpenAI-compatible).
 * URL: https://ai-gateway.vercel.sh/v1/chat/completions
 * Auth: AI_GATEWAY_API_KEY (vck_* key, same gateway used by embed.js)
 *
 * Default model: google/gemini-2.5-flash-lite (fast, cheap, supports JSON mode).
 *
 * Also exposes `callMoonshot` / `callMoonshotWithTools` for Kimi K2.5 — used
 * by the extract stage where tool-calling is required. The bare `callLLM`
 * helper falls back to Moonshot if only `MOONSHOT_API_KEY` is set.
 */

const https = require('https')
const fs = require('fs')
const path = require('path')
const os = require('os')

const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite'

// Per-million-token pricing (USD)
const MODEL_PRICING = {
  'google/gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
  'google/gemini-2.5-flash': { input: 0.30, output: 2.50 },
}

function estimateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING[DEFAULT_MODEL]
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output
}
const GATEWAY_HOST = 'ai-gateway.vercel.sh'
const GATEWAY_PATH = '/v1/chat/completions'

// Legacy Moonshot direct call (only used as last resort)
const MOONSHOT_HOST = 'api.moonshot.ai'
const MOONSHOT_PATH = '/v1/chat/completions'

function getModel() { return DEFAULT_MODEL }

function getGatewayKey() { return process.env.AI_GATEWAY_API_KEY || null }

function getMoonshotKey() {
  if (process.env.MOONSHOT_API_KEY) return process.env.MOONSHOT_API_KEY
  try {
    return fs.readFileSync(path.join(os.homedir(), '.openclaw', 'credentials', 'moonshot-api-key'), 'utf8').trim()
  } catch { return null }
}

async function callGateway(prompt, maxTokens, model) {
  const apiKey = getGatewayKey()
  if (!apiKey) throw new Error('No AI_GATEWAY_API_KEY')
  const body = JSON.stringify({
    model: model || getModel(),
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.3,
  })
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: GATEWAY_HOST, path: GATEWAY_PATH, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      let chunks = ''
      res.on('data', c => { chunks += c })
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks)
          if (data.error) { reject(new Error(data.error.message || JSON.stringify(data.error))); return }
          let content = data.choices?.[0]?.message?.content || ''
          content = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim()
          resolve(content)
        } catch { reject(new Error('Invalid JSON response')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body); req.end()
  })
}

async function callMoonshot(prompt, maxTokens, { jsonPrefill = false, timeout = 180000 } = {}) {
  const apiKey = getMoonshotKey()
  if (!apiKey) throw new Error('No MOONSHOT_API_KEY')
  const messages = [{ role: 'user', content: prompt }]
  // Partial prefill: force JSON output by starting the assistant response with "{"
  if (jsonPrefill) {
    messages.push({ role: 'assistant', content: '{', partial: true })
  }
  const body = JSON.stringify({
    model: 'kimi-k2.5',
    messages,
    max_tokens: maxTokens,
    temperature: 0.6,
    thinking: { type: 'disabled' },
  })
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: MOONSHOT_HOST, path: MOONSHOT_PATH, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout,
    }, (res) => {
      let chunks = ''
      res.on('data', c => { chunks += c })
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks)
          if (data.error) { reject(new Error(data.error.message)); return }
          let content = data.choices?.[0]?.message?.content || ''
          // Prepend "{" when using partial prefill (model continues from there)
          if (jsonPrefill) content = '{' + content
          content = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim()
          resolve(content)
        } catch { reject(new Error('Invalid JSON response')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body); req.end()
  })
}

/**
 * Like callGateway but returns structured usage info + cost estimate.
 */
async function callLLMWithUsage(prompt, maxTokens, model) {
  const apiKey = getGatewayKey()
  if (!apiKey) throw new Error('No AI_GATEWAY_API_KEY')
  const resolvedModel = model || getModel()
  const body = JSON.stringify({
    model: resolvedModel,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.3,
  })
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: GATEWAY_HOST, path: GATEWAY_PATH, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      let chunks = ''
      res.on('data', c => { chunks += c })
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks)
          if (data.error) { reject(new Error(data.error.message || JSON.stringify(data.error))); return }
          let content = data.choices?.[0]?.message?.content || ''
          content = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim()
          const usage = data.usage || {}
          const input_tokens = usage.prompt_tokens || 0
          const output_tokens = usage.completion_tokens || 0
          resolve({
            content,
            model: data.model || resolvedModel,
            input_tokens,
            output_tokens,
            estimated_cost_usd: estimateCost(resolvedModel, input_tokens, output_tokens),
          })
        } catch { reject(new Error('Invalid JSON response')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body); req.end()
  })
}

/**
 * Call Moonshot Kimi K2.5 with tool calling support.
 * Used by extract pipeline for multi-turn tool conversations.
 * Thinking mode is left as default (enabled) — do NOT disable it.
 */
async function callMoonshotWithTools(messages, {
  tools = [],
  tool_choice = 'auto',
  maxTokens = 32768,
  promptCacheKey = null,
  responseFormat = null,
} = {}) {
  const apiKey = getMoonshotKey()
  if (!apiKey) throw new Error('No MOONSHOT_API_KEY')

  const body = {
    model: 'kimi-k2.5',
    messages,
    max_tokens: maxTokens,
    temperature: 0.6,
  }

  if (tools.length > 0) {
    body.tools = tools
    body.tool_choice = tool_choice
  }
  if (promptCacheKey) body.prompt_cache_key = promptCacheKey
  if (responseFormat) body.response_format = responseFormat

  const bodyStr = JSON.stringify(body)

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: MOONSHOT_HOST, path: MOONSHOT_PATH, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
      timeout: 120000,
    }, (res) => {
      let chunks = ''
      res.on('data', c => { chunks += c })
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks)
          if (data.error) { reject(new Error(data.error.message || JSON.stringify(data.error))); return }
          const msg = data.choices?.[0]?.message || {}
          const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0
          const usage = data.usage || {}
          resolve({
            message: msg,
            tool_calls: hasToolCalls ? msg.tool_calls : null,
            content: hasToolCalls ? null : (msg.content || null),
            reasoning_content: msg.reasoning_content || null,
            usage: {
              prompt_tokens: usage.prompt_tokens || 0,
              completion_tokens: usage.completion_tokens || 0,
            },
          })
        } catch { reject(new Error('Invalid JSON response')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(bodyStr); req.end()
  })
}

/**
 * Call the configured LLM. Prefers AI Gateway (Gemini Flash Lite default),
 * falls back to Moonshot Kimi if only MOONSHOT_API_KEY is set.
 */
async function callLLM(prompt, maxTokens = 200) {
  if (getGatewayKey()) return callGateway(prompt, maxTokens)
  if (getMoonshotKey()) return callMoonshot(prompt, maxTokens)
  throw new Error('No LLM credentials (AI_GATEWAY_API_KEY or MOONSHOT_API_KEY)')
}

module.exports = { callLLM, callGateway, callMoonshot, callMoonshotWithTools, callLLMWithUsage, getModel, estimateCost, MODEL_PRICING, DEFAULT_MODEL }
