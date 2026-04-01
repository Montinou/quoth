'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const { createDb } = require('./db.js')
const { judge } = require('./pipeline/judge.js')
const { distill } = require('./pipeline/distill.js')
const { consolidate } = require('./pipeline/consolidate.js')

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
const jobQueue = []
let isProcessing = false
let decayTimer = null
let deepConsolidateTimer = null

// --- Logging ---
function log(level, msg, data) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(data && { data }) }) + '\n'
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
  if (process.env.QUOTH_DEBUG) process.stderr.write(line)
}

// --- PID management ---
fs.writeFileSync(PID_FILE, String(process.pid))
process.on('exit', () => { try { fs.unlinkSync(PID_FILE) } catch {} })

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
  try {
    const files = fs.readdirSync(TRAJECTORIES_DIR).filter(f => f.endsWith('.jsonl'))
    for (const file of files) {
      const filePath = path.join(TRAJECTORIES_DIR, file)
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const entry = JSON.parse(line)
            if (!entry._processed) jobQueue.push({ entry, filePath, line })
          } catch {}
        }
      } catch (err) {
        log('error', 'Failed to read trajectory file', { file, error: err.message })
      }
    }
  } catch (err) {
    log('error', 'scanAndEnqueue failed', { error: err.message })
  }
  if (jobQueue.length > 0) log('info', `Enqueued ${jobQueue.length} entries`)
}

// --- Process queue with up to 5 parallel workers ---
async function processQueue() {
  if (isProcessing || jobQueue.length === 0) return
  if (fs.existsSync(LOCK_FILE)) return

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
async function processEntry({ entry, filePath, line }) {
  try {
    log('debug', 'Processing entry', { agent: entry.agent, outcome: entry.outcome })

    const judgment = judge(entry)
    if (!judgment.effective) {
      log('debug', 'Entry judged ineffective', { reason: judgment.reason })
      markProcessed(filePath, line)
      return
    }

    const distilled = distill(entry)
    const similarPatterns = db.getTopPatterns(3, distilled.tags.length > 0 ? distilled.tags : [])
    const consolidation = consolidate(distilled, similarPatterns)

    if (consolidation.action === 'strengthen' && consolidation.targetId) {
      db.applyConfidenceDelta(consolidation.targetId, 0.03)
      log('info', 'Strengthened pattern', { id: consolidation.targetId })
    } else {
      db.upsertPattern({
        id: distilled.id,
        name: distilled.pattern.slice(0, 60),
        pattern_type: 'code-pattern',
        condition: entry.task || 'agent task',
        action: distilled.pattern,
        confidence: 0.5,
        tags: distilled.tags,
        source: 'distilled'
      })
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

// --- Daily deep consolidation at 3am ---
function scheduleDeepConsolidate() {
  const now = new Date()
  const next3am = new Date(now)
  next3am.setHours(3, 0, 0, 0)
  if (next3am <= now) next3am.setDate(next3am.getDate() + 1)
  const msUntil = next3am - now

  deepConsolidateTimer = setTimeout(() => {
    runDeepConsolidate()
    setInterval(runDeepConsolidate, 24 * 60 * 60 * 1000)
  }, msUntil)

  log('info', `Deep consolidation in ${Math.round(msUntil / 60000)}m`)
}

function runDeepConsolidate() {
  log('info', 'Starting deep consolidation')
  try {
    const patterns = db.getTopPatterns(20)
    if (patterns.length === 0) return

    const prompt = `Review these patterns and identify duplicates to merge or low-value patterns to archive.
Patterns: ${JSON.stringify(patterns)}

Respond with ONLY JSON: {"merges": [{"keep": "id", "archive": "id"}], "archives": ["id"]}`

    const raw = require('child_process').execSync(
      `echo ${JSON.stringify(prompt)} | claude -p --model claude-sonnet-4-6 --output-format text`,
      { encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim()

    const start = raw.indexOf('{')
    if (start === -1) return
    const result = JSON.parse(raw.slice(start))

    for (const id of (result.archives || [])) {
      db.prepare("UPDATE patterns SET status='archived' WHERE id=?").run(id)
    }
    for (const merge of (result.merges || [])) {
      db.applyConfidenceDelta(merge.keep, 0.05)
      db.prepare("UPDATE patterns SET status='archived' WHERE id=?").run(merge.archive)
    }
    log('info', 'Deep consolidation done', { merged: (result.merges||[]).length, archived: (result.archives||[]).length })
  } catch (err) {
    log('error', 'Deep consolidation failed', { error: err.message })
  }
}

function clearTimers() {
  if (decayTimer) clearInterval(decayTimer)
  if (deepConsolidateTimer) clearTimeout(deepConsolidateTimer)
}

// --- Start ---
log('info', 'Quoth daemon started', { pid: process.pid, home: QUOTH_HOME })
watchTrajectories()
startDecayTimer()
scheduleDeepConsolidate()
scanAndEnqueue()
processQueue()
