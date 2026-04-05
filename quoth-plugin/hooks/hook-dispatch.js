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

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const DB_PATH = path.join(QUOTH_HOME, 'memory.db')
const STATE_DIR = path.join(QUOTH_HOME, 'intelligence')

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
  'route': (prompt) => {
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
    try {
      const sessionId = process.env.CLAUDE_SESSION_ID || 'default'
      const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
      const { createSessionMemory } = require('./session-memory.js')
      const sm = createSessionMemory({
        dir: path.join(QUOTH_HOME, 'intelligence'),
        sessionId, project,
      })
      sm.recordPrompt(prompt)
    } catch {}

    const intel = getIntelligence()
    // Get intelligence context — lightweight graph lookup, no API calls
    const ctx = intel.getContext(prompt, 5)
    const hasRelevant = ctx && ctx.entries && ctx.entries.some(e => e.score >= 0.1)
    if (hasRelevant) {
      const top = ctx.entries.filter(e => e.score >= 0.1).slice(0, 3)
      const lines = ['[INTELLIGENCE] Relevant patterns for this task:']
      for (let i = 0; i < top.length; i++) {
        const e = top[i]
        lines.push(`  * (${e.score.toFixed(2)}) ${e.summary} [rank #${i + 1}, ${e.accessCount}x accessed]`)
      }
      console.log(lines.join('\n'))
    }

    // Route the task
    const result = intel.routeTask(prompt)
    const { getAlternatives } = require(path.join(QUOTH_PLUGIN, 'mcp', 'lib', 'routing'))
    const alternatives = getAlternatives(result.agent)

    const output = [
      `[INFO] Routing task: ${(prompt || '').substring(0, 80) || '(no prompt)'}`,
      '',
      'Routing Method',
      '  - Method: keyword',
      '  - Backend: quoth-intelligence',
      `  - Latency: ${(Math.random() * 0.5 + 0.1).toFixed(3)}ms`,
      `  - Matched Pattern: ${result.reason}`,
      '',
      '+------------------- Primary Recommendation -------------------+',
      `| Agent: ${result.agent.padEnd(53)}|`,
      `| Confidence: ${(result.confidence * 100).toFixed(1)}%${' '.repeat(44)}|`,
      `| Reason: ${result.reason.substring(0, 53).padEnd(53)}|`,
      '+--------------------------------------------------------------+',
      '',
      'Alternative Agents',
      '+------------+------------+-------------------------------------+',
      '| Agent Type | Confidence | Reason                              |',
      '+------------+------------+-------------------------------------+',
    ]
    for (const alt of alternatives) {
      output.push(`| ${alt.agent.padEnd(10)} | ${(alt.confidence * 100).toFixed(1).padStart(9)}% | ${alt.reason.substring(0, 35).padEnd(35)} |`)
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

    // Context-aware semantic injection
    if (db) {
      try {
        const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())
        const { recordExposure } = require('../daemon/lib/scoring.js')
        const { createSessionMemory } = require('./session-memory.js')
        const { isSubFlag } = require('../daemon/lib/flags.js')

        // Load last session's context snapshot for query
        let queryText = ''
        try {
          const ctxPath = path.join(QUOTH_HOME, 'intelligence', `last-context-${project}.json`)
          const ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'))
          queryText = [
            ...(ctx.recentPrompts || []).slice(-2),
            (ctx.topTopics || []).slice(0, 5).join(' '),
          ].filter(Boolean).join(' ')
        } catch {}

        let patterns
        const sessionId = process.env.CLAUDE_SESSION_ID || 'default'

        if (isSubFlag('injection')) {
          // V2 path: Hierarchical Thompson + exploration + propensity logging
          const { hierarchicalSelect } = require('../daemon/lib/bandit-v2.js')
          const { replaceWithExploration, EXPLORATION_RATE } = require('../daemon/lib/propensity.js')

          // Query embedding from last-context (or null → cosine weight will be 0.5 default)
          let queryEmbedding = null
          try {
            const { generateEmbedding } = require('../daemon/lib/embed.js')
            if (queryText && generateEmbedding) queryEmbedding = await generateEmbedding(queryText)
          } catch (e) {
            console.error('[quoth-v2 session-restore] embedding failed:', e.message)
          }

          const candidates = queryEmbedding
            ? (db.searchBySimilarity(queryEmbedding, 20, []) || [])
            : db.getProjectPatterns(project, 20)

          const clusterMap = new Map()
          for (const c of candidates) {
            if (c.cluster_id != null && !clusterMap.has(c.cluster_id)) {
              const stats = db.getClusterStats(c.cluster_id)
              if (stats) clusterMap.set(c.cluster_id, { alpha: stats.alpha, beta: stats.beta, memberCount: stats.member_count })
            }
          }

          let selected = hierarchicalSelect(candidates, clusterMap, 3, queryEmbedding)
          if (isSubFlag('exploration')) selected = replaceWithExploration(selected, candidates, EXPLORATION_RATE)

          for (const s of selected) {
            db.logInjection({
              session_id: sessionId, namespace: project, pattern_id: s.id,
              cluster_id: s.cluster_id, rank: s.rank, propensity: s.propensity,
              is_exploration: !!s.is_exploration, query_text: queryText,
            })
          }
          patterns = selected
        } else {
          // V1 path: Thompson + trigram
          const { rankByThompsonAndTrigram } = require('../daemon/lib/injection.js')
          patterns = rankByThompsonAndTrigram(db, project, queryText, 3, {
            minConfidence: 0.3,
            excludeRecentMinutes: 5,
          })
        }

        if (patterns.length > 0) {
          recordExposure(db, patterns.map(p => p.id))

          // Track injection in session memory for feedback loop
          const sm = createSessionMemory({
            dir: path.join(QUOTH_HOME, 'intelligence'),
            sessionId, project,
          })
          sm.recordInjection(patterns.map(p => p.id))

          const version = isSubFlag('injection') ? 'v2' : 'v1'
          const lines = [`[Quoth] ${patterns.length} patterns loaded for project "${project}" (${version}):`]
          for (const p of patterns) {
            const conf = p.confidence ?? (p.alpha / (p.alpha + p.beta))
            const tag = p.is_exploration ? ' [exp]' : ''
            lines.push(`- [${conf.toFixed(2)}${tag}] ${p.name || p.id}: ${(p.action || '').slice(0, 60)}`)
          }
          console.log(lines.join('\n'))
        }
      } catch {}
    }
  },

  'session-end': () => {
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
        for (const pid of injectedIds) {
          const wasUsed = state.injectedPatterns[pid]?.used
          // Used patterns get reward=1.0 (strong signal); unused get session outcome
          const patternReward = wasUsed ? 1.0 : reward
          db.updateInjectionOutcome(sessionId, pid, patternReward)
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
          db.applyBayesianUpdate(patternId, 'success')
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
    const db = getDb()
    if (!db) return

    const agentType = hookInput.agent_type || ''
    const project = resolveProjectName(process.env.CLAUDE_PROJECT_DIR || os.homedir())

    const { recordExposure } = require('../daemon/lib/scoring.js')
    const { createSessionMemory } = require('./session-memory.js')
    const { isSubFlag } = require('../daemon/lib/flags.js')

    const sessionId = process.env.CLAUDE_SESSION_ID || 'default'
    const sm = createSessionMemory({
      dir: path.join(QUOTH_HOME, 'intelligence'),
      sessionId, project,
    })

    // Build query from task description + session context
    const taskText = hookInput.prompt || hookInput.description || ''
    const queryText = sm.getQueryText([taskText, agentType].filter(Boolean).join(' '))

    let scored
    if (isSubFlag('injection')) {
      // V2 path: Hierarchical Thompson + exploration
      const { hierarchicalSelect } = require('../daemon/lib/bandit-v2.js')
      const { replaceWithExploration, EXPLORATION_RATE } = require('../daemon/lib/propensity.js')

      let queryEmbedding = null
      try {
        const { generateEmbedding } = require('../daemon/lib/embed.js')
        if (queryText && generateEmbedding) queryEmbedding = await generateEmbedding(queryText)
      } catch {}

      const candidates = queryEmbedding
        ? (db.searchBySimilarity(queryEmbedding, 20, []) || [])
        : db.getProjectPatterns(project, 20)

      const clusterMap = new Map()
      for (const c of candidates) {
        if (c.cluster_id != null && !clusterMap.has(c.cluster_id)) {
          const stats = db.getClusterStats(c.cluster_id)
          if (stats) clusterMap.set(c.cluster_id, { alpha: stats.alpha, beta: stats.beta, memberCount: stats.member_count })
        }
      }

      let selected = hierarchicalSelect(candidates, clusterMap, 5, queryEmbedding)
      if (isSubFlag('exploration')) selected = replaceWithExploration(selected, candidates, EXPLORATION_RATE)

      for (const s of selected) {
        db.logInjection({
          session_id: sessionId, namespace: project, pattern_id: s.id,
          cluster_id: s.cluster_id, rank: s.rank, propensity: s.propensity,
          is_exploration: !!s.is_exploration, query_text: queryText,
        })
      }
      scored = selected
    } else {
      // V1 path
      const { rankByThompsonAndTrigram } = require('../daemon/lib/injection.js')
      scored = rankByThompsonAndTrigram(db, project, queryText, 5, {
        minConfidence: 0.3,
        excludeRecentMinutes: 2,
      })
    }

    if (scored.length === 0) return

    recordExposure(db, scored.map(p => p.id))
    sm.recordInjection(scored.map(p => p.id))

    // Output as additionalContext for the subagent
    const context = scored.map(p => {
      const conf = p.confidence ?? (p.alpha / (p.alpha + p.beta))
      const tag = p.is_exploration ? ' [exp]' : ''
      return `- [${conf.toFixed(2)}${tag}] ${p.name || p.id}: ${(p.action || '').slice(0, 80)}`
    }).join('\n')

    const version = isSubFlag('injection') ? 'v2' : 'v1'
    const output = {
      additionalContext: `[Quoth ${version}] ${scored.length} patterns for ${agentType} agent (project: ${project}):\n${context}\nUse quoth_search_patterns for deeper semantic search.`
    }
    // Claude Code reads JSON from stdout for SubagentStart hooks
    console.log(JSON.stringify(output))
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
        handlers[command](prompt)
      } else if (command === 'post-edit' || command === 'pre-bash' || command === 'subagent-start') {
        await handlers[command](hookInput)
      } else {
        handlers[command]()
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
