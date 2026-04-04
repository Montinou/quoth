'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const { createDb } = require('./db.js')
const { judge } = require('./pipeline/judge.js')
const { distill } = require('./pipeline/distill.js')
const { consolidate } = require('./pipeline/consolidate.js')
const { promotePattern } = require('./lib/promote.js')

// --- Paths ---
const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const TRAJECTORIES_DIR = path.join(QUOTH_HOME, 'trajectories')
const PID_FILE = path.join(QUOTH_HOME, 'daemon.pid')
const LOG_FILE = path.join(QUOTH_HOME, 'daemon.log')
const LOCK_FILE = path.join(QUOTH_HOME, 'processing.lock')
const DB_PATH = path.join(QUOTH_HOME, 'memory.db')

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
    log('info', 'Watching trajectories', { dir: TRAJECTORIES_DIR })
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
    // Detect actual project from file paths in the task (corrects ~ sessions)
    const rawProject = entry.project || 'default'
    const project = detectProjectFromTask(entry.task, rawProject)
    if (project !== rawProject) {
      log('debug', 'Namespace corrected', { from: rawProject, to: project, task: (entry.task || '').slice(0, 60) })
    }
    log('debug', 'Processing entry', { agent: entry.agent, outcome: entry.outcome, project })

    const judgment = await judge(entry)
    if (!judgment.effective) {
      log('debug', 'Entry judged ineffective', { reason: judgment.reason })
      markProcessed(filePath, line)
      return
    }

    const distilled = await distill(entry)
    const similarTags = distilled.tags.length > 0 ? distilled.tags : []
    const similarPatterns = distilled.embedding
      ? db.searchBySimilarity(distilled.embedding, 3, similarTags)
      : db.getTopPatterns(3, similarTags)
    const consolidation = consolidate(distilled, similarPatterns)

    if (consolidation.action === 'strengthen' && consolidation.targetId) {
      db.applyBayesianUpdate(consolidation.targetId, 'success')
      db.emitEvent('pattern.strengthened', entry.agent || 'daemon', project, {
        patternId: consolidation.targetId,
        update: 'bayesian-success'
      })
      log('info', 'Strengthened pattern', { id: consolidation.targetId })
    } else {
      db.upsertPattern({
        id: distilled.id,
        name: distilled.pattern.slice(0, 60),
        pattern_type: 'code-pattern',
        condition: entry.task || 'agent task',
        action: distilled.pattern,
        confidence: 0.5,
        tags: [...distilled.tags, ...(project !== 'default' ? [`project:${project}`] : [])],
        source: distilled.source || entry.source || 'distilled',
        embedding: distilled.embedding ? JSON.stringify(distilled.embedding) : undefined
      })
      db.emitEvent('pattern.learned', entry.agent || 'daemon', project, {
        patternId: distilled.id,
        name: distilled.pattern.slice(0, 60),
        confidence: 0.5,
        source: distilled.source || 'distilled'
      })
      // Set namespace based on source project
      if (project !== 'default') {
        db.setPatternNamespace(distilled.id, project)
      }
      log('info', 'New pattern', { id: distilled.id })
    }

    markProcessed(filePath, line)

    const candidates = db.getPromotionCandidates()
    if (candidates.length > 0) log('info', 'Promotion candidates', { count: candidates.length })

  } catch (err) {
    log('error', 'processEntry failed', { error: err.message })
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
      log('info', 'Hourly decay applied')
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

// --- Daily deep consolidation at 3am ---
function scheduleDeepConsolidate() {
  const now = new Date()
  const next3am = new Date(now)
  next3am.setHours(3, 0, 0, 0)
  if (next3am <= now) next3am.setDate(next3am.getDate() + 1)
  const msUntil = next3am - now

  deepConsolidateTimer = setTimeout(() => {
    runDeepConsolidate().catch(err => log('error', 'runDeepConsolidate failed', { error: err.message }))
    setInterval(() => {
      runDeepConsolidate().catch(err => log('error', 'runDeepConsolidate failed', { error: err.message }))
    }, 24 * 60 * 60 * 1000)
  }, msUntil)

  log('info', `Deep consolidation in ${Math.round(msUntil / 60000)}m`)
}

async function runDeepConsolidate() {
  log('info', 'Starting deep consolidation')
  try {
    const patterns = db.getTopPatterns(20)
    if (patterns.length === 0) return

    const prompt = `Review these patterns and identify duplicates to merge or low-value patterns to archive.
Patterns: ${JSON.stringify(patterns)}

Respond with ONLY JSON: {"merges": [{"keep": "id", "archive": "id"}], "archives": ["id"]}`

    const { callLLM } = require('./lib/llm.js')
    const raw = await callLLM(prompt, 500)

    const start = raw.indexOf('{')
    if (start === -1) return
    const result = JSON.parse(raw.slice(start))

    for (const id of (result.archives || [])) {
      db.prepare("UPDATE patterns SET status='archived' WHERE id=?").run(id)
    }
    for (const merge of (result.merges || [])) {
      db.applyBayesianUpdate(merge.keep, 'success')
      db.prepare("UPDATE patterns SET status='archived' WHERE id=?").run(merge.archive)
    }
    log('info', 'Deep consolidation done', { merged: (result.merges||[]).length, archived: (result.archives||[]).length })

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

function clearTimers() {
  if (decayTimer) clearInterval(decayTimer)
  if (deepConsolidateTimer) clearTimeout(deepConsolidateTimer)
  if (hnswSaveTimer) clearInterval(hnswSaveTimer)
  if (agentCleanupTimer) clearInterval(agentCleanupTimer)
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

// --- Start ---
log('info', 'Quoth daemon started', { pid: process.pid, home: QUOTH_HOME })
watchTrajectories()
startDecayTimer()
startHnswSaveTimer()
startAgentCleanupTimer()
scheduleDeepConsolidate()
scanAndEnqueue()
processQueue()
