'use strict'

/**
 * Tool Executor — executes K2.5 tool calls locally (read_file, grep_codebase).
 * Zero LLM dependencies — pure I/O.
 */
const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')

// --- Project root mapping (name → filesystem path) ---
const PROJECT_ROOTS = {
  ips: '/home/lord_montino/IPS_audit/IPS',
  quoth: '/home/lord_montino/projects/agents-tools/quoth',
  exolar: '/home/lord_montino/projects/agents-tools/exolar',
  triqual: '/home/lord_montino/projects/agents-tools/triqual',
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

// --- readFile ---
const HARD_CAP_LINES = 200

function readFile(filePath, maxLines = 100) {
  try {
    const effectiveMax = Math.min(maxLines, HARD_CAP_LINES)
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').slice(0, effectiveMax)
    const numbered = lines.map((line, i) => `${i + 1}\t${line}`).join('\n')
    return sanitize(numbered)
  } catch (err) {
    return `Error reading file: ${err.message}`
  }
}

// --- grepCodebase ---
const HARD_CAP_RESULTS = 50

function findRgPath() {
  try {
    const rgPath = childProcess.execSync('which rg 2>/dev/null', { encoding: 'utf-8', timeout: 5000 }).trim()
    if (rgPath) return rgPath
  } catch { /* not found */ }
  return null
}

// Cache rg path lookup at module load so we don't spawn `which` per grep call.
const RG_PATH = findRgPath()

function escapeShellArg(arg) {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

function grepCodebase(pattern, searchPath, maxResults = 30) {
  const effectiveMax = Math.min(maxResults, HARD_CAP_RESULTS)

  const rgPath = RG_PATH

  let cmd
  if (rgPath) {
    cmd = `${rgPath} -n --max-count ${effectiveMax} --glob '!node_modules' --glob '!.git' --glob '!*.lock' -- ${escapeShellArg(pattern)} ${escapeShellArg(searchPath)}`
  } else {
    cmd = `grep -rn --exclude='*.lock' --exclude-dir='node_modules' --exclude-dir='.git' -- ${escapeShellArg(pattern)} ${escapeShellArg(searchPath)} | head -n ${effectiveMax}`
  }

  try {
    const output = childProcess.execSync(cmd, { encoding: 'utf-8', timeout: 15000, maxBuffer: 1024 * 1024 })
    if (!output.trim()) return 'No matches found.'
    const lines = output.trim().split('\n').slice(0, effectiveMax)
    return sanitize(lines.join('\n'))
  } catch (err) {
    // exit code 1 = no matches (both grep and rg)
    if (err.status === 1) return 'No matches found.'
    return `Grep error: ${err.message?.split('\n')[0] || 'unknown error'}`
  }
}

// --- resolveProjectRoot ---
function resolveProjectRoot(project, toolEntries = []) {
  // Strategy 1: Extract absolute paths from tool_input fields (plain strings from trajectory JSONL)
  if (toolEntries.length > 0) {
    const paths = []
    for (const entry of toolEntries) {
      const input = entry.tool_input || entry.task || ''
      // Match absolute paths in plain-text tool_input strings
      const matches = input.match(/(?:file:\s*)?(\/([\w._-]+\/)+[\w._-]+)/g) || []
      for (const m of matches) {
        const clean = m.replace(/^file:\s*/, '').trim()
        if (clean.startsWith('/') && !clean.includes('node_modules')) {
          paths.push(path.dirname(clean))
        }
      }
    }

    if (paths.length > 0) {
      const ancestor = commonAncestorDir(paths)
      if (ancestor && ancestor !== '/') return ancestor
    }
  }

  // Strategy 2: Known project mapping
  const key = project?.toLowerCase()
  if (key && PROJECT_ROOTS[key]) return PROJECT_ROOTS[key]

  return null
}

function commonAncestorDir(dirPaths) {
  if (dirPaths.length === 0) return null
  if (dirPaths.length === 1) return dirPaths[0]

  const parts = dirPaths.map(d => d.split('/'))
  const common = []
  for (let i = 0; i < parts[0].length; i++) {
    const segment = parts[0][i]
    if (parts.every(p => p[i] === segment)) {
      common.push(segment)
    } else {
      break
    }
  }

  return common.join('/') || '/'
}

// --- Path confinement ---
// Ensures a requested path (from LLM tool args) resolves inside projectRoot.
// Accepts both absolute and relative input paths. path.resolve() ignores the
// first arg if the second is absolute, which is exactly what we want for
// rejecting out-of-tree absolute paths.
function isInsideProjectRoot(requested, projectRoot) {
  if (!projectRoot || typeof projectRoot !== 'string') return false
  const resolvedRoot = path.resolve(projectRoot)
  const resolved = path.resolve(resolvedRoot, requested)
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
}

function confinePath(requested, projectRoot) {
  if (!requested || typeof requested !== 'string') return null
  if (!isInsideProjectRoot(requested, projectRoot)) return null
  return path.resolve(path.resolve(projectRoot), requested)
}

// --- executeToolCall ---
// Parameter names match K2.5 tool definitions: path, maxLines, pattern, maxResults
function executeToolCall(toolCall, projectRoot) {
  const name = toolCall?.function?.name
  let args
  try {
    args = JSON.parse(toolCall?.function?.arguments || '{}')
  } catch {
    return 'Error: could not parse tool arguments'
  }

  switch (name) {
    case 'read_file': {
      if (!projectRoot) return 'Error: no project root resolved — cannot read file'
      const confined = confinePath(args.path, projectRoot)
      if (!confined) return 'Error: path outside project root'
      return readFile(confined, args.maxLines)
    }

    case 'grep_codebase': {
      if (!projectRoot) return 'Error: no project root resolved — cannot grep'
      let searchPath = projectRoot
      if (args.path) {
        const confined = confinePath(args.path, projectRoot)
        if (!confined) return 'Error: path outside project root'
        searchPath = confined
      }
      return grepCodebase(args.pattern, searchPath, args.maxResults)
    }

    default:
      return `Unknown tool: ${name}`
  }
}

module.exports = { readFile, grepCodebase, resolveProjectRoot, executeToolCall, sanitize }
