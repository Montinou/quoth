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
const { extract, QUALITY_PRIORS } = require('./pipeline/extract.js')
const { promotePattern } = require('./lib/promote.js')
const { callPipelineAPI } = require('./lib/pipeline-api.js')
const { callDocUpdateAPI } = require('./lib/doc-update-api.js')
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

const DAILY_EXTRACT_CAP = parseInt(process.env.QUOTH_DAILY_EXTRACT_CAP || process.env.QUOTH_DAILY_DISTILL_CAP || '50', 10)
let dailyExtractCount = 0
let dailyExtractDate = new Date().toISOString().slice(0, 10)

// --- Logging ---
function log(level, msg, data) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(data && { data }) }) + '\n'
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
  if (process.env.QUOTH_DEBUG) process.stderr.write(line)
}

// --- PID management (single-instance guard) ---
const SOCK_PATH = path.join(QUOTH_HOME, 'daemon.sock')
if (fs.existsSync(PID_FILE)) {
  try {
    const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim())
    if (existingPid !== process.pid) {
      try {
        process.kill(existingPid, 0) // throws if process doesn't exist
        // Process is alive — exit to avoid duplicates
        log('info', 'Another daemon already running', { existingPid })
        process.exit(0)
      } catch {
        // Process is dead — clean up stale files
        log('info', 'Cleaned stale daemon', { stalePid: existingPid })
        try { fs.unlinkSync(PID_FILE) } catch {}
        try { fs.unlinkSync(SOCK_PATH) } catch {}
      }
    }
  } catch {
    // Malformed PID file — remove it
    try { fs.unlinkSync(PID_FILE) } catch {}
  }
}
fs.writeFileSync(PID_FILE, String(process.pid))
process.on('exit', () => {
  try { fs.unlinkSync(PID_FILE) } catch {}
  try { fs.unlinkSync(LOCK_FILE) } catch {}
  try { fs.unlinkSync(SOCK_PATH) } catch {}
})
// Clean stale lock from previous crash
if (fs.existsSync(LOCK_FILE)) {
  try {
    const lockPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim())
    try { process.kill(lockPid, 0) } catch { fs.unlinkSync(LOCK_FILE); log('info', 'Cleaned stale lock', { stalePid: lockPid }) }
  } catch { try { fs.unlinkSync(LOCK_FILE) } catch {} }
}

// --- Signal handlers ---
let queryServer = null
process.on('SIGTERM', () => {
  log('info', 'SIGTERM received, shutting down')
  clearTimers()
  if (queryServer) queryServer.stop()
  db.close()
  process.exit(0)
})

process.on('SIGUSR1', async () => {
  log('info', 'SIGUSR1: flush triggered')
  scanProcessingDir()
})

process.on('SIGUSR2', async () => {
  log('info', 'SIGUSR2 received — re-indexing doc chunks')
  try {
    const { indexDocs } = require('./lib/doc-chunks.js')
    const result = await indexDocs(PROJECT_ROOT, db, log)
    log('info', 'Doc chunks re-indexed (SIGUSR2)', result)
  } catch (err) {
    log('error', 'Doc chunk re-index failed', { error: err.message })
  }
})

// --- Self-heal ---
process.on('uncaughtException', (err) => {
  log('error', 'uncaughtException', { message: err.message, stack: err.stack })
  // Continue running — don't crash on pipeline errors
})

// --- File watcher ---
function watchTrajectories() {
  const processingDir = path.join(TRAJECTORIES_DIR, 'processing')
  fs.mkdirSync(processingDir, { recursive: true })

  log('info', 'Watching trajectories/processing/ for session handoffs', { dir: processingDir })
  try {
    fs.watch(processingDir, { persistent: true }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.jsonl')) return
      const fullPath = path.join(processingDir, filename)
      setTimeout(() => { enqueueSessionFile(fullPath) }, 50)
    })
  } catch (err) {
    log('error', 'fs.watch on processing/ failed', { error: err.message })
  }

  scanProcessingDir()
}

function scanProcessingDir() {
  const processingDir = path.join(TRAJECTORIES_DIR, 'processing')
  try {
    const files = fs.readdirSync(processingDir).filter(f => f.endsWith('.jsonl'))
    for (const f of files) enqueueSessionFile(path.join(processingDir, f))
  } catch (err) {
    log('error', 'initial scan of processing/ failed', { error: err.message })
  }
}

const _sessionQueue = []
let _workerBusy = false

function enqueueSessionFile(fullPath) {
  if (_sessionQueue.includes(fullPath)) return
  if (!fs.existsSync(fullPath)) return
  _sessionQueue.push(fullPath)
  runWorker()
}

async function runWorker() {
  if (_workerBusy) return
  _workerBusy = true
  // Attach insertNewPattern onto db so daemon-core can call it via the db param.
  // The module-level insertNewPattern function closes over module-level db + log.
  if (!db.insertNewPattern) db.insertNewPattern = insertNewPattern
  try {
    while (_sessionQueue.length > 0) {
      const file = _sessionQueue.shift()
      if (!fs.existsSync(file)) continue
      const { processSessionFile } = require('./daemon-core.js')
      const { extract } = require('./pipeline/extract.js')
      try {
        await processSessionFile({
          sessionFile: file,
          db,
          extractFn: (summary, toolEntries, db) => extract(summary, toolEntries, db),
          log,
        })
      } catch (err) {
        log('error', 'worker unexpected', { file, error: err.message })
      }
    }
  } finally {
    _workerBusy = false
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
    // Only process session_summary entries (EXTRACT pipeline).
    // Individual tool_use entries are consumed as context by EXTRACT
    // when the session_summary arrives.
    if (entry.event === 'session_summary') {
      await processSessionBatch(entry, filePath, line)
      return
    }

    // Don't mark tool_use — processSessionBatch() reads unprocessed
    // tool_use entries from the file when session_summary arrives.
    if (entry.event !== 'tool_use') {
      markProcessed(filePath, line)
    }
  } catch (err) {
    log('error', 'processEntry failed', { error: err.message })
  }
}

// DEPRECATED: removed in Task 17
async function processSessionBatch(summaryEntry, filePath, summaryLine) {
  const sessionId = summaryEntry.session
  const project = summaryEntry.project || 'default'
  log('info', 'EXTRACT for session', { session: sessionId, project, tools: summaryEntry.total_calls })

  // Read all tool_use entries from file for this session
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
    log('debug', 'No tool entries for session', { session: sessionId })
    markProcessed(filePath, summaryLine)
    return
  }

  // Daily cap check
  const today = new Date().toISOString().slice(0, 10)
  if (today !== dailyExtractDate) { dailyExtractCount = 0; dailyExtractDate = today }
  if (dailyExtractCount >= DAILY_EXTRACT_CAP) {
    log('info', 'Daily extract cap reached', { count: dailyExtractCount, cap: DAILY_EXTRACT_CAP })
    markProcessed(filePath, summaryLine)
    return
  }
  dailyExtractCount++

  // Mode switch: managed (cloud) vs local
  let extractedPatterns = []
  if (QUOTH_MODE === 'managed') {
    extractedPatterns = await processSessionManaged(summaryEntry, toolEntries, project)
  } else {
    extractedPatterns = await processSessionLocal(summaryEntry, toolEntries)
  }

  log('info', 'EXTRACT produced patterns', { count: extractedPatterns.length, session: sessionId, mode: QUOTH_MODE })

  // Insert patterns into local DB
  for (const pattern of extractedPatterns) {
    try {
      insertNewPattern(pattern, summaryEntry, project)
    } catch (err) {
      log('error', 'Pattern insertion failed', { error: err.message })
    }
  }

  // Mark all entries as processed
  for (const toolLine of toolLines) markProcessed(filePath, toolLine)
  markProcessed(filePath, summaryLine)
}

// --- Managed mode: send sessions to cloud pipeline API ---
// DEPRECATED: removed in Task 17
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

// DEPRECATED: removed in Task 17
async function processSessionLocal(summaryEntry, toolEntries) {
  const result = await extract(summaryEntry, toolEntries, db)
  // Back-compat shim: older callers expect an array of patterns.
  // Task 8 will consume the full { patterns, facts } object.
  if (Array.isArray(result)) return result
  if (result && Array.isArray(result.patterns)) return result.patterns
  return []
}

function insertNewPattern(distilled, summaryEntry, project) {
  // Pre-insert dedup check
  const dupByName = db.findDuplicateByName(distilled.action)
  const dupByEmbed = distilled.embedding
    ? db.findDuplicateByEmbedding(distilled.embedding)
    : null
  const existing = dupByEmbed || dupByName

  if (existing) {
    db.applyBayesianUpdate(existing.id, 'success')
    log('info', 'EXTRACT: deduped -> strengthened', { id: existing.id })
    return
  }

  // Quality signal -> initial alpha/beta
  const priors = QUALITY_PRIORS[distilled.quality_signal] || QUALITY_PRIORS.project
  const confidence = priors.alpha / (priors.alpha + priors.beta)

  db.upsertPattern({
    id: distilled.id,
    name: distilled.action.slice(0, 200),
    pattern_type: 'code-pattern',
    condition: distilled.condition,
    action: distilled.action,
    description: distilled.condition,
    confidence,
    tags: [
      ...(distilled.tags || []),
      ...(project !== 'default' ? [`project:${project}`] : []),
      'extracted',
    ],
    source: 'distilled',
    embedding: distilled.embedding ? JSON.stringify(distilled.embedding) : undefined,
  })

  // Set alpha/beta and format_version directly (not in upsertPattern's schema)
  db.prepare('UPDATE patterns SET alpha = ?, beta = ?, format_version = 2 WHERE id = ?')
    .run(priors.alpha, priors.beta, distilled.id)

  db.emitEvent('pattern.learned', summaryEntry.agent || 'daemon', project, {
    patternId: distilled.id,
    name: distilled.action.slice(0, 80),
    confidence,
    quality: distilled.quality_signal,
    source: 'extracted',
  })

  if (project !== 'default') {
    db.setPatternNamespace(distilled.id, project)
  }

  log('info', 'EXTRACT: new pattern', {
    id: distilled.id,
    quality: distilled.quality_signal,
    confidence: confidence.toFixed(2),
  })
}

// --- Mark a line as processed ---
// DEPRECATED: removed in Task 17
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

  // Phase B: Doc auto-update — DISABLED (replaced by Claude Code scheduled trigger)
  // Remote agent `quoth-doc-autoupdate` runs daily at 09:00 UTC via claude.ai/code/scheduled
  log('info', 'Phase B skipped (doc updates handled by scheduled remote agent)')

  // Phase C: Cloud pull
  try {
    const { syncFromCloud, pullSharedPatterns } = require('./lib/pull.js')
    await syncFromCloud(db, log)
    // Also pull shared cross-org patterns
    const sharedCount = await pullSharedPatterns(db, log)
    if (sharedCount > 0) log('info', `Pulled ${sharedCount} shared patterns from cross-org pool`)
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

  // Phase H: Outcome maintenance (pruning + dedup + tag enrichment)
  try {
    // H1: Prune stale outcomes (max 20 per pattern)
    const patternsWithOutcomes = db.prepare(`
      SELECT DISTINCT pattern_id FROM pattern_outcomes
    `).all()
    let pruned = 0
    for (const { pattern_id } of patternsWithOutcomes) {
      pruned += db.pruneOutcomes(pattern_id, 20)
    }
    if (pruned > 0) log('info', 'Outcome pruning', { pruned })

    // H2: Deduplicate outcomes (same pattern + similar intention + same result)
    let dedupCount = 0
    for (const { pattern_id } of patternsWithOutcomes) {
      const outcomes = db.getOutcomesForPattern(pattern_id, 50)
      const toDelete = new Set()
      for (let i = 0; i < outcomes.length; i++) {
        if (toDelete.has(outcomes[i].id)) continue
        if (!outcomes[i].intention_embedding) continue
        const vecA = JSON.parse(outcomes[i].intention_embedding)
        for (let j = i + 1; j < outcomes.length; j++) {
          if (toDelete.has(outcomes[j].id)) continue
          if (outcomes[j].outcome !== outcomes[i].outcome) continue
          if (!outcomes[j].intention_embedding) continue
          try {
            const vecB = JSON.parse(outcomes[j].intention_embedding)
            let dot = 0, magA = 0, magB = 0
            for (let k = 0; k < vecA.length; k++) {
              dot += vecA[k] * vecB[k]; magA += vecA[k] * vecA[k]; magB += vecB[k] * vecB[k]
            }
            const sim = dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1)
            if (sim > 0.92) toDelete.add(outcomes[j].id)
          } catch {}
        }
      }
      if (toDelete.size > 0) {
        const ids = [...toDelete]
        const placeholders = ids.map(() => '?').join(',')
        db.prepare(`DELETE FROM pattern_outcomes WHERE id IN (${placeholders})`).run(...ids)
        dedupCount += ids.length
      }
    }
    if (dedupCount > 0) log('info', 'Outcome dedup', { deleted: dedupCount })

    // H3: Tag enrichment — for patterns with >= 5 outcomes, add domain tags from successful outcomes
    const enrichCandidates = db.prepare(`
      SELECT pattern_id, COUNT(*) as total,
             SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as successes
      FROM pattern_outcomes
      GROUP BY pattern_id
      HAVING total >= 5
    `).all()

    let enriched = 0
    for (const { pattern_id, successes } of enrichCandidates) {
      if (successes < 3) continue
      const pattern = db.getPattern(pattern_id)
      if (!pattern) continue

      const successOutcomes = db.prepare(`
        SELECT session_context FROM pattern_outcomes
        WHERE pattern_id = ? AND outcome = 'success' AND session_context IS NOT NULL
      `).all(pattern_id)

      const agentTypes = new Map()
      for (const o of successOutcomes) {
        try {
          const ctx = JSON.parse(o.session_context)
          if (ctx.agent_type) agentTypes.set(ctx.agent_type, (agentTypes.get(ctx.agent_type) || 0) + 1)
        } catch {}
      }

      const currentTags = pattern.tags || []
      let tagsChanged = false
      for (const [agentType, count] of agentTypes) {
        if (count >= 3 && !currentTags.includes(`agent:${agentType}`)) {
          currentTags.push(`agent:${agentType}`)
          tagsChanged = true
        }
      }

      if (tagsChanged) {
        db.prepare('UPDATE patterns SET tags = ? WHERE id = ?').run(JSON.stringify(currentTags), pattern_id)
        enriched++
      }
    }
    if (enriched > 0) log('info', 'Tag enrichment from outcomes', { enriched })

    // H4: Flag old unresolved pipeline errors
    const oldErrors = db.prepare(`
      SELECT stage, error_message, COUNT(*) as c
      FROM pipeline_errors
      WHERE created_at < (strftime('%s','now') - 604800) * 1000
      GROUP BY stage, substr(error_message, 1, 50)
      HAVING c >= 3
    `).all()
    if (oldErrors.length > 0) {
      log('warn', 'Recurring pipeline errors (>7 days)', {
        errors: oldErrors.map(e => `${e.stage}: "${e.error_message.slice(0, 50)}" (${e.c}x)`),
      })
    }
  } catch (err) {
    log('error', 'Nightly Phase H (outcomes) failed', { error: err.message })
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
    // Transfer contextual outcomes from loser to winner
    try {
      db.prepare('UPDATE pattern_outcomes SET pattern_id = ? WHERE pattern_id = ?')
        .run(winnerId, loserId)
    } catch {}
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
      if (obs.length === 0) continue
      const [ns, cid] = key.split('::')
      const estimate = snipsEstimate(obs)
      // Cap update magnitude: fewer pseudo-trials for cold clusters to avoid wild swings
      const { effectiveSampleSize } = require('./lib/snips.js')
      const ess = effectiveSampleSize(obs)
      const n = Math.min(ess, obs.length, obs.length < 3 ? 2 : 10)
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

  // Seed synthetic doc cluster for doc_chunks (cluster_id = -1)
  try {
    const docCount = db.prepare("SELECT COUNT(*) as c FROM doc_chunks WHERE embedding IS NOT NULL").get().c
    if (docCount > 0) {
      db.upsertClusterStats(-1, 'docs', null, docCount)
    }
  } catch {}
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

    // Phase 2.6: Capacity pruning (when > 600 patterns)
    // Lower cap keeps injection signal-to-noise high (top 3-7 from 600 >> top 3-7 from 1000)
    try {
      const candidates = db.prepare(`
        SELECT id, success_count, failure_count
        FROM patterns WHERE status = 'active'
      `).all()
      if (candidates.length > 600) {
        const scored = candidates.map(p => {
          const total = p.success_count + p.failure_count
          const rate = total > 0 ? p.success_count / total : 0
          return { id: p.id, score: rate * Math.log(1 + total) }
        }).sort((a, b) => a.score - b.score)
        const toArchive = scored.slice(0, candidates.length - 500).map(p => p.id)
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

// --- Doc auto-update via cloud API (managed mode, Phase B of nightly pipeline) ---
async function runDocUpdateManaged() {
  const { appendExecLog, commitAndPush: commitAndPushDocs } = require('./lib/doc-updater.js')
  const { recordUpdate, bumpPatch } = require('./lib/doc-manifest.js')
  log('info', 'Starting managed doc auto-update scan')
  appendExecLog(STATE_DIR, { event: 'doc_scan_start', mode: 'managed' })

  const docsDir = path.join(PROJECT_ROOT, 'docs', 'project')
  if (!fs.existsSync(docsDir)) {
    log('debug', 'No docs/project/ found, skipping managed doc update')
    appendExecLog(STATE_DIR, { event: 'doc_scan_skip', reason: 'no docs/project/ dir', mode: 'managed' })
    return
  }

  const { staleDocs } = scanDocs(PROJECT_ROOT, STATE_DIR)

  if (staleDocs.length === 0) {
    log('info', 'All docs up to date (managed)')
    appendExecLog(STATE_DIR, { event: 'doc_scan_complete', stale: 0, mode: 'managed' })
    return
  }

  log('info', `Found ${staleDocs.length} stale doc(s) for managed update`, {
    docs: staleDocs.map(d => `${d.doc} (${d.changedFiles.length} changes)`)
  })
  appendExecLog(STATE_DIR, {
    event: 'doc_scan_complete', stale: staleDocs.length, mode: 'managed',
    docs: staleDocs.map(d => d.doc),
  })

  // Derive project name from git remote or directory name
  let project = path.basename(PROJECT_ROOT)
  try {
    const { execSync } = require('child_process')
    const remote = execSync('git remote get-url origin', {
      cwd: PROJECT_ROOT, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe']
    }).toString().trim()
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/)
    if (match) project = match[1]
  } catch {}

  const updates = []
  const failures = []

  // Sequential — one API call at a time
  for (const staleInfo of staleDocs) {
    const docPath = path.join(docsDir, staleInfo.doc)
    let docContent
    try { docContent = fs.readFileSync(docPath, 'utf8') } catch (err) {
      log('error', 'Failed to read doc', { doc: staleInfo.doc, error: err.message })
      failures.push(staleInfo.doc)
      continue
    }

    const oldVersion = staleInfo.version || '1.0.0'
    const newVersion = bumpPatch(oldVersion)

    // Read each changed source file
    const sourceFiles = []
    for (const src of staleInfo.changedFiles) {
      const candidates = [
        path.join(PROJECT_ROOT, src),
        path.join(PROJECT_ROOT, 'quoth-plugin', src),
        path.join(PROJECT_ROOT, src.replace(/^quoth-plugin\//, '')),
      ]
      for (const candidate of candidates) {
        try {
          const content = fs.readFileSync(candidate, 'utf8')
          sourceFiles.push({ path: src, content })
          break
        } catch {}
      }
    }

    if (sourceFiles.length === 0) {
      log('debug', 'No source files found for managed doc update', { doc: staleInfo.doc })
      appendExecLog(STATE_DIR, { event: 'update_skipped', doc: staleInfo.doc, reason: 'no source files found', mode: 'managed' })
      continue
    }

    log('info', `Calling cloud doc-update API for ${staleInfo.doc}`, {
      sourceFiles: sourceFiles.length, version: `${oldVersion} → ${newVersion}`
    })

    const result = await callDocUpdateAPI(
      { filename: staleInfo.doc, content: docContent, version: oldVersion },
      sourceFiles,
      project
    )

    if (result && result.updated_content) {
      try {
        fs.writeFileSync(docPath, result.updated_content)
        recordUpdate(STATE_DIR, staleInfo.doc, result.new_version || newVersion, PROJECT_ROOT)

        const finalVersion = result.new_version || newVersion
        appendExecLog(STATE_DIR, {
          event: 'update_success', doc: staleInfo.doc, mode: 'managed',
          oldVersion, newVersion: finalVersion,
          changedFiles: staleInfo.changedFiles,
          changesSummary: result.changes_summary || undefined,
        })
        log('info', 'Doc auto-updated via cloud', {
          doc: staleInfo.doc, version: `${oldVersion} → ${finalVersion}`,
          changedFiles: staleInfo.changedFiles.length,
        })
        updates.push({ doc: staleInfo.doc, oldVersion, newVersion: finalVersion })
      } catch (err) {
        log('error', 'Failed to write updated doc', { doc: staleInfo.doc, error: err.message })
        appendExecLog(STATE_DIR, { event: 'update_failed', doc: staleInfo.doc, error: err.message, mode: 'managed' })
        failures.push(staleInfo.doc)
      }
    } else {
      log('warn', 'Cloud doc-update returned no content', { doc: staleInfo.doc })
      appendExecLog(STATE_DIR, { event: 'update_failed', doc: staleInfo.doc, reason: 'no content from API', mode: 'managed' })
      failures.push(staleInfo.doc)
    }
  }

  if (updates.length > 0) {
    commitAndPushDocs(PROJECT_ROOT, updates, log)
  }

  appendExecLog(STATE_DIR, {
    event: 'doc_update_batch_complete', mode: 'managed',
    updated: updates.length, failed: failures.length,
    failures: failures.length > 0 ? failures : undefined,
  })
  log('info', 'Managed doc update complete', { updated: updates.length, failed: failures.length })
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

// --- Stale session detector: SQL-first scan (spec §6.4) ---
function startStaleSessionTimer() {
  // Spec §6.4(b): startup catch-up using daemon_meta.last_stale_scan_ts.
  try {
    const lastTsRaw = typeof db.getDaemonMeta === 'function'
      ? db.getDaemonMeta('last_stale_scan_ts')
      : null
    const lastTs = lastTsRaw != null ? Number(lastTsRaw) || 0 : 0
    if (Date.now() - lastTs > 10 * 60 * 1000) {
      log('info', 'Stale scan startup catch-up', { last_scan_ts: lastTs })
      detectStaleSessions()
    }
  } catch (err) {
    log('warn', 'Stale startup catch-up failed', { error: err.message })
  }

  staleSessionTimer = setInterval(() => {
    try { detectStaleSessions() }
    catch (err) { log('error', 'Stale session detection failed', { error: err.message }) }
  }, 10 * 60 * 1000) // Every 10 minutes
}

function detectStaleSessions() {
  const { detectStaleSessions: scan } = require('./stale-detector.js')
  try {
    scan({ db, trajectoriesDir: TRAJECTORIES_DIR, log })
  } catch (err) {
    log('error', 'Stale session detection failed', { error: err.message })
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

// --- Query server (Unix socket for hook → daemon communication) ---
try {
  const { createQueryServer } = require('./lib/query-server.js')
  queryServer = createQueryServer(db, log)
  queryServer.start()
} catch (err) {
  log('error', 'Query server failed to start', { error: err.message })
}

// --- Pre-warm embedding pipeline (avoids 500ms cold start on first query) ---
;(async () => {
  try {
    const { generateEmbedding } = require('./lib/embed.js')
    await generateEmbedding('warmup')
    log('info', 'Embedding pipeline pre-warmed')
  } catch {}
})()

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

// --- Watch docs/project/ for auto re-indexing on file changes ---
;(() => {
  const docsDir = path.join(PROJECT_ROOT, 'docs', 'project')
  if (fs.existsSync(docsDir)) {
    let docReindexTimer = null
    fs.watch(docsDir, { persistent: false }, () => {
      clearTimeout(docReindexTimer)
      docReindexTimer = setTimeout(async () => {
        try {
          const { indexDocs } = require('./lib/doc-chunks.js')
          const result = await indexDocs(PROJECT_ROOT, db, log)
          if (result.indexed > 0) log('info', 'Doc chunks re-indexed (file change)', result)
        } catch (err) {
          log('error', 'Doc chunk re-index failed', { error: err.message })
        }
      }, 5000)
    })
    log('info', 'Watching docs/project/ for doc chunk re-indexing')
  }
})()
