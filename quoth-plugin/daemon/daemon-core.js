'use strict'

const fs = require('fs')
const path = require('path')
const {
  readAllEntries,
  synthesizeSummaryFromEntries,
  moveSessionFile,
  updateSidecar,
} = require('./lib/sessions.js')

/**
 * Process a single session file from trajectories/processing/.
 *
 * Pure orchestration — no timers, no signals, no daemon lifecycle. This
 * function is unit-testable with fake db + fake extract.
 *
 * Contract:
 *   1. Read all entries + sidecar.
 *   2. If the file has zero tool_use entries → move to empty/.
 *   3. Ensure a session_summary exists (synthesize if missing).
 *   4. Call extractFn(summary, toolEntries, db) → { patterns, facts }.
 *   5. Insert patterns via db.insertNewPattern, facts via db.insertNewFact.
 *   6. Flip sidecar.status + move file to done|routine based on output.
 *   7. On any throw → log + move to error/.
 */
async function processSessionFile({ sessionFile, db, extractFn, log = noopLog }) {
  const sid = path.basename(sessionFile, '.jsonl')

  let entries
  try {
    entries = readAllEntries(sessionFile)
  } catch (err) {
    log('error', 'read_entries_failed', { sid, error: err.message })
    try { await moveSessionFile(sessionFile, 'error') } catch {}
    return
  }

  const toolEntries = entries.filter(e => e && e.event === 'tool_use')
  let summary = entries.find(e => e && e.event === 'session_summary') || null

  if (toolEntries.length === 0) {
    updateSidecarSafe(sessionFile, { status: 'empty' })
    try { await moveSessionFile(sessionFile, 'empty') } catch (err) {
      log('error', 'move_to_empty_failed', { sid, error: err.message })
    }
    return
  }

  if (!summary) {
    summary = synthesizeSummaryFromEntries(toolEntries, { session_id: sid, project: inferProjectFromSidecar(sessionFile) })
  }

  let result
  try {
    result = await extractFn(summary, toolEntries, db)
  } catch (err) {
    log('error', 'extract_failed', { sid, error: err.message })
    try {
      if (typeof db.insertPipelineError === 'function') {
        db.insertPipelineError({
          stage: 'extract',
          error_message: err.message,
          context: JSON.stringify({ session_id: sid, entry_count: toolEntries.length }),
        })
      }
    } catch {}
    updateSidecarSafe(sessionFile, { status: 'error' })
    try { await moveSessionFile(sessionFile, 'error') } catch (moveErr) {
      log('error', 'move_to_error_failed', { sid, error: moveErr.message })
    }
    return
  }

  const patterns = Array.isArray(result?.patterns) ? result.patterns : []
  const facts = Array.isArray(result?.facts) ? result.facts : []

  // Spec §6.3: trust the LLM's explicit `session_type` when present. Only
  // fall back to the pattern/fact presence heuristic when the LLM omitted
  // the field. A session is "routine" if EITHER the LLM says so OR the
  // extractor produced no patterns AND no facts.
  const llmSaidRoutine = result?.session_type === 'routine'
  const extractorProducedNothing = patterns.length === 0 && facts.length === 0
  const sessionType = (llmSaidRoutine || extractorProducedNothing) ? 'routine' : 'productive'

  for (const p of patterns) {
    try { db.insertNewPattern(p, summary, summary.project || 'default') }
    catch (err) { log('error', 'insert_pattern_failed', { sid, error: err.message }) }
  }

  const factMeta = {
    project: summary.project || 'default',
    session_id: sid,
  }
  for (const f of facts) {
    try { db.insertNewFact(f, factMeta) }
    catch (err) { log('error', 'insert_fact_failed', { sid, error: err.message }) }
  }

  const bucket = sessionType === 'productive' ? 'done' : 'routine'
  updateSidecarSafe(sessionFile, {
    status: sessionType === 'productive' ? 'done' : 'routine',
    session_type: sessionType,
    pattern_count: patterns.length,
    fact_count: facts.length,
  })

  const project = summary.project || 'default'
  let filenameOverride = null
  // Epoch collision only applies to done/routine (dated+project layout).
  // empty/error buckets are project-less per spec §4.1 and never reach here
  // in practice (see the early returns above), but guard explicitly so a
  // future refactor can't miscompute the target path. Spec §10.2 Q6.
  if (bucket === 'done' || bucket === 'routine') {
    const destBase = path.basename(sessionFile, '.jsonl')
    const today = new Date().toISOString().slice(0, 10)
    const targetDir = path.join(path.dirname(path.dirname(sessionFile)), bucket, today, project)
    const targetJsonl = path.join(targetDir, `${destBase}.jsonl`)
    if (fs.existsSync(targetJsonl) && typeof db.bumpSessionEpoch === 'function') {
      const epoch = db.bumpSessionEpoch(sid)
      filenameOverride = `${destBase}-e${epoch}.jsonl`
      log('info', 'epoch_bumped_for_resume', { sid, epoch })
    }
  }

  try {
    await moveSessionFile(sessionFile, bucket, {
      project,
      ...(filenameOverride ? { filenameOverride } : {}),
    })
  } catch (err) {
    log('error', `move_to_${bucket}_failed`, { sid, error: err.message })
  }
}

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

    const extractOut = await sem.extract.run(() =>
      stages.runExtract(session, {
        llm: llm.kimi,
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

module.exports = {
  processSessionFile,
  tryClaim,
  runWorkerPool,
  processSessionWithPipeline,
  sem,
}
