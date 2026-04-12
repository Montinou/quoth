'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const {
  readAllEntries,
  synthesizeSummaryFromEntries,
  moveSessionFile,
  updateSidecar,
} = require('./lib/sessions.js')

function noopLog() {}

function updateSidecarSafe(jsonlPath, patch) {
  try {
    const sidecar = jsonlPath.replace(/\.jsonl$/, '.meta.json')
    updateSidecar(sidecar, patch)
  } catch {}
}

function inferProjectFromSidecar(jsonlPath) {
  try {
    const sidecar = jsonlPath.replace(/\.jsonl$/, '.meta.json')
    const data = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
    return data.project || 'default'
  } catch {
    return 'default'
  }
}

/**
 * Claim-by-rename (spec §2.2 "Concurrency contract").
 *
 * Atomically renames `<dir>/<filename>` to
 * `<dir>/<basename>.<pid>.<workerId>.jsonl` via POSIX `renameSync`. If the
 * source file does not exist (another worker already claimed it, or the
 * watcher fired after an unrelated delete), returns `null`. On success
 * returns the absolute path to the claimed file.
 *
 * Why sync: `renameSync` is the only POSIX-atomic claim primitive in the
 * fs API. Wrapping it in a Promise does not give us concurrency — JS is
 * single-threaded — but it does let the worker loop await the result in a
 * consistent style. The race is won by microtask ordering: the first call
 * into this function succeeds, and every subsequent call on the same
 * filename sees ENOENT.
 */
function tryClaim(dir, filename, workerId) {
  const from = path.join(dir, filename)
  const to = path.join(
    dir,
    filename.replace(/\.jsonl$/, `.${process.pid}.${workerId}.jsonl`),
  )
  try {
    fs.renameSync(from, to)
    return to
  } catch {
    return null
  }
}

/**
 * Run `pipeline(item)` across `items` with at most `concurrency` in flight.
 *
 * Spec §2.2 "Worker Pool": each worker is an independent async loop that
 * pulls from a shared queue via `queue.shift()`. `Array.prototype.shift`
 * is atomic at the microtask level (single-threaded JS), so no lock is
 * needed — the worst case is that two workers see a non-empty queue,
 * both call `shift()`, and each ends up with a distinct item. Returning
 * `undefined` from `shift()` is the termination signal for a worker.
 *
 * Pipeline errors are swallowed per-item: the caller is expected to log
 * them inside the pipeline function itself (via `pipeline_errors` table).
 * Raising here would halt the whole pool on a single bad session.
 */
async function runWorkerPool({ items, concurrency, pipeline }) {
  const queue = Array.from(items)
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()
      if (item === undefined) return
      try {
        await pipeline(item)
      } catch {
        // caller logs via pipeline_errors — don't crash the pool
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
}

// Lazy-loaded pipeline stage imports. Kept inside the function to avoid
// side-effectful module loads at daemon-core import time (tests pin these
// with fresh temp dirs via QUOTH_HOME).
let _pipelineStages = null
function _loadPipelineStages() {
  if (_pipelineStages) return _pipelineStages
  _pipelineStages = {
    runTriage: require('./pipeline/triage.js').runTriage,
    runExtract: require('./pipeline/extract.js').runExtract,
    runExtractWithFallback: require('./pipeline/extract.js').runExtractWithFallback,
    embedEntities: require('./pipeline/embed.js').embedEntities,
    persistSession: require('./pipeline/persist.js').persistSession,
  }
  return _pipelineStages
}

// Module-level stage semaphores. Defaults match spec §2.2
// "Concurrency-default rationale" and every value is tunable via env var.
// The Semaphore class is pure / side-effect-free so importing it here is
// safe at module load time.
const { Semaphore } = require('./lib/semaphore.js')
const _stageDefaults = {
  triage: parseInt(process.env.QUOTH_TRIAGE_CONCURRENCY || '8', 10),
  extract: parseInt(process.env.QUOTH_EXTRACT_CONCURRENCY || '3', 10),
  embed: parseInt(process.env.QUOTH_EMBED_CONCURRENCY || '2', 10),
  persist: 1, // HNSW.add not concurrency-safe; SQLite prefers single writer.
}
const sem = {
  triage: new Semaphore(_stageDefaults.triage),
  extract: new Semaphore(_stageDefaults.extract),
  embed: new Semaphore(_stageDefaults.embed),
  persist: new Semaphore(_stageDefaults.persist),
}

/**
 * New pipeline orchestrator (spec §2.2). Chains
 *   triage → (short-circuit on routine) → extract → embed → persist
 * with each stage wrapped in its own Semaphore so that worker concurrency
 * and stage concurrency are decoupled.
 *
 * Added alongside `processSessionFile` (legacy path). Task 13 will wire the
 * file watcher to this function; the legacy function is removed in Task 24.
 *
 * Deps bag:
 *   - hnsw: HNSW index handle (passed through to persistSession)
 *   - llm:  { gemini, kimi } — callables matching the triage/extract DI
 *           contract. Callers construct these with their own budget /
 *           retry policy. If the fleet evolves to new providers, the
 *           property names can grow without touching this function.
 *   - log:  optional logger (level, msg, data)
 *
 * Returns the moved file path(s) on success, or `null` if the session was
 * archived as routine / empty / error.
 */
async function processSessionWithPipeline(sessionFile, deps = {}) {
  const { hnsw, llm = {}, log = noopLog } = deps
  const sid = path.basename(sessionFile, '.jsonl').replace(/\.\d+\.[^.]+$/, '')
  const stages = _loadPipelineStages()

  let entries
  try {
    entries = readAllEntries(sessionFile)
  } catch (err) {
    log('error', 'read_entries_failed', { sid, error: err.message })
    try { await moveSessionFile(sessionFile, 'error') } catch {}
    return null
  }

  const toolEntries = entries.filter(e => e && e.event === 'tool_use')
  if (toolEntries.length === 0) {
    updateSidecarSafe(sessionFile, { status: 'empty' })
    try { await moveSessionFile(sessionFile, 'empty') } catch (err) {
      log('error', 'move_to_empty_failed', { sid, error: err.message })
    }
    return null
  }

  let summary = entries.find(e => e && e.event === 'session_summary') || null
  if (!summary) {
    summary = synthesizeSummaryFromEntries(toolEntries, {
      session_id: sid,
      project: inferProjectFromSidecar(sessionFile),
    })
  }
  const project = summary.project || 'default'
  const session = { session_id: sid, project, entries: toolEntries, summary }

  try {
    const triageOut = await sem.triage.run(() =>
      stages.runTriage(session, { llm: llm.gemini }),
    )
    if (!triageOut || triageOut.productive === false) {
      updateSidecarSafe(sessionFile, {
        status: 'routine',
        session_type: 'routine',
        triage_reason: triageOut?.reason || 'not_productive',
      })
      try {
        return await moveSessionFile(sessionFile, 'routine', { project })
      } catch (err) {
        log('error', 'move_to_routine_failed', { sid, error: err.message })
        return null
      }
    }

    // Semantic pre-search: if triage suggested queries, pre-embed session
    // entries and run each query against the index. Results are passed to
    // extract as enriched context so K2.5 sees targeted deep-dives without
    // needing its own tool-calling loop. Cost: zero (local MiniLM).
    let searchContext = null
    const suggestedQueries = triageOut.suggested_queries || []
    if (suggestedQueries.length > 0 && toolEntries.length > 5) {
      try {
        const { generateEmbeddingBatch, generateEmbedding } = require('./lib/embed.js')
        const { cosineSim } = (() => {
          function cosineSim(a, b) {
            if (!a || !b || a.length !== b.length) return 0
            let dot = 0, na = 0, nb = 0
            for (let i = 0; i < a.length; i++) {
              dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
            }
            const denom = Math.sqrt(na) * Math.sqrt(nb)
            return denom > 0 ? dot / denom : 0
          }
          return { cosineSim }
        })()

        // Pre-embed all entries.
        const texts = toolEntries.map(e => {
          let rawInput = e.tool_input || e.task || ''
          if (typeof rawInput !== 'string') rawInput = JSON.stringify(rawInput)
          return `[${e.tool || '?'}] ${rawInput.slice(0, 300)} ${e.user_intent || ''} ${e.llm_reasoning || ''}`.trim()
        })
        const entryVecs = await generateEmbeddingBatch(texts)

        // Run each suggested query and collect top-5 matches.
        const queryResults = []
        for (const q of suggestedQueries) {
          const qVec = await generateEmbedding(q)
          if (!qVec) continue
          const scored = entryVecs
            .map((v, i) => ({ idx: i, score: v ? cosineSim(qVec, v) : 0 }))
            .filter(s => s.score > 0.3)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
          if (scored.length > 0) {
            const matches = scored.map(s => {
              const e = toolEntries[s.idx]
              let rawInput = e.tool_input || e.task || ''
              if (typeof rawInput !== 'string') rawInput = JSON.stringify(rawInput)
              const input = rawInput.slice(0, 400).replace(/\n/g, ' ')
              const intent = e.user_intent ? ` | intent: ${e.user_intent}` : ''
              const reasoning = e.llm_reasoning ? ` | reasoning: ${(e.llm_reasoning + '').slice(0, 200)}` : ''
              return `  [${s.idx + 1}] (sim=${s.score.toFixed(2)}) [${e.tool}] ${input}${intent}${reasoning}`
            }).join('\n')
            queryResults.push(`Query: "${q}"\n${matches}`)
          }
        }
        if (queryResults.length > 0) {
          searchContext = queryResults.join('\n\n')
          log('info', 'semantic_presearch_complete', {
            sid, queries: suggestedQueries.length, results: queryResults.length,
          })
        }
      } catch (err) {
        log('warn', 'semantic_presearch_failed', { sid, error: err.message })
        // Non-fatal — extract still runs with overview only.
      }
    }

    // Attach search context to session so extract can consume it.
    if (searchContext) session.searchContext = searchContext

    const extractOut = await sem.extract.run(() =>
      stages.runExtractWithFallback(session, {
        llm: llm.kimi,
        sonnetFallback: llm.sonnet,
        urgency: triageOut.urgency,
        suspected_kinds: triageOut.suspected_kinds,
      }),
    )
    const entities = Array.isArray(extractOut?.entities) ? extractOut.entities : []

    const embedded = await sem.embed.run(() => stages.embedEntities(entities))

    await sem.persist.run(() =>
      stages.persistSession({ sessionId: sid, entities: embedded }, { hnsw }),
    )

    updateSidecarSafe(sessionFile, {
      status: 'done',
      session_type: 'productive',
      entity_count: embedded.length,
    })
    try {
      return await moveSessionFile(sessionFile, 'done', { project })
    } catch (err) {
      log('error', 'move_to_done_failed', { sid, error: err.message })
      return null
    }
  } catch (err) {
    log('error', 'pipeline_failed', { sid, error: err.message })
    updateSidecarSafe(sessionFile, { status: 'error' })
    try { await moveSessionFile(sessionFile, 'error') } catch {}
    return null
  }
}

/**
 * FileWatcher with polling fallback (spec §2.2 "FileWatcher polling fallback").
 *
 * Runs two redundant detectors against a directory:
 *   1. `fs.watch` (primary, event-driven; can be disabled via opts.disableFsWatch)
 *   2. `setInterval(readdirSync)` polling fallback (default 5000 ms)
 *
 * On start, an in-memory `knownFiles` Set is seeded from `readdirSync(dir)`
 * BEFORE either detector runs — the "warmup" — so pre-existing files never
 * fire events (they would otherwise look like "the watcher missed these"
 * and pollute pipeline_errors). The first polling tick after start is also
 * marked as warmup and skips the `onDegraded` callback.
 *
 * `onDegraded` is invoked only when the polling sweep picks up a file that
 * `fs.watch` never surfaced (i.e. real event loss). When `disableFsWatch` is
 * true, polling IS the primary detector and degraded events are never fired.
 *
 * Emits `file` events with the basename (not full path). Consumers dedupe by
 * filename at the claim layer (tryClaim).
 */
class FileWatcher extends EventEmitter {
  constructor(dir, opts = {}) {
    super()
    this.dir = dir
    this.pollIntervalMs = opts.pollIntervalMs ?? 5000
    this.disableFsWatch = opts.disableFsWatch === true
    this.onDegraded = typeof opts.onDegraded === 'function' ? opts.onDegraded : null
    this.knownFiles = new Set()
    // Files that fs.watch has surfaced since last poll — used to detect
    // "polling saw it but fs.watch did not" = degraded event-loss signal.
    this._watchSeen = new Set()
    this._watcher = null
    this._timer = null
    this._warmupPollTickDone = false
  }

  async start() {
    // Warmup: seed the known set with everything already in the directory
    // so we never emit an event for pre-existing files.
    try {
      for (const f of fs.readdirSync(this.dir)) {
        this.knownFiles.add(f)
      }
    } catch {
      // Directory may not exist yet; polling will retry.
    }

    if (!this.disableFsWatch) {
      try {
        this._watcher = fs.watch(this.dir, { persistent: false }, (_event, filename) => {
          if (!filename) return
          this._watchSeen.add(filename)
          this._maybeEmit(filename, { fromWatch: true })
        })
      } catch {
        // fs.watch may fail on some filesystems; polling will carry us.
        this._watcher = null
      }
    }

    this._timer = setInterval(() => this._pollTick(), this.pollIntervalMs)
    // Avoid blocking Node event loop exit in tests.
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref()
  }

  _pollTick() {
    let current
    try {
      current = fs.readdirSync(this.dir)
    } catch {
      return
    }
    const warmup = !this._warmupPollTickDone
    for (const filename of current) {
      if (this.knownFiles.has(filename)) continue
      // New-to-us via polling. If fs.watch also saw it, that's not degraded.
      const watchSawIt = this._watchSeen.has(filename)
      if (
        !warmup &&
        !watchSawIt &&
        !this.disableFsWatch &&
        this.onDegraded
      ) {
        try {
          this.onDegraded({ filename, dir: this.dir })
        } catch {
          // Callback failure must not break the watcher.
        }
      }
      this._maybeEmit(filename, { fromWatch: false })
    }
    // Reset the per-tick watcher-saw bookkeeping — any fresh events arriving
    // between ticks will re-populate it.
    this._watchSeen.clear()
    this._warmupPollTickDone = true
  }

  _maybeEmit(filename, _meta) {
    if (this.knownFiles.has(filename)) return
    this.knownFiles.add(filename)
    this.emit('file', filename)
  }

  stop() {
    if (this._watcher) {
      try { this._watcher.close() } catch {}
      this._watcher = null
    }
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  }
}

/**
 * Orphan recovery (spec §2.2 "SIGTERM / orphan recovery", boot path).
 *
 * Scans `dir` for files matching the claim-suffix pattern
 * `<basename>.<pid>.<workerId>.jsonl`. For each, probes the PID with
 * `process.kill(pid, 0)`:
 *
 *   - `ESRCH` (no such process)           → strip suffix via `fs.renameSync`
 *   - alive / EPERM (foreign-owned alive) → leave alone
 *   - any other error                     → leave alone (safer default)
 *
 * Files that do not match the `<base>.<pid-number>.<worker>.jsonl` shape are
 * ignored entirely. Silent on success; returns the number of files recovered.
 */
function recoverOrphans(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return 0
  }
  let recovered = 0
  for (const filename of entries) {
    if (!filename.endsWith('.jsonl')) continue
    // Expect exactly `.${pid}.${worker}.jsonl` suffix: at least 4 dot-parts.
    const base = filename.slice(0, -'.jsonl'.length)
    const parts = base.split('.')
    if (parts.length < 3) continue
    const workerPart = parts[parts.length - 1]
    const pidPart = parts[parts.length - 2]
    if (!/^\d+$/.test(pidPart)) continue
    if (!workerPart || /^\d+$/.test(workerPart)) {
      // worker id should be non-numeric (e.g. "w1") so we don't rewrite
      // legitimate timestamp-suffixed files. Be conservative.
      continue
    }
    const pid = parseInt(pidPart, 10)
    let alive
    try {
      process.kill(pid, 0)
      alive = true
    } catch (err) {
      if (err && err.code === 'ESRCH') alive = false
      else if (err && err.code === 'EPERM') alive = true
      else alive = true // unknown — play it safe and leave it
    }
    if (alive) continue
    const originalBase = parts.slice(0, parts.length - 2).join('.')
    const original = `${originalBase}.jsonl`
    const from = path.join(dir, filename)
    const to = path.join(dir, original)
    try {
      fs.renameSync(from, to)
      recovered += 1
    } catch {
      // If rename fails (target exists, permissions, etc.) leave the orphan
      // on disk so a later sweep can try again.
    }
  }
  return recovered
}

/**
 * Graceful shutdown (spec §2.2 "SIGTERM / orphan recovery", shutdown path).
 *
 * Waits up to `graceMs` for in-flight claims to drain, then invokes
 * `state.rollback(claim)` for any claim still in `state.inFlight`. The
 * rollback callback is expected to `fs.renameSync` the claimed file back
 * to its original name so a subsequent daemon boot can re-pick it up.
 *
 * This function is intentionally minimal — the real production wiring
 * (racing worker-pool drain against the grace timer, killing LLM child
 * processes, closing DB handles) lives in the daemon.js boot path. This
 * helper isolates the deadline + rollback-callback contract so it can be
 * unit-tested and reused.
 */
async function gracefulShutdown(state, opts = {}) {
  const graceMs = opts.graceMs ?? 30000
  await new Promise(resolve => setTimeout(resolve, graceMs))
  const stillInFlight = Array.isArray(state && state.inFlight) ? state.inFlight : []
  if (typeof state?.rollback !== 'function') return
  for (const claim of stillInFlight) {
    try {
      state.rollback(claim)
    } catch {
      // rollback failure must not prevent rolling back the rest
    }
  }
}

/**
 * Startup-failure sentinel (spec §7 error handling table,
 * "daemon-startup → DB migration failed → leave a `~/.quoth/STARTUP_FAILED`
 * flag file").
 *
 * On a fatal boot error the daemon writes the reason string verbatim to
 * `${QUOTH_HOME}/STARTUP_FAILED`. The next hook invocation reads the file
 * via `checkStartupFlag()` and surfaces a one-line warning. The flag is
 * sticky — it persists until an operator clears it (or a successful boot
 * removes it).
 */
function _resolveQuothHome() {
  return process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
}

function writeStartupFailed(reason) {
  const home = _resolveQuothHome()
  try {
    fs.mkdirSync(home, { recursive: true })
  } catch {}
  const flagPath = path.join(home, 'STARTUP_FAILED')
  const body = `${new Date().toISOString()} ${String(reason)}\n`
  try {
    fs.writeFileSync(flagPath, body)
  } catch {
    // Best-effort; if we cannot write the flag the caller is already
    // exiting with a non-zero code.
  }
}

function checkStartupFlag() {
  const home = _resolveQuothHome()
  const flagPath = path.join(home, 'STARTUP_FAILED')
  try {
    if (!fs.existsSync(flagPath)) return null
    return fs.readFileSync(flagPath, 'utf8')
  } catch {
    return null
  }
}

module.exports = {
  tryClaim,
  runWorkerPool,
  processSessionWithPipeline,
  sem,
  FileWatcher,
  recoverOrphans,
  gracefulShutdown,
  writeStartupFailed,
  checkStartupFlag,
}
