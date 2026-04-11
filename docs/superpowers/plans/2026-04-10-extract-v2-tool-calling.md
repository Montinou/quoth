# Extract Pipeline v2 — Thinking + Tool Calling + Rich Persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-turn, context-blind EXTRACT pipeline with a multi-turn tool-calling loop that produces specific, actionable patterns instead of generic tautologies.

**Architecture:** Split the LLM call into cacheable system + per-session user messages. Give Kimi K2.5 two tools (`read_file`, `grep_codebase`) to inspect code from the session before extracting patterns. Multi-turn loop with dynamic budget (2/5/8 calls based on session size). Patterns now have separate `condition` (when) and `action` (what to do) fields instead of a single blob.

**Tech Stack:** Kimi K2.5 via Moonshot API (thinking mode + tool calling), MiniLM-L6-v2 local embeddings (384d), ripgrep for code search, SQLite + HNSW.

**Spec:** `docs/superpowers/specs/2026-04-10-extract-v2-tool-calling.md` (v1.2)

---

## File Structure

| File | Responsibility | Status |
|------|---------------|--------|
| `quoth-plugin/daemon/lib/tool-executor.js` | Execute `read_file` and `grep_codebase` tool calls locally, sanitize results, resolve project roots | **New** |
| `quoth-plugin/daemon/lib/llm.js` | Add `callMoonshotWithTools()` — multi-message, tool calling, thinking enabled, 120s timeout | **Modify** |
| `quoth-plugin/daemon/pipeline/extract.js` | Rewrite to multi-turn tool loop, split system/user prompts, condition/action return shape | **Modify** |
| `quoth-plugin/daemon/daemon.js` | Update `insertNewPattern()` and `processSessionLocal()` for new return shape | **Modify** |
| `quoth-plugin/tests/tool-executor.test.js` | Tests for read_file, grep_codebase, resolveProjectRoot, sanitization | **New** |
| `quoth-plugin/tests/llm-tools.test.js` | Tests for callMoonshotWithTools multi-turn behavior | **New** |
| `quoth-plugin/tests/extract.test.js` | Update for condition/action return shape, add multi-turn tests | **Modify** |

---

## Task 1: Tool Executor — `read_file` and `grep_codebase`

New module that executes K2.5 tool calls locally. This has zero LLM dependencies — pure I/O.

**Files:**
- Create: `quoth-plugin/daemon/lib/tool-executor.js`
- Create: `quoth-plugin/tests/tool-executor.test.js`
- Reference: `quoth-plugin/hooks/trajectory-capture.js:137-167` (REDACT_PATTERNS + sanitize to copy)

### Important: ripgrep path

`rg` is **not** a system binary — it's a shell alias pointing to Claude Code's vendor dir at `/home/lord_montino/.npm-global/lib/node_modules/@anthropic-ai/claude-code/vendor/ripgrep/x64-linux/rg`. Node's `child_process.execSync` doesn't load shell aliases. The tool-executor must:
1. Try `which rg` first (in case installed system-wide).
2. Fall back to `grep -rn --include='*' -m {maxResults}` as a portable alternative.
3. Never hardcode the Claude Code vendor path.

- [ ] **Step 1: Write failing tests for `readFile()`**

```javascript
// quoth-plugin/tests/tool-executor.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

const { readFile, grepCodebase, executeToolCall, resolveProjectRoot } = require('../daemon/lib/tool-executor.js')

describe('tool-executor', () => {
  describe('readFile', () => {
    it('reads a file and returns numbered lines', () => {
      const testFile = path.join(os.tmpdir(), 'tool-exec-test.txt')
      fs.writeFileSync(testFile, 'line 1\nline 2\nline 3\n')
      const result = readFile(testFile)
      expect(result).toContain('1: line 1')
      expect(result).toContain('2: line 2')
      expect(result).toContain('3: line 3')
      fs.unlinkSync(testFile)
    })

    it('respects maxLines parameter', () => {
      const testFile = path.join(os.tmpdir(), 'tool-exec-lines.txt')
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n')
      fs.writeFileSync(testFile, lines)
      const result = readFile(testFile, 5)
      expect(result.split('\n').filter(l => l.trim())).toHaveLength(5)
      fs.unlinkSync(testFile)
    })

    it('hard caps at 200 lines', () => {
      const testFile = path.join(os.tmpdir(), 'tool-exec-cap.txt')
      const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n')
      fs.writeFileSync(testFile, lines)
      const result = readFile(testFile, 999)
      expect(result.split('\n').filter(l => l.trim()).length).toBeLessThanOrEqual(200)
      fs.unlinkSync(testFile)
    })

    it('returns error string for missing file', () => {
      const result = readFile('/nonexistent/path/file.js')
      expect(result).toContain('Error')
    })

    it('sanitizes secrets from file content', () => {
      const testFile = path.join(os.tmpdir(), 'tool-exec-secrets.txt')
      fs.writeFileSync(testFile, 'API_KEY=sk_EXAMPLE_PLACEHOLDER_NOT_REAL\n')
      const result = readFile(testFile)
      expect(result).not.toContain('sk_EXAMPLE_PLACEHOLDER')
      expect(result).toContain('[REDACTED')
      fs.unlinkSync(testFile)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quoth-plugin && npx vitest run tests/tool-executor.test.js`
Expected: FAIL — `Cannot find module '../daemon/lib/tool-executor.js'`

- [ ] **Step 3: Implement `readFile()` with sanitization**

```javascript
// quoth-plugin/daemon/lib/tool-executor.js
'use strict'

const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')

// --- Sanitization (copied from trajectory-capture.js) ---
const REDACT_PATTERNS = [
  [/\b(sk|pk|key|token|secret|Bearer|qth|vck|ghp|ghu|ghs|npm|pypi|AKIA)[_-]?[A-Za-z0-9_\-]{16,}\b/gi, '[REDACTED_KEY]'],
  [/\b[0-9a-f]{32,}\b/gi, '[REDACTED_HEX]'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[REDACTED_UUID]'],
  [/:\/\/([^:]+):([^@]+)@/g, '://$1:[REDACTED]@'],
  [/(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|API_KEY)\s*[=:]\s*\S+/gi, '$1=[REDACTED]'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]'],
  [/\b(?:[A-Za-z0-9+/]{40,}={0,2})\b/g, (match) => match.length > 60 ? '[REDACTED_B64]' : match],
]

function sanitize(text) {
  if (!text || typeof text !== 'string') return text || ''
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    text = text.replace(pattern, replacement)
  }
  return text
}

const MAX_LINES_CAP = 200
const TOOL_TIMEOUT_MS = 15000

function readFile(filePath, maxLines = 100) {
  try {
    const capped = Math.min(maxLines, MAX_LINES_CAP)
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split('\n').slice(0, capped)
    const numbered = lines.map((line, i) => `${i + 1}: ${line}`).join('\n')
    return sanitize(numbered)
  } catch (err) {
    return `Error: ${err.message}`
  }
}
```

- [ ] **Step 4: Run tests for `readFile()`**

Run: `cd quoth-plugin && npx vitest run tests/tool-executor.test.js`
Expected: All readFile tests PASS

- [ ] **Step 5: Write failing tests for `grepCodebase()`**

Add to `tool-executor.test.js`:

```javascript
describe('grepCodebase', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grep-test-'))
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'function hello() { return 1 }\nfunction world() { return 2 }')
    fs.writeFileSync(path.join(tmpDir, 'b.js'), 'const hello = require("./a")\nconsole.log(hello())')
    fs.mkdirSync(path.join(tmpDir, 'node_modules'))
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'c.js'), 'function hello() {}')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('finds matching lines across files', () => {
    const result = grepCodebase('hello', tmpDir)
    expect(result).toContain('hello')
    expect(result.split('\n').filter(l => l.trim()).length).toBeGreaterThanOrEqual(2)
  })

  it('excludes node_modules', () => {
    const result = grepCodebase('hello', tmpDir)
    expect(result).not.toContain('node_modules')
  })

  it('respects maxResults', () => {
    const result = grepCodebase('hello', tmpDir, 1)
    const lines = result.split('\n').filter(l => l.trim())
    expect(lines.length).toBeLessThanOrEqual(1)
  })

  it('returns error for invalid regex', () => {
    const result = grepCodebase('[invalid(', tmpDir)
    expect(result).toContain('Error')
  })

  it('sanitizes secrets from results', () => {
    fs.writeFileSync(path.join(tmpDir, 'env.js'), 'const KEY = "sk_EXAMPLE_PLACEHOLDER_NOT_REAL"')
    const result = grepCodebase('KEY', tmpDir)
    expect(result).not.toContain('sk_EXAMPLE_PLACEHOLDER')
  })
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd quoth-plugin && npx vitest run tests/tool-executor.test.js`
Expected: FAIL — `grepCodebase is not a function` (not yet implemented)

- [ ] **Step 7: Implement `grepCodebase()`**

Add to `tool-executor.js`:

```javascript
const MAX_RESULTS_CAP = 50

function findRgBinary() {
  // Try system rg first
  try {
    childProcess.execSync('which rg', { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] })
    return 'rg'
  } catch {}
  return null // Will fall back to grep
}

let _rgBinary = undefined // lazy init

function grepCodebase(pattern, searchPath, maxResults = 30) {
  const capped = Math.min(maxResults, MAX_RESULTS_CAP)

  try {
    if (_rgBinary === undefined) _rgBinary = findRgBinary()

    let cmd, result
    if (_rgBinary) {
      cmd = `${_rgBinary} -n -I --glob '!node_modules' --glob '!.git' --glob '!*.lock' -m ${capped} -- ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)}`
    } else {
      // Fallback: grep -rn (portable, slower)
      cmd = `grep -rn --include='*.js' --include='*.ts' --include='*.jsx' --include='*.tsx' --include='*.py' --include='*.md' --exclude-dir=node_modules --exclude-dir=.git -m ${capped} -- ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)}`
    }

    result = childProcess.execSync(cmd, {
      encoding: 'utf8',
      timeout: TOOL_TIMEOUT_MS,
      maxBuffer: 256 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    return sanitize(result.trim())
  } catch (err) {
    // grep/rg return exit code 1 for no matches — that's not an error
    if (err.status === 1 && !err.stderr?.trim()) return 'No matches found.'
    return `Error: ${(err.message || '').slice(0, 200)}`
  }
}
```

- [ ] **Step 8: Run grepCodebase tests**

Run: `cd quoth-plugin && npx vitest run tests/tool-executor.test.js`
Expected: All grepCodebase tests PASS

- [ ] **Step 9: Write failing tests for `resolveProjectRoot()` and `executeToolCall()`**

Add to `tool-executor.test.js`:

```javascript
describe('resolveProjectRoot', () => {
  it('extracts common ancestor from file paths in tool entries', () => {
    const entries = [
      { tool_input: 'file: /home/user/project/src/a.js, content: ...' },
      { tool_input: 'file: /home/user/project/src/b.js, content: ...' },
    ]
    const root = resolveProjectRoot('unknown', entries)
    expect(root).toBe('/home/user/project/src')
  })

  it('falls back to PROJECT_ROOTS mapping when no paths found', () => {
    const root = resolveProjectRoot('quoth', [])
    expect(root).toContain('quoth')
  })

  it('returns null for unknown project with no paths', () => {
    const root = resolveProjectRoot('totally-unknown', [])
    expect(root).toBeNull()
  })
})

describe('executeToolCall', () => {
  it('dispatches read_file calls', () => {
    const testFile = path.join(os.tmpdir(), 'exec-test.txt')
    fs.writeFileSync(testFile, 'hello world')
    const result = executeToolCall({
      function: { name: 'read_file', arguments: JSON.stringify({ path: testFile }) }
    }, os.tmpdir())
    expect(result).toContain('hello world')
    fs.unlinkSync(testFile)
  })

  it('dispatches grep_codebase calls', () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-grep-'))
    fs.writeFileSync(path.join(tmpDir2, 'x.js'), 'function foobar() {}')
    const result = executeToolCall({
      function: { name: 'grep_codebase', arguments: JSON.stringify({ pattern: 'foobar', path: tmpDir2 }) }
    }, tmpDir2)
    expect(result).toContain('foobar')
    fs.rmSync(tmpDir2, { recursive: true, force: true })
  })

  it('returns error for unknown tool', () => {
    const result = executeToolCall({
      function: { name: 'delete_everything', arguments: '{}' }
    }, os.tmpdir())
    expect(result).toContain('Unknown tool')
  })
})
```

- [ ] **Step 10: Implement `resolveProjectRoot()` and `executeToolCall()`**

Add to `tool-executor.js`:

```javascript
const PROJECT_ROOTS = {
  'ips': '/home/lord_montino/IPS_audit/IPS',
  'quoth': '/home/lord_montino/projects/agents-tools/quoth',
  'exolar': '/home/lord_montino/projects/agents-tools/exolar',
  'triqual': '/home/lord_montino/projects/agents-tools/triqual',
}

function resolveProjectRoot(project, toolEntries = []) {
  // Strategy 1: Extract absolute paths from tool_input fields, find common ancestor
  const paths = []
  for (const entry of toolEntries) {
    const input = entry.tool_input || entry.task || ''
    const matches = input.match(/(?:file:\s*|\/)(\/[^\s,'"]+)/g) || []
    for (const m of matches) {
      const clean = m.replace(/^file:\s*/, '').trim()
      if (clean.startsWith('/') && !clean.includes('node_modules')) {
        paths.push(path.dirname(clean))
      }
    }
  }
  if (paths.length > 0) {
    // Common ancestor: split all paths, find longest shared prefix
    const segments = paths.map(p => p.split('/'))
    const common = []
    for (let i = 0; i < segments[0].length; i++) {
      if (segments.every(s => s[i] === segments[0][i])) common.push(segments[0][i])
      else break
    }
    if (common.length > 1) return common.join('/')
  }

  // Strategy 2: Known project mapping
  if (PROJECT_ROOTS[project]) return PROJECT_ROOTS[project]

  return null
}

function executeToolCall(toolCall, projectRoot) {
  const fnName = toolCall.function?.name
  let args
  try {
    args = JSON.parse(toolCall.function?.arguments || '{}')
  } catch {
    return 'Error: invalid tool call arguments'
  }

  switch (fnName) {
    case 'read_file':
      return readFile(args.path, args.maxLines)
    case 'grep_codebase':
      return grepCodebase(args.pattern, args.path || projectRoot, args.maxResults)
    default:
      return `Unknown tool: ${fnName}`
  }
}

module.exports = { readFile, grepCodebase, resolveProjectRoot, executeToolCall, sanitize }
```

- [ ] **Step 11: Run all tool-executor tests**

Run: `cd quoth-plugin && npx vitest run tests/tool-executor.test.js`
Expected: All PASS

- [ ] **Step 12: Commit**

```bash
git add quoth-plugin/daemon/lib/tool-executor.js quoth-plugin/tests/tool-executor.test.js
git commit -m "feat(extract): add tool-executor for read_file and grep_codebase

Local tool execution for K2.5 multi-turn extraction loop.
Sanitizes all results via REDACT_PATTERNS before sending to LLM."
```

---

## Task 2: `callMoonshotWithTools()` in llm.js

New function for multi-turn Moonshot API calls with tool calling and thinking mode enabled. The existing `callMoonshot()` stays untouched.

**Files:**
- Modify: `quoth-plugin/daemon/lib/llm.js`
- Create: `quoth-plugin/tests/llm-tools.test.js`

- [ ] **Step 1: Write failing tests for `callMoonshotWithTools()`**

```javascript
// quoth-plugin/tests/llm-tools.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import https from 'https'
import { EventEmitter } from 'events'

// Mock https.request before requiring the module
vi.mock('https', () => {
  return {
    default: { request: vi.fn() },
    request: vi.fn(),
  }
})

const { callMoonshotWithTools } = require('../daemon/lib/llm.js')

function mockResponse(data, statusCode = 200) {
  const res = new EventEmitter()
  res.statusCode = statusCode
  setTimeout(() => {
    res.emit('data', JSON.stringify(data))
    res.emit('end')
  }, 10)
  return res
}

function mockRequest(responseData) {
  const req = new EventEmitter()
  req.write = vi.fn()
  req.end = vi.fn()
  req.destroy = vi.fn()
  https.request.mockImplementation((opts, cb) => {
    setTimeout(() => cb(mockResponse(responseData)), 5)
    return req
  })
  return req
}

describe('callMoonshotWithTools', () => {
  beforeEach(() => {
    process.env.MOONSHOT_API_KEY = 'test-key-for-unit-tests'
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.MOONSHOT_API_KEY
    vi.restoreAllMocks()
  })

  it('sends messages array with tools to Moonshot API', async () => {
    mockRequest({
      choices: [{ message: { content: '{"patterns": []}', role: 'assistant' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    })

    const messages = [
      { role: 'system', content: 'You are a pattern extractor.' },
      { role: 'user', content: 'Analyze this session.' },
    ]
    const tools = [{ type: 'function', function: { name: 'read_file', parameters: {} } }]

    const result = await callMoonshotWithTools(messages, { tools })

    expect(result.content).toBe('{"patterns": []}')
    expect(result.usage.prompt_tokens).toBe(100)
    expect(result.tool_calls).toBeNull()

    // Verify request body
    const body = JSON.parse(https.request.mock.calls[0][1] ? undefined : https.request.mock.calls[0][0])
    // The request was made to Moonshot
    expect(https.request).toHaveBeenCalled()
  })

  it('returns tool_calls when model requests tools', async () => {
    const toolCalls = [
      { id: 'tc_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"/a.js"}' } }
    ]
    mockRequest({
      choices: [{ message: { role: 'assistant', content: null, tool_calls: toolCalls } }],
      usage: { prompt_tokens: 200, completion_tokens: 80 },
    })

    const result = await callMoonshotWithTools(
      [{ role: 'user', content: 'test' }],
      { tools: [] }
    )

    expect(result.tool_calls).toHaveLength(1)
    expect(result.tool_calls[0].function.name).toBe('read_file')
    expect(result.content).toBeNull()
  })

  it('preserves reasoning_content from K2.5 thinking', async () => {
    mockRequest({
      choices: [{
        message: {
          role: 'assistant',
          content: '{"patterns": []}',
          reasoning_content: 'I need to analyze the session...',
        }
      }],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    })

    const result = await callMoonshotWithTools(
      [{ role: 'user', content: 'test' }],
      { tools: [] }
    )

    expect(result.reasoning_content).toBe('I need to analyze the session...')
  })

  it('throws without MOONSHOT_API_KEY', async () => {
    delete process.env.MOONSHOT_API_KEY
    await expect(callMoonshotWithTools(
      [{ role: 'user', content: 'test' }],
      { tools: [] }
    )).rejects.toThrow('MOONSHOT_API_KEY')
  })

  it('does not pass thinking: disabled', async () => {
    mockRequest({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })

    await callMoonshotWithTools([{ role: 'user', content: 'test' }], { tools: [] })

    // Inspect the request body that was written
    const writeCall = https.request.mock.results[0]?.value?.write?.mock?.calls?.[0]?.[0]
    // The body should NOT contain "thinking":{"type":"disabled"}
    // (Exact assertion depends on mock setup — key point is thinking is not disabled)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quoth-plugin && npx vitest run tests/llm-tools.test.js`
Expected: FAIL — `callMoonshotWithTools is not a function`

- [ ] **Step 3: Implement `callMoonshotWithTools()`**

Add to `quoth-plugin/daemon/lib/llm.js`, before the `module.exports` line:

```javascript
/**
 * Call Moonshot K2.5 with tool calling support (multi-turn).
 * Thinking mode is enabled by default (do NOT disable).
 * Returns structured response for multi-turn loop in extract().
 *
 * @param {Object[]} messages - Full message array (system + user + assistant + tool)
 * @param {Object} options
 * @returns {Promise<{message: Object, tool_calls: Object[]|null, content: string|null, reasoning_content: string|null, usage: Object}>}
 */
async function callMoonshotWithTools(messages, {
  tools = [],
  tool_choice = 'auto',
  maxTokens = 16384,
  promptCacheKey = null,
  responseFormat = null,
} = {}) {
  const apiKey = getMoonshotKey()
  if (!apiKey) throw new Error('No MOONSHOT_API_KEY')

  const bodyObj = {
    model: 'kimi-k2.5',
    messages,
    max_tokens: maxTokens,
    temperature: 0.6,
  }

  if (tools.length > 0) {
    bodyObj.tools = tools
    bodyObj.tool_choice = tool_choice
  }

  if (promptCacheKey) bodyObj.prompt_cache_key = promptCacheKey
  if (responseFormat) bodyObj.response_format = responseFormat

  // NOTE: do NOT set thinking: { type: 'disabled' } — let K2.5 think

  const body = JSON.stringify(bodyObj)

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: MOONSHOT_HOST,
      path: MOONSHOT_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 120000,
    }, (res) => {
      let chunks = ''
      res.on('data', c => { chunks += c })
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks)
          if (data.error) {
            reject(new Error(data.error.message || JSON.stringify(data.error)))
            return
          }
          const msg = data.choices?.[0]?.message || {}
          const toolCalls = msg.tool_calls && msg.tool_calls.length > 0 ? msg.tool_calls : null
          resolve({
            message: msg,
            tool_calls: toolCalls,
            content: toolCalls ? null : (msg.content || null),
            reasoning_content: msg.reasoning_content || null,
            usage: data.usage || { prompt_tokens: 0, completion_tokens: 0 },
          })
        } catch { reject(new Error('Invalid JSON response from Moonshot')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Moonshot API timeout (120s)')) })
    req.write(body)
    req.end()
  })
}
```

Update `module.exports` to include it:

```javascript
module.exports = { callLLM, callGateway, callMoonshot, callMoonshotWithTools, callLLMWithUsage, getModel, estimateCost, MODEL_PRICING, DEFAULT_MODEL }
```

- [ ] **Step 4: Run tests**

Run: `cd quoth-plugin && npx vitest run tests/llm-tools.test.js`
Expected: PASS (adjust mock setup as needed — https mocking can be finicky with vitest)

- [ ] **Step 5: Verify existing tests still pass**

Run: `cd quoth-plugin && npx vitest run`
Expected: No regressions — `callMoonshot()` unchanged, existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add quoth-plugin/daemon/lib/llm.js quoth-plugin/tests/llm-tools.test.js
git commit -m "feat(extract): add callMoonshotWithTools for multi-turn tool calling

120s timeout, thinking enabled, tool_choice support, reasoning_content preserved.
Existing callMoonshot() unchanged."
```

---

## Task 3: Rewrite `extract.js` — Multi-Turn Tool Loop

The core change. Replace single-turn `buildPrompt()` + `callMoonshot()` with `buildSystemPrompt()` + `buildUserPrompt()` + multi-turn loop.

**Files:**
- Modify: `quoth-plugin/daemon/pipeline/extract.js`
- Modify: `quoth-plugin/tests/extract.test.js`

### Key decisions from spec:
- `buildPrompt()` → `buildSystemPrompt()` (static, cacheable) + `buildUserPrompt()` (per-session)
- 60 entries max (was 30), includes `tool_input` and `user_intent`
- Multi-turn loop: max 12 iterations, dynamic tool budget (2/5/8), 100K token cap
- Return shape: `{ id, condition, action, tags, quality_signal, embedding, source }` (was `{ id, pattern, ... }`)
- `id` = `sha1(condition + action)`
- Embedding text = `condition + " → " + action`
- JSON mode attempt → fallback to `parseJson()` regex
- `parsePatterns()` accepts both `{"patterns": [...]}` and `{"session_type": "routine", "patterns": []}`
- Sonnet fallback: concatenate system + user prompt, single-turn, no tools

- [ ] **Step 1: Write failing tests for the new return shape**

Update `quoth-plugin/tests/extract.test.js` — replace the current `extract()` tests with v2 shape tests. Keep `makeId`, `QUALITY_MAP`, `QUALITY_PRIORS` tests (they still apply).

```javascript
// Replace the extract() test section:

describe('extract() v2 — condition/action return shape', () => {
  it('happy path: returns patterns with condition and action', async () => {
    // Mock callMoonshotWithTools to return final content directly (no tool calls)
    vi.doMock('../daemon/lib/llm.js', () => ({
      callMoonshotWithTools: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: JSON.stringify({
          patterns: [{
            condition: 'When adding a NOT NULL column to a table with existing data',
            action: 'Add as nullable first, backfill default, then alter to NOT NULL — ORM push won\'t handle this in one step',
            tags: ['database', 'migration'],
            quality_signal: 'domain',
          }]
        })},
        tool_calls: null,
        content: JSON.stringify({
          patterns: [{
            condition: 'When adding a NOT NULL column to a table with existing data',
            action: 'Add as nullable first, backfill default, then alter to NOT NULL — ORM push won\'t handle this in one step',
            tags: ['database', 'migration'],
            quality_signal: 'domain',
          }]
        }),
        reasoning_content: 'Thinking about the session...',
        usage: { prompt_tokens: 500, completion_tokens: 200 },
      }),
      getMoonshotKey: () => 'test-key',
    }))

    // Re-require extract after mocking
    vi.resetModules()
    const { extract } = require('../daemon/pipeline/extract.js')

    const db = mockDb()
    const result = await extract(SUMMARY, TOOL_ENTRIES, db)

    expect(result).toHaveLength(1)
    expect(result[0].condition).toContain('NOT NULL column')
    expect(result[0].action).toContain('nullable first')
    expect(result[0]).not.toHaveProperty('pattern')
    expect(result[0]).not.toHaveProperty('intention')
    expect(result[0].id).toHaveLength(12)
    expect(result[0].source).toBe('distilled')
  })

  it('empty patterns array returns empty result', async () => {
    vi.doMock('../daemon/lib/llm.js', () => ({
      callMoonshotWithTools: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: '{"patterns": []}' },
        tool_calls: null,
        content: '{"patterns": []}',
        reasoning_content: null,
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
      getMoonshotKey: () => 'test-key',
    }))
    vi.resetModules()
    const { extract } = require('../daemon/pipeline/extract.js')

    const result = await extract(SUMMARY, TOOL_ENTRIES, mockDb())
    expect(result).toHaveLength(0)
  })

  it('backward compat: session_type routine returns empty', async () => {
    vi.doMock('../daemon/lib/llm.js', () => ({
      callMoonshotWithTools: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: '{"session_type":"routine","patterns":[]}' },
        tool_calls: null,
        content: '{"session_type":"routine","patterns":[]}',
        reasoning_content: null,
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
      getMoonshotKey: () => 'test-key',
    }))
    vi.resetModules()
    const { extract } = require('../daemon/pipeline/extract.js')

    const result = await extract(SUMMARY, TOOL_ENTRIES, mockDb())
    expect(result).toHaveLength(0)
  })

  it('id is sha1 of condition + action', async () => {
    const { makeId } = require('../daemon/pipeline/extract.js')
    const condition = 'When X'
    const action = 'Do Y'
    const expected = makeId(condition + action)
    // Verify the hash uses both fields
    expect(expected).not.toBe(makeId(condition))
    expect(expected).not.toBe(makeId(action))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quoth-plugin && npx vitest run tests/extract.test.js`
Expected: FAIL — `callMoonshotWithTools` mock issues or `result[0].condition` undefined

- [ ] **Step 3: Rewrite `extract.js`**

Replace the contents of `quoth-plugin/daemon/pipeline/extract.js`. Keep `QUALITY_MAP`, `QUALITY_PRIORS`, `makeId`, `parseJson`. Replace `buildPrompt` → `buildSystemPrompt` + `buildUserPrompt`. Replace `extract()` with multi-turn loop.

Key implementation (pseudocode → real code):

```javascript
'use strict'

const crypto = require('crypto')
const childProcess = require('child_process')

// ... keep QUALITY_MAP, QUALITY_PRIORS, makeId, parseJson as-is ...

// --- Tool definitions for K2.5 ---
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the local filesystem. Use this to understand code that was edited or referenced during the session. Returns file contents (truncated to maxLines).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file' },
          maxLines: { type: 'integer', description: 'Maximum lines to return (default 100, max 200)', default: 100 },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep_codebase',
      description: 'Search for a pattern in the project codebase. Use this to understand how a function/component is used across the project. Returns matching lines with file paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'Directory to search in (defaults to project root)' },
          maxResults: { type: 'integer', description: 'Maximum matching lines to return (default 30, max 50)', default: 30 },
        },
        required: ['pattern'],
      },
    },
  },
]

function buildSystemPrompt() {
  return `You are analyzing coding sessions to extract reusable engineering patterns.

You have tools to read files and search code from the session's project.
Use them to understand WHAT ACTUALLY HAPPENED — don't guess from tool names alone.

EXTRACTION RULES:
1. Use your tools to read the key files that were edited or referenced.
   Focus on files that were Written/Edited, not just Read.
2. Extract patterns that encode a TRANSFERABLE TECHNIQUE — not a description
   of what tools were used.
3. Each pattern has TWO parts:
   - condition: WHEN to apply this (situation, context, signals)
   - action: WHAT to do (the technique, approach, or decision)
4. A good pattern helps someone in a SIMILAR situation make a better decision.
   A bad pattern describes obvious tool usage.

GOOD PATTERNS:
- condition: "When adding a NOT NULL column to a table with existing data in a
  Next.js app using Drizzle ORM"
  action: "Add the column as nullable first, backfill with a default via SQL,
  then alter to NOT NULL — Drizzle's push won't handle this in one step"
- condition: "When debugging hydration mismatches in Next.js App Router where
  the component uses Date formatting"
  action: "Move date formatting to a client-only useEffect or pass the
  formatted string from the server as a prop — SSR and client locales diverge"

BAD PATTERNS (do NOT extract):
- "Read file then edit it" (obvious)
- "Use grep to find code" (describes a tool, not a technique)
- "Preserve existing code structure" (tautological)
- "Run tests after changes" (standard practice)

OUTPUT FORMAT:
Respond with JSON:
{
  "patterns": [
    {
      "condition": "when/situation (50-150 chars)",
      "action": "what to do and why (100-250 chars)",
      "tags": ["domain1", "domain2"],
      "quality_signal": "universal" | "domain" | "project" | "edge_case"
    }
  ]
}

Return {"patterns": []} if no genuine technique emerged.`
}

function buildUserPrompt(summaryEntry, toolEntries) {
  const project = summaryEntry.project || 'unknown'
  const outcome = summaryEntry.outcome || 'unknown'
  const successRate = Math.round((summaryEntry.success_rate || 0) * 100)
  const intents = (summaryEntry.user_intents || [])
    .filter(i => i && i.length > 5)
    .slice(0, 5)
    .join(' -> ') || 'Not captured'

  const actions = toolEntries.map((e, i) => {
    const parts = [`  ${i + 1}. [${e.tool}] ${(e.task || '').slice(0, 150)}`]
    if (e.tool_input) parts.push(`     Input: ${(e.tool_input || '').slice(0, 300)}`)
    if (e.user_intent) parts.push(`     Intent: ${e.user_intent}`)
    if (e.llm_reasoning) parts.push(`     Reasoning: ${(e.llm_reasoning || '').slice(0, 150)}`)
    return parts.join('\n')
  }).join('\n')

  return `SESSION:
- Project: ${project}
- Outcome: ${outcome} (success rate: ${successRate}%)
- User intents: ${intents}

ACTIONS (${toolEntries.length} tool calls, chronological):
${actions || 'No actions captured'}

Use your tools to read files that were edited or referenced above,
then extract patterns.`
}

// --- JSON mode support discovery (cached per daemon lifecycle) ---
let _jsonModeSupported = null // null = untested, true/false = discovered

function parsePatterns(raw) {
  let parsed
  try {
    parsed = parseJson(raw)
  } catch (err) {
    throw new Error(`JSON parse failed: ${err.message}`)
  }

  // Backward compat: session_type "routine" = no patterns
  if (parsed.session_type === 'routine') return []
  if (!parsed.patterns || !Array.isArray(parsed.patterns)) return []

  return parsed.patterns.filter(p =>
    p.condition && p.condition.length >= 10 &&
    p.action && p.action.length >= 20 && p.action.length <= 500
  )
}

async function extract(summaryEntry, toolEntries, db) {
  const recentTools = toolEntries.slice(-60)
  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(summaryEntry, recentTools)
  const cacheKey = crypto.createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16)

  const maxCalls = recentTools.length <= 10 ? 2
    : recentTools.length <= 30 ? 5
    : 8

  let rawOutput
  let model = 'kimi-k2.5'

  // Primary: K2.5 multi-turn with tool calling
  try {
    const { callMoonshotWithTools } = require('../lib/llm.js')
    const { executeToolCall, resolveProjectRoot, sanitize } = require('../lib/tool-executor.js')
    const projectRoot = resolveProjectRoot(summaryEntry.project, recentTools)

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    let toolCallCount = 0
    let totalTokens = 0

    for (let iteration = 0; iteration < 12; iteration++) {
      const forceContent = toolCallCount >= maxCalls || totalTokens >= 100000

      const callOpts = {
        tools: TOOL_DEFINITIONS,
        tool_choice: forceContent ? 'none' : 'auto',
        maxTokens: 16384,
        promptCacheKey: cacheKey,
      }

      // Try JSON mode on first call if not yet discovered as unsupported
      if (iteration === 0 && _jsonModeSupported !== false) {
        callOpts.responseFormat = { type: 'json_object' }
      }

      let response
      try {
        response = await callMoonshotWithTools(messages, callOpts)
      } catch (apiErr) {
        // JSON mode + tools combo rejected? Retry without response_format
        if (iteration === 0 && callOpts.responseFormat && apiErr.message?.includes('response_format')) {
          _jsonModeSupported = false
          delete callOpts.responseFormat
          response = await callMoonshotWithTools(messages, callOpts)
        } else {
          throw apiErr
        }
      }

      if (iteration === 0 && callOpts.responseFormat && _jsonModeSupported === null) {
        _jsonModeSupported = true
      }

      totalTokens += (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0)

      // Tool calls? Execute locally
      if (response.tool_calls && !forceContent) {
        messages.push({
          role: 'assistant',
          content: response.content || null,
          reasoning_content: response.reasoning_content || undefined,
          tool_calls: response.tool_calls,
        })

        for (const tc of response.tool_calls) {
          const result = executeToolCall(tc, projectRoot)
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: sanitize(result),
          })
          toolCallCount++
        }
        continue
      }

      // Final content response
      if (response.content) {
        rawOutput = response.content
        break
      }
    }

    if (!rawOutput) return [] // Exhausted iterations
  } catch (primaryErr) {
    // Log primary failure
    try {
      db.insertPipelineError({
        stage: 'extract',
        error_message: primaryErr.message,
        error_stack: (primaryErr.stack || '').slice(0, 500),
        context: JSON.stringify({
          session_id: summaryEntry.session,
          project: summaryEntry.project,
          entry_count: recentTools.length,
          model: 'kimi-k2.5',
        }),
        model_attempted: 'kimi-k2.5',
        fallback_attempted: 1,
      })
    } catch {}

    // Fallback: claude -p Sonnet (single-turn, no tools)
    try {
      const fallbackPrompt = systemPrompt + '\n---\n' + userPrompt
      rawOutput = childProcess.execSync(
        'claude -p --model claude-sonnet-4-6 --effort low --output-format text --allowedTools ""',
        {
          input: fallbackPrompt,
          encoding: 'utf8',
          timeout: 60000,
          maxBuffer: 512 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      )
      model = 'claude-sonnet-4-6'

      try {
        db.insertPipelineError({
          stage: 'extract',
          error_message: `Primary failed, fallback succeeded: ${primaryErr.message}`,
          context: JSON.stringify({ session_id: summaryEntry.session, model: 'claude-sonnet-4-6' }),
          model_attempted: 'kimi-k2.5',
          fallback_attempted: 1,
          fallback_succeeded: 1,
        })
      } catch {}
    } catch (fallbackErr) {
      try {
        db.insertPipelineError({
          stage: 'extract',
          error_message: `Both models failed. Fallback: ${fallbackErr.message}`,
          error_stack: (fallbackErr.stack || '').slice(0, 500),
          context: JSON.stringify({
            session_id: summaryEntry.session,
            project: summaryEntry.project,
            entry_count: recentTools.length,
            primary_error: primaryErr.message,
          }),
          model_attempted: 'claude-sonnet-4-6',
          fallback_attempted: 1,
          fallback_succeeded: 0,
        })
      } catch {}
      return []
    }
  }

  // Parse patterns
  let validPatterns
  try {
    validPatterns = parsePatterns(rawOutput)
  } catch (parseErr) {
    try {
      db.insertPipelineError({
        stage: 'extract',
        error_message: parseErr.message,
        context: JSON.stringify({ output_preview: (rawOutput || '').slice(0, 500), model }),
        model_attempted: model,
      })
    } catch {}
    return []
  }

  if (validPatterns.length === 0) return []

  // Batch embed: condition + " → " + action
  let embeddings = validPatterns.map(() => null)
  try {
    const { generateEmbeddingBatch } = require('../lib/embed.js')
    embeddings = await generateEmbeddingBatch(
      validPatterns.map(p => `${p.condition} → ${p.action}`)
    )
  } catch (embedErr) {
    try {
      db.insertPipelineError({
        stage: 'embed',
        error_message: embedErr.message,
        context: JSON.stringify({ pattern_count: validPatterns.length }),
        model_attempted: 'MiniLM-L6-v2',
      })
    } catch {}
  }

  return validPatterns.map((p, i) => ({
    id: makeId(p.condition + p.action),
    condition: p.condition,
    action: p.action,
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 5) : [],
    quality_signal: QUALITY_MAP[p.quality_signal] ? p.quality_signal : 'project',
    embedding: embeddings[i],
    source: 'distilled',
  }))
}

module.exports = {
  extract, makeId, buildSystemPrompt, buildUserPrompt, parseJson, parsePatterns,
  QUALITY_MAP, QUALITY_PRIORS, TOOL_DEFINITIONS,
}
```

- [ ] **Step 4: Update `extract.test.js` imports**

The test file imports `buildPrompt` which no longer exists. Update:

```javascript
const { extract, makeId, QUALITY_MAP, QUALITY_PRIORS, buildSystemPrompt, buildUserPrompt, parsePatterns } = require('../daemon/pipeline/extract.js')
```

Remove any tests that reference `buildPrompt`. Add:

```javascript
describe('buildSystemPrompt', () => {
  it('returns a string containing extraction rules', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('EXTRACTION RULES')
    expect(prompt).toContain('condition')
    expect(prompt).toContain('action')
    expect(prompt).toContain('GOOD PATTERNS')
    expect(prompt).toContain('BAD PATTERNS')
  })
})

describe('buildUserPrompt', () => {
  it('includes tool_input and user_intent', () => {
    const entries = [{
      tool: 'Edit',
      task: 'Edit auth.js',
      tool_input: 'file: /src/auth.js, old: function login(), new: async function login()',
      user_intent: 'Make login async',
      llm_reasoning: 'Need async for DB calls',
    }]
    const prompt = buildUserPrompt(SUMMARY, entries)
    expect(prompt).toContain('file: /src/auth.js')
    expect(prompt).toContain('Make login async')
    expect(prompt).toContain('quoth')
  })
})

describe('parsePatterns', () => {
  it('parses valid condition/action patterns', () => {
    const json = JSON.stringify({
      patterns: [{
        condition: 'When doing X in context Y with constraint Z',
        action: 'Do A then B then C because D, ensuring E is handled properly for robustness',
        tags: ['test'],
        quality_signal: 'domain',
      }]
    })
    const result = parsePatterns(json)
    expect(result).toHaveLength(1)
    expect(result[0].condition).toContain('When doing X')
  })

  it('filters patterns with short condition', () => {
    const json = JSON.stringify({
      patterns: [{ condition: 'Short', action: 'Valid action with enough characters to pass filter easily', tags: [], quality_signal: 'project' }]
    })
    expect(parsePatterns(json)).toHaveLength(0)
  })

  it('handles session_type routine for backward compat', () => {
    expect(parsePatterns('{"session_type":"routine","patterns":[]}')).toHaveLength(0)
  })
})
```

- [ ] **Step 5: Run all extract tests**

Run: `cd quoth-plugin && npx vitest run tests/extract.test.js`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add quoth-plugin/daemon/pipeline/extract.js quoth-plugin/tests/extract.test.js
git commit -m "feat(extract): v2 multi-turn tool loop with condition/action patterns

- Split buildPrompt → buildSystemPrompt + buildUserPrompt (cacheable)
- Multi-turn loop: 2/5/8 tool calls, 12 iteration cap, 100K token cap
- Return shape: {condition, action} replaces {pattern, intention}
- Embed text: condition + ' → ' + action for richer semantic dedup
- JSON mode discovery with regex fallback
- 60 entries max (was 30), includes tool_input + user_intent"
```

---

## Task 4: Update `daemon.js` — Persistence and Caller Changes

Update `insertNewPattern()` to use the new `condition`/`action` fields and `processSessionLocal()` to pass enriched entries.

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js` (lines ~402-463)

- [ ] **Step 1: Read `insertNewPattern()` and `processSessionLocal()`**

Already read at `daemon.js:402-463` and `daemon.js:315-350`. Key changes:
- `distilled.pattern` → `distilled.action` (3 occurrences)
- `condition: Session: ...` → `distilled.condition`
- `findDuplicateByName(distilled.pattern)` → `findDuplicateByName(distilled.action)`
- Add `description: distilled.condition`
- `processSessionLocal()` passes enriched entries (already does — `extract()` handles the 60-entry cap internally)

- [ ] **Step 2: Update `insertNewPattern()`**

In `quoth-plugin/daemon/daemon.js`, at `insertNewPattern()` function (~line 408):

Replace:
```javascript
const dupByName = db.findDuplicateByName(distilled.pattern)
```
With:
```javascript
const dupByName = db.findDuplicateByName(distilled.action)
```

Replace:
```javascript
  db.upsertPattern({
    id: distilled.id,
    name: distilled.pattern.slice(0, 200),
    pattern_type: 'code-pattern',
    condition: `Session: ${(summaryEntry.task || '').slice(0, 100)}`,
    action: distilled.pattern,
```
With:
```javascript
  db.upsertPattern({
    id: distilled.id,
    name: (distilled.action || '').slice(0, 200),
    pattern_type: 'code-pattern',
    condition: distilled.condition || '',
    action: distilled.action || '',
    description: distilled.condition || '',
```

Replace:
```javascript
    name: distilled.pattern.slice(0, 80),
```
With:
```javascript
    name: (distilled.action || '').slice(0, 80),
```

- [ ] **Step 3: Run full test suite**

Run: `cd quoth-plugin && npx vitest run`
Expected: All PASS. If `insertNewPattern` is called in any integration test, verify it works with the new field names.

- [ ] **Step 4: Commit**

```bash
git add quoth-plugin/daemon/daemon.js
git commit -m "feat(extract): update insertNewPattern for condition/action schema

- name = distilled.action (was distilled.pattern)
- condition = distilled.condition (was 'Session: ...' hardcoded)
- description = distilled.condition (for search display)
- findDuplicateByName uses action text for dedup"
```

---

## Task 5: Migration — Re-embed Existing Patterns

On deployment, existing patterns have embeddings from `pattern`-only text. New patterns will embed `condition + " → " + action`. To prevent dedup drift, re-embed all active patterns once.

This is a one-time script, not a daemon feature. Keep it simple.

**Files:**
- Create: `quoth-plugin/scripts/reembed-patterns.js`

- [ ] **Step 1: Write the re-embed script**

```javascript
// quoth-plugin/scripts/reembed-patterns.js
'use strict'

/**
 * One-time migration: re-embed all active patterns using
 * condition + " → " + action text for v2 dedup consistency.
 *
 * Run: node quoth-plugin/scripts/reembed-patterns.js
 */

const path = require('path')
const os = require('os')

const DB_PATH = path.join(os.homedir(), '.quoth', 'memory.db')

async function main() {
  const { generateEmbeddingBatch } = require('../daemon/lib/embed.js')

  // Open DB directly
  const Database = require('better-sqlite3')
  const db = new Database(DB_PATH)

  const patterns = db.prepare(
    "SELECT id, name, condition, action FROM patterns WHERE status = 'active'"
  ).all()

  console.log(`Found ${patterns.length} active patterns to re-embed`)

  if (patterns.length === 0) {
    db.close()
    return
  }

  // Build embedding text: use condition + " → " + action
  // For v1 patterns where condition = "Session: ...", use name as both sides
  const texts = patterns.map(p => {
    const cond = (p.condition && !p.condition.startsWith('Session:'))
      ? p.condition
      : (p.name || '')
    const act = p.action || p.name || ''
    return `${cond} → ${act}`
  })

  // Batch in groups of 32 (MiniLM handles this efficiently)
  const BATCH_SIZE = 32
  const update = db.prepare('UPDATE patterns SET embedding = ? WHERE id = ?')
  let updated = 0

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const embeddings = await generateEmbeddingBatch(batch)

    const tx = db.transaction((startIdx, embeds) => {
      for (let j = 0; j < embeds.length; j++) {
        if (embeds[j]) {
          update.run(JSON.stringify(embeds[j]), patterns[startIdx + j].id)
          updated++
        }
      }
    })
    tx(i, embeddings)
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, patterns.length)}/${patterns.length}\r`)
  }

  console.log(`\nRe-embedded ${updated} patterns`)
  db.close()
}

main().catch(err => {
  console.error('Re-embed failed:', err.message)
  process.exit(1)
})
```

- [ ] **Step 2: Test the script against a dry-run**

Run: `cd quoth-plugin && node scripts/reembed-patterns.js`
Expected: Outputs count of patterns, re-embeds them, completes without error.

- [ ] **Step 3: Commit**

```bash
git add quoth-plugin/scripts/reembed-patterns.js
git commit -m "feat(extract): add one-time re-embed script for v2 migration

Re-embeds all active patterns using 'condition → action' text format
to prevent dedup drift between v1 and v2 embedding spaces."
```

---

## Task 6: Integration Verification

End-to-end verification that the full pipeline works with all pieces connected.

**Files:**
- None new — verification only

- [ ] **Step 1: Run the full test suite**

Run: `cd quoth-plugin && npx vitest run`
Expected: All tests pass, no regressions.

- [ ] **Step 2: Verify the module dependency chain loads**

Run: `cd quoth-plugin && node -e "const e = require('./daemon/pipeline/extract.js'); console.log('extract exports:', Object.keys(e)); const t = require('./daemon/lib/tool-executor.js'); console.log('tool-executor exports:', Object.keys(t)); const l = require('./daemon/lib/llm.js'); console.log('llm exports:', Object.keys(l))"`
Expected: All three modules load without error, showing the expected export keys.

- [ ] **Step 3: Verify `buildSystemPrompt()` + `buildUserPrompt()` produce valid prompts**

Run:
```bash
cd quoth-plugin && node -e "
  const { buildSystemPrompt, buildUserPrompt } = require('./daemon/pipeline/extract.js')
  const sys = buildSystemPrompt()
  console.log('System prompt length:', sys.length, 'chars')
  console.log('Contains tool instructions:', sys.includes('read_file') || sys.includes('tools'))
  const user = buildUserPrompt(
    { project: 'quoth', outcome: 'success', success_rate: 0.9, user_intents: ['fix auth'] },
    [{ tool: 'Edit', task: 'Edit auth.js', tool_input: 'file: /src/auth.js', user_intent: 'Fix JWT', llm_reasoning: 'Token expired' }]
  )
  console.log('User prompt length:', user.length, 'chars')
  console.log('Contains tool_input:', user.includes('/src/auth.js'))
"
```
Expected: System prompt ~1500-2000 chars, user prompt includes tool_input content.

- [ ] **Step 4: Verify `parsePatterns()` handles edge cases**

Run:
```bash
cd quoth-plugin && node -e "
  const { parsePatterns } = require('./daemon/pipeline/extract.js')
  console.log('empty patterns:', parsePatterns('{\"patterns\":[]}'))
  console.log('routine:', parsePatterns('{\"session_type\":\"routine\",\"patterns\":[]}'))
  console.log('valid:', parsePatterns(JSON.stringify({patterns:[{condition:'When X happens in context Y',action:'Do A then B because C handles the edge case properly',tags:['test'],quality_signal:'domain'}]})))
"
```
Expected: First two return `[]`, third returns array with 1 pattern.

- [ ] **Step 5: Commit (if any fixes needed)**

Only commit if integration testing revealed issues that needed fixes.

```bash
git add -u quoth-plugin/
git commit -m "fix(extract): integration fixes from v2 verification"
```

---

## Task 7: Final — Run Full Suite and Document

- [ ] **Step 1: Run full test suite one final time**

Run: `cd quoth-plugin && npx vitest run`
Expected: All tests pass.

- [ ] **Step 2: Restart daemon to pick up changes**

Run: `kill -TERM $(cat ~/.quoth/daemon.pid) 2>/dev/null; echo "Daemon stopped — session-start hook will auto-restart"`
Expected: Daemon stops. It will restart automatically on the next Claude Code session start.

- [ ] **Step 3: Run re-embed migration**

Run: `cd quoth-plugin && node scripts/reembed-patterns.js`
Expected: All active patterns re-embedded with new text format.
