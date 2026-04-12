#!/usr/bin/env node
'use strict'

/**
 * Quoth CLI — Interactive onboarding and management.
 * Usage: node cli.js init | node cli.js status | node cli.js restart
 * Future: npx quoth init (when published to npm)
 */

const readline = require('readline')
const { execSync, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const { resetQuothHome, WIPE_PATHS } = require('./reset-quoth-home.js')

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const PLUGIN_DIR = path.resolve(__dirname, '..')
const VERSION = '3.6.1'

// --- Colors (ANSI, no deps) ---
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
}

const ok = (msg) => console.log(`  ${c.green}✓${c.reset} ${msg}`)
const warn = (msg) => console.log(`  ${c.yellow}⚠${c.reset} ${msg}`)
const fail = (msg) => console.log(`  ${c.red}✗${c.reset} ${msg}`)
const info = (msg) => console.log(`  ${c.dim}${msg}${c.reset}`)

function banner() {
  console.log(`
  ${c.cyan}${c.bold}╭─────────────────────────────────╮${c.reset}
  ${c.cyan}${c.bold}│   Quoth v${VERSION} — Self-Learning  │${c.reset}
  ${c.cyan}${c.bold}╰─────────────────────────────────╯${c.reset}
`)
}

// --- Prompts (readline, no deps) ---
function createPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return {
    ask(question) {
      return new Promise(resolve => rl.question(`  ${c.cyan}?${c.reset} ${question} `, resolve))
    },
    select(question, options) {
      return new Promise(resolve => {
        console.log(`  ${c.cyan}?${c.reset} ${question}`)
        options.forEach((opt, i) => {
          console.log(`    ${c.dim}${i + 1})${c.reset} ${opt.label}${opt.hint ? ` ${c.gray}${opt.hint}${c.reset}` : ''}`)
        })
        rl.question(`  ${c.dim}  Enter choice [1-${options.length}]:${c.reset} `, answer => {
          const idx = parseInt(answer) - 1
          resolve(options[Math.max(0, Math.min(idx, options.length - 1))].value)
        })
      })
    },
    close() { rl.close() }
  }
}

// --- Detection ---
function detectClaude() {
  try { execSync('claude --version', { stdio: 'pipe' }); return true } catch { return false }
}

function detectNode() {
  return process.version
}

function isDaemonRunning() {
  const pidFile = path.join(QUOTH_HOME, 'daemon.pid')
  if (!fs.existsSync(pidFile)) return false
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim())
    process.kill(pid, 0)
    return pid
  } catch { return false }
}

function countEntities() {
  try {
    const db = require('better-sqlite3')(path.join(QUOTH_HOME, 'memory.db'), { readonly: true })
    const row = db.prepare(
      "SELECT COUNT(*) as n FROM knowledge_entities WHERE status = 'active'"
    ).get()
    db.close()
    return row.n
  } catch { return '?' }
}

function detectLegacyDbTables() {
  try {
    const db = require('better-sqlite3')(path.join(QUOTH_HOME, 'memory.db'), { readonly: true })
    const legacy = [
      'patterns', 'trajectories', 'trajectory_steps', 'memory_entries',
      'cluster_stats', 'injection_log', 'pattern_outcomes', 'doc_chunks', 'skills',
    ]
    const present = []
    for (const t of legacy) {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      ).get(t)
      if (row) present.push(t)
    }
    db.close()
    return present
  } catch { return [] }
}

function countHooks() {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'))
    const hooks = settings.hooks || {}
    let count = 0
    for (const event of Object.keys(hooks)) {
      count += (hooks[event]?.hooks || hooks[event] || []).length
    }
    return count
  } catch { return 0 }
}

// --- Commands ---

async function cmdInit() {
  banner()
  console.log(`  ${c.bold}Detecting environment...${c.reset}`)

  const hasClaude = detectClaude()
  const nodeVer = detectNode()
  hasClaude ? ok(`Claude Code detected`) : info('Claude Code not found')
  ok(`Node.js ${nodeVer}`)

  // v3.6 greenfield check: warn loudly if legacy tables are still around.
  const legacyTables = detectLegacyDbTables()
  if (legacyTables.length > 0) {
    console.log()
    warn(`Pre-v3.6 tables detected: ${legacyTables.join(', ')}`)
    info(`Run ${c.bold}node quoth-plugin/scripts/cli.js reset${c.reset} first to back up`)
    info(`and wipe the legacy store before continuing. The new pipeline`)
    info(`bootstraps a fresh knowledge_entities schema on first daemon boot.`)
  }
  console.log()

  const prompt = createPrompt()

  // Mode selection
  const mode = await prompt.select('Select mode:', [
    { label: `${c.bold}Local${c.reset}`, hint: '(use your own LLM keys — full control)', value: 'local' },
    { label: `${c.bold}Managed${c.reset}`, hint: '(Quoth cloud handles LLM — no keys needed)', value: 'managed' },
  ])

  // API key
  let apiKey = ''
  if (mode === 'managed') {
    apiKey = await prompt.ask(`Enter your Quoth API key ${c.gray}(get one at quoth.triqual.dev):${c.reset}`)
    if (!apiKey.startsWith('qth_')) {
      warn('API key should start with qth_ — you can fix this in ~/.quoth/.env later')
    }
  } else {
    const wantKey = await prompt.ask(`Do you have a Quoth API key for cloud sync? ${c.gray}(y/N):${c.reset}`)
    if (wantKey.toLowerCase() === 'y') {
      apiKey = await prompt.ask('Enter your Quoth API key:')
    }
  }

  // Local mode: check for LLM keys
  let gatewayKey = ''
  if (mode === 'local') {
    if (!hasClaude) {
      warn('Local mode without Claude Code — consolidation will use heuristics only')
    }
    if (!process.env.AI_GATEWAY_API_KEY) {
      const wantGateway = await prompt.ask(`Enter AI Gateway key for triage/extract stages ${c.gray}(or press Enter to skip):${c.reset}`)
      if (wantGateway) gatewayKey = wantGateway
    }
  }

  prompt.close()
  console.log()
  console.log(`  ${c.bold}Setting up...${c.reset}`)

  // 1. Create dirs
  for (const dir of [QUOTH_HOME, path.join(QUOTH_HOME, 'hooks'), path.join(QUOTH_HOME, 'trajectories'), path.join(QUOTH_HOME, 'intelligence')]) {
    fs.mkdirSync(dir, { recursive: true })
  }
  ok('Created ~/.quoth/')

  // 2. Run setup.sh for hooks + symlinks + settings.json
  try {
    execSync(`bash "${path.join(__dirname, 'setup.sh')}"`, { stdio: 'pipe', env: { ...process.env, QUOTH_MODE: mode } })
    ok('Hooks installed')
  } catch (err) {
    fail(`Hook setup failed: ${err.message}`)
    info('Try running manually: bash quoth-plugin/scripts/setup.sh')
  }

  // 3. Write .env
  const envFile = path.join(QUOTH_HOME, '.env')
  const envLines = [
    `# Quoth daemon configuration (generated by quoth init)`,
    `# local = uses your own LLM keys (AI_GATEWAY_API_KEY, claude CLI)`,
    `# managed = uses Quoth cloud pipeline (only needs QUOTH_API_KEY)`,
    `QUOTH_MODE=${mode}`,
    '',
  ]
  if (apiKey) envLines.push(`QUOTH_API_KEY=${apiKey}`)
  else envLines.push('# QUOTH_API_KEY=qth_your_key_here')
  envLines.push('')
  if (mode === 'local') {
    if (gatewayKey) envLines.push(`AI_GATEWAY_API_KEY=${gatewayKey}`)
    else envLines.push('# AI_GATEWAY_API_KEY=vck_your_key_here')
  }
  fs.writeFileSync(envFile, envLines.join('\n') + '\n')
  ok(`Config saved to ~/.quoth/.env (mode: ${mode})`)

  // 4. Start daemon
  const pid = isDaemonRunning()
  if (pid) {
    ok(`Daemon already running (PID ${pid})`)
  } else {
    try {
      const daemon = spawn('node', [path.join(PLUGIN_DIR, 'daemon', 'daemon.js')], {
        detached: true, stdio: 'ignore',
      })
      daemon.unref()
      // Wait briefly for PID file
      await new Promise(r => setTimeout(r, 1500))
      const newPid = isDaemonRunning()
      if (newPid) ok(`Daemon started (PID ${newPid})`)
      else warn('Daemon may be starting — check ~/.quoth/daemon.log')
    } catch {
      fail('Failed to start daemon')
    }
  }

  // 5. Summary
  console.log()
  console.log(`  ${c.green}${c.bold}Done!${c.reset} Quoth is learning.`)
  console.log()
  if (mode === 'managed') {
    info(`Mode: Managed — LLM processing via Quoth cloud`)
    if (!apiKey) warn('Set QUOTH_API_KEY in ~/.quoth/.env to enable cloud processing')
  } else {
    info(`Mode: Local — full control with your own LLM keys`)
    if (!hasClaude) info('Install Claude Code for full pipeline support')
  }
  console.log()
  info('Verify: node ~/.quoth/hooks/hook-dispatch.js stats')
  info('Status: node quoth-plugin/scripts/cli.js status')
  console.log()
}

function cmdStatus() {
  banner()
  console.log(`  ${c.bold}Status${c.reset}`)
  console.log()

  // Mode
  const envFile = path.join(QUOTH_HOME, '.env')
  let mode = 'unknown'
  try {
    const env = fs.readFileSync(envFile, 'utf8')
    const m = env.match(/QUOTH_MODE=(\w+)/)
    if (m) mode = m[1]
  } catch {}
  info(`Mode: ${mode}`)

  // Daemon
  const pid = isDaemonRunning()
  pid ? ok(`Daemon running (PID ${pid})`) : fail('Daemon not running')

  // Hooks
  const hookCount = countHooks()
  hookCount > 0 ? ok(`${hookCount} hook bindings in settings.json`) : fail('No hooks configured')

  // Knowledge entities
  const entityCount = countEntities()
  ok(`${entityCount} active knowledge entities in memory.db`)

  // MCP
  const mcpFile = path.join(os.homedir(), '.mcp.json')
  const hasMcp = fs.existsSync(mcpFile) && fs.readFileSync(mcpFile, 'utf8').includes('quoth-learning')
  hasMcp ? ok('MCP server registered') : warn('MCP server not in ~/.mcp.json')

  // Claude CLI
  detectClaude() ? ok('Claude Code available') : info('Claude Code not installed (managed mode OK)')

  console.log()
}

function cmdRestart() {
  console.log(`  Restarting daemon...`)
  const pid = isDaemonRunning()
  if (pid) {
    try { process.kill(pid, 'SIGTERM') } catch {}
    // Wait for shutdown
    let tries = 0
    while (isDaemonRunning() && tries < 10) {
      execSync('sleep 0.2')
      tries++
    }
    ok('Stopped old daemon')
  }

  const daemon = spawn('node', [path.join(PLUGIN_DIR, 'daemon', 'daemon.js')], {
    detached: true, stdio: 'ignore',
  })
  daemon.unref()

  setTimeout(() => {
    const newPid = isDaemonRunning()
    newPid ? ok(`Daemon started (PID ${newPid})`) : fail('Failed to start daemon')
  }, 1500)
}

async function cmdReset() {
  banner()
  console.log(`  ${c.bold}Greenfield reset${c.reset}`)
  console.log()
  info('This backs up ~/.quoth/ to a sibling tarball, then wipes:')
  for (const rel of WIPE_PATHS) info(`  - ${rel}`)
  info('Everything else (.env, credentials, trajectory archive) survives.')
  console.log()

  if (!fs.existsSync(QUOTH_HOME)) {
    warn(`${QUOTH_HOME} does not exist — nothing to reset`)
    return
  }

  const pid = isDaemonRunning()
  if (pid) {
    warn(`Daemon is running (PID ${pid}). Stop it first: kill ${pid}`)
    return
  }

  const prompt = createPrompt()
  const answer = await prompt.ask(`Type ${c.bold}RESET${c.reset} to confirm:`)
  prompt.close()

  if (answer.trim() !== 'RESET') {
    info('Cancelled.')
    return
  }

  console.log()
  try {
    const result = resetQuothHome({ home: QUOTH_HOME, confirm: true, log: info })
    if (result.wiped) {
      ok(`Backup: ${result.backupPath}`)
      ok('Wipe complete. Next `cli.js init` or daemon boot will bootstrap v3.6 schema.')
    }
  } catch (err) {
    fail(`Reset failed: ${err.message}`)
    process.exitCode = 1
  }
  console.log()
}

function cmdHelp() {
  banner()
  console.log(`  ${c.bold}Usage:${c.reset} node cli.js <command>`)
  console.log()
  console.log(`  ${c.bold}Commands:${c.reset}`)
  console.log(`    init      Interactive setup wizard`)
  console.log(`    status    Show daemon, hooks, entities status`)
  console.log(`    restart   Restart the daemon`)
  console.log(`    reset     Back up and wipe pre-v3.6 state (greenfield cutover)`)
  console.log(`    help      Show this help`)
  console.log()
}

// --- Main ---
const cmd = process.argv[2] || 'help'
switch (cmd) {
  case 'init': cmdInit(); break
  case 'status': cmdStatus(); break
  case 'restart': cmdRestart(); break
  case 'reset': cmdReset(); break
  default: cmdHelp()
}
