'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

// --- Load .env from project root (no dependency on dotenv) ---
const DAEMON_REAL_DIR = fs.realpathSync(__dirname)
const _projectRoot = process.env.QUOTH_PROJECT_ROOT || path.join(DAEMON_REAL_DIR, '..', '..')
for (const envFile of ['.env.local', '.env']) {
  const envPath = path.join(_projectRoot, envFile)
  try {
    const content = fs.readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
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
const { scanDocs } = require('./lib/doc-manifest.js')
const { updateDoc, commitAndPush } = require('./lib/doc-updater.js')

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
    // Session summary entries trigger batch distill instead of individual processing
    if (entry.event === 'session_summary') {
      await processSessionBatch(entry, filePath, line)
      return
    }

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
    const consolidation = await consolidate(distilled, similarPatterns)

    if (consolidation.action === 'strengthen' && consolidation.targetId) {
      db.applyBayesianUpdate(consolidation.targetId, 'success')
      db.emitEvent('pattern.strengthened', entry.agent || 'daemon', project, {
        patternId: consolidation.targetId,
        update: 'bayesian-success'
      })
      log('info', 'Strengthened pattern', { id: consolidation.targetId })
    } else {
      // Pre-insert dedup: check if a near-duplicate already exists
      const dupByName = db.findDuplicateByName(distilled.pattern)
      const dupByEmbed = distilled.embedding
        ? db.findDuplicateByEmbedding(distilled.embedding)
        : null
      const existing = dupByEmbed || dupByName

      if (existing) {
        // Strengthen existing instead of creating duplicate
        db.applyBayesianUpdate(existing.id, 'success')
        db.emitEvent('pattern.deduped', entry.agent || 'daemon', project, {
          patternId: existing.id,
          duplicateOf: distilled.pattern.slice(0, 60),
          method: dupByEmbed ? 'embedding' : 'name'
        })
        log('info', 'Deduped → strengthened existing', { id: existing.id, method: dupByEmbed ? 'embedding' : 'name' })
      } else {
        db.upsertPattern({
          id: distilled.id,
          name: distilled.pattern.slice(0, 80),
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
          name: distilled.pattern.slice(0, 80),
          confidence: 0.5,
          source: distilled.source || 'distilled'
        })
        // Set namespace based on source project
        if (project !== 'default') {
          db.setPatternNamespace(distilled.id, project)
        }
        log('info', 'New pattern', { id: distilled.id })
      }
    }

    markProcessed(filePath, line)

    const candidates = db.getPromotionCandidates()
    if (candidates.length > 0) log('info', 'Promotion candidates', { count: candidates.length })

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

  // Run batch distill — one LLM call for the entire session
  const batchPatterns = await distillBatch(summaryEntry, toolEntries)
  log('info', 'Batch distill produced patterns', { count: batchPatterns.length, session: sessionId })

  // Process each batch pattern through consolidate + dedup + insert
  for (const distilled of batchPatterns) {
    try {
      const similarTags = distilled.tags.length > 0 ? distilled.tags : []
      const similarPatterns = distilled.embedding
        ? db.searchBySimilarity(distilled.embedding, 3, similarTags)
        : db.getTopPatterns(3, similarTags)
      const consolidation = await consolidate(distilled, similarPatterns)

      if (consolidation.action === 'strengthen' && consolidation.targetId) {
        db.applyBayesianUpdate(consolidation.targetId, 'success')
        db.emitEvent('pattern.strengthened', summaryEntry.agent || 'daemon', project, {
          patternId: consolidation.targetId,
          update: 'batch-distill'
        })
        log('info', 'Batch: strengthened pattern', { id: consolidation.targetId })
      } else {
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
            confidence: 0.55,  // Slightly above default — batch patterns have more context
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

// --- Nightly pipeline at 3am: deep consolidation → doc auto-update ---
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
}

async function runNightlyPipeline() {
  const start = Date.now()
  log('info', 'Nightly pipeline started')

  // Phase A: Deep consolidation (patterns)
  try {
    await runDeepConsolidate()
  } catch (err) {
    log('error', 'Nightly Phase A (consolidation) failed', { error: err.message, stack: err.stack })
  }

  // Phase B: Doc auto-update
  try {
    await runDocUpdate()
  } catch (err) {
    log('error', 'Nightly Phase B (doc update) failed', { error: err.message, stack: err.stack })
  }

  log('info', `Nightly pipeline complete in ${Math.round((Date.now() - start) / 1000)}s`)
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

    const { callLLM } = require('./lib/llm.js')
    const raw = await callLLM(prompt, 500)
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
  if (agentCleanupTimer) clearInterval(agentCleanupTimer)
  if (staleSessionTimer) clearInterval(staleSessionTimer)
}

// --- Doc auto-update (called as Phase B of nightly pipeline) ---
async function runDocUpdate() {
  log('info', 'Starting doc auto-update scan')
  try {
    // Check if docs/project/ exists in this project
    const docsDir = path.join(PROJECT_ROOT, 'docs', 'project')
    if (!fs.existsSync(docsDir)) {
      log('debug', 'No docs/project/ found, skipping doc update')
      return
    }

    // Scan for stale docs using content hashes
    const { staleDocs } = scanDocs(PROJECT_ROOT, STATE_DIR)

    if (staleDocs.length === 0) {
      log('info', 'All docs up to date')
      return
    }

    log('info', `Found ${staleDocs.length} stale doc(s)`, {
      docs: staleDocs.map(d => `${d.doc} (${d.changedFiles.length} changes)`)
    })

    // Update each stale doc (sequential to avoid overwhelming the LLM)
    const updates = []
    for (const staleInfo of staleDocs) {
      const result = await updateDoc(PROJECT_ROOT, STATE_DIR, staleInfo, log)
      if (result) updates.push(result)
    }

    // Re-scan to update all content hashes in manifest after updates
    scanDocs(PROJECT_ROOT, STATE_DIR)

    // Git commit + push
    if (updates.length > 0) {
      commitAndPush(PROJECT_ROOT, updates, log)
    }

    log('info', 'Doc auto-update complete', {
      scanned: staleDocs.length,
      updated: updates.length
    })
  } catch (err) {
    log('error', 'Doc auto-update failed', { error: err.message })
  }
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
startAgentCleanupTimer()
startStaleSessionTimer()
scheduleNightlyPipeline()
scanAndEnqueue()
processQueue()
