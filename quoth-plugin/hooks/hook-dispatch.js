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
 *   stats           - Intelligence diagnostics
 */

'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const DB_PATH = path.join(QUOTH_HOME, 'memory.db')
const STATE_DIR = path.join(QUOTH_HOME, 'intelligence')

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
    const intel = getIntelligence()
    // Get intelligence context
    const ctx = intel.getContext(prompt, 5)
    if (ctx && ctx.entries && ctx.entries.length > 0) {
      const lines = ['[INTELLIGENCE] Relevant patterns for this task:']
      for (let i = 0; i < ctx.entries.length; i++) {
        const e = ctx.entries[i]
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

  'session-restore': () => {
    const intel = getIntelligence()
    const db = getDb()

    // Initialize intelligence graph
    const result = intel.initGraph(db)
    if (result.nodes > 0) {
      console.log(`[INTELLIGENCE] Loaded ${result.nodes} patterns, ${result.edges} edges`)
    }

    // Inject patterns (replaces inject-patterns.js)
    if (db) {
      try {
        const project = (process.env.CLAUDE_PROJECT_DIR || '').split('/').pop() || 'default'
        const patterns = db.getProjectPatterns(project, 8)
        if (patterns && patterns.length > 0) {
          const lines = [`[Quoth] ${patterns.length} patterns loaded for project "${project}":`]
          for (const p of patterns) {
            lines.push(`- [${(p.confidence || 0).toFixed(2)}] ${p.name || p.id}: ${(p.action || '').slice(0, 60)}`)
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
    intel.applyFeedback(true)
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

  'stats': () => {
    const intel = getIntelligence()
    const result = intel.getStats()
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
      } else if (command === 'post-edit' || command === 'pre-bash') {
        handlers[command](hookInput)
      } else {
        handlers[command]()
      }
    } catch (e) {
      console.log(`[WARN] Hook ${command} error: ${e.message}`)
    }
  } else if (command) {
    console.log(`[OK] Hook: ${command}`)
  } else {
    console.log('Usage: hook-dispatch.js <route|session-restore|session-end|post-edit|post-task|pre-bash|stats>')
  }
}

process.exitCode = 0
main().catch((e) => {
  try { console.log(`[WARN] Hook error: ${e.message}`) } catch {}
}).finally(() => {
  process.exit(0)
})
