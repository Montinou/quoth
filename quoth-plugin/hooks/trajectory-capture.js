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
const ACTIVE_DIR = path.join(TRAJECTORIES_DIR, 'active')

// Ensure active/ exists (covers both first run and fresh install).
if (!fs.existsSync(ACTIVE_DIR)) fs.mkdirSync(ACTIVE_DIR, { recursive: true })

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
    // Try CLAUDE_PROJECT_DIR first, then cwd. If both resolve to home dir,
    // try git rev-parse from cwd to find the actual repo root.
    let projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
    if (projectDir === os.homedir() || path.basename(projectDir) === os.userInfo().username) {
      try {
        const { execSync } = require('child_process')
        const gitRoot = execSync('git rev-parse --show-toplevel', { timeout: 1000, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
        if (gitRoot && gitRoot !== os.homedir()) projectDir = gitRoot
      } catch {}
    }
    const project = resolveProjectName(projectDir)

    // Extract tool info from hook data
    const toolName = hookData.tool_name || hookData.toolName || 'unknown'
    const toolInput = hookData.tool_input || hookData.input || {}
    const toolResult = hookData.tool_result || hookData.result || {}
    // Session id: prefer hookData.session_id (Claude Code provides this in PostToolUse payload),
    // then CLAUDE_SESSION_ID env var, then a stable-per-process fallback (not per-tool-call).
    const sessionId = hookData.session_id
      || hookData.sessionId
      || process.env.CLAUDE_SESSION_ID
      || process.env.CLAUDE_CODE_SESSION_ID
      || `fallback-${process.ppid}-${new Date().toISOString().slice(0,13)}`

    // Determine outcome from result
    const isError = toolResult.is_error === true ||
                    (typeof toolResult === 'string' && toolResult.includes('error'))
    const outcome = isError ? 'failure' : 'success'

    // Read recent prompt history for context enrichment.
    // Includes last 3 user prompts to capture intent + planning context around this tool call.
    let userIntent = null
    let conversationContext = null
    try {
      const historyFile = path.join(QUOTH_HOME, 'intelligence', 'prompt-history.json')
      if (fs.existsSync(historyFile)) {
        const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'))
        // Only use if recent (< 5 min) and same session
        const recent = history.filter(h => {
          const age = Date.now() - (h.timestamp || 0)
          const sameSession = !h.session || !sessionId || h.session === sessionId
          return age < 300000 && sameSession
        })
        if (recent.length > 0) {
          userIntent = recent[0].prompt || null  // Most recent prompt
          // Include last 3 as conversation context (oldest first for chronological order)
          conversationContext = recent.slice(0, 3).reverse().map(h => h.prompt)
        }
      }
    } catch {}

    // Extract LLM reasoning from tool input fields.
    const llmReasoning = extractReasoning(toolName, toolInput)

    // Capture sanitized tool input and output for richer context.
    // The full data lets downstream LLMs understand what happened, not just the tool name.
    const sanitizedInput = sanitize(summarizeToolInput(toolName, toolInput))
    const sanitizedOutput = sanitize(summarizeToolOutput(toolName, toolResult))

    // Build trajectory entry
    const entry = {
      event: 'tool_use',
      agent: 'claude-code',
      project,
      session: sessionId,
      task: `${toolName} ${summarizeInput(toolName, toolInput)}`.trim(),
      tool: toolName,
      tool_input: sanitizedInput,
      tool_output: sanitizedOutput,
      outcome,
      user_intent: userIntent,
      conversation_context: conversationContext,
      llm_reasoning: llmReasoning,
      pattern_used: null,
      source: 'claude-code',
      timestamp: Date.now()
    }

    // Per-session file isolation: every session writes to its own JSONL
    // under active/, plus a sidecar with metadata the daemon reads.
    // Sanitize sessionId before using it as a path segment to prevent
    // directory traversal if a malformed payload arrives. Keep the raw
    // value in the JSONL entry body so downstream consumers see the
    // original id.
    const safeSid = String(sessionId).replace(/[^A-Za-z0-9_\-]/g, '_')
    const sessionFile = path.join(ACTIVE_DIR, `${safeSid}.jsonl`)
    const sidecarFile = path.join(ACTIVE_DIR, `${safeSid}.meta.json`)
    const nowTs = Date.now()

    // Append JSONL line first — if we crash between append and sidecar
    // update, the detector can still rebuild sidecar from the JSONL.
    fs.appendFileSync(sessionFile, JSON.stringify(entry) + '\n')

    // Read-modify-write sidecar. Tolerate a missing or malformed file
    // by treating it as a fresh session. We write via .tmp + rename
    // for atomicity (see daemon/lib/sessions.js for the shared helper,
    // but this hook stays dependency-free to keep startup cost near zero).
    // Field names match the canonical schema in spec §5 / db.js sessions
    // table: last_seen_ts (not last_activity_ts), tool_count (not entry_count).
    let meta = null
    try {
      meta = JSON.parse(fs.readFileSync(sidecarFile, 'utf8'))
    } catch {}
    if (!meta || typeof meta !== 'object') {
      meta = {
        session_id: sessionId,
        project,
        status: 'active',
        first_seen_ts: nowTs,
        last_seen_ts: nowTs,
        tool_count: 0,
        closed_marker: false,
        source: 'hook',
      }
    }
    meta.last_seen_ts = nowTs
    meta.tool_count = (meta.tool_count || 0) + 1
    // Keep project stable after first write — don't overwrite on later calls.
    if (!meta.project) meta.project = project

    const tmpPath = sidecarFile + '.tmp'
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(meta))
      fs.renameSync(tmpPath, sidecarFile)
    } catch {
      // fire-and-forget; sidecar can be rebuilt from JSONL if needed
      try { fs.unlinkSync(tmpPath) } catch {}
    }

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

// --- Sanitizer: redact secrets, keys, tokens, passwords, UUIDs ---
const REDACT_PATTERNS = [
  // API keys (common prefixes)
  [/\b(sk|pk|key|token|secret|Bearer|qth|vck|ghp|ghu|ghs|npm|pypi|AKIA)[_-]?[A-Za-z0-9_\-]{16,}\b/gi, '[REDACTED_KEY]'],
  // Generic hex tokens (32+ chars)
  [/\b[0-9a-f]{32,}\b/gi, '[REDACTED_HEX]'],
  // UUIDs
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[REDACTED_UUID]'],
  // Passwords in URLs
  [/:\/\/([^:]+):([^@]+)@/g, '://$1:[REDACTED]@'],
  // .env style KEY=value (value part)
  [/(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|API_KEY)\s*[=:]\s*\S+/gi, '$1=[REDACTED]'],
  // JWT tokens
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]'],
  // Base64 encoded secrets (long base64 strings that look like secrets)
  [/\b(?:[A-Za-z0-9+/]{40,}={0,2})\b/g, (match) => {
    // Only redact if it doesn't look like a file path or common base64 (e.g., git hashes)
    if (match.length > 60) return '[REDACTED_B64]'
    return match
  }],
]

function sanitize(text) {
  if (!text) return text
  if (typeof text !== 'string') {
    try { text = JSON.stringify(text) } catch { return null }
  }
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    text = text.replace(pattern, replacement)
  }
  return text
}

// --- Rich tool input/output capture (truncated, sanitized) ---
function summarizeToolInput(tool, input) {
  if (!input) return null
  const maxLen = 500
  switch (tool) {
    case 'Bash':
      return (input.command || '').slice(0, maxLen)
    case 'Write':
      return `file: ${input.file_path || '?'}, content: ${(input.content || '').slice(0, 200)}...`
    case 'Edit':
      return `file: ${input.file_path || '?'}, old: ${(input.old_string || '').slice(0, 150)}, new: ${(input.new_string || '').slice(0, 150)}`
    case 'Read':
      return `file: ${input.file_path || '?'}${input.offset ? `, offset: ${input.offset}` : ''}${input.limit ? `, limit: ${input.limit}` : ''}`
    case 'Glob':
      return `pattern: ${input.pattern || '?'}${input.path ? `, path: ${input.path}` : ''}`
    case 'Grep':
      return `pattern: ${input.pattern || '?'}${input.path ? `, path: ${input.path}` : ''}${input.glob ? `, glob: ${input.glob}` : ''}`
    case 'Agent':
      return `type: ${input.subagent_type || 'general'}, desc: ${(input.description || '').slice(0, 100)}, prompt: ${(input.prompt || '').slice(0, 200)}`
    default:
      try { return JSON.stringify(input).slice(0, maxLen) } catch { return null }
  }
}

function summarizeToolOutput(tool, result) {
  if (!result) return null
  const maxLen = 300
  if (typeof result === 'string') return result.slice(0, maxLen)
  // Claude Code hook results can have various shapes
  const text = result.content || result.output || result.stdout || result.text || ''
  if (typeof text === 'string') return text.slice(0, maxLen)
  try { return JSON.stringify(result).slice(0, maxLen) } catch { return null }
}

function extractReasoning(tool, input) {
  if (!input) return null
  const parts = []
  // Bash: description field is the LLM's explanation of what the command does
  if (tool === 'Bash' && input.description) {
    parts.push(input.description.slice(0, 200))
  }
  // Agent: prompt field is the LLM's full planning/delegation text
  if (tool === 'Agent' && input.prompt) {
    parts.push(input.prompt.slice(0, 300))
  }
  // Agent: description field is a short summary of the task
  if (tool === 'Agent' && input.description) {
    parts.push(`Task: ${input.description}`)
  }
  // Write/Edit: the LLM chose to modify this file for a reason
  if ((tool === 'Write' || tool === 'Edit') && input.file_path) {
    if (input.old_string && input.new_string) {
      // Edit: capture what changed (truncated)
      parts.push(`Edit: replaced "${input.old_string.slice(0, 80)}" with "${input.new_string.slice(0, 80)}"`)
    }
  }
  return parts.length > 0 ? parts.join(' | ') : null
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
