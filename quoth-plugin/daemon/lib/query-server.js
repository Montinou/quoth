'use strict'

const http = require('http')
const net = require('net')
const fs = require('fs')
const path = require('path')
const os = require('os')

const SOCK_PATH = path.join(
  process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth'),
  'daemon.sock'
)

const MAX_BODY = 64 * 1024 // 64KB
const HANDLER_TIMEOUT_MS = 400

function createQueryServer(db, log) {
  let server = null

  function start() {
    return new Promise((resolve, reject) => {
      // Check for stale socket
      if (fs.existsSync(SOCK_PATH)) {
        const probe = net.connect(SOCK_PATH)
        probe.on('connect', () => {
          probe.destroy()
          reject(new Error('Another query server is already listening on ' + SOCK_PATH))
        })
        probe.on('error', () => {
          // Stale socket — remove it
          try { fs.unlinkSync(SOCK_PATH) } catch {}
          _listen(resolve, reject)
        })
      } else {
        _listen(resolve, reject)
      }
    })
  }

  function _listen(resolve, reject) {
    server = http.createServer((req, res) => _handleRequest(req, res, db, log))
    server.on('error', reject)
    server.listen(SOCK_PATH, () => {
      log('info', 'Query server listening', { socket: SOCK_PATH })
      resolve()
    })
  }

  function stop() {
    if (server) {
      server.close()
      server = null
    }
    try { fs.unlinkSync(SOCK_PATH) } catch {}
  }

  return { start, stop }
}

function _handleRequest(req, res, db, log) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200)
    res.end(JSON.stringify({
      status: 'ok',
      pid: process.pid,
      uptime: process.uptime(),
    }))
    return
  }

  if (req.method === 'POST' && req.url === '/query') {
    const chunks = []
    let size = 0

    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        res.writeHead(413)
        res.end(JSON.stringify({ error: 'Body too large' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (res.writableEnded) return

      let body
      try {
        body = JSON.parse(Buffer.concat(chunks).toString())
      } catch {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
        return
      }

      let responded = false
      const timeout = setTimeout(() => {
        if (!responded) {
          responded = true
          res.writeHead(504)
          res.end(JSON.stringify({ error: 'Handler timeout' }))
        }
      }, HANDLER_TIMEOUT_MS)

      handleQuery(body, db, log)
        .then((result) => {
          if (!responded) {
            responded = true
            clearTimeout(timeout)
            res.writeHead(200)
            res.end(JSON.stringify(result))
          }
        })
        .catch((err) => {
          if (!responded) {
            responded = true
            clearTimeout(timeout)
            log('error', 'Query handler error', { error: err.message })
            res.writeHead(500)
            res.end(JSON.stringify({ error: 'Internal error' }))
          }
        })
    })

    return
  }

  // Unknown route
  res.writeHead(404)
  res.end(JSON.stringify({ error: 'Not found' }))
}

async function handleQuery(body, db, log) {
  const { prompt, project, session_id, limit = 7, type = 'route+inject', tags = [] } = body
  if (!prompt) return { error: 'prompt required' }

  const t0 = Date.now()

  // 1. Embed prompt
  const { generateEmbedding } = require('./embed.js')
  const embedding = await generateEmbedding(prompt)
  const embeddingMs = Date.now() - t0

  const t1 = Date.now()
  const result = { embedding_ms: embeddingMs }

  // 2. Route (if type includes 'route')
  if (type === 'route' || type === 'route+inject') {
    const { routeTask, getAlternatives } = require('../../mcp/lib/routing.js')
    const route = routeTask(prompt)
    result.agent = route.agent
    result.agent_confidence = route.confidence
    result.agent_reason = route.reason
    result.alternatives = getAlternatives(route.agent)
  }

  // 3. Pattern injection (if type includes 'inject')
  const DOC_CLUSTER_ID = -1
  if (type === 'inject' || type === 'route+inject') {
    const ns = project || 'default'

    // Check V2 flag
    let patterns = []
    let docResults = []
    try {
      const { isSubFlag } = require('./flags.js')
      if (isSubFlag('injection') && embedding) {
        // V2: unified ranking — patterns + doc chunks in one hierarchicalSelect pass
        const { hierarchicalSelect } = require('./bandit-v2.js')
        const candidates = db.searchBySimilarity(embedding, 20, tags)

        // Fetch doc chunk candidates and transform to pattern shape
        const docCandidates = db.getDocChunksWithStats(embedding, 10)
        const docAsPatterns = docCandidates.map(c => ({
          id: `doc:${c.id}`,
          name: c.section_header,
          action: (c.content || '').slice(0, 200),
          condition: c.doc_file,
          confidence: c.confidence || 0.5,
          alpha: c.alpha || 1,
          beta: c.beta || 1,
          cluster_id: DOC_CLUSTER_ID,
          embedding: typeof c.embedding === 'string' ? JSON.parse(c.embedding) : c.embedding,
          tags: JSON.stringify([`doc:${(c.doc_file || '').replace('.md', '')}`]),
          _isDocChunk: true,
          _similarity: c._similarity || 0,
        }))

        // Merge candidates
        const allCandidates = [...candidates, ...docAsPatterns]

        // Build cluster map including synthetic doc cluster
        const clusterMap = new Map()
        for (const c of allCandidates) {
          if (c.cluster_id != null) {
            if (c.cluster_id === DOC_CLUSTER_ID) {
              if (!clusterMap.has(DOC_CLUSTER_ID)) {
                clusterMap.set(DOC_CLUSTER_ID, { alpha: 1, beta: 1, attempts: docCandidates.length })
              }
            } else {
              const stats = db.getClusterStats(c.cluster_id, ns)
              if (stats) clusterMap.set(c.cluster_id, stats)
            }
          }
        }

        // Unified hierarchical selection
        const selected = hierarchicalSelect(allCandidates, clusterMap, limit, embedding)

        // Split back into patterns and doc chunks
        patterns = selected.filter(s => !s.id.startsWith('doc:'))
        docResults = selected.filter(s => s.id.startsWith('doc:'))
      } else {
        // V1: Thompson + trigram
        const { rankByThompsonAndTrigram } = require('./injection.js')
        patterns = rankByThompsonAndTrigram(db, ns, prompt, limit, {
          minConfidence: 0.3,
          excludeRecentMinutes: 2,
          tags,
        })
      }
    } catch (err) {
      log('error', 'Pattern injection failed in query server', { error: err.message })
      patterns = []
    }

    // Log pattern injections
    for (let i = 0; i < patterns.length; i++) {
      const p = patterns[i]
      try {
        db.logInjection({
          session_id: session_id || 'daemon-query',
          namespace: ns,
          pattern_id: p.id,
          cluster_id: p.cluster_id || null,
          rank: p.rank || i + 1,
          propensity: p.propensity || 1.0,
          is_exploration: p._exploration || false,
          query_text: prompt.slice(0, 200),
        })
      } catch {}
    }

    // Log doc chunk injections
    for (let i = 0; i < docResults.length; i++) {
      try {
        db.logInjection({
          session_id: session_id || 'daemon-query',
          namespace: ns,
          pattern_id: docResults[i].id,
          cluster_id: DOC_CLUSTER_ID,
          rank: patterns.length + i + 1,
          propensity: docResults[i].propensity || 1.0,
          is_exploration: 0,
          query_text: (prompt || '').slice(0, 200),
        })
      } catch {}
    }

    result.patterns = patterns.map(p => ({
      id: p.id,
      name: p.name,
      action: p.action,
      confidence: p.confidence,
      score: p._score || p._trigramSim || p._similarity || 0,
      rank: p.rank || 0,
      propensity: p.propensity || 1.0,
      tags: p.tags || [],
    }))

    // 4. Doc chunks result
    if (docResults.length > 0) {
      // V2: doc chunks from unified ranking (already selected + logged)
      result.doc_chunks = docResults.map(c => ({
        id: c.id,
        title: c.name || c.section_header || '',
        content: (c.action || c.content || '').slice(0, 500),
        score: c._similarity || c.propensity || 0,
        doc_file: c.condition || c.doc_file || '',
      }))
    } else {
      // V1 fallback: separate doc chunk search
      try {
        if (embedding) {
          const chunks = db.searchDocChunks(embedding, 3)
          result.doc_chunks = chunks.map(c => ({
            id: `doc:${c.id}`,
            title: c.section_header || c.doc_path || '',
            content: (c.content || '').slice(0, 500),
            score: c._similarity || 0,
            doc_file: c.doc_file || '',
          }))
        }
      } catch { result.doc_chunks = [] }
    }
  }

  result.search_ms = Date.now() - t1
  return result
}

function cosineSim(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}

/**
 * Rerank patterns by contextual outcome data.
 *
 * For each candidate pattern, compare the current query embedding against
 * stored intention embeddings in pattern_outcomes:
 * - Similar intention + success → boost score
 * - Similar intention + failure → penalize score
 * - No similar intention → neutral (global confidence stands)
 *
 * @param {Object[]} patterns - candidate patterns (must have .id)
 * @param {number[]} queryEmbedding - current prompt embedding
 * @param {Object} outcomesMap - { patternId: [{intention_embedding, outcome}] }
 * @param {number} simThreshold - minimum similarity to count as "similar" (default 0.5)
 * @returns {Object[]} patterns with _outcomeScore added
 */
function rerankByOutcomes(patterns, queryEmbedding, outcomesMap, simThreshold = 0.5) {
  if (!queryEmbedding || queryEmbedding.length === 0) {
    return patterns.map(p => ({ ...p, _outcomeScore: 0 }))
  }

  return patterns.map(p => {
    const outcomes = outcomesMap[p.id] || []
    if (outcomes.length === 0) return { ...p, _outcomeScore: 0 }

    let score = 0
    let matchCount = 0

    for (const o of outcomes) {
      if (!o.intention_embedding) continue
      try {
        const intentVec = typeof o.intention_embedding === 'string'
          ? JSON.parse(o.intention_embedding)
          : o.intention_embedding
        const sim = cosineSim(queryEmbedding, intentVec)
        if (sim < simThreshold) continue

        matchCount++
        if (o.outcome === 'success') score += sim * 0.3
        else if (o.outcome === 'failure') score -= sim * 0.3
        else score += sim * 0.1 // partial
      } catch {}
    }

    // Normalize by match count to prevent patterns with many outcomes from dominating
    const normalizedScore = matchCount > 0 ? score / matchCount : 0
    return { ...p, _outcomeScore: normalizedScore }
  })
}

module.exports = { createQueryServer, rerankByOutcomes }
