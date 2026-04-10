'use strict'

const fs = require('fs')
const path = require('path')

const TRAJECTORIES_SUBDIRS = ['active', 'processing', 'done', 'routine', 'empty', 'error']

const TERMINAL_BUCKETS = new Set(['done', 'routine', 'empty', 'error'])

/**
 * Ensure `trajectories/<sub>/…` exists. Called by writers before append.
 */
function ensureSubdir(trajectoriesDir, sub) {
  const dir = path.join(trajectoriesDir, sub)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Sidecar path for a session in a given subdir.
 */
function sidecarPath(subdir, sessionId) {
  return path.join(subdir, `${sessionId}.meta.json`)
}

function jsonlPath(subdir, sessionId) {
  return path.join(subdir, `${sessionId}.jsonl`)
}

/**
 * Read a sidecar file. Returns null if missing or malformed.
 */
function readSidecar(subdir, sessionId) {
  try {
    const raw = fs.readFileSync(sidecarPath(subdir, sessionId), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Write a sidecar atomically (.tmp → rename).
 *
 * SINGLE-WRITER ASSUMPTION: the `.tmp` filename is `<sidecar>.tmp` (no PID
 * suffix). Two simultaneous writers for the same session would race on the
 * .tmp file. Today this is safe because each subdir has exactly one writer:
 *   - `active/<sid>.meta.json`     → only the hook process (trajectory-capture)
 *   - `processing/<sid>.meta.json` → only the daemon (after atomic rename)
 *   - terminal buckets             → never updated (immutable on entry)
 * If you ever add a second writer to a subdir, switch to PID-suffixed .tmp
 * (`finalPath + '.tmp.' + process.pid`) before doing so.
 */
function writeSidecar(subdir, sessionId, meta) {
  if (!fs.existsSync(subdir)) fs.mkdirSync(subdir, { recursive: true })
  const finalPath = sidecarPath(subdir, sessionId)
  const tmpPath = finalPath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(meta))
  fs.renameSync(tmpPath, finalPath)
}

/**
 * Dual-form sidecar update. See "API contract" section at the top of Task 3.
 *
 * (a) 3-arg counter-bump form — hooks:
 *       updateSidecar(subdir, sessionId, { project, timestamp, closed_marker? })
 *     Read-modify-write; increments tool_count; updates last_seen_ts.
 *
 * (b) 2-arg patch form — daemon-core / stale detector:
 *       updateSidecar(sidecarFilePath, { status, empty_reason?, ... })
 *     Read-modify-write; does NOT increment tool_count; no-op if file missing.
 *
 * Detection: if `secondArg` is a string (sessionId) → form (a); otherwise form (b).
 */
function updateSidecar(firstArg, secondArg, thirdArg) {
  // Form (b): 2-arg patch — firstArg is a path ending in `.meta.json`
  if (typeof secondArg === 'object' && secondArg !== null && thirdArg === undefined) {
    const sidecarFile = firstArg
    const patch = secondArg
    let existing
    try {
      existing = JSON.parse(fs.readFileSync(sidecarFile, 'utf8'))
    } catch {
      return null // no-op if file missing/malformed
    }
    const next = { ...existing, ...patch }
    const tmp = sidecarFile + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(next))
    fs.renameSync(tmp, sidecarFile)
    return next
  }

  // Form (a): 3-arg counter-bump
  const subdir = firstArg
  const sessionId = secondArg
  const input = thirdArg || {}
  const now = input.timestamp || Date.now()
  const existing = readSidecar(subdir, sessionId)
  const next = existing || {
    session_id: sessionId,
    project: input.project,
    first_seen_ts: now,
    last_seen_ts: now,
    tool_count: 0,
    closed_marker: false,
  }
  next.last_seen_ts = now
  next.tool_count = (next.tool_count || 0) + 1
  if (input.project && !next.project) next.project = input.project
  if (input.closed_marker != null) next.closed_marker = !!input.closed_marker
  writeSidecar(subdir, sessionId, next)
  return next
}

/**
 * Read a JSONL file and parse every line. Skips empty and malformed lines.
 */
function readAllEntries(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const out = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try { out.push(JSON.parse(line)) } catch {}
    }
    return out
  } catch {
    return []
  }
}

/**
 * Mechanically aggregate tool_use entries into a synthetic session_summary.
 * ZERO relevance judgement — just counts, intents, and outcome rate.
 * Used both by the stale detector and the migration script when a session
 * lacks a real session_summary (e.g. crashed before session-end).
 */
function synthesizeSummaryFromEntries(toolEntries, meta) {
  const toolCounts = {}
  const intents = new Set()
  const reasonings = []
  let successes = 0, failures = 0

  for (const e of toolEntries) {
    toolCounts[e.tool] = (toolCounts[e.tool] || 0) + 1
    if (e.outcome === 'success') successes++
    else failures++
    if (e.user_intent) intents.add(e.user_intent)
    if (e.llm_reasoning) reasonings.push(e.llm_reasoning)
  }

  const toolSummary = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t}:${c}`)
    .join(', ')

  const total = toolEntries.length
  return {
    event: 'session_summary',
    agent: 'claude-code',
    project: meta.project || 'default',
    session: meta.session_id,
    task: `Session (synthetic): ${total} tool calls (${toolSummary}). ${successes} ok, ${failures} fail.`,
    tool_counts: toolCounts,
    total_calls: total,
    success_rate: total > 0 ? successes / total : 0,
    user_intents: [...intents].slice(0, 5),
    llm_reasonings: [...new Set(reasonings)].slice(-10),
    outcome: total === 0
      ? 'unknown'
      : (failures === 0 ? 'success' : (successes > failures ? 'partial' : 'failure')),
    source: 'synthetic-aggregator',
    timestamp: Date.now(),
  }
}

/**
 * Dual-form atomic move. See "API contract" section at the top of Task 3.
 *
 * (a) Options-bag form — tests, migration script:
 *       moveSessionFile({ trajectoriesDir, sessionId, from, to, dated?, project?, date?, filenameOverride? })
 *
 * (b) Positional-path form — daemon-core, stale detector:
 *       moveSessionFile(sessionFilePath, destBucket, opts = {})
 *     Infers trajectoriesDir/sessionId/from from the path. `dated` defaults
 *     to true when destBucket is a terminal bucket (done/routine/empty/error),
 *     false otherwise.
 *
 * @returns {{ jsonlPath: string, metaPath: string }}
 */
function moveSessionFile(firstArg, secondArg, thirdArg) {
  let opts
  if (typeof firstArg === 'object' && firstArg !== null) {
    // Form (a): options-bag
    opts = firstArg
  } else if (typeof firstArg === 'string' && typeof secondArg === 'string') {
    // Form (b): positional-path — infer context from the path
    const sessionFilePath = firstArg
    const destBucket = secondArg
    const extraOpts = thirdArg || {}
    const sessionId = path.basename(sessionFilePath, '.jsonl')
    const from = path.basename(path.dirname(sessionFilePath))
    const trajectoriesDir = path.dirname(path.dirname(sessionFilePath))
    const datedDefault = TERMINAL_BUCKETS.has(destBucket)
    opts = {
      trajectoriesDir,
      sessionId,
      from,
      to: destBucket,
      dated: extraOpts.dated != null ? extraOpts.dated : datedDefault,
      project: extraOpts.project,
      date: extraOpts.date,
      filenameOverride: extraOpts.filenameOverride,
    }
  } else {
    throw new TypeError('moveSessionFile: expected options-bag or (sessionFilePath, destBucket, opts?)')
  }

  const { trajectoriesDir, sessionId, from, to } = opts
  const { dated = false, project, date, filenameOverride } = opts

  const fromDir = path.join(trajectoriesDir, from)
  const fromJsonl = jsonlPath(fromDir, sessionId)
  const fromMeta = sidecarPath(fromDir, sessionId)

  const d = date || new Date().toISOString().slice(0, 10)
  let toDir
  if (dated) {
    // empty/ uses date only (no project subdir — spec §4.1)
    toDir = to === 'empty'
      ? path.join(trajectoriesDir, to, d)
      : path.join(trajectoriesDir, to, d, project || 'default')
  } else {
    toDir = path.join(trajectoriesDir, to)
  }
  fs.mkdirSync(toDir, { recursive: true })

  const filename = filenameOverride || `${sessionId}.jsonl`
  const metaFilename = filenameOverride
    ? filenameOverride.replace(/\.jsonl$/, '.meta.json')
    : `${sessionId}.meta.json`
  const toJsonl = path.join(toDir, filename)
  const toMeta = path.join(toDir, metaFilename)

  fs.renameSync(fromJsonl, toJsonl)
  if (fs.existsSync(fromMeta)) {
    // Best-effort sidecar move. JSONL has already been renamed; if the sidecar
    // rename fails (cross-device, EACCES, etc.) we leave the sidecar at the
    // source and continue. Downstream readers (Task 8 processSessionFile,
    // Task 10 stale detector) handle a missing sidecar by falling back to
    // defaults — they will not crash, but they also won't see the original
    // metadata. If you see "missing sidecar" warnings in production, look
    // here first.
    try { fs.renameSync(fromMeta, toMeta) } catch {}
  }
  return { jsonlPath: toJsonl, metaPath: toMeta }
}

module.exports = {
  TRAJECTORIES_SUBDIRS,
  TERMINAL_BUCKETS,
  ensureSubdir,
  sidecarPath,
  jsonlPath,
  readSidecar,
  writeSidecar,
  updateSidecar,
  readAllEntries,
  synthesizeSummaryFromEntries,
  moveSessionFile,
}
