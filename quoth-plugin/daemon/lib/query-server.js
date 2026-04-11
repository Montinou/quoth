'use strict'

const http = require('http')
const net = require('net')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const SOCK_PATH = path.join(
  process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth'),
  'daemon.sock'
)

const MAX_BODY = 64 * 1024 // 64KB
const HANDLER_TIMEOUT_MS = 400

// --- /inject cache (spec §2.3): sha1(prompt + project + kinds_csv), 60s TTL ---
const INJECT_CACHE_TTL_MS = 60_000
const INJECT_CACHE_MAX = 512
const injectCache = new Map()

function _injectCachePut(key, value) {
  // Map iteration order is insertion order — when over cap, drop the oldest.
  if (injectCache.size >= INJECT_CACHE_MAX) {
    const firstKey = injectCache.keys().next().value
    if (firstKey !== undefined) injectCache.delete(firstKey)
  }
  injectCache.set(key, value)
}

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex')
}

/**
 * Build a raw http.Server wired to our request handler. Does NOT call
 * listen() — the caller decides where (unix socket for the daemon,
 * ephemeral loopback port for tests).
 *
 * @param {object}   opts
 * @param {object}   opts.db               - db handle from createDb()
 * @param {function} [opts.log]            - log(level, msg, meta) sink
 * @param {?string}  [opts.trajectoriesDir] - absolute path to ~/.quoth/trajectories
 *                                            (required for /sessions/:sid/status)
 * @returns {import('http').Server}
 */
function buildQueryServer({ db, log = () => {}, trajectoriesDir = null, embedPrompt = null } = {}) {
  return http.createServer((req, res) =>
    _handleRequest(req, res, db, log, { trajectoriesDir, embedPrompt })
  )
}

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
    // Unix-socket path: no trajectoriesDir needed (daemon wiring does not
    // yet use /sessions routes over the socket — loopback port is the
    // primary consumer). A future task can thread trajectoriesDir through.
    server = buildQueryServer({ db, log, trajectoriesDir: null })
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

function _handleRequest(req, res, db, log, ctx = {}) {
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

  // --- Session + facts routes (Task 18, spec §10.2 #10) ---

  // GET /sessions/:sid/status
  if (req.method === 'GET') {
    let parsedUrl
    try {
      parsedUrl = new URL(req.url, 'http://localhost')
    } catch {
      parsedUrl = null
    }
    if (parsedUrl) {
      const parts = parsedUrl.pathname.split('/').filter(Boolean)

      // GET /inject?prompt=&project=&kinds=&limit= (spec §2.3)
      if (parts[0] === 'inject' && parts.length === 1) {
        let responded = false
        const timeout = setTimeout(() => {
          if (responded) return
          responded = true
          try {
            res.writeHead(504)
            res.end(JSON.stringify({ error: 'Handler timeout' }))
          } catch {}
        }, HANDLER_TIMEOUT_MS)
        handleInject(req, res, db, log, ctx, parsedUrl)
          .then(() => {
            if (!responded) {
              responded = true
              clearTimeout(timeout)
            }
          })
          .catch((err) => {
            if (responded) return
            responded = true
            clearTimeout(timeout)
            log('error', '/inject handler error', { error: err && err.message })
            if (res.writableEnded) return
            try {
              res.writeHead(500)
              res.end(JSON.stringify({ error: 'Internal error' }))
            } catch {}
          })
        return
      }

      if (parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'status') {
        const sid = decodeURIComponent(parts[1])
        const info = findSessionInBuckets(sid, ctx.trajectoriesDir)
        if (!info) {
          res.writeHead(404)
          res.end(JSON.stringify({ error: 'not_found' }))
          return
        }
        res.writeHead(200)
        res.end(JSON.stringify(info))
        return
      }

      // GET /facts/:namespace?limit=N
      if (parts[0] === 'facts' && parts.length === 2) {
        const ns = decodeURIComponent(parts[1])
        const limit = Math.min(100, Number(parsedUrl.searchParams.get('limit')) || 20)
        const rows = (db.listFactsByNamespace && db.listFactsByNamespace(ns, limit)) || []
        const mapped = rows.map((r) => {
          let content
          try { content = JSON.parse(r.content) } catch { content = {} }
          let tags = []
          if (r.tags) {
            if (typeof r.tags === 'string') {
              try { tags = JSON.parse(r.tags) } catch { tags = [] }
            } else if (Array.isArray(r.tags)) {
              tags = r.tags
            }
          }
          return {
            topic: r.key,
            statement: content.statement || null,
            evidence: content.evidence || null,
            scope: nsToScope(ns),
            tags,
            updated_at: r.updated_at,
          }
        })
        res.writeHead(200)
        res.end(JSON.stringify(mapped))
        return
      }
    }
  }

  // DELETE /facts/:namespace/:topic
  if (req.method === 'DELETE') {
    let parsedUrl
    try {
      parsedUrl = new URL(req.url, 'http://localhost')
    } catch {
      parsedUrl = null
    }
    if (parsedUrl) {
      const parts = parsedUrl.pathname.split('/').filter(Boolean)
      if (parts[0] === 'facts' && parts.length === 3) {
        const ns = decodeURIComponent(parts[1])
        const topic = decodeURIComponent(parts[2])
        const deleted = (db.archiveFact && db.archiveFact(ns, topic)) || false
        res.writeHead(200)
        res.end(JSON.stringify({ deleted: Boolean(deleted) }))
        return
      }
    }
  }

  // Unknown route
  res.writeHead(404)
  res.end(JSON.stringify({ error: 'Not found' }))
}

// ---------------------------------------------------------------------------
// GET /inject — per-prompt knowledge-entities injection (spec §2.3)
// ---------------------------------------------------------------------------
//
// Returns top-K { id, kind, summary, content, metadata, confidence, score }
// for the given prompt, filtered to (scope='global' OR 'project:<project>')
// and the requested kinds. Score = cosine × confidence × recency × kind_weight.
//
// Facts are silently excluded — they're session-start only.

const KIND_ALLOWLIST = new Set(['pattern', 'decision', 'anti_pattern'])

function kindWeight(kind) {
  const envKey = `QUOTH_KIND_WEIGHT_${kind.toUpperCase()}`
  const fallback = { pattern: 1.0, decision: 1.3, anti_pattern: 1.5 }[kind] ?? 1.0
  const v = parseFloat(process.env[envKey])
  return Number.isFinite(v) ? v : fallback
}

function _rowsForIds(db, ids, kinds, scopeArg) {
  if (!ids.length || !kinds.length) return []
  const placeholders = ids.map(() => '?').join(',')
  const kindPlaceholders = kinds.map(() => '?').join(',')
  const sql = `
    SELECT id, kind, summary, content, metadata, confidence, updated_at, source_session_id
      FROM knowledge_entities
     WHERE status = 'active'
       AND kind IN (${kindPlaceholders})
       AND (scope = 'global' OR scope = ?)
       AND id IN (${placeholders})
  `
  return db.prepare(sql).all(...kinds, scopeArg, ...ids)
}

async function handleInject(req, res, db, log, ctx, parsedUrl) {
  const prompt = parsedUrl.searchParams.get('prompt') ?? ''
  const project = parsedUrl.searchParams.get('project') ?? 'global'
  const limitRaw = parseInt(parsedUrl.searchParams.get('limit') ?? '8', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 8

  const kindsRaw = (parsedUrl.searchParams.get('kinds') ?? 'pattern,decision,anti_pattern')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  // Silently drop 'fact' and any unknown kinds — facts are session-start only.
  const kinds = kindsRaw.filter((k) => KIND_ALLOWLIST.has(k))
  if (kinds.length === 0) {
    res.writeHead(200)
    res.end(JSON.stringify({ results: [] }))
    return
  }

  const kindsKey = [...kinds].sort().join(',')
  const cacheKey = sha1(`${prompt}\0${project}\0${kindsKey}`)
  const cached = injectCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < INJECT_CACHE_TTL_MS) {
    res.writeHead(200)
    res.end(JSON.stringify({ results: cached.results }))
    return
  }

  // Embed prompt (DI via ctx.embedPrompt, default to ./embed.js).
  const embedPrompt = ctx.embedPrompt || (async (text) => {
    const { generateEmbedding } = require('./embed.js')
    return generateEmbedding(text)
  })
  const vec = await embedPrompt(prompt)
  if (!vec) {
    res.writeHead(200)
    res.end(JSON.stringify({ results: [] }))
    return
  }

  // Load HNSW singleton (keyed by QUOTH_HOME, shared across requests).
  const { loadOrInit } = require('./hnsw.js')
  const hnsw = await loadOrInit({ db })

  const scopeArg = `project:${project}`
  const overFetch = limit * 3
  const defaultEf = parseInt(process.env.QUOTH_HNSW_EF_SEARCH ?? '50', 10)

  // First HNSW probe.
  const annResults = hnsw.search(vec, overFetch, defaultEf)
  const distanceById = new Map(annResults.map((r) => [r.id, r.distance]))

  let rows = _rowsForIds(db, [...distanceById.keys()], kinds, scopeArg)

  // Under-fetch fallback: re-probe with wider efSearch. Union the id sets so
  // first-probe hits stay candidates even if the wider probe doesn't revisit
  // them (HNSW's k-ANN isn't monotonic in ef).
  if (rows.length < limit) {
    const annResults2 = hnsw.search(vec, overFetch, 200)
    for (const r of annResults2) {
      if (!distanceById.has(r.id)) distanceById.set(r.id, r.distance)
    }
    rows = _rowsForIds(db, [...distanceById.keys()], kinds, scopeArg)
    if (rows.length < limit) {
      try {
        const { logPipelineError } = require('../db.js')
        logPipelineError({
          stage: 'inject',
          severity: 'warn',
          session_id: null,
          error_message: 'under_fetch',
          context: {
            prompt_len: prompt.length,
            project,
            limit,
            found: rows.length,
          },
        })
      } catch (err) {
        log('error', 'logPipelineError failed in /inject', { error: err && err.message })
      }
    }
  }

  // Re-rank: score = cosine × confidence × recency × kind_weight.
  const now = Date.now()
  const scored = rows
    .map((r) => {
      const distance = distanceById.has(r.id) ? distanceById.get(r.id) : 1
      const cos = 1 - distance
      const ageMs = Math.max(0, now - (r.updated_at || now))
      const recency = Math.exp(-ageMs / (30 * 86_400_000)) // 30-day half-ish decay
      const conf = Number.isFinite(r.confidence) ? r.confidence : 0.5
      const score = cos * conf * recency * kindWeight(r.kind)
      let metadata = r.metadata
      if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata) } catch { metadata = {} }
      }
      return {
        id: r.id,
        kind: r.kind,
        summary: r.summary,
        content: r.content,
        metadata,
        confidence: conf,
        source_session_id: r.source_session_id,
        score,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  _injectCachePut(cacheKey, { ts: Date.now(), results: scored })

  res.writeHead(200)
  res.end(JSON.stringify({ results: scored }))
}

function findSessionInBuckets(sid, trajectoriesDir) {
  if (!trajectoriesDir) return null
  const metaName = `${sid}.meta.json`

  // Flat buckets (no date subdir): active + processing.
  for (const bucket of ['active', 'processing']) {
    const sidecar = path.join(trajectoriesDir, bucket, metaName)
    if (fs.existsSync(sidecar)) {
      try {
        const meta = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
        return { ...meta, location: bucket }
      } catch {}
    }
  }

  // Dated-but-flat buckets (spec §4.1): empty/YYYY-MM-DD/ and error/YYYY-MM-DD/
  // — no project subdir.
  for (const bucket of ['empty', 'error']) {
    const bucketRoot = path.join(trajectoriesDir, bucket)
    if (!fs.existsSync(bucketRoot)) continue
    for (const dateDir of safeReaddir(bucketRoot)) {
      const sidecar = path.join(bucketRoot, dateDir, metaName)
      if (fs.existsSync(sidecar)) {
        try {
          const meta = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
          return { ...meta, location: `${bucket}/${dateDir}` }
        } catch {}
      }
    }
  }

  // Dated + project buckets: done/YYYY-MM-DD/<project>/ and routine/YYYY-MM-DD/<project>/.
  for (const bucket of ['done', 'routine']) {
    const bucketRoot = path.join(trajectoriesDir, bucket)
    if (!fs.existsSync(bucketRoot)) continue
    for (const dateDir of safeReaddir(bucketRoot)) {
      const dateDirPath = path.join(bucketRoot, dateDir)
      for (const projDir of safeReaddir(dateDirPath)) {
        const sidecar = path.join(dateDirPath, projDir, metaName)
        if (fs.existsSync(sidecar)) {
          try {
            const meta = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
            return { ...meta, location: `${bucket}/${dateDir}/${projDir}` }
          } catch {}
        }
      }
    }
  }

  return null
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir) } catch { return [] }
}

function nsToScope(ns) {
  if (ns === 'facts:global') return 'global'
  if (ns.startsWith('facts:proj:')) return 'project'
  return 'unknown'
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

    // Outcome reranking: boost/penalize based on contextual outcomes
    if (patterns.length > 0 && embedding) {
      try {
        const outcomesMap = {}
        for (const p of patterns) {
          if (p.id && !p.id.startsWith('doc:')) {
            const outcomes = db.getOutcomesForPattern
              ? db.getOutcomesForPattern(p.id, 10)
              : []
            if (outcomes.length > 0) outcomesMap[p.id] = outcomes
          }
        }
        if (Object.keys(outcomesMap).length > 0) {
          patterns = rerankByOutcomes(patterns, embedding, outcomesMap)
          // Re-sort by combined score: original score + outcome adjustment
          patterns.sort((a, b) => {
            const aTotal = (a._score || a._trigramSim || a._similarity || 0) + (a._outcomeScore || 0)
            const bTotal = (b._score || b._trigramSim || b._similarity || 0) + (b._outcomeScore || 0)
            return bTotal - aTotal
          })
          // Trim back to limit
          patterns = patterns.slice(0, limit)
        }
      } catch (err) {
        log('error', 'Outcome reranking failed', { error: err.message })
      }
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

module.exports = { createQueryServer, buildQueryServer, rerankByOutcomes }
