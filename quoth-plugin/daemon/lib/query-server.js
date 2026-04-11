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
 *                                            (required for /sessions/:sid/status
 *                                            and /health stuck_files scan)
 * @param {function} [opts.embedPrompt]    - (text) => Promise<Float32Array|null>
 *                                            DI'd for /inject tests
 * @param {function} [opts.getDaemonState] - () => { queue_depth, in_flight }
 *                                            DI'd for /health; wired by daemon-core
 *                                            in prod (Task 17). Defaults to zeros.
 * @returns {import('http').Server}
 */
function buildQueryServer({
  db,
  log = () => {},
  trajectoriesDir = null,
  embedPrompt = null,
  getDaemonState = () => ({ queue_depth: 0, in_flight: 0 }),
} = {}) {
  return http.createServer((req, res) =>
    _handleRequest(req, res, db, log, { trajectoriesDir, embedPrompt, getDaemonState })
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
    try {
      const body = handleHealth(db, ctx)
      res.writeHead(200)
      res.end(JSON.stringify(body))
    } catch (err) {
      log('error', '/health handler error', { error: err && err.message })
      if (!res.writableEnded) {
        res.writeHead(500)
        res.end(JSON.stringify({ error: 'Internal error' }))
      }
    }
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
        const scope = nsToScope(ns)
        const rows = scope
          ? db.prepare(`
              SELECT id, summary, content, tags, confidence, updated_at
              FROM knowledge_entities
              WHERE kind = 'fact' AND status = 'active' AND scope = ?
              ORDER BY updated_at DESC
              LIMIT ?
            `).all(scope, limit)
          : []
        const mapped = rows.map((r) => {
          let content = {}
          try { content = r.content ? JSON.parse(r.content) : {} } catch {}
          let tags = []
          try { tags = r.tags ? JSON.parse(r.tags) : [] } catch {}
          return {
            topic: r.summary,
            statement: content.statement || r.summary || null,
            evidence: content.evidence || null,
            scope,
            tags,
            confidence: r.confidence,
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
        const scope = nsToScope(ns)
        let deleted = false
        if (scope) {
          const info = db.prepare(`
            UPDATE knowledge_entities
            SET status = 'archived', updated_at = ?
            WHERE kind = 'fact' AND scope = ? AND summary = ? AND status = 'active'
          `).run(Date.now(), scope, topic)
          deleted = info.changes > 0
        }
        res.writeHead(200)
        res.end(JSON.stringify({ deleted }))
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
    SELECT id, kind, summary, content, metadata, tags, confidence, updated_at, source_session_id
      FROM knowledge_entities
     WHERE status = 'active'
       AND kind IN (${kindPlaceholders})
       AND (scope = 'global' OR scope = ?)
       AND id IN (${placeholders})
  `
  return db.prepare(sql).all(...kinds, scopeArg, ...ids)
}

// Task 19 / spec §2.3: subagent-start forwards an agentType query param so
// only knowledge entities tagged `agent:<type>` reach the final top-N.
// This is a *hard* filter applied to the HNSW-retrieved row set before the
// final scoring+select — it removes non-matching rows rather than down-
// weighting them. When the filtered pool is smaller than
// `QUOTH_AGENT_MIN_MATCHES` (default 1 — i.e. always respect a match) we
// fall back to the unfiltered set so the subagent still gets context. Set
// a higher floor if spurious single matches pollute your results.
function _agentMinMatches() {
  const v = parseInt(process.env.QUOTH_AGENT_MIN_MATCHES ?? '1', 10)
  return Number.isFinite(v) && v > 0 ? v : 1
}
function _filterByAgentType(rows, agentType) {
  if (!agentType) return rows
  const needle = `agent:${agentType}`
  const filtered = rows.filter((r) => {
    let tags
    try { tags = JSON.parse(r.tags || '[]') } catch { tags = [] }
    return Array.isArray(tags) && tags.includes(needle)
  })
  return filtered.length >= _agentMinMatches() ? filtered : rows
}

async function handleInject(req, res, db, log, ctx, parsedUrl) {
  const prompt = parsedUrl.searchParams.get('prompt') ?? ''
  const project = parsedUrl.searchParams.get('project') ?? 'global'
  const limitRaw = parseInt(parsedUrl.searchParams.get('limit') ?? '8', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 8
  // agentType filter (Task 19): empty string / absent → no filter.
  const agentType = (parsedUrl.searchParams.get('agentType') ?? '').trim()

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
  const cacheKey = sha1(`${prompt}\0${project}\0${kindsKey}\0${agentType}`)
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
  rows = _filterByAgentType(rows, agentType)

  // Under-fetch fallback: re-probe with wider efSearch. Union the id sets so
  // first-probe hits stay candidates even if the wider probe doesn't revisit
  // them (HNSW's k-ANN isn't monotonic in ef).
  if (rows.length < limit) {
    const annResults2 = hnsw.search(vec, overFetch, 200)
    for (const r of annResults2) {
      if (!distanceById.has(r.id)) distanceById.set(r.id, r.distance)
    }
    rows = _rowsForIds(db, [...distanceById.keys()], kinds, scopeArg)
    rows = _filterByAgentType(rows, agentType)
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

// ---------------------------------------------------------------------------
// GET /health — spec §5.5 observability surface
// ---------------------------------------------------------------------------
//
// Synchronous aggregation of daemon state, last-24h pipeline_errors by
// stage+severity, today's llm_budget row, stuck processing/ files, and the
// five most recent error/degraded rows. Everything fits in a handful of
// prepared statements — no embedding, no HNSW, no timeout wrapper needed.

const HEALTH_STAGES = ['triage', 'extract', 'persist']
const HEALTH_SEVERITIES = ['error', 'warn', 'degraded']

function _healthUtcDate() {
  return new Date().toISOString().slice(0, 10)
}

function _healthBudgetLimit() {
  return parseFloat(process.env.QUOTH_DAILY_LLM_BUDGET_USD ?? '1.00')
}

function _healthProcessingMaxAgeHours() {
  const v = parseFloat(process.env.QUOTH_PROCESSING_MAX_AGE_HOURS ?? '24')
  return Number.isFinite(v) && v > 0 ? v : 24
}

function _healthErrors24h(db) {
  // Initialize the nested shape with zeros so every stage/severity is present.
  const out = {}
  for (const stage of HEALTH_STAGES) {
    out[stage] = { error: 0, warn: 0, degraded: 0 }
  }
  const since = Date.now() - 86_400_000
  const rows = db.prepare(`
    SELECT stage, severity, COUNT(*) AS count
      FROM pipeline_errors
     WHERE ts IS NOT NULL
       AND ts >= ?
       AND stage IN ('triage', 'extract', 'persist')
     GROUP BY stage, severity
  `).all(since)
  for (const r of rows) {
    if (!out[r.stage]) continue // defensive; stage IN (...) already filters
    if (!HEALTH_SEVERITIES.includes(r.severity)) continue // drop unknowns silently
    out[r.stage][r.severity] = r.count
  }
  return out
}

function _healthBudget(db) {
  const date = _healthUtcDate()
  const limit_usd = _healthBudgetLimit()
  let row
  try {
    row = db.prepare(`SELECT date, spend_usd FROM llm_budget WHERE date = ?`).get(date)
  } catch {
    row = null
  }
  if (!row) {
    return { date, spend_usd: 0, limit_usd }
  }
  return {
    date: row.date,
    spend_usd: Number(row.spend_usd) || 0,
    limit_usd,
  }
}

function _healthStuckFiles(trajectoriesDir) {
  if (!trajectoriesDir) return []
  const procDir = path.join(trajectoriesDir, 'processing')
  let entries
  try {
    entries = fs.readdirSync(procDir)
  } catch {
    return []
  }
  const thresholdMs = _healthProcessingMaxAgeHours() * 3600_000
  const now = Date.now()
  const stuck = []
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue // ignore .meta.json sidecars + anything else
    const full = path.join(procDir, name)
    let stat
    try { stat = fs.statSync(full) } catch { continue }
    if (!stat.isFile()) continue
    const ageMs = now - stat.mtimeMs
    if (ageMs < thresholdMs) continue
    // Strip `.jsonl` and any `.PID.WORKER` claim suffix (Task 12/13 naming):
    //   abc-123.jsonl                → abc-123
    //   abc-123.12345.worker-2.jsonl → abc-123
    let sid = name.slice(0, -'.jsonl'.length)
    const claimMatch = sid.match(/^(.*?)\.\d+\.[^.]+$/)
    if (claimMatch) sid = claimMatch[1]
    stuck.push({
      session_id: sid,
      age_hours: ageMs / 3600_000,
    })
  }
  return stuck
}

function _healthRecentFailures(db) {
  try {
    const rows = db.prepare(`
      SELECT ts, stage, severity, session_id, error_message
        FROM pipeline_errors
       WHERE severity IN ('error', 'degraded')
       ORDER BY ts DESC
       LIMIT 5
    `).all()
    return rows.map((r) => ({
      ts: r.ts,
      stage: r.stage,
      severity: r.severity,
      session_id: r.session_id,
      error_message: r.error_message,
    }))
  } catch {
    return []
  }
}

function handleHealth(db, ctx) {
  const daemonState = (ctx && ctx.getDaemonState)
    ? ctx.getDaemonState()
    : { queue_depth: 0, in_flight: 0 }
  return {
    daemon: {
      pid: process.pid,
      uptime_s: Math.floor(process.uptime()),
      queue_depth: Number(daemonState.queue_depth) || 0,
      in_flight: Number(daemonState.in_flight) || 0,
    },
    errors_24h: _healthErrors24h(db),
    budget: _healthBudget(db),
    stuck_files: _healthStuckFiles(ctx && ctx.trajectoriesDir),
    recent_failures: _healthRecentFailures(db),
  }
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
  if (ns.startsWith('facts:proj:')) return 'project:' + ns.slice('facts:proj:'.length)
  return null
}

module.exports = {
  createQueryServer,
  buildQueryServer,
  // Exposed for unit tests (Task 19): agent:<type> tag filter semantics.
  _filterByAgentType,
}
