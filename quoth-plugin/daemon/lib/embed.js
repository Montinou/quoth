'use strict'

/**
 * Daemon embedding — voyage/voyage-4-lite via Vercel AI Gateway
 * URL: https://ai-gateway.vercel.sh/v1/embeddings
 * Cost: $0.02/MTok (6.5x cheaper than text-embedding-3-large)
 * Auth: AI_GATEWAY_API_KEY (vck_* key)
 */

const https = require('https')

const MODEL = 'voyage/voyage-4-lite'
const GATEWAY_HOST = 'ai-gateway.vercel.sh'
const GATEWAY_PATH = '/v1/embeddings'

async function generateEmbedding(text) {
  const apiKey = process.env.AI_GATEWAY_API_KEY
  if (!apiKey) return null

  const clean = (text || '').replace(/\n+/g, ' ').trim()
  if (!clean) return null

  try {
    const body = JSON.stringify({ model: MODEL, input: clean })

    const data = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: GATEWAY_HOST,
        path: GATEWAY_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 10000
      }, (res) => {
        let chunks = ''
        res.on('data', c => { chunks += c })
        res.on('end', () => {
          try { resolve(JSON.parse(chunks)) } catch { reject(new Error('Invalid JSON')) }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
      req.write(body)
      req.end()
    })

    return data.data?.[0]?.embedding || null
  } catch {
    return null
  }
}

module.exports = { generateEmbedding, MODEL }
