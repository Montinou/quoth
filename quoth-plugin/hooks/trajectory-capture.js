#!/usr/bin/env node
'use strict'

// PostToolUse hook: captures tool calls across all Claude Code projects
// Reads hook input from stdin, writes JSONL to ~/.quoth/trajectories/
// Fire-and-forget: must exit quickly (< 1s) to not block Claude Code

const fs = require('fs')
const path = require('path')
const os = require('os')

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const TRAJECTORIES_DIR = path.join(QUOTH_HOME, 'trajectories')

// Ensure directory exists
if (!fs.existsSync(TRAJECTORIES_DIR)) fs.mkdirSync(TRAJECTORIES_DIR, { recursive: true })

// Read hook input from stdin
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  try {
    const hookData = JSON.parse(input)

    // Extract project name from CLAUDE_PROJECT_DIR or cwd.
    // For OpenClaw workspaces (~/.openclaw/workspaces/<name>/repo), use the workspace
    // name instead of "repo" to avoid collisions across agents.
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
    const project = resolveProjectName(projectDir)

    // Extract tool info from hook data
    const toolName = hookData.tool_name || hookData.toolName || 'unknown'
    const toolInput = hookData.tool_input || hookData.input || {}
    const toolResult = hookData.tool_result || hookData.result || {}
    const sessionId = process.env.CLAUDE_SESSION_ID || `session-${Date.now()}`

    // Determine outcome from result
    const isError = toolResult.is_error === true ||
                    (typeof toolResult === 'string' && toolResult.includes('error'))
    const outcome = isError ? 'failure' : 'success'

    // Build trajectory entry
    const entry = {
      event: 'tool_use',
      agent: 'claude-code',
      project,
      session: sessionId,
      task: `${toolName} ${summarizeInput(toolName, toolInput)}`.trim(),
      tool: toolName,
      outcome,
      pattern_used: null,
      source: 'claude-code',
      timestamp: Date.now()
    }

    // Write to project-specific trajectory file
    const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const trajFile = path.join(TRAJECTORIES_DIR, `${project}-${date}.jsonl`)
    fs.appendFileSync(trajFile, JSON.stringify(entry) + '\n')

  } catch (err) {
    // Fire-and-forget: never fail the hook
  }

  // Output empty JSON to signal success to Claude Code hook system
  process.stdout.write('{}')
})

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

function summarizeInput(tool, input) {
  if (!input) return ''
  if (typeof input === 'string') return input.slice(0, 80)
  // For file operations, show the path
  if (input.file_path) return input.file_path
  if (input.path) return input.path
  // For Bash, show the command (truncated)
  if (input.command) return input.command.slice(0, 80)
  // For searches
  if (input.pattern) return input.pattern
  if (input.query) return input.query
  return ''
}
