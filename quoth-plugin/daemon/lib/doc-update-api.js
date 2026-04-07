'use strict'

const https = require('https')

const TIMEOUT_MS = 120000
const MAX_SOURCE_FILES = 10
const MAX_CONTENT_LENGTH = 10000

/**
 * Send a doc + source files to cloud for update.
 * @param {Object} doc - { filename, content, version }
 * @param {Object[]} sourceFiles - [{ path, content }] (max 10, content truncated to 10K)
 * @param {string} project - project name
 * @returns {Promise<Object|null>} { updated_content, new_version, changes_summary } or null
 */
async function callDocUpdateAPI(doc, sourceFiles, project) {
  const apiKey = process.env.QUOTH_API_KEY
  if (!apiKey) {
    process.stderr.write('[quoth-doc-update] QUOTH_API_KEY not set, skipping cloud doc update\n')
    return null
  }

  const apiUrl = process.env.QUOTH_API_URL || 'https://quoth.triqual.dev'

  const trimmedSources = (sourceFiles || []).slice(0, MAX_SOURCE_FILES).map(s => ({
    path: s.path,
    content: (s.content || '').slice(0, MAX_CONTENT_LENGTH)
  }))

  const body = {
    doc: {
      filename: doc.filename,
      content: doc.content,
      version: doc.version
    },
    source_files: trimmedSources,
    project: project || 'unknown'
  }

  try {
    const res = await apiCall(`${apiUrl}/api/v1/docs/update`, 'POST', body, apiKey)
    return res
  } catch (err) {
    process.stderr.write(`[quoth-doc-update] Error: ${err.message || err}\n`)
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
      process.stderr.write(`[quoth-doc-update] Request error: ${err.message}\n`)
      resolve(null)
    })
    req.on('timeout', () => {
      process.stderr.write('[quoth-doc-update] Request timed out\n')
      req.destroy()
      resolve(null)
    })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

module.exports = { callDocUpdateAPI }
