/**
 * Tool Executor — executes K2.5 tool calls locally (read_file, grep_codebase).
 * Zero LLM dependencies — pure I/O.
 */
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

// --- Project root mapping ---
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

export function sanitize(text) {
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

export function readFile(filePath, maxLines = 100) {
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
    const rgPath = execSync('which rg 2>/dev/null', { encoding: 'utf-8', timeout: 5000 }).trim()
    if (rgPath) return rgPath
  } catch { /* not found */ }
  return null
}

export function grepCodebase(pattern, searchPath, maxResults = 30) {
  const effectiveMax = Math.min(maxResults, HARD_CAP_RESULTS)

  const rgPath = findRgPath()
  const excludes = ['node_modules', '.git', '*.lock']

  let cmd
  if (rgPath) {
    const excludeArgs = excludes.map(e => `--glob '!${e}'`).join(' ')
    cmd = `${rgPath} -n --max-count ${effectiveMax} ${excludeArgs} -- ${escapeShellArg(pattern)} ${escapeShellArg(searchPath)}`
  } else {
    const excludeArgs = excludes.map(e => `--exclude-dir='${e.replace('*.', '')}'`).join(' ')
    // For *.lock, use --exclude
    cmd = `grep -rn --exclude='*.lock' --exclude-dir='node_modules' --exclude-dir='.git' -- ${escapeShellArg(pattern)} ${escapeShellArg(searchPath)} | head -n ${effectiveMax}`
  }

  try {
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 15000, maxBuffer: 1024 * 1024 })
    if (!output.trim()) return 'No matches found.'
    // Trim to effectiveMax lines
    const lines = output.trim().split('\n').slice(0, effectiveMax)
    return sanitize(lines.join('\n'))
  } catch (err) {
    // exit code 1 = no matches (both grep and rg)
    if (err.status === 1) return 'No matches found.'
    // exit code 2 = error (e.g. invalid regex)
    return `Grep error: ${err.message?.split('\n')[0] || 'unknown error'}`
  }
}

function escapeShellArg(arg) {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

// --- resolveProjectRoot ---
export function resolveProjectRoot(project, toolEntries = []) {
  // Try to extract common ancestor from absolute paths in tool entries
  if (toolEntries.length > 0) {
    const paths = []
    for (const entry of toolEntries) {
      try {
        const input = typeof entry.tool_input === 'string' ? JSON.parse(entry.tool_input) : entry.tool_input
        // Look for file_path, path, or command fields that contain absolute paths
        const candidates = [input?.file_path, input?.path, input?.search_path]
        for (const c of candidates) {
          if (typeof c === 'string' && c.startsWith('/')) {
            paths.push(c)
          }
        }
      } catch { /* skip unparseable */ }
    }

    if (paths.length > 0) {
      const ancestor = commonAncestorDir(paths)
      if (ancestor && ancestor !== '/') return ancestor
    }
  }

  // Fall back to known project roots
  const key = project?.toLowerCase()
  if (key && PROJECT_ROOTS[key]) return PROJECT_ROOTS[key]

  return null
}

function commonAncestorDir(paths) {
  const dirs = paths.map(p => {
    // If path points to a file, get dirname
    const ext = path.extname(p)
    return ext ? path.dirname(p) : p
  })

  if (dirs.length === 0) return null
  if (dirs.length === 1) return dirs[0]

  const parts = dirs.map(d => d.split('/'))
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

// --- executeToolCall ---
export function executeToolCall(toolCall, projectRoot) {
  const name = toolCall?.function?.name
  let args
  try {
    args = JSON.parse(toolCall?.function?.arguments || '{}')
  } catch {
    return `Error: could not parse tool arguments`
  }

  switch (name) {
    case 'read_file':
      return readFile(args.file_path, args.max_lines)

    case 'grep_codebase':
      return grepCodebase(args.pattern, args.search_path || projectRoot, args.max_results)

    default:
      return `Unknown tool: ${name}`
  }
}
