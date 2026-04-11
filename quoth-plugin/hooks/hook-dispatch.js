#!/usr/bin/env node
/**
 * Quoth Unified Hook Dispatcher
 * Replaces ~/.claude/helpers/hook-handler.cjs by using quoth handlers directly.
 *
 * Usage: node hook-dispatch.js <command> [args...]
 *
 * Commands:
 *   route           - Route task to optimal agent
 *   session-restore - Initialize intelligence graph + inject facts
 *   session-end     - Consolidate intelligence
 *   post-edit       - Record edit for intelligence
 *   post-task       - Implicit success feedback
 *   pre-bash        - Command safety check
 *   subagent-start  - Inject relevant patterns into subagent context
 *   stats           - Intelligence diagnostics
 */

'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const http = require('http')
const { spawn } = require('child_process')

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const DB_PATH = path.join(QUOTH_HOME, 'memory.db')
const STATE_DIR = path.join(QUOTH_HOME, 'intelligence')
const SOCK_PATH = path.join(QUOTH_HOME, 'daemon.sock')

function resolveProjectName(dir) {
  // Try git remote origin → use repo name (e.g. "sales-companion" from Montinou/sales-companion)
  try {
    const { execSync } = require('child_process')
    const url = execSync('git remote get-url origin', { cwd: dir, timeout: 1000, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
    const match = url.match(/[/:]([^/]+\/([^/]+?))(\.git)?$/)
    if (match) return match[2].toLowerCase()
  } catch {}
  // Fallback: workspace name or directory basename
  const base = path.basename(dir)
  const wsMatch = dir.match(/\.openclaw\/workspaces\/([^/]+)\/repo\/?$/)
  if (wsMatch) return wsMatch[1]
  if (base === 'repo' || base === 'src') return path.basename(path.dirname(dir))
  return base
}

// Resolve quoth-plugin root: follow symlinks to find the real source location.
// When deployed as symlink (~/.quoth/hooks/hook-dispatch.js -> quoth-plugin/hooks/hook-dispatch.js),
// fs.realpathSync resolves to the source tree where mcp/handlers/ exists.
const REAL_DIR = fs.realpathSync(__dirname)
const QUOTH_PLUGIN = process.env.QUOTH_PLUGIN_DIR || path.join(REAL_DIR, '..')

// Lazy-load intelligence handlers (direct require, no MCP roundtrip)
let _intelligence = null
function getIntelligence() {
  if (_intelligence) return _intelligence
  _intelligence = require(path.join(QUOTH_PLUGIN, 'mcp', 'handlers', 'intelligence'))
  return _intelligence
}

// Lazy-load db
let _db = null
function getDb() {
  if (_db) return _db
  try {
    const { createDb } = require(path.join(QUOTH_PLUGIN, 'daemon', 'db.js'))
    _db = createDb(DB_PATH)
  } catch {}
  return _db
}

// --- Daemon query client (Unix socket) ---
function queryDaemon(body, timeoutMs = 500) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request({
      socketPath: SOCK_PATH,
      path: '/query',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: timeoutMs,
    }, (res) => {
      let chunks = ''
      res.on('data', c => { chunks += c })
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)) }
        catch { reject(new Error('Invalid JSON from daemon')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Daemon query timeout')) })
    req.write(data)
    req.end()
  })
}

function isDaemonAlive() {
  return new Promise(resolve => {
    const req = http.request({
      socketPath: SOCK_PATH, path: '/health', method: 'GET', timeout: 200,
    }, (res) => {
      let d = ''
      res.on('data', c => { d += c })
      res.on('end', () => resolve(res.statusCode === 200))
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
}

async function ensureDaemon() {
  if (fs.existsSync(SOCK_PATH) && await isDaemonAlive()) return
  // Clean stale sock/pid before starting — prevents "already listening" errors
  try { fs.unlinkSync(SOCK_PATH) } catch {}
  const pidPath = path.join(QUOTH_HOME, 'daemon.pid')
  if (fs.existsSync(pidPath)) {
    try {
      const oldPid = parseInt(fs.readFileSync(pidPath, 'utf8').trim())
      try { process.kill(oldPid, 0) } catch { fs.unlinkSync(pidPath) }
    } catch { try { fs.unlinkSync(pidPath) } catch {} }
  }
  // Start daemon
  const daemonPath = path.join(QUOTH_PLUGIN, 'daemon', 'daemon.js')
  const child = spawn('node', [daemonPath], { detached: true, stdio: 'ignore' })
  child.unref()
  // Wait for socket to become available (max 5s)
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100))
    if (fs.existsSync(SOCK_PATH) && await isDaemonAlive()) return
  }
  throw new Error('Daemon failed to start within 5s')
}

// --- Task 17: route fast-path helpers (spec §2.3) ---
//
// Default 200ms, tunable via QUOTH_DAEMON_SOCKET_TIMEOUT_MS (spec §2.3 / config
// example line 1049). Parsed at each call so tests and ops can flip it at
// runtime without module reload.
function getInjectTimeoutMs() {
  const raw = process.env.QUOTH_DAEMON_SOCKET_TIMEOUT_MS
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 200
}

// GET /inject URLs encode the full prompt into the query string. Node's
// default http parser caps request header size at ~16KB, so a pasted stack
// trace can deterministically fail the socket. Truncating the prompt at the
// hook boundary is safer than renegotiating to POST: injection results don't
// need the last 30KB of a prompt to match relevant entities.
const MAX_PROMPT_BYTES = 4096
function truncatePrompt(prompt) {
  if (prompt == null) return prompt
  const s = String(prompt)
  return s.length > MAX_PROMPT_BYTES ? s.slice(0, MAX_PROMPT_BYTES) : s
}

// fetchInject(): unix-socket GET /inject with a configurable timeout.
// Returns the parsed JSON response. Any error (ENOENT, ECONNREFUSED,
// timeout, malformed JSON) is surfaced so the caller can fall back to the
// daemon-detach path.
function fetchInject({ prompt, project, kinds, limit, agentType }, timeoutMs) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams()
    if (prompt != null) params.set('prompt', truncatePrompt(prompt))
    if (project != null) params.set('project', String(project))
    if (kinds != null) params.set('kinds', String(kinds))
    if (limit != null) params.set('limit', String(limit))
    if (agentType) params.set('agentType', String(agentType))
    const req = http.request({
      socketPath: SOCK_PATH,
      path: `/inject?${params.toString()}`,
      method: 'GET',
      timeout: timeoutMs,
    }, (res) => {
      let chunks = ''
      res.on('data', (c) => { chunks += c })
      res.on('end', () => {
        try { resolve(JSON.parse(chunks || '{}')) }
        catch { reject(new Error('Invalid JSON from /inject')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('/inject timeout')); reject(new Error('/inject timeout')) })
    req.end()
  })
}

// emitAdditionalContext: Claude Code hook protocol emission.
// The CC hook harness reads stdout as JSON and forwards `additionalContext`
// into the next prompt. Empty strings are skipped by the caller.
function emitAdditionalContext(text) {
  if (!text) return
  console.log(JSON.stringify({ additionalContext: text }))
}

// formatInjectResults: render the /inject response array as a markdown
// block. One bullet per result: `- **[kind]** summary (confidence: 0.XX)`
// followed by an indented content snippet truncated to ~200 chars.
// Returns '' when the results array is empty or missing.
function formatInjectResults(results) {
  if (!Array.isArray(results) || results.length === 0) return ''
  const lines = ['[Quoth] Relevant knowledge for this prompt:']
  for (const r of results) {
    if (!r || typeof r !== 'object') continue
    const kind = r.kind || 'entity'
    const summary = (r.summary || r.id || '').toString()
    const conf = Number.isFinite(r.confidence) ? r.confidence.toFixed(2) : '0.00'
    lines.push(`- **[${kind}]** ${summary} (confidence: ${conf})`)
    const content = (r.content || '').toString().trim()
    if (content) {
      const snippet = content.length > 200 ? content.slice(0, 200) + '…' : content
      lines.push(`  ${snippet}`)
    }
  }
  return lines.join('\n')
}

// spawnDaemonDetached: fire-and-forget warm-start for the next prompt.
// Spec §2.3 daemon-detach contract — all three of detached:true,
// stdio:'ignore', child.unref() are required. Anything missing pins the
// hook parent on the child's pipes and the 250ms budget blows up.
//
// Short-circuits when ${QUOTH_HOME}/STARTUP_FAILED exists (sticky flag set
// by daemon-core on fatal boot errors) to avoid a respawn spin-loop.
function spawnDaemonDetached() {
  // Defensive: never spawn a real daemon when QUOTH_HOME points inside the
  // OS temp dir. This is the unambiguous signature of a test scratch home
  // (tests use fs.mkdtempSync(os.tmpdir() + '/quoth-*')), and spawning a
  // detached child against a tmp home that the test rm'd in afterEach
  // leaves reparented orphans. Production QUOTH_HOME lives under $HOME.
  try {
    const tmp = fs.realpathSync(os.tmpdir())
    const home = QUOTH_HOME ? fs.realpathSync(QUOTH_HOME) : ''
    if (home && home.startsWith(tmp + path.sep)) return
  } catch {
    // realpath can fail if QUOTH_HOME was already removed — that itself
    // means the test already cleaned up, so skip the spawn defensively.
    return
  }
  try {
    const { checkStartupFlag } = require(path.join(QUOTH_PLUGIN, 'daemon', 'daemon-core.js'))
    if (checkStartupFlag()) return
  } catch {
    // If daemon-core can't be required for any reason, still attempt the
    // spawn — the daemon itself will re-check the flag at boot.
  }
  const daemonPath = path.join(QUOTH_PLUGIN, 'daemon', 'daemon.js')
  const child = spawn('node', [daemonPath], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    cwd: os.homedir(),
    env: process.env,
  })
  child.unref()
}

// Read stdin (Claude Code sends hook data as JSON)
async function readStdin() {
  if (process.stdin.isTTY) return ''
  return new Promise((resolve) => {
    let data = ''
    const timer = setTimeout(() => {
      process.stdin.removeAllListeners()
      process.stdin.pause()
      resolve(data)
    }, 500)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { data += chunk })
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data) })
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data) })
    process.stdin.resume()
  })
}

const handlers = {
  'route': async (prompt) => {
    // Persist rolling prompt history for trajectory context enrichment.
    // Keeps last 5 prompts so tool calls can reference nearby user intents + planning context.
    try {
      const historyFile = path.join(STATE_DIR, 'prompt-history.json')
      if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true })
      let history = []
      try {
        if (fs.existsSync(historyFile)) {
          history = JSON.parse(fs.readFileSync(historyFile, 'utf8'))
          // Reset if different session
          const currentSession = process.env.CLAUDE_SESSION_ID || null
          if (history.length > 0 && history[0].session !== currentSession) history = []
        }
      } catch { history = [] }
      history.unshift({
        prompt: (prompt || '').slice(0, 500),
        timestamp: Date.now(),
        session: process.env.CLAUDE_SESSION_ID || null
      })
      // Keep last 5
      if (history.length > 5) history.length = 5
      fs.writeFileSync(historyFile, JSON.stringify(history))
    } catch {}

    // Record prompt in session memory for context-aware injection
    const sessionId = process.env.CLAUDE_SESSION_ID || 'default'
    const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
    try {
      const { createSessionMemory } = require('./session-memory.js')
      const sm = createSessionMemory({
        dir: path.join(QUOTH_HOME, 'intelligence'),
        sessionId, project,
      })
      sm.recordPrompt(prompt)
    } catch {}

    // Spec §2.3 route fast-path:
    //   1. GET /inject over unix socket with a hardcoded 200ms timeout
    //   2. Emit matched entities as additionalContext (no stdout banner)
    //   3. On any error (daemon down / hung / slow) → spawn detached for
    //      next prompt, emit nothing, exit clean.
    try {
      const resp = await fetchInject({
        prompt,
        project,
        kinds: 'pattern,decision,anti_pattern',
        limit: 8,
      }, getInjectTimeoutMs())
      const text = formatInjectResults(resp && resp.results)
      if (text) emitAdditionalContext(text)
    } catch {
      try { spawnDaemonDetached() } catch {}
    }
  },

  'session-restore': async () => {
    const intel = getIntelligence()
    const db = getDb()

    // Initialize intelligence graph
    const result = intel.initGraph(db)
    if (result.nodes > 0) {
      console.log(`[INTELLIGENCE] Loaded ${result.nodes} patterns, ${result.edges} edges`)
    }

    // Inject project summary context if available.
    // Looks for: quoth-plugin/context/{project-name}.md, then project-summary.md as fallback.
    // Also checks {CLAUDE_PROJECT_DIR}/.quoth-context.md for project-local context.
    try {
      const projectDir = process.env.CLAUDE_PROJECT_DIR || os.homedir()
      const project = resolveProjectName(projectDir)
      let contextInjected = false

      // 1. Project-specific context in plugin: context/{project}.md
      const projectContextPath = path.join(QUOTH_PLUGIN, 'context', `${project}.md`)
      if (fs.existsSync(projectContextPath)) {
        console.log(fs.readFileSync(projectContextPath, 'utf8'))
        contextInjected = true
      }

      // 2. Fallback: generic project-summary.md (only for the quoth project itself)
      if (!contextInjected) {
        const fallbackPath = path.join(QUOTH_PLUGIN, 'context', 'project-summary.md')
        if (fs.existsSync(fallbackPath) && project === 'quoth') {
          console.log(fs.readFileSync(fallbackPath, 'utf8'))
          contextInjected = true
        }
      }

      // 3. Project-local context: {projectDir}/.quoth-context.md
      const localContextPath = path.join(projectDir, '.quoth-context.md')
      if (fs.existsSync(localContextPath)) {
        console.log(fs.readFileSync(localContextPath, 'utf8'))
      }
    } catch {}

    // Report doc auto-updates ONCE — track last-seen timestamp so updates aren't repeated
    try {
      const manifestPath = path.join(STATE_DIR, 'doc-manifest.json')
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        const lastSeen = manifest.lastReportedAt || 0
        const unseen = (manifest.recentUpdates || []).filter(u => u.timestamp > lastSeen)
        if (unseen.length > 0) {
          const lines = [`[Quoth] ${unseen.length} doc(s) auto-updated:`]
          for (const u of unseen.slice(0, 5)) {
            lines.push(`  - ${u.doc} → v${u.version}`)
          }
          if (unseen.length > 5) lines.push(`  ... and ${unseen.length - 5} more`)
          console.log(lines.join('\n'))
          // Mark as seen
          manifest.lastReportedAt = Date.now()
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
        }
      }
    } catch {}

    // Task 18 / spec §2.3: pattern injection has moved to the route hook
    // (/inject fast-path). session-restore no longer queries the daemon for
    // patterns or doc chunks — it now only initializes the intelligence
    // graph, surfaces project-context.md, and emits the facts block below.

    // --- Facts injection (spec §6.7) ---
    // Pull up to 5 facts per namespace (project + global) from
    // memory_entries and emit a markdown block so Claude Code captures
    // it in the opening context. Only two namespaces per spec §6.6 —
    // there is no facts:user. Silent on error / empty DB.
    try {
      const factsDb = getDb()
      if (!factsDb || typeof factsDb.listFactsByNamespace !== 'function') throw new Error('no_db')

      const factsProject = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
      const namespaces = [
        { label: 'project', ns: `facts:proj:${factsProject}` },
        { label: 'global',  ns: 'facts:global' },
      ]

      const blocks = []
      for (const { label, ns } of namespaces) {
        const rows = factsDb.listFactsByNamespace(ns, 5) || []
        if (rows.length === 0) continue
        const lines = rows.map(r => {
          let parsed
          try { parsed = JSON.parse(r.content) } catch { parsed = { statement: String(r.content || '').slice(0, 200) } }
          const stmt = String(parsed.statement || '').replace(/\s+/g, ' ').trim().slice(0, 240)
          return `- **${r.key}**: ${stmt}`
        })
        const heading = label === 'project' ? `Facts (project — ${factsProject})` : 'Facts (global)'
        blocks.push(`### ${heading}\n${lines.join('\n')}`)
      }

      if (blocks.length > 0) {
        process.stdout.write(`## Facts\n\n${blocks.join('\n\n')}\n`)
      }
    } catch {}
  },

  'session-end': async () => {
    const intel = getIntelligence()
    const db = getDb()
    const result = intel.consolidateGraph(db)
    if (result.entries > 0) {
      console.log(`[INTELLIGENCE] Consolidated: ${result.entries} entries, ${result.edges} edges${result.newEntries > 0 ? `, ${result.newEntries} new` : ''}, PageRank recomputed`)
    }

    // Atomic handoff: active/<sid>.jsonl → processing/<sid>.jsonl
    // Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §4.1, §6.2.
    // The rename is the daemon's claim on the session — once in processing/,
    // the file belongs to the daemon. Fire-and-forget: any failure is silent
    // (missing active file, no session id, race with another end-hook, etc).
    try {
      const sessionId = process.env.CLAUDE_SESSION_ID || null
      if (!sessionId) throw new Error('no_session_id')

      const projectDir = process.env.CLAUDE_PROJECT_DIR || os.homedir()
      const project = resolveProjectName(projectDir)

      // Sanitize sid as a path segment (matches trajectory-capture.js).
      const safeSid = String(sessionId).replace(/[^A-Za-z0-9_\-]/g, '_')
      const activeDir = path.join(QUOTH_HOME, 'trajectories', 'active')
      const processingDir = path.join(QUOTH_HOME, 'trajectories', 'processing')
      const jsonlSrc = path.join(activeDir, `${safeSid}.jsonl`)
      const jsonlDst = path.join(processingDir, `${safeSid}.jsonl`)
      const sidecarSrc = path.join(activeDir, `${safeSid}.meta.json`)
      const sidecarDst = path.join(processingDir, `${safeSid}.meta.json`)

      // If the active JSONL doesn't exist, the hook may have already run
      // (rerun after handoff) or the session never recorded any tool calls.
      // Either way — silent no-op.
      if (!fs.existsSync(jsonlSrc)) throw new Error('no_active_jsonl')

      // Read session's tool_use entries from its own JSONL.
      const lines = fs.readFileSync(jsonlSrc, 'utf8').split('\n').filter(Boolean)
      const sessionEntries = []
      for (const line of lines) {
        try {
          const entry = JSON.parse(line)
          if (entry.event === 'tool_use') sessionEntries.push(entry)
        } catch {}
      }

      // Aggregate tool counts, outcomes, intents, reasonings.
      const toolCounts = {}
      const intents = new Set()
      const reasonings = []
      let successes = 0, failures = 0
      for (const e of sessionEntries) {
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
      const uniqueIntents = [...intents].slice(0, 5)
      const uniqueReasonings = [...new Set(reasonings)].slice(-10)
      const outcome = failures === 0
        ? 'success'
        : (successes > failures ? 'partial' : 'failure')
      const nowTs = Date.now()

      const summaryEntry = {
        event: 'session_summary',
        agent: 'claude-code',
        project,
        session: sessionId,
        task: `Session: ${sessionEntries.length} tool calls (${toolSummary}). ${successes} ok, ${failures} fail.`,
        tool_counts: toolCounts,
        total_calls: sessionEntries.length,
        success_rate: sessionEntries.length > 0 ? successes / sessionEntries.length : 0,
        user_intents: uniqueIntents,
        llm_reasonings: uniqueReasonings,
        outcome,
        source: 'session-end',
        timestamp: nowTs,
      }

      // Write the summary into the session's own JSONL BEFORE the rename,
      // so the summary travels with the file into processing/.
      fs.appendFileSync(jsonlSrc, JSON.stringify(summaryEntry) + '\n')

      // Read-modify-write sidecar: flip to terminated + closed. Field names
      // match the canonical schema (last_seen_ts, tool_count, closed_marker).
      let meta = null
      try {
        meta = JSON.parse(fs.readFileSync(sidecarSrc, 'utf8'))
      } catch {}
      if (!meta || typeof meta !== 'object') {
        meta = {
          session_id: sessionId,
          project,
          first_seen_ts: nowTs,
          source: 'hook',
        }
      }
      meta.status = 'terminated'
      meta.closed_marker = true
      meta.last_seen_ts = nowTs
      meta.tool_count = sessionEntries.length
      meta.summary = {
        total_calls: sessionEntries.length,
        tool_counts: toolCounts,
        outcome,
      }

      const sidecarTmp = sidecarSrc + '.tmp'
      try {
        fs.writeFileSync(sidecarTmp, JSON.stringify(meta))
        fs.renameSync(sidecarTmp, sidecarSrc)
      } catch {
        try { fs.unlinkSync(sidecarTmp) } catch {}
      }

      // Ensure processing/ exists before the rename.
      if (!fs.existsSync(processingDir)) fs.mkdirSync(processingDir, { recursive: true })

      // The rename is the daemon's claim. JSONL first, then sidecar — if we
      // crash between renames, the daemon sees the jsonl in processing/ and
      // can rebuild the sidecar from it.
      fs.renameSync(jsonlSrc, jsonlDst)
      try {
        fs.renameSync(sidecarSrc, sidecarDst)
      } catch {}

      // Signal daemon to consume immediately (batch distill on session end).
      try {
        const pidFile = path.join(QUOTH_HOME, 'daemon.pid')
        if (fs.existsSync(pidFile)) {
          const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim())
          process.kill(pid, 'SIGUSR1')
        }
      } catch {}
    } catch {}

    // Apply feedback + snapshot context for next session
    try {
      const sessionId = process.env.CLAUDE_SESSION_ID || 'default'
      const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
      const { createSessionMemory } = require('./session-memory.js')
      const { applySoftNegative } = require('../daemon/lib/scoring.js')
      const { isSubFlag } = require('../daemon/lib/flags.js')

      const sm = createSessionMemory({
        dir: path.join(QUOTH_HOME, 'intelligence'),
        sessionId, project,
      })

      if (isSubFlag('injection') && db) {
        // V2 feedback: update injection_log with session outcome reward
        const state = sm._state()
        const injectedIds = Object.keys(state.injectedPatterns || {})
        // Compute session-level reward from trajectory (binary outcome for now)
        const trajFile = path.join(QUOTH_HOME, 'trajectories', `${project}-${new Date().toISOString().slice(0,10)}.jsonl`)
        let reward = 0.5
        try {
          if (fs.existsSync(trajFile)) {
            const lines = fs.readFileSync(trajFile, 'utf8').split('\n').filter(Boolean)
            const events = []
            for (const line of lines) {
              try {
                const e = JSON.parse(line)
                if (e.session === sessionId && e.event === 'tool_use') events.push(e)
              } catch (e) {
                console.error('[quoth-v2 session-end] malformed trajectory line:', e.message)
              }
            }
            const { sessionOutcomeReward } = require('../daemon/lib/attribution.js')
            reward = sessionOutcomeReward(events)
          }
        } catch (e) {
          console.error('[quoth-v2 session-end] trajectory read failed:', e.message)
        }
        // Compute session intention for contextual outcomes
        let intentionText = ''
        let intentionEmbedding = null
        try {
          intentionText = (state.prompts || []).slice(0, 3).join(' ').slice(0, 200)
            || (summary && summary.user_intents ? summary.user_intents.join(' ').slice(0, 200) : '')
          if (intentionText.length >= 10) {
            const { generateEmbedding } = require(path.join(QUOTH_PLUGIN, 'daemon', 'lib', 'embed.js'))
            intentionEmbedding = await generateEmbedding(intentionText)
          }
        } catch {}

        for (const pid of injectedIds) {
          const wasUsed = state.injectedPatterns[pid]?.used
          // Used patterns get reward=1.0 (strong signal); unused get session outcome
          const patternReward = wasUsed ? 1.0 : reward
          db.updateInjectionOutcome(sessionId, pid, patternReward)

          // Route Bayesian update to correct table
          if (pid.startsWith('doc:')) {
            const chunkId = pid.slice(4)
            if (patternReward >= 0.7) db.updateDocChunkAlphaBeta(chunkId, 'success')
            else if (patternReward <= 0.3) db.updateDocChunkAlphaBeta(chunkId, 'failure')
            // 0.3-0.7 = neutral, no Bayesian update (avoid noise)
          } else {
            if (patternReward >= 0.7) db.applyBayesianUpdate(pid, 'success')
            else if (patternReward <= 0.3) db.applyBayesianUpdate(pid, 'failure')
          }

          // Contextual outcome recording (skip doc chunks)
          if (!pid.startsWith('doc:') && intentionText && intentionText.length >= 10) {
            let outcomeLabel
            if (wasUsed && reward >= 0.7) outcomeLabel = 'success'
            else if (!wasUsed) outcomeLabel = 'failure'
            else outcomeLabel = 'partial'

            // Half-penalty per spec: used + session failed → beta += 0.5
            if (outcomeLabel === 'partial') {
              try {
                const pat = db.prepare('SELECT beta FROM patterns WHERE id = ?').get(pid)
                if (pat) db.prepare('UPDATE patterns SET beta = ? WHERE id = ?').run(pat.beta + 0.5, pid)
              } catch {}
            }

            const isDup = db.isDuplicateOutcome
              ? db.isDuplicateOutcome(pid, intentionEmbedding, outcomeLabel)
              : false
            if (!isDup) {
              try {
                db.insertOutcome({
                  pattern_id: pid,
                  intention: intentionText,
                  intention_embedding: intentionEmbedding ? JSON.stringify(intentionEmbedding) : null,
                  outcome: outcomeLabel,
                  session_context: JSON.stringify({ project, agent_type: state.routingResult?.agent_type || 'unknown' }),
                  session_id: sessionId,
                })
                if (db.pruneOutcomes) db.pruneOutcomes(pid, 20)
              } catch {}
            }
          }
        }
      } else if (db) {
        // V1 feedback: soft-negative on stale (un-used) injections
        const stale = sm.getStaleInjections(0)
        if (stale.length > 0) applySoftNegative(db, stale)
      }

      // Snapshot context for next session-restore
      const ctx = sm.getContextSummary()
      const ctxPath = path.join(QUOTH_HOME, 'intelligence', `last-context-${project}.json`)
      fs.mkdirSync(path.dirname(ctxPath), { recursive: true })
      fs.writeFileSync(ctxPath, JSON.stringify(ctx))

      // Clean up session memory file
      sm.clear()
    } catch (e) {
      console.error('[quoth session-end] feedback loop failed:', e.message)
    }
  },

  'post-edit': (hookInput) => {
    // Record edit for intelligence
    const file = hookInput.file_path || (hookInput.toolInput && hookInput.toolInput.file_path)
      || process.env.TOOL_INPUT_file_path || ''
    if (file) {
      try {
        const pendingPath = path.join(STATE_DIR, 'pending-insights.jsonl')
        if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true })
        fs.appendFileSync(pendingPath, JSON.stringify({ type: 'edit', file, timestamp: Date.now() }) + '\n')
      } catch {}
    }
    console.log('[OK] Edit recorded')
  },

  'post-task': () => {
    const intel = getIntelligence()
    const result = intel.applyFeedback(true)

    // Also apply Bayesian update to actual DB patterns (not just intelligence graph JSON)
    const db = getDb()
    if (db && result.boosted && result.boosted.length > 0) {
      for (const id of result.boosted) {
        // Intelligence graph IDs are prefixed: pat-{realId} for patterns
        const patternId = id.startsWith('pat-') ? id.slice(4) : null
        if (patternId) {
          // Route doc: IDs to doc_chunks table, regular IDs to patterns table
          if (patternId.startsWith('doc:')) {
            db.updateDocChunkAlphaBeta(patternId.slice(4), 'success')
          } else {
            db.applyBayesianUpdate(patternId, 'success')
          }
        }
      }
    }

    // Positive feedback: mark recently-injected patterns as used (within last 5 min)
    try {
      const sessionId = process.env.CLAUDE_SESSION_ID || 'default'
      const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
      const { createSessionMemory } = require('./session-memory.js')
      const sm = createSessionMemory({
        dir: path.join(QUOTH_HOME, 'intelligence'),
        sessionId, project,
      })

      const fiveMinAgo = Date.now() - 5 * 60 * 1000
      const injections = sm._state().injectedPatterns || {}
      const recentUnused = Object.entries(injections)
        .filter(([, v]) => !v.used && v.at > fiveMinAgo)
        .map(([id]) => id)

      const { isSubFlag } = require('../daemon/lib/flags.js')
      const v2 = isSubFlag('injection')
      for (const id of recentUnused) {
        sm.markPatternUsed(id)
        if (db) {
          if (v2) {
            // V2: record as strong reward in injection_log (nightly SNIPS aggregates)
            db.updateInjectionOutcome(sessionId, id, 1.0)
            // Route Bayesian update to correct table
            if (id.startsWith('doc:')) {
              db.updateDocChunkAlphaBeta(id.slice(4), 'success')
            } else {
              db.applyBayesianUpdate(id, 'success')
            }
          } else {
            db.applyBayesianUpdate(id, 'success')
          }
        }
      }
    } catch (e) {
      console.error('[quoth post-task] feedback loop failed:', e.message)
    }

    console.log('[OK] Task completed')
  },

  'pre-bash': (hookInput) => {
    const cmd = (hookInput.command || '').toLowerCase()
    const dangerous = ['rm -rf /', 'format c:', 'del /s /q c:\\', ':(){:|:&};:']
    for (const d of dangerous) {
      if (cmd.includes(d)) {
        console.error(`[BLOCKED] Dangerous command detected: ${d}`)
        process.exit(1)
      }
    }
    console.log('[OK] Command validated')
  },

  'subagent-start': async (hookInput) => {
    // Task 19 / spec §2.3: fetch relevant knowledge entities from the
    // daemon's /inject fast-path, scoped by the spawned subagent's type
    // (`agent:<type>` tag). Fail-open: daemon down / hung / slow → emit
    // nothing and spawn a warm-start. Drops the legacy chunk table (moved
    // out of the v3 redesign); drops ensureDaemon / queryDaemon /
    // session-memory exposure tracking (legacy pattern-store bookkeeping).
    const agentType = hookInput.agent_type || ''
    const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
    const taskText = hookInput.prompt || hookInput.description || ''

    try {
      const resp = await fetchInject({
        prompt: taskText || 'subagent task',
        project,
        kinds: 'pattern,decision,anti_pattern',
        limit: 5,
        agentType,
      }, getInjectTimeoutMs())
      const results = (resp && resp.results) || []
      if (results.length === 0) return

      const lines = agentType
        ? [`[Quoth] ${results.length} knowledge entities for ${agentType} agent (project: ${project}):`]
        : [`[Quoth] ${results.length} knowledge entities (project: ${project}):`]
      for (const r of results) {
        if (!r || typeof r !== 'object') continue
        const kind = r.kind || 'entity'
        const summary = (r.summary || r.id || '').toString()
        const conf = Number.isFinite(r.confidence) ? r.confidence.toFixed(2) : '0.00'
        lines.push(`- **[${kind}]** (${conf}) ${summary}`)
      }
      const additionalContext = lines.join('\n')
      console.log(JSON.stringify({ additionalContext }))
    } catch {
      try { spawnDaemonDetached() } catch {}
    }
  },

  'stats': () => {
    const intel = getIntelligence()
    const result = intel.getStats(getDb())
    console.log(JSON.stringify(result, null, 2))
  },
}

async function main() {
  const [,, command, ...args] = process.argv

  let stdinData = ''
  try { stdinData = await readStdin() } catch {}

  let hookInput = {}
  if (stdinData.trim()) {
    try { hookInput = JSON.parse(stdinData) } catch {}
  }

  const prompt = hookInput.prompt || hookInput.command || hookInput.toolInput
    || process.env.PROMPT || process.env.TOOL_INPUT_command || args.join(' ') || ''

  if (command && handlers[command]) {
    try {
      if (command === 'route') {
        await handlers[command](prompt)
      } else if (command === 'post-edit' || command === 'pre-bash' || command === 'subagent-start') {
        await handlers[command](hookInput)
      } else {
        await handlers[command]()
      }
    } catch (e) {
      console.log(`[WARN] Hook ${command} error: ${e.message}`)
    }
  } else if (command) {
    console.log(`[OK] Hook: ${command}`)
  } else {
    console.log('Usage: hook-dispatch.js <route|session-restore|session-end|post-edit|post-task|pre-bash|subagent-start|stats>')
  }
}

process.exitCode = 0
main().catch((e) => {
  try { console.log(`[WARN] Hook error: ${e.message}`) } catch {}
}).finally(() => {
  process.exit(0)
})
