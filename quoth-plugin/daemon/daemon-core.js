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
    try { await moveSessionFile(sessionFile, 'error', { dated: false }) } catch (moveErr) {
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
  try {
    // done/ is dated+project-namespaced; routine/ is flat (no date subdir).
    const moveOpts = bucket === 'done'
      ? { project: summary.project || 'default' }
      : { dated: false }
    await moveSessionFile(sessionFile, bucket, moveOpts)
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

module.exports = { processSessionFile }
