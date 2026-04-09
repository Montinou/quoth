#!/usr/bin/env node
/**
 * Quoth Unified Hook Dispatcher
 * Replaces ~/.claude/helpers/hook-handler.cjs by using quoth handlers directly.
 *
 * Usage: node hook-dispatch.js <command> [args...]
 *
 * Commands:
 *   route           - Route task to optimal agent
 *   session-restore - Initialize intelligence graph + inject patterns
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

    // Query daemon for unified routing + injection + doc chunks
    await ensureDaemon()
    const t0 = Date.now()
    const resp = await queryDaemon({
      prompt, project, session_id: sessionId, limit: 5, type: 'route+inject'
    })
    const latency = Date.now() - t0

    // Collect all IDs for exposure tracking (patterns + doc chunks)
    const allIds = (resp.patterns || []).map(p => p.id)
    const docChunks = resp.doc_chunks || []
    const relevantDocs = docChunks.filter(c => c.score > 0.2)
    for (const c of relevantDocs) {
      if (c.id) allIds.push(c.id)
    }

    // Pattern injection output
    if (resp.patterns && resp.patterns.length > 0) {
      try {
        const { recordExposure } = require('../daemon/lib/scoring.js')
        const { createSessionMemory } = require('./session-memory.js')
        const db = getDb()
        if (db) recordExposure(db, allIds)
        const sm = createSessionMemory({ dir: path.join(QUOTH_HOME, 'intelligence'), sessionId, project })
        sm.recordInjection(allIds)
      } catch {}

      const lines = ['[Quoth] Patterns for this prompt:']
      for (const p of resp.patterns) {
        lines.push(`- [${(p.confidence || 0).toFixed(2)}] ${p.name || p.id}: ${(p.action || '').slice(0, 80)}`)
      }
      console.log(lines.join('\n'))
    }

    // Doc chunk injection output
    if (relevantDocs.length > 0) {
      const lines = ['[Quoth Docs] Relevant project context:']
      for (const c of relevantDocs) {
        lines.push(`  • [${c.title}] ${(c.content || '').slice(0, 250)}`)
      }
      console.log(lines.join('\n'))
    }

    // Routing output
    const agent = resp.agent || 'coder'
    const confidence = resp.agent_confidence || 0.5
    const reason = resp.agent_reason || 'Default routing'
    const alternatives = resp.alternatives || []

    const output = [
      `[INFO] Routing task: ${(prompt || '').substring(0, 80) || '(no prompt)'}`,
      '',
      'Routing Method',
      '  - Method: semantic+keyword',
      '  - Backend: quoth-daemon',
      `  - Latency: ${latency}ms (embed: ${resp.embedding_ms || 0}ms, search: ${resp.search_ms || 0}ms)`,
      `  - Matched Pattern: ${reason}`,
      '',
      '+------------------- Primary Recommendation -------------------+',
      `| Agent: ${agent.padEnd(53)}|`,
      `| Confidence: ${(confidence * 100).toFixed(1)}%${' '.repeat(44)}|`,
      `| Reason: ${reason.substring(0, 53).padEnd(53)}|`,
      '+--------------------------------------------------------------+',
      '',
      'Alternative Agents',
      '+------------+------------+-------------------------------------+',
      '| Agent Type | Confidence | Reason                              |',
      '+------------+------------+-------------------------------------+',
    ]
    for (const alt of alternatives) {
      output.push(`| ${(alt.agent || '').padEnd(10)} | ${((alt.confidence || 0) * 100).toFixed(1).padStart(9)}% | ${(alt.reason || '').substring(0, 35).padEnd(35)} |`)
    }
    output.push('+------------+------------+-------------------------------------+')
    output.push('')
    output.push('Estimated Metrics')
    output.push('  - Success Probability: 70.0%')
    output.push('  - Estimated Duration: 10-30 min')
    output.push('  - Complexity: LOW')

    console.log(output.join('\n'))
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

    // Context-aware semantic injection via daemon query
    try {
      const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
      const sessionId = process.env.CLAUDE_SESSION_ID || 'default'

      // Load last session's context for query
      let queryText = ''
      try {
        const ctxPath = path.join(QUOTH_HOME, 'intelligence', `last-context-${project}.json`)
        const ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'))
        queryText = [
          ...(ctx.recentPrompts || []).slice(-2),
          (ctx.topTopics || []).slice(0, 5).join(' '),
        ].filter(Boolean).join(' ')
      } catch {}

      if (queryText || true) {
        await ensureDaemon()
        const resp = await queryDaemon({
          prompt: queryText || 'session start',
          project, session_id: sessionId, limit: 7, type: 'inject'
        })

        const patterns = resp.patterns || []
        const allIds = patterns.map(p => p.id)

        // Collect doc chunk IDs for unified tracking
        const docChunks = resp.doc_chunks || []
        const relevantDocs = docChunks.filter(c => c.score > 0.2)
        if (relevantDocs.length > 0) {
          for (const c of relevantDocs) {
            if (c.id) allIds.push(c.id)
          }
        }

        if (patterns.length > 0 || relevantDocs.length > 0) {
          try {
            const { recordExposure } = require('../daemon/lib/scoring.js')
            const { createSessionMemory } = require('./session-memory.js')
            const db = getDb()
            if (db) recordExposure(db, allIds)
            const sm = createSessionMemory({ dir: path.join(QUOTH_HOME, 'intelligence'), sessionId, project })
            sm.recordInjection(allIds)
          } catch {}

          if (patterns.length > 0) {
            const lines = [`[Quoth] ${patterns.length} patterns loaded for project "${project}":`]
            for (const p of patterns) {
              lines.push(`- [${(p.confidence || 0).toFixed(2)}] ${p.name || p.id}: ${(p.action || '').slice(0, 60)}`)
            }
            console.log(lines.join('\n'))
          }

          // Doc chunk injection at session start
          if (relevantDocs.length > 0) {
            const docLines = ['[Quoth Docs] Session context:']
            for (const c of relevantDocs) {
              const label = (c.doc_file || c.title || '').replace('.md', '').replace(/^\d+-/, '')
              docLines.push(`  • [${label}] ${(c.content || '').slice(0, 150)}`)
            }
            console.log(docLines.join('\n'))
          }
        }
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

    // Write session summary to trajectory JSONL for downstream learning
    try {
      const sessionId = process.env.CLAUDE_SESSION_ID || null
      const projectDir = process.env.CLAUDE_PROJECT_DIR || os.homedir()
      const project = resolveProjectName(projectDir)
      const date = new Date().toISOString().slice(0, 10)
      const trajFile = path.join(QUOTH_HOME, 'trajectories', `${project}-${date}.jsonl`)

      if (!fs.existsSync(trajFile)) throw new Error('no_traj')

      // Read session's tool calls from today's trajectory file
      const lines = fs.readFileSync(trajFile, 'utf8').split('\n').filter(Boolean)
      const sessionEntries = []
      for (const line of lines) {
        try {
          const entry = JSON.parse(line)
          if (entry.session === sessionId && entry.event === 'tool_use') {
            sessionEntries.push(entry)
          }
        } catch {}
      }

      if (sessionEntries.length === 0) throw new Error('no_entries')

      // Build summary
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
      // Keep unique reasoning snippets (deduped, last 10)
      const uniqueReasonings = [...new Set(reasonings)].slice(-10)

      const summary = {
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
        outcome: failures === 0 ? 'success' : (successes > failures ? 'partial' : 'failure'),
        source: 'session-end',
        timestamp: Date.now()
      }

      fs.appendFileSync(trajFile, JSON.stringify(summary) + '\n')

      // Signal daemon to process immediately (batch distill on session_summary)
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
    const agentType = hookInput.agent_type || ''
    const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
    const sessionId = process.env.CLAUDE_SESSION_ID || 'default'
    const taskText = hookInput.prompt || hookInput.description || ''

    try {
      await ensureDaemon()
      const agentTag = agentType ? [`agent:${agentType}`] : []
      let resp = await queryDaemon({
        prompt: taskText || 'subagent task',
        project, session_id: sessionId, limit: 5, type: 'inject',
        tags: agentTag,
      })

      // Fallback: if too few results with tag filter, retry without tags
      if (agentTag.length > 0 && (resp.patterns || []).length < 2) {
        resp = await queryDaemon({
          prompt: taskText || 'subagent task',
          project, session_id: sessionId, limit: 5, type: 'inject',
          tags: [],
        })
      }

      const scored = resp.patterns || []
      const docChunks = resp.doc_chunks || []
      const relevantDocs = docChunks.filter(c => c.score > 0.2)

      if (scored.length === 0 && relevantDocs.length === 0) return

      // Track all injected IDs (patterns + doc chunks)
      const allIds = [...scored.map(p => p.id), ...relevantDocs.filter(c => c.id).map(c => c.id)]
      try {
        const { recordExposure } = require('../daemon/lib/scoring.js')
        const { createSessionMemory } = require('./session-memory.js')
        const db = getDb()
        if (db) recordExposure(db, allIds)
        const sm = createSessionMemory({ dir: path.join(QUOTH_HOME, 'intelligence'), sessionId, project })
        sm.recordInjection(allIds)
      } catch {}

      let additionalContext = ''
      if (scored.length > 0) {
        const context = scored.map(p =>
          `- [${(p.confidence || 0).toFixed(2)}] ${p.name || p.id}: ${(p.action || '').slice(0, 80)}`
        ).join('\n')
        additionalContext = `[Quoth] ${scored.length} patterns for ${agentType} agent (project: ${project}):\n${context}\nUse quoth_search_patterns for deeper semantic search.`
      }

      // Append doc chunks to additionalContext
      if (relevantDocs.length > 0) {
        const docContext = relevantDocs
          .map(c => `- [doc] ${c.title || ''}: ${(c.content || '').slice(0, 100)}`)
          .join('\n')
        additionalContext += `${additionalContext ? '\n\n' : ''}[Quoth Docs] Relevant documentation:\n${docContext}`
      }

      if (additionalContext) {
        console.log(JSON.stringify({ additionalContext }))
      }
    } catch {}
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
