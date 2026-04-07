'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

// --- Load .env from project root (no dependency on dotenv) ---
const DAEMON_REAL_DIR = fs.realpathSync(__dirname)
const _projectRoot = process.env.QUOTH_PROJECT_ROOT || path.join(DAEMON_REAL_DIR, '..', '..')
// Load env from: ~/.quoth/.env (user config) → project .env.local → project .env
const _quothHome = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
for (const envPath of [
  path.join(_quothHome, '.env'),
  path.join(_projectRoot, '.env.local'),
  path.join(_projectRoot, '.env'),
]) {
  try {
    const content = fs.readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      // Strip inline comments ( # comment) but preserve # inside values
      const stripped = line.replace(/\s+#.*$/, '')
      const match = stripped.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '').trim()
      }
    }
  } catch {}
}

const { createDb } = require('./db.js')
const { judge } = require('./pipeline/judge.js')
const { distill } = require('./pipeline/distill.js')
const { distillBatch } = require('./pipeline/distill-batch.js')
const { consolidate } = require('./pipeline/consolidate.js')
const { promotePattern } = require('./lib/promote.js')
const { callPipelineAPI } = require('./lib/pipeline-api.js')
const { scanDocs } = require('./lib/doc-manifest.js')
const { updateDoc, commitAndPush } = require('./lib/doc-updater.js')

// --- Daemon mode ---
// 'local' = full local LLM pipeline (needs AI_GATEWAY_API_KEY or claude CLI)
// 'managed' = cloud pipeline via Quoth API (only needs QUOTH_API_KEY)
const QUOTH_MODE = process.env.QUOTH_MODE || 'local'

// --- Paths ---
const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const TRAJECTORIES_DIR = path.join(QUOTH_HOME, 'trajectories')
const PID_FILE = path.join(QUOTH_HOME, 'daemon.pid')
const LOG_FILE = path.join(QUOTH_HOME, 'daemon.log')
const LOCK_FILE = path.join(QUOTH_HOME, 'processing.lock')
const DB_PATH = path.join(QUOTH_HOME, 'memory.db')
const STATE_DIR = path.join(QUOTH_HOME, 'intelligence')

const PROJECT_ROOT = _projectRoot

// --- Setup dirs ---
;[QUOTH_HOME, TRAJECTORIES_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
})

const db = createDb(DB_PATH)
db.initHnsw()
const jobQueue = []
const enqueuedKeys = new Set()  // Track enqueued entries to prevent duplicates
let isProcessing = false
let decayTimer = null
let deepConsolidateTimer = null
let hnswSaveTimer = null
let agentCleanupTimer = null

// --- Logging ---
function log(level, msg, data) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(data && { data }) }) + '\n'
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
  if (process.env.QUOTH_DEBUG) process.stderr.write(line)
}

// --- PID management ---
fs.writeFileSync(PID_FILE, String(process.pid))
process.on('exit', () => { try { fs.unlinkSync(PID_FILE) } catch {}; try { fs.unlinkSync(LOCK_FILE) } catch {} })
// Clean stale lock from previous crash
if (fs.existsSync(LOCK_FILE)) {
  try {
    const lockPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim())
    try { process.kill(lockPid, 0) } catch { fs.unlinkSync(LOCK_FILE); log('info', 'Cleaned stale lock', { stalePid: lockPid }) }
  } catch { try { fs.unlinkSync(LOCK_FILE) } catch {} }
}

// --- Signal handlers ---
process.on('SIGTERM', () => {
  log('info', 'SIGTERM received, shutting down')
  clearTimers()
  db.close()
  process.exit(0)
})

process.on('SIGUSR1', () => {
  log('info', 'SIGUSR1: flush triggered')
  scanAndEnqueue()
  processQueue()
})

// --- Self-heal ---
process.on('uncaughtException', (err) => {
  log('error', 'uncaughtException', { message: err.message, stack: err.stack })
  // Continue running — don't crash on pipeline errors
})

// --- File watcher ---
function watchTrajectories() {
  try {
    fs.watch(TRAJECTORIES_DIR, { persistent: true }, (event, filename) => {
      if (filename && filename.endsWith('.jsonl')) {
        setTimeout(() => { scanAndEnqueue(); processQueue() }, 500)
      }
    })
    log('info', 'Watching trajectories', { dir: TRAJECTORIES_DIR, mode: QUOTH_MODE })
  } catch (err) {
    log('error', 'Failed to start watcher', { error: err.message })
  }
}

// --- Scan JSONL files for unprocessed entries ---
function scanAndEnqueue() {
  let added = 0
  try {
    const files = fs.readdirSync(TRAJECTORIES_DIR).filter(f => f.endsWith('.jsonl'))
    for (const file of files) {
      const filePath = path.join(TRAJECTORIES_DIR, file)
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
        for (let i = 0; i < lines.length; i++) {
          try {
            const entry = JSON.parse(lines[i])
            if (entry._processed) continue
            // Deduplicate: use file + line index as unique key
            const key = `${file}:${i}`
            if (enqueuedKeys.has(key)) continue
            enqueuedKeys.add(key)
            jobQueue.push({ entry, filePath, line: lines[i], key })
            added++
          } catch {}
        }
      } catch (err) {
        log('error', 'Failed to read trajectory file', { file, error: err.message })
      }
    }
  } catch (err) {
    log('error', 'scanAndEnqueue failed', { error: err.message })
  }
  if (added > 0) log('info', `Enqueued ${added} new entries (queue: ${jobQueue.length})`)
}

// --- Process queue with up to 5 parallel workers ---
async function processQueue() {
  if (isProcessing || jobQueue.length === 0) return
  if (fs.existsSync(LOCK_FILE)) {
    // Check if lock holder is still alive
    try {
      const lockPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim())
      try { process.kill(lockPid, 0) } catch { fs.unlinkSync(LOCK_FILE) }
    } catch { try { fs.unlinkSync(LOCK_FILE) } catch {} }
    if (fs.existsSync(LOCK_FILE)) return
  }

  try { fs.writeFileSync(LOCK_FILE, String(process.pid)) } catch { return }
  isProcessing = true

  try {
    const CONCURRENCY = 5
    while (jobQueue.length > 0) {
      const batch = jobQueue.splice(0, CONCURRENCY)
      await Promise.all(batch.map(job => processEntry(job)))
    }
  } finally {
    isProcessing = false
    try { fs.unlinkSync(LOCK_FILE) } catch {}
  }
}

// --- Process a single trajectory entry ---
/**
 * Detect the actual project from file paths in the task description.
 * Corrects the namespace when sessions run from ~ but edit project-specific files.
 */
// Workspace directory name → GitHub repo name mapping
const WORKSPACE_REPO_MAP = {
  ads: 'studio-pipeline',
  billing: 'billing-processor',
  curator: 'quoth',
  deployer: 'agentical',
  echo: 'ai-voice-platform',
  interviews: 'interview-companion',
  jardin: 'jardin-maternal',
  multimedia: 'triqual',
  omnichannel: 'omnichannel',
  portfolio: 'portfolio',
  sales: 'sales-companion',
}

function detectProjectFromTask(task, fallback) {
  if (!task) return fallback
  // Match known project path patterns (order matters — most specific first)
  const patterns = [
    [/projects\/agents-tools\/(quoth|exolar|triqual)/, null],
    [/projects\/skill-registry/, 'skill-registry'],
    [/projects\/claude-code-fork-main/, 'claude-code-fork-main'],
    [/\.openclaw\/workspaces\/([\w-]+)\/repo/, 'workspace'],
    [/IPS_audit\/IPS/, 'ips'],
    [/shadcnblocks-registry/, 'shadcnblocks-registry'],
    [/remotion-studio/, 'remotion-studio'],
    [/prompt-to-motion-graphics/, 'prompt-to-motion-graphics'],
  ]
  for (const [re, override] of patterns) {
    const m = task.match(re)
    if (!m) continue
    if (override === 'workspace') {
      // Map workspace dir name to git repo name
      return WORKSPACE_REPO_MAP[m[1]] || m[1].toLowerCase()
    }
    return override || m[1].toLowerCase()
  }
  return fallback
}

async function processEntry({ entry, filePath, line }) {
  try {
    // Only process session_summary entries (batch distill).
    // Individual tool_use entries are skipped — they're consumed as context
    // by the batch distiller when the session_summary arrives.
    if (entry.event === 'session_summary') {
      await processSessionBatch(entry, filePath, line)
      return
    }

    // Mark tool_use entries as processed immediately (no individual LLM calls)
    const rawProject = entry.project || 'default'
    const project = detectProjectFromTask(entry.task, rawProject)
    log('debug', 'Processing entry', { agent: entry.agent, outcome: entry.outcome, project })
    markProcessed(filePath, line)

  } catch (err) {
    log('error', 'processEntry failed', { error: err.message })
  }
}

// --- Process a session_summary entry via batch distill ---
async function processSessionBatch(summaryEntry, filePath, summaryLine) {
  const sessionId = summaryEntry.session
  const project = summaryEntry.project || 'default'
  log('info', 'Batch distill for session', { session: sessionId, project, tools: summaryEntry.total_calls })

  // Read all entries from the same file to find tool_use entries for this session
  const toolEntries = []
  const toolLines = []
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
    for (const rawLine of lines) {
      try {
        const e = JSON.parse(rawLine)
        if (e.session === sessionId && e.event === 'tool_use' && !e._processed) {
          toolEntries.push(e)
          toolLines.push(rawLine)
        }
      } catch {}
    }
  } catch (err) {
    log('error', 'Failed to read session entries', { error: err.message })
    markProcessed(filePath, summaryLine)
    return
  }

  if (toolEntries.length === 0) {
    log('debug', 'No tool entries for session batch', { session: sessionId })
    markProcessed(filePath, summaryLine)
    return
  }

  // --- Mode switch: managed (cloud) vs local ---
  let batchPatterns = []
  if (QUOTH_MODE === 'managed') {
    batchPatterns = await processSessionManaged(summaryEntry, toolEntries, project)
  } else {
    batchPatterns = await processSessionLocal(summaryEntry, toolEntries)
  }

  log('info', 'Batch distill produced patterns', { count: batchPatterns.length, session: sessionId, mode: QUOTH_MODE })

  // Insert patterns into local DB (same for both modes)
  for (const distilled of batchPatterns) {
    try {
      applyDistilledPattern(distilled, summaryEntry, project)
    } catch (err) {
      log('error', 'Batch pattern consolidation failed', { error: err.message })
    }
  }

  // Mark all session tool entries + summary as processed
  for (const toolLine of toolLines) {
    markProcessed(filePath, toolLine)
  }
  markProcessed(filePath, summaryLine)
}

// --- Managed mode: send sessions to cloud pipeline API ---
async function processSessionManaged(summaryEntry, toolEntries, project) {
  // Get top local patterns for consolidation context
  const topPatterns = db.getTopPatterns(10).map(p => ({
    id: p.id, name: p.name, confidence: p.confidence
  }))

  const session = {
    summary: {
      project,
      outcome: summaryEntry.outcome || 'unknown',
      success_rate: summaryEntry.success_rate || 0,
      total_calls: summaryEntry.total_calls || toolEntries.length,
      user_intents: summaryEntry.user_intents || [],
      task: summaryEntry.task || ''
    },
    tool_entries: toolEntries.slice(-30).map(e => ({
      tool: e.tool || '', task: (e.task || '').slice(0, 200),
      outcome: e.outcome || 'success', llm_reasoning: (e.llm_reasoning || '').slice(0, 150)
    }))
  }

  const result = await callPipelineAPI([session], topPatterns)
  if (!result || !result.patterns) {
    log('warn', 'Managed pipeline returned no results, falling back to local', { project })
    return processSessionLocal(summaryEntry, toolEntries)
  }

  if (result.tokens_used) {
    log('info', 'Cloud pipeline tokens used', { tokens: result.tokens_used, quota: result.quota_remaining })
  }

  // Map cloud response to local pattern format (add local embeddings)
  const { generateEmbeddingBatch } = require('./lib/embed.js')
  const texts = result.patterns.map(p => p.pattern)
  const embeddings = await generateEmbeddingBatch(texts)

  return result.patterns.map((p, i) => ({
    id: p.id,
    pattern: p.pattern,
    tags: p.tags || [],
    applicability: p.applicability || 'broad',
    embedding: embeddings[i],
    source: 'distilled',
    // Cloud already did consolidation
    _action: p.action,
    _targetId: p.targetId
  }))
}

// --- Local mode: original distill + consolidate pipeline ---
async function processSessionLocal(summaryEntry, toolEntries) {
  return distillBatch(summaryEntry, toolEntries)
}

// --- Apply a distilled pattern to local DB (shared by both modes) ---
function applyDistilledPattern(distilled, summaryEntry, project) {
  // If cloud already decided action (managed mode)
  if (distilled._action === 'strengthen' && distilled._targetId) {
    db.applyBayesianUpdate(distilled._targetId, 'success')
    db.emitEvent('pattern.strengthened', summaryEntry.agent || 'daemon', project, {
      patternId: distilled._targetId, update: 'batch-distill'
    })
    log('info', 'Batch: strengthened pattern', { id: distilled._targetId, mode: QUOTH_MODE })
    return
  }

  // For local mode or cloud action='new': run local consolidation
  if (!distilled._action) {
    const similarTags = distilled.tags.length > 0 ? distilled.tags : []
    const similarPatterns = distilled.embedding
      ? db.searchBySimilarity(distilled.embedding, 3, similarTags)
      : db.getTopPatterns(3, similarTags)

    // Local consolidation (requires claude CLI or LLM)
    // In managed mode with action='new', skip consolidation (cloud already decided)
    if (QUOTH_MODE === 'local') {
      consolidate(distilled, similarPatterns).then(consolidation => {
        if (consolidation.action === 'strengthen' && consolidation.targetId) {
          db.applyBayesianUpdate(consolidation.targetId, 'success')
          db.emitEvent('pattern.strengthened', summaryEntry.agent || 'daemon', project, {
            patternId: consolidation.targetId, update: 'batch-distill'
          })
          log('info', 'Batch: strengthened pattern', { id: consolidation.targetId })
          return
        }
        insertNewPattern(distilled, summaryEntry, project)
      }).catch(err => {
        log('error', 'Local consolidation failed, inserting as new', { error: err.message })
        insertNewPattern(distilled, summaryEntry, project)
      })
      return
    }
  }

  // Insert as new pattern (managed mode action='new' or fallback)
  insertNewPattern(distilled, summaryEntry, project)
}

function insertNewPattern(distilled, summaryEntry, project) {
  // Pre-insert dedup
  const dupByName = db.findDuplicateByName(distilled.pattern)
  const dupByEmbed = distilled.embedding
    ? db.findDuplicateByEmbedding(distilled.embedding)
    : null
  const existing = dupByEmbed || dupByName

  if (existing) {
    db.applyBayesianUpdate(existing.id, 'success')
    log('info', 'Batch: deduped → strengthened', { id: existing.id })
  } else {
    db.upsertPattern({
      id: distilled.id,
      name: distilled.pattern.slice(0, 80),
      pattern_type: 'code-pattern',
      condition: `Session batch: ${(summaryEntry.task || '').slice(0, 100)}`,
      action: distilled.pattern,
      confidence: 0.55,
      tags: [...distilled.tags, ...(project !== 'default' ? [`project:${project}`] : []), 'batch-distilled'],
      source: 'distilled',
      embedding: distilled.embedding ? JSON.stringify(distilled.embedding) : undefined
    })
    db.emitEvent('pattern.learned', summaryEntry.agent || 'daemon', project, {
      patternId: distilled.id,
      name: distilled.pattern.slice(0, 80),
      confidence: 0.55,
      source: 'batch-distilled'
    })
    if (project !== 'default') {
      db.setPatternNamespace(distilled.id, project)
    }
    log('info', 'Batch: new pattern', { id: distilled.id, name: distilled.pattern.slice(0, 60) })
  }
}

// --- Mark a line as processed ---
function markProcessed(filePath, originalLine) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const processedLine = originalLine.replace(/\}(\s*)$/, ',"_processed":true}$1')
    fs.writeFileSync(filePath, content.replace(originalLine, processedLine))
  } catch {}
}

// --- Hourly decay timer ---
function startDecayTimer() {
  decayTimer = setInterval(() => {
    try {
      db.applyHourlyDecay()
      db.archiveWeakPatterns()
      const pruned = db.pruneYoungUnused()
      log('info', 'Hourly decay applied', { pruned: pruned || 0 })
    } catch (err) {
      log('error', 'Decay failed', { error: err.message })
    }
  }, 60 * 60 * 1000)
}

// --- Save HNSW index every 30 minutes ---
function startHnswSaveTimer() {
  hnswSaveTimer = setInterval(() => {
    try { db.saveHnsw() } catch {}
  }, 30 * 60 * 1000)
}

// --- Cloud pull every 6 hours ---
let cloudPullTimer = null
function startCloudPullTimer() {
  cloudPullTimer = setInterval(async () => {
    try {
      const { syncFromCloud } = require('./lib/pull.js')
      await syncFromCloud(db, log)
    } catch (err) {
      log('error', 'Cloud pull failed', { error: err.message })
    }
  }, 6 * 60 * 60 * 1000)
}

// --- V2 mini-pipeline every 2 hours (clusters + SNIPS + judge batch) ---
// Complements the nightly 3am run by draining the judge queue frequently.
// Each run: ~30 judges × 15s = ~7.5min of LLM time. 12 runs/day = 360 judges/day.
// Combined with nightly (100/run) → 460 judges/day capacity.
let v2MiniTimer = null
function startV2MiniTimer() {
  v2MiniTimer = setInterval(async () => {
    const flags = require('./lib/flags.js')
    if (!flags.isSubFlag('injection') && !flags.isSubFlag('judge')) return
    try {
      log('info', 'V2 mini-pipeline start')
      if (flags.isSubFlag('injection')) {
        await rebuildClusters()
        await updateClusterPosteriors()
      }
      if (flags.isSubFlag('judge')) {
        const origLimit = process.env.QUOTH_JUDGE_DAILY_LIMIT
        process.env.QUOTH_JUDGE_DAILY_LIMIT = process.env.QUOTH_V2_MINI_JUDGE_LIMIT || '30'
        await enqueueJudgePairs()
        await runJudgeBatch()
        if (origLimit != null) process.env.QUOTH_JUDGE_DAILY_LIMIT = origLimit
        else delete process.env.QUOTH_JUDGE_DAILY_LIMIT
      }
      log('info', 'V2 mini-pipeline done')
    } catch (err) {
      log('error', 'V2 mini-pipeline failed', { error: err.message })
    }
  }, 2 * 60 * 60 * 1000)
}

// --- Nightly pipeline at 3am: deep consolidation → doc auto-update ---
// Also runs at startup if >24h since last execution (daemon restarts kill timers).
function scheduleNightlyPipeline() {
  const now = new Date()
  const next3am = new Date(now)
  next3am.setUTCHours(6, 0, 0, 0) // 06:00 UTC = 03:00 ART (UTC-3)
  if (next3am <= now) next3am.setDate(next3am.getDate() + 1)
  const msUntil = next3am - now

  deepConsolidateTimer = setTimeout(() => {
    runNightlyPipeline().catch(err => log('error', 'runNightlyPipeline failed', { error: err.message }))
    setInterval(() => {
      runNightlyPipeline().catch(err => log('error', 'runNightlyPipeline failed', { error: err.message }))
    }, 24 * 60 * 60 * 1000)
  }, msUntil)

  log('info', `Nightly pipeline (consolidation + doc update) in ${Math.round(msUntil / 60000)}m`)

  // Startup catch-up: if >24h since last nightly execution, run now
  checkStartupCatchup()
}

function checkStartupCatchup() {
  try {
    const logPath = path.join(STATE_DIR, 'doc-update-log.jsonl')
    let lastRunAt = 0
    if (fs.existsSync(logPath)) {
      const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
      // Find last pipeline_start or pipeline_complete event
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const e = JSON.parse(lines[i])
          if (e.event === 'pipeline_start' || e.event === 'pipeline_complete') {
            lastRunAt = new Date(e.ts).getTime()
            break
          }
        } catch {}
      }
    }

    const hoursSinceLastRun = (Date.now() - lastRunAt) / (1000 * 60 * 60)
    if (hoursSinceLastRun > 24) {
      log('info', `Nightly pipeline overdue (${Math.round(hoursSinceLastRun)}h since last run), executing now`)
      // Delay 10s to let daemon fully initialize
      setTimeout(() => {
        runNightlyPipeline().catch(err => log('error', 'Startup catch-up pipeline failed', { error: err.message }))
      }, 10000)
    } else {
      log('info', `Last nightly pipeline ${Math.round(hoursSinceLastRun)}h ago, skipping startup catch-up`)
    }
  } catch (err) {
    log('error', 'Startup catch-up check failed', { error: err.message })
  }
}

async function runNightlyPipeline() {
  const start = Date.now()
  log('info', 'Nightly pipeline started')
  const { appendExecLog } = require('./lib/doc-updater.js')
  appendExecLog(STATE_DIR, { event: 'pipeline_start' })

  // Phase A: Deep consolidation (patterns)
  try {
    await runDeepConsolidate()
  } catch (err) {
    log('error', 'Nightly Phase A (consolidation) failed', { error: err.message, stack: err.stack })
  }

  // Phase B: Doc auto-update (requires claude CLI — skip in managed mode)
  if (QUOTH_MODE === 'managed') {
    log('info', 'Skipping doc auto-update (managed mode — no claude CLI)')
  } else {
    try {
      await runDocUpdate()
    } catch (err) {
      log('error', 'Nightly Phase B (doc update) failed', { error: err.message, stack: err.stack })
    }
  }

  // Phase C: Cloud pull
  try {
    const { syncFromCloud } = require('./lib/pull.js')
    await syncFromCloud(db, log)
  } catch (err) {
    log('error', 'Nightly Phase C (cloud pull) failed', { error: err.message })
  }

  // Phase D: V2 cluster rebuild (feature-flagged)
  if (require('./lib/flags.js').isSubFlag('injection')) {
    try { await rebuildClusters() }
    catch (err) { log('error', 'Nightly Phase D (clusters) failed', { error: err.message }) }
  }

  // Phase E: V2 SNIPS cluster posterior update (feature-flagged)
  if (require('./lib/flags.js').isSubFlag('injection')) {
    try { await updateClusterPosteriors() }
    catch (err) { log('error', 'Nightly Phase E (posteriors) failed', { error: err.message }) }
  }

  // Phase F: V2 LLM-as-Judge pairwise (feature-flagged)
  if (require('./lib/flags.js').isSubFlag('judge')) {
    try {
      await enqueueJudgePairs()
      await runJudgeBatch()
    } catch (err) { log('error', 'Nightly Phase F (judge) failed', { error: err.message }) }
  }

  // Phase G: V2 curation (quality gates, dedup, retirement) — flagged + weekly gate
  if (require('./lib/flags.js').isSubFlag('curation')) {
    try {
      const { backfillDistinctiveness, findNearDuplicates, enqueueDedupPairs, retirePoorPatterns } = require('./lib/curation.js')
      const n = backfillDistinctiveness(db)
      log('info', 'Distinctiveness recomputed', { patterns: n })
      // Weekly: dedup + retirement (Sunday UTC)
      if (new Date().getUTCDay() === 0) {
        const dups = findNearDuplicates(db, 0.92)
        if (dups.length > 0) {
          const enq = enqueueDedupPairs(db, dups)
          log('info', 'Dedup pairs enqueued', { pairs: enq })
        }
        const retired = retirePoorPatterns(db)
        log('info', 'Weekly retirement', { retired })
      }
    } catch (err) { log('error', 'Nightly Phase G (curation) failed', { error: err.message }) }
  }

  const elapsed = Math.round((Date.now() - start) / 1000)
  appendExecLog(STATE_DIR, { event: 'pipeline_complete', elapsed_s: elapsed })
  log('info', `Nightly pipeline complete in ${elapsed}s`)
}

async function enqueueJudgePairs() {
  const { selectUncertainPairs } = require('./lib/judge.js')
  const clusters = db.prepare("SELECT cluster_id, alpha, beta, namespace FROM cluster_stats").all()
  const pairs = selectUncertainPairs(clusters, { maxPairs: 20, widthThreshold: 0.3 })
  let enqueued = 0
  for (const p of pairs) {
    const patA = db.prepare("SELECT id FROM patterns WHERE cluster_id=? AND status='active' ORDER BY confidence DESC LIMIT 1").get(p.a.cluster_id)
    const patB = db.prepare("SELECT id FROM patterns WHERE cluster_id=? AND status='active' ORDER BY confidence DESC LIMIT 1").get(p.b.cluster_id)
    if (!patA || !patB) continue
    db.prepare(`
      INSERT INTO judge_queue (session_id, pattern_a_id, pattern_b_id, trajectory_summary, priority)
      VALUES ('v2-cluster-uncertainty', ?, ?, ?, ?)
    `).run(patA.id, patB.id, `Cluster uncertainty: c${p.a.cluster_id} vs c${p.b.cluster_id}`, 0.7)
    enqueued++
  }
  if (enqueued > 0) log('info', 'Judge pairs enqueued', { enqueued })
}

function mergeLoserIntoWinner(db, winnerId, loserId) {
  // Skip if either pattern is already archived (idempotency)
  const winner = db.prepare("SELECT id, alpha, beta, success_count, failure_count, exposure_count FROM patterns WHERE id=? AND status='active'").get(winnerId)
  const loser = db.prepare("SELECT id, alpha, beta, success_count, failure_count, exposure_count FROM patterns WHERE id=? AND status='active'").get(loserId)
  if (!winner || !loser) return false
  // Transfer stats: sum counts, merge Beta posteriors additively (minus double-counted prior)
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE patterns SET
        alpha = ? + alpha - 1,
        beta = ? + beta - 1,
        success_count = success_count + ?,
        failure_count = failure_count + ?,
        exposure_count = exposure_count + ?,
        updated_at = strftime('%s','now') * 1000
      WHERE id = ?
    `).run(loser.alpha, loser.beta, loser.success_count || 0, loser.failure_count || 0, loser.exposure_count || 0, winnerId)
    db.prepare(`
      UPDATE patterns SET
        status = 'archived',
        retired_at = strftime('%s','now') * 1000,
        retired_reason = 'deduped-merged',
        updated_at = strftime('%s','now') * 1000
      WHERE id = ?
    `).run(loserId)
  })
  tx()
  return true
}

async function runJudgeBatch() {
  const { buildPairwisePrompt, callJudge, parseJudgeVerdict } = require('./lib/judge.js')
  const maxBatch = parseInt(process.env.QUOTH_JUDGE_DAILY_LIMIT || '100', 10)
  const pending = db.prepare(`
    SELECT id, session_id, pattern_a_id, pattern_b_id, trajectory_summary
    FROM judge_queue WHERE status='pending' ORDER BY priority DESC LIMIT ?
  `).all(maxBatch)
  let judged = 0, failed = 0
  for (const item of pending) {
    const a = db.getPattern(item.pattern_a_id)
    const b = db.getPattern(item.pattern_b_id)
    if (!a || !b) {
      db.prepare("UPDATE judge_queue SET status='skipped' WHERE id=?").run(item.id)
      continue
    }
    const { prompt, positionMap } = buildPairwisePrompt(item.trajectory_summary || '', a, b)
    let raw
    try {
      raw = await callJudge(prompt)
    } catch (e) {
      log('error', 'Judge LLM call failed', { itemId: item.id, error: e.message })
      db.prepare("UPDATE judge_queue SET status='failed' WHERE id=?").run(item.id)
      failed++
      continue
    }
    if (!raw) {
      log('warn', 'Judge returned empty response', { itemId: item.id })
      db.prepare("UPDATE judge_queue SET status='failed' WHERE id=?").run(item.id)
      failed++
      continue
    }
    const verdict = parseJudgeVerdict(raw, positionMap)
    db.prepare(`
      UPDATE judge_queue SET status='judged', verdict=?, judged_at=strftime('%s','now')*1000, cost_cents=0.03
      WHERE id=?
    `).run(verdict, item.id)

    const isDedup = item.session_id === 'dedup'
    if (isDedup && (verdict === item.pattern_a_id || verdict === item.pattern_b_id)) {
      // Merge: archive loser, transfer stats to winner (alpha/beta/exposure/success counts)
      const winnerId = verdict
      const loserId = winnerId === item.pattern_a_id ? item.pattern_b_id : item.pattern_a_id
      mergeLoserIntoWinner(db, winnerId, loserId)
    } else if (verdict === item.pattern_a_id) {
      db.prepare('UPDATE patterns SET alpha = alpha + 0.5 WHERE id=?').run(item.pattern_a_id)
      db.prepare('UPDATE patterns SET beta = beta + 0.5 WHERE id=?').run(item.pattern_b_id)
    } else if (verdict === item.pattern_b_id) {
      db.prepare('UPDATE patterns SET alpha = alpha + 0.5 WHERE id=?').run(item.pattern_b_id)
      db.prepare('UPDATE patterns SET beta = beta + 0.5 WHERE id=?').run(item.pattern_a_id)
    }
    judged++
  }
  log('info', 'Judge batch complete', { judged, failed, skipped: pending.length - judged - failed })
}

async function updateClusterPosteriors() {
  const { snipsEstimate } = require('./lib/snips.js')
  const completed = db.prepare(`
    SELECT cluster_id, namespace, reward, propensity FROM injection_log
    WHERE outcome_at IS NOT NULL AND reward IS NOT NULL AND cluster_id IS NOT NULL
      AND injected_at > (strftime('%s','now') - 86400*7) * 1000
  `).all()
  if (completed.length === 0) { log('info', 'SNIPS: no completed observations yet'); return }
  const byCluster = new Map()
  for (const row of completed) {
    const key = `${row.namespace}::${row.cluster_id}`
    if (!byCluster.has(key)) byCluster.set(key, [])
    byCluster.get(key).push({ reward: row.reward, propensity: row.propensity })
  }
  let updated = 0
  const tx = db.transaction(() => {
    for (const [key, obs] of byCluster.entries()) {
      if (obs.length < 3) continue  // need minimum data
      const [ns, cid] = key.split('::')
      const estimate = snipsEstimate(obs)
      // Cap update magnitude: interpret SNIPS estimate as n pseudo-trials.
      const n = Math.min(obs.length, 10)
      db.prepare(`
        UPDATE cluster_stats SET
          alpha = alpha + ?, beta = beta + ?, attempts = attempts + ?,
          updated_at = strftime('%s','now') * 1000
        WHERE cluster_id = ? AND namespace = ?
      `).run(n * estimate, n * (1 - estimate), obs.length, parseInt(cid), ns)
      updated++
    }
  })
  tx()
  log('info', 'Cluster posteriors updated via SNIPS', { clusters: updated, observations: completed.length })
}

async function rebuildClusters() {
  const { clusterPatterns } = require('./lib/clustering.js')
  const namespaces = db.prepare("SELECT DISTINCT namespace FROM patterns WHERE status='active'").all()
  for (const { namespace } of namespaces) {
    const rows = db.prepare(`
      SELECT id, embedding FROM patterns
      WHERE status='active' AND namespace = ? AND embedding IS NOT NULL
    `).all(namespace)
    const patterns = rows.map(p => {
      try { return { id: p.id, embedding: JSON.parse(p.embedding) } } catch { return null }
    }).filter(Boolean)
    if (patterns.length < 10) continue
    const K = Math.min(50, Math.max(3, Math.floor(Math.sqrt(patterns.length))))
    const { clusters, assignments } = clusterPatterns(patterns, K, { maxIter: 30 })
    if (clusters.length === 0) continue
    const tx = db.transaction(() => {
      for (const a of assignments) db.assignPatternCluster(a.patternId, a.cluster)
      for (const c of clusters) db.upsertClusterStats(c.id, namespace, c.centroid, c.memberCount)
    })
    tx()
    log('info', 'Cluster rebuild', { namespace, K, patterns: patterns.length })
  }
}

async function runDeepConsolidate() {
  log('info', 'Starting deep consolidation')
  try {
    // Phase 0: Archive garbage patterns (raw tool calls as names)
    const garbageArchived = db.prepare(`
      UPDATE patterns SET status = 'archived', updated_at = strftime('%s','now') * 1000
      WHERE status = 'active'
        AND (name LIKE 'claude-code: Bash %' OR name LIKE 'claude-code: Write /%' OR name LIKE 'claude-code: Edit /%'
             OR name LIKE 'claude-code: Read /%' OR name LIKE 'claude-code: Glob %' OR name LIKE 'claude-code: Grep %')
        AND confidence <= 0.5
        AND (success_count + failure_count) < 3
    `).run()
    if (garbageArchived.changes > 0) {
      log('info', 'Archived garbage patterns', { count: garbageArchived.changes })
    }

    // Phase 1: Name-based dedup — group by normalized name prefix
    const allActive = db.prepare(`
      SELECT id, name, confidence, alpha, beta FROM patterns WHERE status = 'active' ORDER BY confidence DESC
    `).all()
    let dedupCount = 0
    const seen = new Map() // normalized prefix → best pattern id
    for (const p of allActive) {
      const norm = (p.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 50)
      if (norm.length < 10) continue
      if (seen.has(norm)) {
        // Keep the one with higher confidence, archive this one
        db.applyBayesianUpdate(seen.get(norm), 'success')
        db.prepare("UPDATE patterns SET status='archived' WHERE id=?").run(p.id)
        dedupCount++
      } else {
        seen.set(norm, p.id)
      }
    }
    if (dedupCount > 0) log('info', 'Name-based dedup', { archived: dedupCount })

    // Phase 2: LLM review of top patterns — line-based approach, no JSON parsing
    const patterns = db.getTopPatterns(20)
    if (patterns.length === 0) {
      log('info', 'Deep consolidation done (no patterns to review)', { garbageArchived: garbageArchived.changes, nameDedups: dedupCount })
      return
    }

    const patternList = patterns.map(p => `${p.id} "${p.name}" (conf=${p.confidence.toFixed(2)}) → ${(p.action || '').slice(0, 80)}`).join('\n')
    const prompt = `You are reviewing a pattern library for duplicates and low-value entries.

${patternList}

For each action, write ONE line using bare IDs (no brackets). Only output lines that need action:
MERGE keep_id archive_id1 archive_id2 — reason (first ID is kept, rest archived)
ARCHIVE id — reason

If nothing needs action, write: NONE`

    const { execSync } = require('child_process')
    const raw = execSync(
      'claude -p --model claude-haiku-4-5-20251001 --output-format text --allowedTools ""',
      { input: prompt, encoding: 'utf8', timeout: 60000, maxBuffer: 512 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    log('debug', 'LLM consolidation response', { response: raw.slice(0, 500) })

    let llmMerged = 0, llmArchived = 0
    // Extract bare hex IDs — strip optional brackets/quotes
    const extractIds = (str) => [...str.matchAll(/\[?([a-f0-9]{12})\]?/g)].map(m => m[1])

    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('MERGE')) {
        const ids = extractIds(trimmed)
        if (ids.length < 2) continue
        const keepId = ids[0]
        const keep = db.prepare("SELECT id FROM patterns WHERE id=? AND status='active'").get(keepId)
        if (!keep) continue
        // Merge all subsequent IDs into the first (pairwise)
        for (let i = 1; i < ids.length; i++) {
          const archive = db.prepare("SELECT id FROM patterns WHERE id=? AND status='active'").get(ids[i])
          if (archive) {
            db.applyBayesianUpdate(keepId, 'success')
            db.prepare("UPDATE patterns SET status='archived' WHERE id=?").run(ids[i])
            llmMerged++
            log('debug', 'Merged pattern', { keep: keepId, archived: ids[i] })
          }
        }
        continue
      }
      if (trimmed.startsWith('ARCHIVE')) {
        const ids = extractIds(trimmed)
        for (const id of ids) {
          const exists = db.prepare("SELECT id FROM patterns WHERE id=? AND status='active'").get(id)
          if (exists) {
            db.prepare("UPDATE patterns SET status='archived' WHERE id=?").run(id)
            llmArchived++
            log('debug', 'Archived pattern', { id })
          }
        }
      }
    }
    log('info', 'Deep consolidation done', { garbageArchived: garbageArchived.changes, nameDedups: dedupCount, llmMerged, llmArchived })

    // Phase 2.5: Conversion-rate rebalancing
    try {
      // Penalize patterns shown a lot but rarely used
      const penalized = db.prepare(`
        UPDATE patterns
        SET beta = beta + 2,
            confidence = alpha / NULLIF(alpha + beta + 2, 0)
        WHERE status = 'active'
          AND exposure_count > 20
          AND (success_count * 1.0 / NULLIF(exposure_count, 0)) < 0.05
      `).run()

      // Boost patterns with high conversion
      const boosted = db.prepare(`
        UPDATE patterns
        SET alpha = alpha + 1,
            confidence = (alpha + 1) / NULLIF(alpha + 1 + beta, 0)
        WHERE status = 'active'
          AND exposure_count > 5
          AND (success_count * 1.0 / NULLIF(exposure_count, 0)) > 0.5
      `).run()

      log('info', 'Conversion rebalancing', { penalized: penalized.changes, boosted: boosted.changes })
    } catch (err) {
      log('error', 'Rebalancing failed', { error: err.message })
    }

    // Phase 2.6: Capacity pruning (when > 1000 patterns)
    try {
      const candidates = db.prepare(`
        SELECT id, success_count, failure_count
        FROM patterns WHERE status = 'active'
      `).all()
      if (candidates.length > 1000) {
        const scored = candidates.map(p => {
          const total = p.success_count + p.failure_count
          const rate = total > 0 ? p.success_count / total : 0
          return { id: p.id, score: rate * Math.log(1 + total) }
        }).sort((a, b) => a.score - b.score)
        const toArchive = scored.slice(0, candidates.length - 900).map(p => p.id)
        const stmt = db.prepare("UPDATE patterns SET status='archived' WHERE id=?")
        const tx = db.transaction((ids) => { for (const id of ids) stmt.run(id) })
        tx(toArchive)
        log('info', 'Capacity pruning', { pruned: toArchive.length, remaining: candidates.length - toArchive.length })
      }
    } catch (err) {
      log('error', 'Pruning failed', { error: err.message })
    }

    // Promote high-confidence patterns to Quoth cloud
    try {
      const candidates = db.getPromotionCandidates()
      log('info', `Found ${candidates.length} promotion candidates`)

      for (const pattern of candidates) {
        const needsPromotion = !pattern.promoted_at ||
          (pattern.confidence - (pattern.promoted_confidence || 0)) > 0.1
        if (!needsPromotion) continue

        const promoteResult = await promotePattern(pattern)
        if (promoteResult) {
          db.markPromoted(pattern.id, promoteResult.documentId, pattern.confidence)
          db.emitEvent('pattern.promoted', 'daemon', null, {
            patternId: pattern.id,
            documentId: promoteResult.documentId,
            confidence: pattern.confidence
          })
          log('info', 'Pattern promoted to cloud', {
            id: pattern.id,
            documentId: promoteResult.documentId,
            version: promoteResult.version,
            status: promoteResult.status
          })
        }
      }
    } catch (err) {
      log('error', 'Promotion phase failed', { error: err.message })
    }

    // Auto-promote broad patterns to global namespace
    try {
      const globalCandidates = db.prepare(`
        SELECT * FROM patterns
        WHERE status = 'active' AND namespace != 'global'
          AND confidence > 0.8 AND (success_count + failure_count) > 10
          AND applicability = 'broad'
      `).all()
      for (const p of globalCandidates) {
        db.promoteToGlobal(p.id)
        log('info', 'Pattern promoted to global', { id: p.id, from: p.namespace })
      }
      if (globalCandidates.length > 0) {
        log('info', `Promoted ${globalCandidates.length} patterns to global namespace`)
      }
    } catch (err) {
      log('error', 'Global promotion failed', { error: err.message })
    }

    // Exolar cross-validation placeholder
    // Full cross-validation requires MCP context (daemon runs outside Claude Code).
    // The actual validation happens when triqual_load_context runs and compares
    // Exolar failure rates against pattern confidence.
    // Future: daemon HTTP calls to Exolar API directly.
    try {
      const candidates = db.getPromotionCandidates()
      log('info', `Exolar cross-validation: ${candidates.length} patterns eligible for validation`)
    } catch (err) {
      log('debug', 'Exolar cross-validation skipped', { error: err.message })
    }
  } catch (err) {
    log('error', 'Deep consolidation failed', { error: err.message })
  }
}

let staleSessionTimer = null
function clearTimers() {
  if (decayTimer) clearInterval(decayTimer)
  if (deepConsolidateTimer) clearTimeout(deepConsolidateTimer)
  if (hnswSaveTimer) clearInterval(hnswSaveTimer)
  if (cloudPullTimer) clearInterval(cloudPullTimer)
  if (v2MiniTimer) clearInterval(v2MiniTimer)
  if (agentCleanupTimer) clearInterval(agentCleanupTimer)
  if (staleSessionTimer) clearInterval(staleSessionTimer)
}

// --- Doc auto-update (called as Phase B of nightly pipeline) ---
async function runDocUpdate() {
  const { appendExecLog } = require('./lib/doc-updater.js')
  log('info', 'Starting doc auto-update scan')
  appendExecLog(STATE_DIR, { event: 'doc_scan_start' })

  // Check if docs/project/ exists in this project
  const docsDir = path.join(PROJECT_ROOT, 'docs', 'project')
  if (!fs.existsSync(docsDir)) {
    log('debug', 'No docs/project/ found, skipping doc update')
    appendExecLog(STATE_DIR, { event: 'doc_scan_skip', reason: 'no docs/project/ dir' })
    return
  }

  // Scan for stale docs using content hashes
  const { staleDocs } = scanDocs(PROJECT_ROOT, STATE_DIR)

  if (staleDocs.length === 0) {
    log('info', 'All docs up to date')
    appendExecLog(STATE_DIR, { event: 'doc_scan_complete', stale: 0 })
    return
  }

  log('info', `Found ${staleDocs.length} stale doc(s)`, {
    docs: staleDocs.map(d => `${d.doc} (${d.changedFiles.length} changes)`)
  })
  appendExecLog(STATE_DIR, {
    event: 'doc_scan_complete', stale: staleDocs.length,
    docs: staleDocs.map(d => d.doc),
  })

  // Spawn doc update as a separate process so claude -p doesn't kill the daemon.
  // Concurrency of 3 to balance speed vs resource usage.
  const { spawn } = require('child_process')
  const script = `
    const path = require('path'), os = require('os'), fs = require('fs')
    const { scanDocs } = require('./quoth-plugin/daemon/lib/doc-manifest.js')
    const { updateDoc, commitAndPush, appendExecLog } = require('./quoth-plugin/daemon/lib/doc-updater.js')
    const P = ${JSON.stringify(PROJECT_ROOT)}, S = ${JSON.stringify(STATE_DIR)}
    const CONCURRENCY = 3
    const log = (l, m, d) => console.error(JSON.stringify({ ts: new Date().toISOString(), level: l, msg: m, data: d }))
    async function run() {
      const { staleDocs } = scanDocs(P, S)
      const updates = [], failures = []
      for (let i = 0; i < staleDocs.length; i += CONCURRENCY) {
        const batch = staleDocs.slice(i, i + CONCURRENCY)
        log('info', 'Batch ' + (Math.floor(i/CONCURRENCY)+1), { docs: batch.map(d => d.doc) })
        const results = await Promise.allSettled(batch.map(s => updateDoc(P, S, s, log)))
        for (let j = 0; j < results.length; j++) {
          const r = results[j]
          if (r.status === 'fulfilled' && r.value) updates.push(r.value)
          else failures.push(batch[j].doc)
        }
      }
      if (updates.length > 0) commitAndPush(P, updates, log)
      appendExecLog(S, { event: 'doc_update_batch_complete', updated: updates.length, failed: failures.length, failures: failures.length > 0 ? failures : undefined })
      log('info', 'Done', { updated: updates.length, failed: failures.length })
    }
    run().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
  `
  const child = spawn('node', ['-e', script], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  })
  child.stderr.on('data', (d) => {
    try { const e = JSON.parse(d.toString().trim()); log(e.level, `[doc-update] ${e.msg}`, e.data) }
    catch { log('debug', `[doc-update] ${d.toString().trim()}`) }
  })
  child.unref() // Don't wait for it — daemon continues running
  log('info', 'Doc update spawned as separate process', { pid: child.pid, docs: staleDocs.length })
  // Note: updates/failures are tracked inside the child process, not here.
  // The child writes its own appendExecLog when done.
}

// --- Stale agent cleanup every 5 minutes ---
function startAgentCleanupTimer() {
  agentCleanupTimer = setInterval(() => {
    try {
      db.cleanupStaleAgents(300000) // 5 min timeout
    } catch (err) {
      log('error', 'Agent cleanup failed', { error: err.message })
    }
  }, 5 * 60 * 1000)
}

// --- Stale session detector: generates synthetic summaries for orphaned sessions ---
function startStaleSessionTimer() {
  staleSessionTimer = setInterval(() => {
    try {
      detectStaleSessions()
    } catch (err) {
      log('error', 'Stale session detection failed', { error: err.message })
    }
  }, 10 * 60 * 1000) // Every 10 minutes
}

function detectStaleSessions() {
  const STALE_THRESHOLD = 30 * 60 * 1000 // 30 minutes
  const now = Date.now()

  try {
    const files = fs.readdirSync(TRAJECTORIES_DIR).filter(f => f.endsWith('.jsonl'))
    for (const file of files) {
      const filePath = path.join(TRAJECTORIES_DIR, file)
      const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)

      // Group unprocessed tool_use entries by session
      const sessions = new Map() // sessionId → { entries, latestTimestamp }
      const hasSummary = new Set() // sessions that already have a summary

      for (const rawLine of lines) {
        try {
          const e = JSON.parse(rawLine)
          if (e._processed) continue
          if (e.event === 'session_summary') {
            hasSummary.add(e.session)
            continue
          }
          if (e.event === 'tool_use' && e.session) {
            if (!sessions.has(e.session)) {
              sessions.set(e.session, { entries: [], latest: 0 })
            }
            const s = sessions.get(e.session)
            s.entries.push(e)
            s.latest = Math.max(s.latest, e.timestamp || 0)
          }
        } catch {}
      }

      // Find orphaned sessions: tool_use entries without summary, idle > 30 min
      for (const [sessionId, { entries, latest }] of sessions) {
        if (hasSummary.has(sessionId)) continue
        if (entries.length < 3) continue // Skip tiny sessions
        if ((now - latest) < STALE_THRESHOLD) continue // Still active

        log('info', 'Detected stale session, generating synthetic summary', {
          session: sessionId, entries: entries.length, idleMin: Math.round((now - latest) / 60000)
        })

        // Build synthetic session_summary
        const toolCounts = {}
        const intents = new Set()
        const reasonings = []
        let successes = 0, failures = 0
        const project = entries[0].project || 'default'

        for (const e of entries) {
          toolCounts[e.tool] = (toolCounts[e.tool] || 0) + 1
          if (e.outcome === 'success') successes++
          else failures++
          if (e.user_intent) intents.add(e.user_intent)
          if (e.llm_reasoning) reasonings.push(e.llm_reasoning)
        }

        const toolSummary = Object.entries(toolCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([tool, count]) => `${tool}:${count}`)
          .join(', ')

        const summary = {
          event: 'session_summary',
          agent: 'claude-code',
          project,
          session: sessionId,
          task: `Session (synthetic): ${entries.length} tool calls (${toolSummary}). ${successes} ok, ${failures} fail.`,
          tool_counts: toolCounts,
          total_calls: entries.length,
          success_rate: entries.length > 0 ? successes / entries.length : 0,
          user_intents: [...intents].slice(0, 5),
          llm_reasonings: [...new Set(reasonings)].slice(-10),
          outcome: failures === 0 ? 'success' : (successes > failures ? 'partial' : 'failure'),
          source: 'stale-session-detector',
          timestamp: now
        }

        fs.appendFileSync(filePath, JSON.stringify(summary) + '\n')
      }
    }
  } catch (err) {
    log('error', 'detectStaleSessions scan failed', { error: err.message })
  }
}

// --- Start ---
log('info', 'Quoth daemon started', { pid: process.pid, home: QUOTH_HOME })
watchTrajectories()
startDecayTimer()
startHnswSaveTimer()
startCloudPullTimer()
startV2MiniTimer()
startAgentCleanupTimer()
startStaleSessionTimer()
scheduleNightlyPipeline()
scanAndEnqueue()
processQueue()

// --- Index doc chunks at startup (async, non-blocking) ---
;(async () => {
  try {
    const { indexDocs } = require('./lib/doc-chunks.js')
    const result = await indexDocs(PROJECT_ROOT, db, log)
    if (result.indexed > 0) log('info', 'Doc chunk indexing complete', result)
  } catch (err) {
    log('error', 'Doc chunk indexing failed', { error: err.message })
  }
})()
