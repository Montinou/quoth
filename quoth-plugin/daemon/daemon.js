'use strict'

// Quoth daemon entry point (greenfield reset v3.6).
//
// Post Task 24 this file is a minimal bootstrapper: env load, DB + HNSW
// init, PID guard, signal wiring, FileWatcher over trajectories/
// processing/, a worker pool that drives the new 4-kind pipeline
// (triage → extract → embed → persist) from daemon-core.js, a query
// server, and a handful of periodic timers (HNSW save, retention sweep,
// stale-session detection, agent cleanup).
//
// All of the pre-v3.6 v2 scaffolding — legacy pattern stages, clustering,
// bandit selection, curation, doc auto-update, cloud pull, nightly deep
// merge — was deleted in this task. The new pipeline is authoritative via
// the knowledge_entities store (spec §3.1).

const fs = require('fs')
const path = require('path')
const os = require('os')

// --- Load .env (no dependency on dotenv) ------------------------------------
const DAEMON_REAL_DIR = fs.realpathSync(__dirname)
const PROJECT_ROOT = process.env.QUOTH_PROJECT_ROOT || path.join(DAEMON_REAL_DIR, '..', '..')
const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')

for (const envPath of [
  path.join(QUOTH_HOME, '.env'),
  path.join(PROJECT_ROOT, '.env.local'),
  path.join(PROJECT_ROOT, '.env'),
]) {
  try {
    const content = fs.readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const stripped = line.replace(/\s+#.*$/, '')
      const match = stripped.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '').trim()
      }
    }
  } catch {}
}

const { spawn } = require('child_process')
const { createDb } = require('./db.js')
const core = require('./daemon-core.js')
const { callLLMWithUsage, callMoonshot } = require('./lib/llm.js')

// --- Paths ------------------------------------------------------------------
const TRAJECTORIES_DIR = path.join(QUOTH_HOME, 'trajectories')
const PROCESSING_DIR = path.join(TRAJECTORIES_DIR, 'processing')
const PID_FILE = path.join(QUOTH_HOME, 'daemon.pid')
const LOG_FILE = path.join(QUOTH_HOME, 'daemon.log')
const DB_PATH = path.join(QUOTH_HOME, 'memory.db')
const SOCK_PATH = path.join(QUOTH_HOME, 'daemon.sock')

;[QUOTH_HOME, TRAJECTORIES_DIR, PROCESSING_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
})

// --- Logging ----------------------------------------------------------------
function log(level, msg, data) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(data && { data }) }) + '\n'
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
  if (process.env.QUOTH_DEBUG) process.stderr.write(line)
}

// --- PID management (single-instance guard) ---------------------------------
if (fs.existsSync(PID_FILE)) {
  try {
    const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
    if (existingPid !== process.pid) {
      try {
        process.kill(existingPid, 0)
        log('info', 'Another daemon already running', { existingPid })
        process.exit(0)
      } catch {
        log('info', 'Cleaned stale daemon', { stalePid: existingPid })
        try { fs.unlinkSync(PID_FILE) } catch {}
        try { fs.unlinkSync(SOCK_PATH) } catch {}
      }
    }
  } catch {
    try { fs.unlinkSync(PID_FILE) } catch {}
  }
}
fs.writeFileSync(PID_FILE, String(process.pid))
process.on('exit', () => {
  try { fs.unlinkSync(PID_FILE) } catch {}
  try { fs.unlinkSync(SOCK_PATH) } catch {}
})

// --- DB + HNSW --------------------------------------------------------------
const db = createDb(DB_PATH)
db.initHnsw()

// Resolve the HnswIndex singleton for the worker pool. loadOrInit is async
// on first call (may rebuild the index from knowledge_entities) but
// deterministic thereafter — the worker awaits this promise before handing
// off to persistSession so we always pass a real index, not null.
const hnswReady = (async () => {
  try {
    const { loadOrInit } = require('./lib/hnsw.js')
    return await loadOrInit({ db, home: QUOTH_HOME })
  } catch (err) {
    log('error', 'hnsw_load_failed', { error: err.message })
    return null
  }
})()

// --- LLM dependency bag -----------------------------------------------------
// Pipeline contract: `llm({ system, prompt, stage, maxTokens? })` →
// `{ text: string, cost_usd: number }`. Tests pass fakes; in production each
// key wraps the real backend. Errors propagate; the pipeline handles retries
// and fallback chains.
//
// gemini  — Vercel AI Gateway, `google/gemini-2.5-flash-lite` by default.
// kimi    — Moonshot API, `kimi-k2.5`. Returns usage via response; we
//           estimate cost from token counts using a rough $0.60/$2.50 /M.
// sonnet  — `claude -p` subprocess (spec §5 fallback). stdin-prompt,
//           stdout-JSON response; cost_usd=0 for now (budget treats it as
//           free; a future task can add Anthropic API accounting).
function joinPrompt({ system, prompt }) {
  const s = (system || '').toString().trim()
  const u = (prompt || '').toString()
  return s ? `${s}\n\n${u}` : u
}

const KIMI_PRICING = { input: 0.60, output: 2.50 } // USD / 1M tokens (approx)

async function geminiAdapter({ system, prompt, maxTokens = 2048 }) {
  const combined = joinPrompt({ system, prompt })
  const res = await callLLMWithUsage(combined, maxTokens, 'google/gemini-2.5-flash-lite')
  return {
    text: res.content,
    cost_usd: res.estimated_cost_usd || 0,
  }
}

async function kimiAdapter({ system, prompt, maxTokens = 8192 }) {
  const combined = joinPrompt({ system, prompt })
  const text = await callMoonshot(combined, maxTokens)
  // callMoonshot doesn't surface usage — approximate from string lengths
  // (4 chars/token heuristic). Under-budget triage will over-estimate
  // slightly which is the safe direction.
  const inTok = Math.ceil(combined.length / 4)
  const outTok = Math.ceil((text || '').length / 4)
  const cost_usd = (inTok / 1_000_000) * KIMI_PRICING.input + (outTok / 1_000_000) * KIMI_PRICING.output
  return { text, cost_usd }
}

function sonnetAdapter({ system, prompt }) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', 'sonnet-4-6'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { err += c })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude -p exited ${code}: ${err.slice(0, 200)}`))
        return
      }
      resolve({ text: out, cost_usd: 0 })
    })
    child.stdin.write(joinPrompt({ system, prompt }))
    child.stdin.end()
  })
}

const llm = {
  gemini: geminiAdapter,
  kimi: kimiAdapter,
  sonnet: sonnetAdapter,
}

// --- Worker pool driving the new pipeline -----------------------------------
const sessionQueue = []
const queuedSet = new Set()
let workerBusy = false

function enqueueSessionFile(fullPath) {
  if (queuedSet.has(fullPath)) return
  if (!fs.existsSync(fullPath)) return
  queuedSet.add(fullPath)
  sessionQueue.push(fullPath)
  runWorker()
}

async function runWorker() {
  if (workerBusy) return
  workerBusy = true
  try {
    while (sessionQueue.length > 0) {
      const file = sessionQueue.shift()
      queuedSet.delete(file)
      if (!fs.existsSync(file)) continue
      try {
        const hnsw = await hnswReady
        await core.processSessionWithPipeline(file, { hnsw, llm, log })
      } catch (err) {
        log('error', 'pipeline_worker_failed', { file, error: err.message })
      }
    }
  } finally {
    workerBusy = false
  }
}

// --- File watcher over processing/ -----------------------------------------
const watcher = new core.FileWatcher(PROCESSING_DIR, {
  pollIntervalMs: parseInt(process.env.QUOTH_POLL_INTERVAL_MS || '5000', 10),
  onDegraded: (evt) => log('warn', 'watcher_degraded', evt),
})
watcher.on('file', (filename) => {
  enqueueSessionFile(path.join(PROCESSING_DIR, filename))
})
watcher.start()

// Boot-time orphan recovery — strip stale `.pid.worker.jsonl` suffixes from
// crashed workers, then enqueue every remaining processing/ file so the
// worker pool drains them. The FileWatcher warmup seeds pre-existing files
// into its known-set, so this boot scan is the only code path that hands
// them to the worker pool.
try {
  const recovered = core.recoverOrphans(PROCESSING_DIR)
  if (recovered > 0) log('info', 'orphans_recovered', { count: recovered })
  for (const filename of fs.readdirSync(PROCESSING_DIR)) {
    if (!filename.endsWith('.jsonl')) continue
    enqueueSessionFile(path.join(PROCESSING_DIR, filename))
  }
} catch (err) {
  log('error', 'orphan_recovery_failed', { error: err.message })
}

// --- Query server (Unix socket) --------------------------------------------
let queryServer = null
try {
  const { createQueryServer } = require('./lib/query-server.js')
  queryServer = createQueryServer(db, log, {
    trajectoriesDir: TRAJECTORIES_DIR,
    getDaemonState: () => ({
      queue_depth: sessionQueue.length,
      in_flight: workerBusy ? 1 : 0,
    }),
  })
  queryServer.start()
} catch (err) {
  log('error', 'query_server_failed_to_start', { error: err.message })
}

// --- Periodic timers --------------------------------------------------------
let hnswSaveTimer = null
let retentionTimer = null
let staleSessionTimer = null
let agentCleanupTimer = null

function startHnswSaveTimer() {
  hnswSaveTimer = setInterval(() => {
    try { db.saveHnsw() } catch (err) { log('error', 'hnsw_save_failed', { error: err.message }) }
  }, 30 * 60 * 1000)
}

function startRetentionTimer() {
  const runOnce = () => {
    try {
      const { runRetentionSweep } = require('./retention.js')
      const res = runRetentionSweep({ log })
      log('info', 'retention_complete', { deleted: res.deleted, ttls: res.ttls })
    } catch (err) {
      log('error', 'retention_failed', { error: err.message })
    }
  }
  // Schedule first run at next 06:00 UTC (03:00 ART), then every 24h.
  const now = new Date()
  const next = new Date(now)
  next.setUTCHours(6, 0, 0, 0)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  const msUntil = next - now
  setTimeout(() => {
    runOnce()
    retentionTimer = setInterval(runOnce, 24 * 60 * 60 * 1000)
  }, msUntil)
  log('info', `retention_scheduled`, { minutes_until: Math.round(msUntil / 60000) })
}

function startStaleSessionTimer() {
  const runScan = () => {
    try {
      const { detectStaleSessions } = require('./stale-detector.js')
      detectStaleSessions({ db, trajectoriesDir: TRAJECTORIES_DIR, log })
    } catch (err) {
      log('error', 'stale_scan_failed', { error: err.message })
    }
  }
  // Startup catch-up — if we haven't scanned recently, run immediately.
  try {
    const lastTsRaw = typeof db.getDaemonMeta === 'function'
      ? db.getDaemonMeta('last_stale_scan_ts') : null
    const lastTs = lastTsRaw != null ? Number(lastTsRaw) || 0 : 0
    if (Date.now() - lastTs > 10 * 60 * 1000) {
      log('info', 'stale_startup_catchup', { last_scan_ts: lastTs })
      runScan()
    }
  } catch (err) {
    log('warn', 'stale_startup_catchup_failed', { error: err.message })
  }
  staleSessionTimer = setInterval(runScan, 10 * 60 * 1000)
}

function startAgentCleanupTimer() {
  agentCleanupTimer = setInterval(() => {
    try { db.cleanupStaleAgents(300000) }
    catch (err) { log('error', 'agent_cleanup_failed', { error: err.message }) }
  }, 5 * 60 * 1000)
}

function clearTimers() {
  if (hnswSaveTimer) clearInterval(hnswSaveTimer)
  if (retentionTimer) clearInterval(retentionTimer)
  if (staleSessionTimer) clearInterval(staleSessionTimer)
  if (agentCleanupTimer) clearInterval(agentCleanupTimer)
}

// --- Signal handlers --------------------------------------------------------
process.on('SIGTERM', () => {
  log('info', 'SIGTERM received, shutting down')
  clearTimers()
  try { watcher.stop() } catch {}
  if (queryServer) { try { queryServer.stop() } catch {} }
  try { db.saveHnsw() } catch {}
  try { db.close() } catch {}
  process.exit(0)
})

process.on('SIGUSR1', () => {
  log('info', 'SIGUSR1 received, flushing processing/')
  try {
    core.recoverOrphans({
      processingDir: PROCESSING_DIR,
      onFile: (fullPath) => enqueueSessionFile(fullPath),
      log,
    })
  } catch (err) {
    log('error', 'flush_failed', { error: err.message })
  }
})

process.on('uncaughtException', (err) => {
  log('error', 'uncaughtException', { message: err.message, stack: err.stack })
})

// --- Start ------------------------------------------------------------------
startHnswSaveTimer()
startRetentionTimer()
startStaleSessionTimer()
startAgentCleanupTimer()

// Pre-warm the embedding pipeline (~500 ms cold start otherwise).
;(async () => {
  try {
    const { generateEmbedding } = require('./lib/embed.js')
    await generateEmbedding('warmup')
    log('info', 'embedding_warmup_complete')
  } catch (err) {
    log('warn', 'embedding_warmup_failed', { error: err.message })
  }
})()

log('info', 'quoth_daemon_started', { pid: process.pid, home: QUOTH_HOME })
