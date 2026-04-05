'use strict'

const https = require('https')

async function pullProjectPatterns(slug, since = 0, apiKey, apiUrl = 'https://quoth.triqual.dev') {
  if (!apiKey) return { patterns: [], skipped: 'no API key' }
  const url = new URL(`/api/v1/patterns?projectSlug=${encodeURIComponent(slug)}&since=${since}&limit=50`, apiUrl)

  return new Promise((resolve) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      timeout: 5000,
    }, (res) => {
      let chunks = ''
      res.on('data', c => { chunks += c })
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks)
          resolve({ patterns: data.patterns || [], status: res.statusCode })
        } catch {
          resolve({ patterns: [], error: 'parse error' })
        }
      })
    })
    req.on('error', (err) => resolve({ patterns: [], error: err.message }))
    req.on('timeout', () => { req.destroy(); resolve({ patterns: [], error: 'timeout' }) })
    req.end()
  })
}

async function syncFromCloud(db, log) {
  const apiKey = process.env.QUOTH_API_KEY
  if (!apiKey) { log('info', 'Cloud pull skipped: no QUOTH_API_KEY'); return }

  const namespaces = db.prepare(
    "SELECT DISTINCT namespace FROM patterns WHERE namespace IS NOT NULL"
  ).all().map(r => r.namespace)

  let totalNew = 0
  for (const ns of namespaces) {
    // Incremental sync: only fetch patterns updated after our newest local one.
    const row = db.prepare(
      "SELECT MAX(updated_at) as m FROM patterns WHERE namespace = ?"
    ).get(ns)
    const since = (row && row.m) ? row.m : 0
    const { patterns, error } = await pullProjectPatterns(ns, since, apiKey, process.env.QUOTH_API_URL)
    if (error) { log('warn', `Cloud pull failed for ${ns}`, { error }); continue }

    for (const p of patterns) {
      const exists = db.prepare('SELECT id FROM patterns WHERE id = ?').get(p.patternId || p.id)
      if (exists) continue
      try {
        db.upsertPattern({
          id: p.patternId || p.id,
          name: p.name,
          condition: p.condition,
          action: p.action,
          confidence: p.confidence,
          alpha: p.alpha || 1,
          beta: p.beta || 1,
          tags: p.tags || [],
          namespace: ns,
          source: 'cloud-pulled',
          applicability: p.applicability || 'narrow',
          embedding: p.embedding,
        })
        totalNew++
      } catch {}
    }
  }
  log('info', `Cloud pull: ${totalNew} new patterns from ${namespaces.length} namespaces`)
}

module.exports = { pullProjectPatterns, syncFromCloud }
