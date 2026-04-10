'use strict'

const crypto = require('crypto')
const childProcess = require('child_process')

/**
 * EXTRACT v2: Multi-turn tool-calling pipeline.
 *
 * Primary model: Kimi K2.5 via Moonshot API (with tool calling)
 * Fallback model: claude -p Sonnet --effort low ($0, Max plan)
 *
 * Returns 0-N patterns with condition/action format, embeddings, and quality_signal.
 * Errors are always logged to pipeline_errors table (never silent).
 */

const QUALITY_MAP = {
  universal: 0.9,
  domain: 0.7,
  project: 0.5,
  edge_case: 0.3,
}

const QUALITY_PRIORS = {
  universal: { alpha: 3, beta: 1 },
  domain: { alpha: 2, beta: 1 },
  project: { alpha: 1, beta: 1 },
  edge_case: { alpha: 1, beta: 2 },
}

function makeId(content) {
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 12)
}

function parseJson(raw) {
  let content = (raw || '').replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim()
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON object in LLM response')
  return JSON.parse(content.slice(start, end + 1))
}

// --- Tool definitions for K2.5 ---

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the project. Returns numbered lines. Use to inspect source code relevant to the session patterns.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path to read' },
          maxLines: { type: 'integer', description: 'Max lines to read (default 100, max 200)', default: 100 },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep_codebase',
      description: 'Search the project codebase for a pattern using ripgrep. Returns matching lines with file paths and line numbers.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (regex supported)' },
          path: { type: 'string', description: 'Directory to search in (defaults to project root)' },
          maxResults: { type: 'integer', description: 'Max results to return (default 30, max 50)', default: 30 },
        },
        required: ['pattern'],
      },
    },
  },
]

// --- Prompt builders ---

function buildSystemPrompt() {
  return `You are a pattern extractor analyzing coding sessions. You have tools to read files and search the codebase to understand what happened.

EXTRACTION RULES:
1. Determine if the session was productive or routine. Routine sessions (just reading files, standard edits, running tests) produce NO patterns.
2. For productive sessions, extract EVERY genuine reusable technique as a condition/action pair.
3. Each pattern has:
   - "condition": WHEN to apply this pattern (>= 10 chars). Describes the situation/trigger.
   - "action": WHAT to do (>= 20 chars, <= 500 chars). The reusable technique/workflow.
   - "tags": domain tags (max 5)
   - "quality_signal": one of "universal", "domain", "project", "edge_case"

GOOD PATTERNS:
- condition: "When refactoring across multiple files in a monorepo"
  action: "Read all target files in parallel before making batch edits to ensure consistency and catch cross-file dependencies before committing changes"
- condition: "When debugging intermittent test failures"
  action: "Isolate the failing test first with .only, then add verbose logging to the setup/teardown lifecycle hooks to identify timing or state issues"

BAD PATTERNS (do NOT extract these):
- "Read file then edit it" (obvious)
- "Run npm test after changes" (standard practice)
- "Use git commit to save changes" (trivial)

Use your tools to inspect relevant files if you need more context about the techniques used. Then respond with JSON:

{
  "session_type": "productive" | "routine",
  "patterns": [
    {
      "condition": "When/situation description (>= 10 chars)",
      "action": "What to do — reusable technique (20-500 chars)",
      "tags": ["domain1", "domain2"],
      "quality_signal": "universal" | "domain" | "project" | "edge_case"
    }
  ]
}

If routine, return {"session_type": "routine", "patterns": []}`
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
    const parts = [`${i + 1}. [${e.tool}]`]
    if (e.tool_input) parts.push(` ${(e.tool_input + '').slice(0, 300)}`)
    else if (e.task) parts.push(` ${(e.task + '').slice(0, 300)}`)
    if (e.user_intent) parts.push(`   Intent: ${e.user_intent}`)
    if (e.llm_reasoning) parts.push(`   Reasoning: ${(e.llm_reasoning + '').slice(0, 150)}`)
    if (e.outcome === 'failure') parts.push(`   FAILED`)
    return parts.join('\n')
  }).join('\n')

  return `SESSION:
- Project: ${project}
- Outcome: ${outcome} (success rate: ${successRate}%)
- User intents: ${intents}

TOOL ACTIONS (${toolEntries.length} entries, chronological):
${actions || 'No actions captured'}

Analyze this session and extract reusable patterns. Use tools if you need more context about the codebase.`
}

// --- Pattern parser ---

function parsePatterns(raw) {
  const parsed = parseJson(raw)

  // Backward-compat: routine sessions return empty
  if (parsed.session_type === 'routine' || !parsed.patterns || !Array.isArray(parsed.patterns)) {
    return []
  }

  return parsed.patterns.filter(p => {
    if (!p.condition || p.condition.length < 10) return false
    if (!p.action || p.action.length < 20 || p.action.length > 500) return false
    return true
  })
}

// --- Main extract function ---

// Module-level cache for json_mode support detection
let _jsonModeSupported = true

async function extract(summaryEntry, toolEntries, db, _deps = null) {
  const recentTools = toolEntries.slice(-60)
  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(summaryEntry, recentTools)

  // Cache key for prompt caching (K2.5 supports this)
  const cacheKey = crypto.createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16)

  // Dynamic tool budget based on entry count
  const entryCount = recentTools.length
  let toolBudget = entryCount <= 10 ? 2 : entryCount <= 30 ? 5 : 8

  let rawOutput
  let model = 'kimi-k2.5'

  // Dependency injection for testability (falls back to real modules)
  const deps = _deps || {
    callMoonshotWithTools: require('../lib/llm.js').callMoonshotWithTools,
    executeToolCall: require('../lib/tool-executor.js').executeToolCall,
    resolveProjectRoot: require('../lib/tool-executor.js').resolveProjectRoot,
    sanitize: require('../lib/tool-executor.js').sanitize,
    generateEmbeddingBatch: require('../lib/embed.js').generateEmbeddingBatch,
  }

  // Primary: Kimi K2.5 with multi-turn tool calling
  try {
    const { callMoonshotWithTools, executeToolCall, resolveProjectRoot, sanitize } = deps

    const projectRoot = resolveProjectRoot(summaryEntry.project, recentTools)

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    let totalTokens = 0

    for (let iter = 0; iter < 12; iter++) {
      const forceNoTools = toolBudget <= 0 || totalTokens >= 100_000
      const callOpts = {
        tools: forceNoTools ? [] : TOOL_DEFINITIONS,
        tool_choice: forceNoTools ? 'none' : 'auto',
        maxTokens: 16384,
        promptCacheKey: cacheKey,
      }

      // Try json_mode on first call if supported
      if (iter === 0 && _jsonModeSupported) {
        callOpts.responseFormat = { type: 'json_object' }
      }

      let response
      try {
        response = await callMoonshotWithTools(messages, callOpts)
      } catch (apiErr) {
        // If json_mode rejected, retry without it
        if (iter === 0 && _jsonModeSupported && apiErr.message && apiErr.message.includes('response_format')) {
          _jsonModeSupported = false
          delete callOpts.responseFormat
          response = await callMoonshotWithTools(messages, callOpts)
        } else {
          throw apiErr
        }
      }

      totalTokens += (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0)

      // Build assistant message for conversation history
      const assistantMsg = { role: 'assistant' }
      if (response.message?.content) assistantMsg.content = response.message.content
      if (response.reasoning_content) assistantMsg.reasoning_content = response.reasoning_content
      if (response.tool_calls) assistantMsg.tool_calls = response.tool_calls

      messages.push(assistantMsg)

      // Tool calls → execute and continue loop
      if (response.tool_calls) {
        for (const tc of response.tool_calls) {
          const result = executeToolCall(tc, projectRoot)
          const sanitized = sanitize(result) || 'No output'
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized),
          })
          toolBudget--
        }
        continue
      }

      // Content response → we're done
      if (response.content) {
        rawOutput = response.content
        break
      }

      // No tool calls and no content — shouldn't happen, but break to avoid infinite loop
      break
    }

    if (!rawOutput) {
      throw new Error('K2.5 returned no content after tool loop')
    }
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

    // Fallback: claude -p Sonnet --effort low ($0)
    try {
      const fallbackPrompt = systemPrompt + '\n\n' + userPrompt
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

      // Mark fallback success
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
      // Both failed — log and return empty
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

  // Parse patterns from LLM output
  let validPatterns
  try {
    validPatterns = parsePatterns(rawOutput)
  } catch (parseErr) {
    try {
      db.insertPipelineError({
        stage: 'extract',
        error_message: `JSON parse failed: ${parseErr.message}`,
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
    embeddings = await deps.generateEmbeddingBatch(
      validPatterns.map(p => p.condition + ' → ' + p.action)
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
