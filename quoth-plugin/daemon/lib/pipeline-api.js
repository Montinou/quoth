'use strict'

const https = require('https')

const MAX_SESSIONS = 5
const MAX_TOOL_ENTRIES = 30
const TIMEOUT_MS = 60000

/**
 * Send a batch of sessions to the cloud pipeline for processing.
 * Used in managed mode (QUOTH_MODE=managed) when user has no local LLM keys.
 *
 * @param {Object[]} sessions - Array of { summary, tool_entries }
 * @param {Object[]} existingPatterns - Top local patterns for consolidation [{ id, name, confidence }]
 * @returns {Promise<Object|null>} Pipeline response or null on failure
 */
async function callPipelineAPI(sessions, existingPatterns) {
  const apiKey = process.env.QUOTH_API_KEY
  if (!apiKey) {
    process.stderr.write('[quoth-pipeline] QUOTH_API_KEY not set, skipping cloud pipeline\n')
    return null
  }

  const apiUrl = process.env.QUOTH_API_URL || 'https://quoth.triqual.dev'

  const trimmedSessions = (sessions || []).slice(0, MAX_SESSIONS).map(s => ({
    summary: s.summary,
    tool_entries: (s.tool_entries || []).slice(0, MAX_TOOL_ENTRIES)
  }))

  const body = {
    sessions: trimmedSessions,
    existing_patterns: existingPatterns || []
  }

  try {
    const res = await apiCall(`${apiUrl}/api/v1/pipeline/process`, 'POST', body, apiKey)
    if (res === null) return null
    return {
      patterns: Array.isArray(res.patterns) ? res.patterns : [],
      facts: Array.isArray(res.facts) ? res.facts : [],
      tokens_used: res.tokens_used || 0,
      quota_remaining: res.quota_remaining || null,
    }
  } catch (err) {
    process.stderr.write(`[quoth-pipeline] Error: ${err.message || err}\n`)
    return null
  }
}

function apiCall(url, method, body, apiKey) {
  return new Promise((resolve) => {
    const parsed = new URL(url)
    const bodyStr = body ? JSON.stringify(body) : null
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      },
      timeout: TIMEOUT_MS
    }, (res) => {
      let chunks = ''
      res.on('data', c => { chunks += c })
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)) } catch { resolve(null) }
      })
    })
    req.on('error', (err) => {
      process.stderr.write(`[quoth-pipeline] Request error: ${err.message}\n`)
      resolve(null)
    })
    req.on('timeout', () => {
      process.stderr.write('[quoth-pipeline] Request timed out\n')
      req.destroy()
      resolve(null)
    })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

module.exports = { callPipelineAPI }
