'use strict'

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

async function promotePattern(pattern) {
  const apiKey = process.env.QUOTH_API_KEY
  if (!apiKey) return null

  const apiUrl = process.env.QUOTH_API_URL || 'https://quoth.triqual.dev'
  const tags = Array.isArray(pattern.tags) ? pattern.tags : JSON.parse(pattern.tags || '[]')

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
    const res = await fetch(`${apiUrl}/api/v1/patterns/promote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

module.exports = { promotePattern, buildContent }
