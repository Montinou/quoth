'use strict'

/**
 * Daemon LLM calls via Vercel AI Gateway (OpenAI-compatible).
 * URL: https://ai-gateway.vercel.sh/v1/chat/completions
 * Auth: AI_GATEWAY_API_KEY (vck_* key, same gateway used by embed.js)
 *
 * Default model: google/gemini-2.5-flash-lite (fast, cheap, supports JSON mode).
 * Override via QUOTH_LLM_MODEL env var (e.g. 'deepseek/deepseek-v3.2').
 *
 * Legacy: prior version used Kimi K2.5 directly via Moonshot. That path is
 * kept as a fallback if MOONSHOT_API_KEY is set but AI_GATEWAY_API_KEY is not.
 */

const https = require('https')
const fs = require('fs')
const path = require('path')
const os = require('os')

const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite'
const GATEWAY_HOST = 'ai-gateway.vercel.sh'
const GATEWAY_PATH = '/v1/chat/completions'

// Legacy Moonshot direct call (only used as last resort)
const MOONSHOT_HOST = 'api.moonshot.ai'
const MOONSHOT_PATH = '/v1/chat/completions'

function getModel() { return process.env.QUOTH_LLM_MODEL || DEFAULT_MODEL }

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

async function callMoonshot(prompt, maxTokens) {
  const apiKey = getMoonshotKey()
  if (!apiKey) throw new Error('No MOONSHOT_API_KEY')
  const body = JSON.stringify({
    model: 'kimi-k2.5',
    messages: [{ role: 'user', content: prompt }],
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
      timeout: 30000,
    }, (res) => {
      let chunks = ''
      res.on('data', c => { chunks += c })
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks)
          if (data.error) { reject(new Error(data.error.message)); return }
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

/**
 * Call the configured LLM. Prefers AI Gateway (Gemini Flash Lite default),
 * falls back to Moonshot Kimi if only MOONSHOT_API_KEY is set.
 */
async function callLLM(prompt, maxTokens = 200) {
  if (getGatewayKey()) return callGateway(prompt, maxTokens)
  if (getMoonshotKey()) return callMoonshot(prompt, maxTokens)
  throw new Error('No LLM credentials (AI_GATEWAY_API_KEY or MOONSHOT_API_KEY)')
}

module.exports = { callLLM, callGateway, callMoonshot, getModel, DEFAULT_MODEL }
