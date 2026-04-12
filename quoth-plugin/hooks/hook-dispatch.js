#!/usr/bin/env node
/**
 * Quoth Unified Hook Dispatcher (greenfield reset v3.6).
 *
 * Post Task 24 this file is the minimal surface that bridges Claude Code
 * hooks to the new knowledge_entities pipeline. Intelligence graph,
 * session-memory, v1/v2 feedback loops, doc-manifest reporting, and all
 * pattern/memory_entries coupling have been deleted.
 *
 * Commands:
 *   route           - UserPromptSubmit → GET /inject fast-path (spec §2.3)
 *   session-restore - SessionStart → project-context.md + facts injection
 *   session-end     - SessionEnd/PreCompact → atomic active/→processing/ rename
 *   pre-bash        - PreToolUse Bash → dangerous-command guard
 *   subagent-start  - SubagentStart → GET /inject with agent_type filter
 */

'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const http = require('http')
const { spawn } = require('child_process')

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const DB_PATH = path.join(QUOTH_HOME, 'memory.db')
const SOCK_PATH = path.join(QUOTH_HOME, 'daemon.sock')

// Resolve quoth-plugin root: follow symlinks to find the real source location.
const REAL_DIR = fs.realpathSync(__dirname)
const QUOTH_PLUGIN = process.env.QUOTH_PLUGIN_DIR || path.join(REAL_DIR, '..')

function resolveProjectName(dir) {
  try {
    const { execSync } = require('child_process')
    const url = execSync('git remote get-url origin', { cwd: dir, timeout: 1000, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
    const match = url.match(/[/:]([^/]+\/([^/]+?))(\.git)?$/)
    if (match) return match[2].toLowerCase()
  } catch {}
  const base = path.basename(dir)
  const wsMatch = dir.match(/\.openclaw\/workspaces\/([^/]+)\/repo\/?$/)
  if (wsMatch) return wsMatch[1]
  if (base === 'repo' || base === 'src') return path.basename(path.dirname(dir))
  return base
}

// Lazy-load db (read-only path for facts injection — no writes from hooks).
let _db = null
function getDb() {
  if (_db) return _db
  try {
    const { createDb } = require(path.join(QUOTH_PLUGIN, 'daemon', 'db.js'))
    _db = createDb(DB_PATH)
  } catch {}
  return _db
}

// --- Task 17: route fast-path helpers (spec §2.3) ---
function getInjectTimeoutMs() {
  const raw = process.env.QUOTH_DAEMON_SOCKET_TIMEOUT_MS
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 200
}

// GET /inject URLs encode the full prompt into the query string. Node's
// default http parser caps request header size at ~16KB, so a pasted stack
// trace can deterministically fail the socket. Truncating the prompt at the
// hook boundary is safer than renegotiating to POST.
const MAX_PROMPT_BYTES = 4096
function truncatePrompt(prompt) {
  if (prompt == null) return prompt
  const s = String(prompt)
  return s.length > MAX_PROMPT_BYTES ? s.slice(0, MAX_PROMPT_BYTES) : s
}

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

// resolveAgentType: normalize a Claude Code Task subagent_type to one of the
// canonical Quoth agent types used in `agent:<type>` tags. Uses routing.js
// AGENT_TYPES + routeTask. Returns '' when no canonical type can be derived.
function resolveAgentType(rawType, prompt) {
  let AGENT_TYPES, routeTask
  try {
    ({ AGENT_TYPES, routeTask } = require(path.join(QUOTH_PLUGIN, 'mcp', 'lib', 'routing.js')))
  } catch { return '' }
  const normalized = String(rawType || '').trim().toLowerCase()
  if (normalized && AGENT_TYPES.includes(normalized)) return normalized
  if (prompt) {
    try {
      const r = routeTask(String(prompt))
      if (r && r.agent && AGENT_TYPES.includes(r.agent)) return r.agent
    } catch {}
  }
  return ''
}

function emitAdditionalContext(text) {
  if (!text) return
  console.log(JSON.stringify({ additionalContext: text }))
}

// formatInjectResults: render the /inject response array as a markdown block.
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
// Spec §2.3 daemon-detach contract — detached:true, stdio:'ignore',
// child.unref() are all required. Short-circuits on STARTUP_FAILED flag
// and when QUOTH_HOME is under os.tmpdir() (test scratch homes).
function spawnDaemonDetached() {
  try {
    const tmp = fs.realpathSync(os.tmpdir())
    const home = QUOTH_HOME ? fs.realpathSync(QUOTH_HOME) : ''
    if (home && home.startsWith(tmp + path.sep)) return
  } catch {
    return
  }
  try {
    const { checkStartupFlag } = require(path.join(QUOTH_PLUGIN, 'daemon', 'daemon-core.js'))
    if (checkStartupFlag()) return
  } catch {}
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
    const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())

    // Spec §2.3 route fast-path:
    //   1. GET /inject over unix socket with a short timeout
    //   2. Emit matched entities as additionalContext
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
    // Inject project summary context if available.
    // Looks for: quoth-plugin/context/{project-name}.md, then project-summary.md as fallback.
    // Also checks {CLAUDE_PROJECT_DIR}/.quoth-context.md for project-local context.
    try {
      const projectDir = process.env.CLAUDE_PROJECT_DIR || os.homedir()
      const project = resolveProjectName(projectDir)
      let contextInjected = false

      const projectContextPath = path.join(QUOTH_PLUGIN, 'context', `${project}.md`)
      if (fs.existsSync(projectContextPath)) {
        console.log(fs.readFileSync(projectContextPath, 'utf8'))
        contextInjected = true
      }

      if (!contextInjected) {
        const fallbackPath = path.join(QUOTH_PLUGIN, 'context', 'project-summary.md')
        if (fs.existsSync(fallbackPath) && project === 'quoth') {
          console.log(fs.readFileSync(fallbackPath, 'utf8'))
          contextInjected = true
        }
      }

      const localContextPath = path.join(projectDir, '.quoth-context.md')
      if (fs.existsSync(localContextPath)) {
        console.log(fs.readFileSync(localContextPath, 'utf8'))
      }
    } catch {}

    // --- Facts injection (spec §3, §5.4) ---
    // Query knowledge_entities directly for kind='fact' (top 5 per scope,
    // ordered by confidence). Facts are session-start-only — they never
    // appear in /inject results (spec §5.4). Two scopes per spec §6.6:
    // `project:<name>` and `global`. Silent on error / empty DB.
    try {
      const db = getDb()
      if (!db) throw new Error('no_db')

      const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
      const scopes = [
        { label: 'project', scope: `project:${project}` },
        { label: 'global',  scope: 'global' },
      ]

      const rowsByScope = {}
      for (const { label, scope } of scopes) {
        let rows = []
        try {
          rows = db.prepare(`
            SELECT id, summary, content, confidence
            FROM knowledge_entities
            WHERE kind = 'fact' AND status = 'active' AND scope = ?
            ORDER BY confidence DESC
            LIMIT 5
          `).all(scope)
        } catch { rows = [] }
        if (rows.length > 0) rowsByScope[label] = rows
      }

      const blocks = []
      for (const label of ['project', 'global']) {
        const rows = rowsByScope[label]
        if (!rows) continue
        const heading = label === 'project' ? `Facts (project — ${project})` : 'Facts (global)'
        const lines = rows.map(r => {
          const summary = String(r.summary || '').trim().slice(0, 240)
          return `- ${summary}`
        })
        blocks.push(`### ${heading}\n${lines.join('\n')}`)
      }

      if (blocks.length > 0) {
        process.stdout.write(`## Facts\n\n${blocks.join('\n\n')}\n`)
      }
    } catch {}
  },

  'session-end': async () => {
    // Atomic handoff: active/<sid>.jsonl → processing/<sid>.jsonl
    // Spec: docs/superpowers/specs/2026-04-10-session-isolation.md §4.1, §6.2.
    // The rename is the daemon's claim on the session — once in processing/,
    // the file belongs to the daemon. Fire-and-forget: any failure is silent.
    try {
      const sessionId = process.env.CLAUDE_SESSION_ID || null
      if (!sessionId) throw new Error('no_session_id')

      const projectDir = process.env.CLAUDE_PROJECT_DIR || os.homedir()
      const project = resolveProjectName(projectDir)

      const safeSid = String(sessionId).replace(/[^A-Za-z0-9_\-]/g, '_')
      const activeDir = path.join(QUOTH_HOME, 'trajectories', 'active')
      const processingDir = path.join(QUOTH_HOME, 'trajectories', 'processing')
      const jsonlSrc = path.join(activeDir, `${safeSid}.jsonl`)
      const jsonlDst = path.join(processingDir, `${safeSid}.jsonl`)
      const sidecarSrc = path.join(activeDir, `${safeSid}.meta.json`)
      const sidecarDst = path.join(processingDir, `${safeSid}.meta.json`)

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

      // Read-modify-write sidecar: flip to terminated + closed.
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

      if (!fs.existsSync(processingDir)) fs.mkdirSync(processingDir, { recursive: true })

      // The rename is the daemon's claim. JSONL first, then sidecar.
      fs.renameSync(jsonlSrc, jsonlDst)
      try {
        fs.renameSync(sidecarSrc, sidecarDst)
      } catch {}

      // Signal daemon to consume immediately.
      try {
        const pidFile = path.join(QUOTH_HOME, 'daemon.pid')
        if (fs.existsSync(pidFile)) {
          const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim())
          process.kill(pid, 'SIGUSR1')
        }
      } catch {}
    } catch {}
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
    // nothing and spawn a warm-start.
    const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
    const taskText = hookInput.prompt || hookInput.description || ''
    const agentType = resolveAgentType(hookInput.agent_type, taskText)

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
      } else if (command === 'pre-bash' || command === 'subagent-start') {
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
    console.log('Usage: hook-dispatch.js <route|session-restore|session-end|pre-bash|subagent-start>')
  }
}

process.exitCode = 0
main().catch((e) => {
  try { console.log(`[WARN] Hook error: ${e.message}`) } catch {}
}).finally(() => {
  process.exit(0)
})
