'use strict'

const https = require('https')

function buildContent(pattern) {
  const tags = Array.isArray(pattern.tags) ? pattern.tags : JSON.parse(pattern.tags || '[]')
  const date = new Date().toISOString().split('T')[0]
  return `# ${pattern.name}

**Condition:** ${pattern.condition}

**Action:** ${pattern.action}

**Confidence:** ${pattern.confidence.toFixed(2)} (${pattern.success_count} successes, ${pattern.failure_count} failures)

**Tags:** ${tags.length > 0 ? tags.join(', ') : 'none'}

**Source:** Distilled from local learning daemon — promoted ${date}
`
}

// Cache of known project slugs to avoid repeated lookups
const knownProjects = new Set()

/**
 * Ensure a project exists in Quoth cloud. Creates it if missing.
 */
async function ensureProject(slug, apiKey, apiUrl) {
  if (knownProjects.has(slug)) return true

  try {
    // Check if project exists
    const listRes = await apiCall(`${apiUrl}/api/v1/projects?limit=100`, 'GET', null, apiKey)
    if (listRes && listRes.data) {
      for (const p of listRes.data) {
        knownProjects.add(p.slug)
      }
    }
    if (knownProjects.has(slug)) return true

    // Create it
    const createRes = await apiCall(`${apiUrl}/api/v1/projects`, 'POST', {
      slug,
      name: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      description: `Auto-created from local daemon pattern promotion`
    }, apiKey)

    if (createRes && createRes.data) {
      knownProjects.add(slug)
      return true
    }
    return false
  } catch {
    return false
  }
}

async function promotePattern(pattern) {
  const apiKey = process.env.QUOTH_API_KEY
  if (!apiKey) return null

  const apiUrl = process.env.QUOTH_API_URL || 'https://quoth.triqual.dev'
  const tags = Array.isArray(pattern.tags) ? pattern.tags : JSON.parse(pattern.tags || '[]')

  // Ensure the pattern's project exists in cloud
  const namespace = pattern.namespace || 'default'
  await ensureProject(namespace, apiKey, apiUrl)

  let embedding = undefined
  if (pattern.embedding) {
    try {
      embedding = typeof pattern.embedding === 'string'
        ? JSON.parse(pattern.embedding)
        : pattern.embedding
    } catch {}
  }

  const body = {
    patternId: pattern.id,
    name: pattern.name,
    condition: pattern.condition,
    action: pattern.action,
    content: buildContent(pattern),
    confidence: pattern.confidence,
    successCount: pattern.success_count,
    failureCount: pattern.failure_count,
    tags,
    applicability: pattern.applicability || 'narrow',
    ...(embedding ? { embedding } : {})
  }

  try {
    const res = await apiCall(`${apiUrl}/api/v1/patterns/promote`, 'POST', body, apiKey)
    return res
  } catch {
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
      timeout: 15000
    }, (res) => {
      let chunks = ''
      res.on('data', c => { chunks += c })
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)) } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

module.exports = { promotePattern, buildContent, ensureProject }
