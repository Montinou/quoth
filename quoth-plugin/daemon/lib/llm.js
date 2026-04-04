'use strict'

/**
 * Daemon LLM calls — Kimi K2.5 via Moonshot API (OpenAI-compatible)
 * URL: https://api.moonshot.ai/v1/chat/completions
 * Auth: MOONSHOT_API_KEY (sk-* key from ~/.openclaw/credentials/moonshot-api-key)
 * Cost: $0.50/MTok input, $2.80/MTok output
 */

const https = require('https')
const fs = require('fs')
const path = require('path')
const os = require('os')

const MODEL = 'kimi-k2.5'
const API_HOST = 'api.moonshot.ai'
const API_PATH = '/v1/chat/completions'

function getApiKey() {
  if (process.env.MOONSHOT_API_KEY) return process.env.MOONSHOT_API_KEY
  // Fallback: read from OpenClaw credentials
  try {
    const keyFile = path.join(os.homedir(), '.openclaw', 'credentials', 'moonshot-api-key')
    return fs.readFileSync(keyFile, 'utf8').trim()
  } catch { return null }
}

/**
 * Call Kimi K2.5 with a prompt. Returns the text response.
 * @param {string} prompt - The prompt to send
 * @param {number} maxTokens - Max response tokens (default 200)
 * @returns {Promise<string>} The model's text response
 */
async function callLLM(prompt, maxTokens = 200) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('No MOONSHOT_API_KEY')

  const body = JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.6,
    thinking: { type: 'disabled' }
  })

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_HOST,
      path: API_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    }, (res) => {
      let chunks = ''
      res.on('data', c => { chunks += c })
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks)
          if (data.error) { reject(new Error(data.error.message)); return }
          let content = data.choices?.[0]?.message?.content || ''
          // Strip markdown code blocks if present
          content = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim()
          resolve(content)
        } catch { reject(new Error('Invalid JSON response')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body)
    req.end()
  })
}

module.exports = { callLLM, MODEL }
