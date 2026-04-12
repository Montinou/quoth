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
  return `You are a session analyzer. You have tools to read files and search the codebase. You produce two things from a session: PATTERNS (reusable techniques) and FACTS (stable, session-independent knowledge).

DECIDE FIRST: Was this session productive or routine?
- productive: the agent accomplished something non-trivial, learned, fixed a bug, shipped code, established a fact, or made a decision
- routine: the agent just read files, ran standard tests, asked questions — nothing worth remembering

For routine sessions, return { "session_type": "routine", "patterns": [], "facts": [] }.

For productive sessions, extract BOTH patterns and facts.

PATTERN EXTRACTION RULES:
1. A pattern has { condition, action, tags, quality_signal }
   - condition (>= 10 chars): WHEN to apply this pattern — the trigger/situation
   - action (20-500 chars): WHAT to do — the reusable technique/workflow
   - tags: max 5 short domain tags
   - quality_signal: one of "universal", "domain", "project", "edge_case"
2. GOOD PATTERNS:
   - condition: "When refactoring across multiple files in a monorepo"
     action: "Read all target files in parallel before batch-editing to ensure consistency and catch cross-file dependencies before committing"
   - condition: "When debugging intermittent test failures"
     action: "Isolate the failing test with .only, then add verbose logging to setup/teardown hooks to identify timing or state issues"
3. BAD PATTERNS (do NOT extract these):
   - "Read file then edit it" (obvious)
   - "Run npm test after changes" (standard practice)
   - "Use git commit to save changes" (trivial)

FACT EXTRACTION RULES:
1. A fact is a stable piece of knowledge that is true INDEPENDENT of this particular session — it is something someone would want to know next week.
2. A fact has { topic, statement, evidence, scope, tags }
   - topic (<= 120 chars): short slug-like key e.g. "build command", "auth flow", "db primary key"
   - statement (<= 500 chars): the fact itself, in one or two sentences
   - evidence (<= 300 chars, optional): how we know — file path, command output, url, commit, etc
   - scope: one of "global" (true across all projects) or "project" (true for this project). These are the ONLY two allowed scopes. Do NOT use "user" or anything else.
   - tags: max 5 short tags
3. GOOD FACTS:
   - { topic: "build command", statement: "The plugin builds with \`pnpm -C quoth-plugin test\`", evidence: "package.json scripts", scope: "project", tags: ["build","pnpm"] }
   - { topic: "atomic rename on POSIX", statement: "fs.renameSync is atomic inside the same filesystem on POSIX, which is what makes the active→processing handoff race-free", scope: "global", tags: ["posix","fs"] }
   - { topic: "db primary key", statement: "The sessions table uses a compound (session_id, epoch) primary key", evidence: "daemon/db.js", scope: "project", tags: ["db","schema"] }
4. BAD FACTS (do NOT extract these):
   - Anything that's just THIS session's state (e.g. "we just edited foo.ts")
   - Anything that's obviously true (e.g. "Node.js has a fs module")
   - Anything about the human operator (preferences, role, language) — that is NOT in scope for facts
   - Repetition of the exact same topic multiple times — pick the most complete phrasing

Use your tools to inspect files if you need more context. Then respond with JSON:

{
  "session_type": "productive" | "routine",
  "patterns": [
    { "condition": "...", "action": "...", "tags": ["..."], "quality_signal": "universal" | "domain" | "project" | "edge_case" }
  ],
  "facts": [
    { "topic": "...", "statement": "...", "evidence": "...", "scope": "global" | "project", "tags": ["..."] }
  ]
}

If routine, return { "session_type": "routine", "patterns": [], "facts": [] }.`
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

// --- Extract output parser ---

// Spec §6.6: only "global" and "project" are allowed. "user" is explicitly
// NOT a valid fact scope — facts about the human operator are out of scope.
const ALLOWED_SCOPES = new Set(['global', 'project'])

function parseExtractOutput(raw) {
  const parsed = parseJson(raw)

  const session_type = parsed.session_type === 'productive' ? 'productive' : 'routine'
  if (session_type === 'routine') {
    return { session_type, patterns: [], facts: [] }
  }

  const rawPatterns = Array.isArray(parsed.patterns) ? parsed.patterns : []
  const patterns = rawPatterns.filter(p => {
    if (!p.condition || typeof p.condition !== 'string' || p.condition.length < 10) return false
    if (!p.action || typeof p.action !== 'string' || p.action.length < 20 || p.action.length > 500) return false
    return true
  })

  const rawFacts = Array.isArray(parsed.facts) ? parsed.facts : []
  const facts = rawFacts
    .filter(f => {
      if (!f.topic || typeof f.topic !== 'string' || f.topic.trim().length === 0) return false
      if (!f.statement || typeof f.statement !== 'string' || f.statement.trim().length === 0) return false
      if (!f.scope || !ALLOWED_SCOPES.has(f.scope)) return false
      return true
    })
    .map(f => ({
      topic: f.topic.trim().slice(0, 120),
      statement: f.statement.trim().slice(0, 500),
      evidence: typeof f.evidence === 'string' ? f.evidence.trim().slice(0, 300) : null,
      scope: f.scope,
      tags: Array.isArray(f.tags) ? f.tags.slice(0, 5) : [],
    }))

  return { session_type, patterns, facts }
}

// Back-compat shim so any existing direct caller still works until Task 8
// rewires everything via parseExtractOutput. NOTE: this just returns the
// patterns array from the new parser.
function parsePatterns(raw) {
  return parseExtractOutput(raw).patterns
}

// --- Main extract function ---

// Module-level cache for json_mode support detection.
// Latched off only on clear 400 response_format rejection from Moonshot.
// Exposed reset helper for tests and to allow future retry logic.
let _jsonModeSupported = true

function _resetJsonModeCache() {
  _jsonModeSupported = true
}

async function extract(summaryEntry, toolEntries, db, _deps = null) {
  const recentTools = toolEntries.slice(-60)
  let extractedFacts = []
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

    // Moonshot's usage.prompt_tokens is cumulative-per-turn (includes full
    // conversation history). We overwrite totalTokens each iteration rather
    // than summing, to avoid artificially tripping the 200K cap. Kimi K2.5
    // advertises 256K context — we leave ~56K slack for output + overhead.
    let totalTokens = 0

    for (let iter = 0; iter < 12; iter++) {
      const forceNoTools = toolBudget <= 0 || totalTokens >= 200_000
      const callOpts = {
        tools: forceNoTools ? [] : TOOL_DEFINITIONS,
        tool_choice: forceNoTools ? 'none' : 'auto',
        maxTokens: 32768,
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
        // If json_mode rejected, retry without it. Only latch-off on clear
        // 4xx client errors that mention response_format AND "not support"
        // or "invalid" — to avoid false positives on coincidental substring matches.
        const msg = (apiErr?.message || '').toLowerCase()
        const looksLikeResponseFormatRejection =
          msg.includes('response_format') &&
          (msg.includes('not support') || msg.includes('unsupported') || msg.includes('invalid')) &&
          (msg.includes('400') || msg.includes('bad request') || !msg.includes('5'))
        if (iter === 0 && _jsonModeSupported && looksLikeResponseFormatRejection) {
          _jsonModeSupported = false
          delete callOpts.responseFormat
          response = await callMoonshotWithTools(messages, callOpts)
        } else {
          throw apiErr
        }
      }

      // Overwrite (don't accumulate) — prompt_tokens already includes history.
      totalTokens = (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0)

      // Build assistant message for conversation history.
      // Only include role/content/tool_calls — NEVER reasoning_content, which
      // Moonshot rejects as an input-side field (output-only).
      const assistantMsg = { role: 'assistant', content: response.message?.content ?? null }
      if (response.tool_calls && response.tool_calls.length > 0) {
        assistantMsg.tool_calls = response.tool_calls
      }
      messages.push(assistantMsg)

      // Tool calls → execute and continue loop.
      // Enforce tool budget per-call: if response returns more tool_calls
      // than budget allows, execute only the first N and push synthetic
      // tool results for the rest so the conversation stays valid.
      if (response.tool_calls && response.tool_calls.length > 0) {
        const allCalls = response.tool_calls
        const runnable = Math.max(0, toolBudget)
        const toRun = allCalls.slice(0, runnable)
        const toSkip = allCalls.slice(runnable)

        for (const tc of toRun) {
          const result = executeToolCall(tc, projectRoot)
          const sanitized = sanitize(result) || 'No output'
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized),
          })
          toolBudget--
        }

        for (const tc of toSkip) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: 'Tool budget exhausted — no more tools available',
          })
        }

        continue
      }

      // Content response → we're done. llm.js exposes both response.content
      // (null when tool_calls present) and response.message.content. Prefer
      // the top-level convenience field for consistency.
      const finalContent = response.content ?? response.message?.content ?? null
      if (finalContent) {
        rawOutput = finalContent
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
      return { patterns: [], facts: [] }
    }
  }

  // Parse patterns from LLM output
  let validPatterns
  try {
    const parsed = parseExtractOutput(rawOutput)
    validPatterns = parsed.patterns
    // Attach facts onto the result so the caller can consume them.
    extractedFacts = parsed.facts
  } catch (parseErr) {
    try {
      db.insertPipelineError({
        stage: 'extract',
        error_message: `JSON parse failed: ${parseErr.message}`,
        context: JSON.stringify({ output_preview: (rawOutput || '').slice(0, 500), model }),
        model_attempted: model,
      })
    } catch {}
    return { patterns: [], facts: [] }
  }

  if (validPatterns.length === 0) return { patterns: [], facts: extractedFacts }

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

  const patterns = validPatterns.map((p, i) => ({
    id: makeId(p.condition + p.action),
    condition: p.condition,
    action: p.action,
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 5) : [],
    quality_signal: QUALITY_MAP[p.quality_signal] ? p.quality_signal : 'project',
    embedding: embeddings[i],
    source: 'distilled',
  }))

  return { patterns, facts: extractedFacts }
}

// ============================================================================
// Task 9 — four-kind extractor (runs alongside legacy extract() above).
//
// NOTE on naming: the legacy extractor already exports `parseExtractOutput`
// with a {patterns, facts} shape. The original Task 9 plan reused that name
// for the new 4-kind shape, which would collide. We intentionally deviate
// from the plan and name the new parser `parseExtractEntities` + new runner
// `runExtract`, leaving the legacy functions untouched. This is sanctioned
// by the plan's open-issue footer: "extract.js DI shape differs from Task 9
// assumption". Legacy callers (8 in tests/extract.test.js) keep working.
// ============================================================================

const { reserve, reconcile } = require('../lib/llm-budget.js')
const { logPipelineError } = require('../db.js')

const EXTRACT_EST_COST = { low: 0.005, medium: 0.012, high: 0.025 }
const VALID_ENTITY_KINDS = new Set(['pattern', 'decision', 'anti_pattern', 'fact'])
const ALL_KINDS = ['pattern', 'decision', 'anti_pattern', 'fact']

function estCost(urgency) {
  return EXTRACT_EST_COST[urgency] ?? EXTRACT_EST_COST.medium
}

function buildEntitiesSystemPrompt({ urgency = 'medium', suspected_kinds = ALL_KINDS, strict = false } = {}) {
  const depthHint = urgency === 'high'
    ? 'Be thorough. Extract every distinct pattern, decision, anti-pattern, and fact worth remembering.'
    : urgency === 'low'
      ? 'Be conservative. Only extract clearly valuable items. It is fine to return an empty entities array.'
      : 'Extract the meaningful items you observe. Skip trivial or obvious entries.'

  const kindsFilter = Array.isArray(suspected_kinds) && suspected_kinds.length > 0
    ? suspected_kinds.filter(k => VALID_ENTITY_KINDS.has(k))
    : ALL_KINDS

  const strictLine = strict ? '\nRESPOND WITH A SINGLE VALID JSON OBJECT. NO PROSE.\n' : ''

  return `You are the EXTRACT stage of a knowledge-extraction pipeline. You receive a session summary and return an \`entities\` array. Each entity has one of 4 kinds: pattern, decision, anti_pattern, fact.
${strictLine}
${depthHint}

Allowed kinds for this session: ${kindsFilter.join(', ')}.

Return ONLY a JSON object with this exact shape, no code fence, no prose:
{
  "entities": [
    {
      "kind": "pattern",
      "summary": "...",
      "condition": "...",
      "action": "...",
      "quality_signal": "universal" | "domain" | "project" | "edge_case"
    },
    {
      "kind": "decision",
      "summary": "...",
      "situation": "...",
      "options_considered": ["..."],
      "choice": "...",
      "reasoning": "...",
      "outcome": "..."
    },
    {
      "kind": "anti_pattern",
      "summary": "...",
      "condition": "...",
      "what_not_to_do": "...",
      "why_failed": "..."
    },
    {
      "kind": "fact",
      "summary": "...",
      "topic": "...",
      "statement": "...",
      "evidence": "..."
    }
  ]
}

If the session has nothing worth capturing, return { "entities": [] }.`
}

function buildEntitiesUserPrompt(session) {
  const project = session?.project ?? 'unknown'
  const entries = Array.isArray(session?.entries) ? session.entries : []
  const head = entries.slice(0, 10)
  const tail = entries.slice(-20)
  return [
    `project=${project}`,
    `entries=${entries.length}`,
    `head=${JSON.stringify(head)}`,
    `tail=${JSON.stringify(tail)}`,
  ].join('\n')
}

/**
 * Parse the 4-kind entities payload from an LLM response.
 * Returns { entities: [...] }. Malformed entries are silently dropped.
 * Non-JSON input returns { entities: [] }.
 */
function parseExtractEntities(raw) {
  let parsed
  try {
    parsed = parseJson(raw)
  } catch {
    return { entities: [] }
  }

  const rawEntities = Array.isArray(parsed?.entities) ? parsed.entities : []
  const entities = []

  for (const e of rawEntities) {
    if (!e || typeof e !== 'object') continue
    if (!VALID_ENTITY_KINDS.has(e.kind)) continue
    if (typeof e.summary !== 'string' || e.summary.length === 0) continue

    if (e.kind === 'pattern') {
      if (typeof e.condition !== 'string' || !e.condition) continue
      if (typeof e.action !== 'string' || !e.action) continue
      entities.push({
        kind: 'pattern',
        summary: e.summary,
        content: `${e.condition} → ${e.action}`,
        metadata: {
          condition: e.condition,
          action: e.action,
          quality_signal: e.quality_signal ?? null,
        },
      })
    } else if (e.kind === 'decision') {
      if (typeof e.situation !== 'string' || !e.situation) continue
      if (typeof e.choice !== 'string' || !e.choice) continue
      entities.push({
        kind: 'decision',
        summary: e.summary,
        content: `${e.situation}: ${e.choice}`,
        metadata: {
          situation: e.situation,
          options_considered: Array.isArray(e.options_considered) ? e.options_considered : [],
          choice: e.choice,
          reasoning: typeof e.reasoning === 'string' ? e.reasoning : '',
          outcome: e.outcome ?? null,
        },
      })
    } else if (e.kind === 'anti_pattern') {
      if (typeof e.condition !== 'string' || !e.condition) continue
      if (typeof e.what_not_to_do !== 'string' || !e.what_not_to_do) continue
      entities.push({
        kind: 'anti_pattern',
        summary: e.summary,
        content: `${e.condition}: NOT ${e.what_not_to_do}`,
        metadata: {
          condition: e.condition,
          what_not_to_do: e.what_not_to_do,
          why_failed: typeof e.why_failed === 'string' ? e.why_failed : '',
        },
      })
    } else if (e.kind === 'fact') {
      if (typeof e.topic !== 'string' || !e.topic) continue
      if (typeof e.statement !== 'string' || !e.statement) continue
      entities.push({
        kind: 'fact',
        summary: e.summary,
        content: `${e.topic}: ${e.statement}`,
        metadata: {
          topic: e.topic,
          statement: e.statement,
          evidence: typeof e.evidence === 'string' ? e.evidence : '',
        },
      })
    }
  }

  return { entities }
}

/**
 * Run the 4-kind extractor against a session. Dependency-injected LLM callable.
 *
 * opts: { llm, urgency, suspected_kinds, sleep }
 * Returns { entities, cost_usd } on success, or
 *         { entities: [], cost_usd, error: 'budget' | 'parse-failed' } on failure.
 */
async function runExtract(session, opts = {}) {
  const { llm, urgency = 'medium', suspected_kinds = ALL_KINDS } = opts
  if (typeof llm !== 'function') {
    throw new Error('runExtract requires a `llm` callable in opts')
  }

  const estimated_usd = estCost(urgency)
  const reservation = reserve({ stage: 'extract', estimated_usd })
  if (!reservation.ok) {
    return { entities: [], cost_usd: 0, error: 'budget' }
  }

  const session_id = session?.session_id ?? null
  const project = session?.project ?? null
  const userPrompt = buildEntitiesUserPrompt(session)

  let actualCost = 0
  let lastEntities = []
  let parseFailed = true

  for (let attempt = 0; attempt < 2; attempt++) {
    const strict = attempt > 0
    const system = buildEntitiesSystemPrompt({ urgency, suspected_kinds, strict })

    let res
    try {
      res = await llm({ system, prompt: userPrompt, stage: 'extract' })
    } catch (err) {
      // Reconcile whatever we spent so far and propagate — wrapper may fall back.
      reconcile({ stage: 'extract', estimated_usd, actual_usd: actualCost })
      throw err
    }

    actualCost += typeof res?.cost_usd === 'number' ? res.cost_usd : 0

    // Distinguish a clean parse (even if empty) from total parse failure. A
    // valid JSON object with an empty entities array is a legitimate answer
    // and must NOT trigger a retry — the retry is for malformed responses
    // only.
    let parsedOk = false
    try {
      const probe = parseJson(res?.text ?? '')
      if (probe && typeof probe === 'object') parsedOk = true
    } catch {
      parsedOk = false
    }

    const parsed = parseExtractEntities(res?.text ?? '')
    lastEntities = parsed.entities

    if (parsedOk) {
      parseFailed = false
      break
    }
    // Otherwise: keep parseFailed=true; if we still have another attempt,
    // loop with strict=true. If not, drop out of the loop.
  }

  // Anti-leak: the LLM cannot be trusted to set `project`, `scope`, `source`,
  // or `source_session_id` on entities. We authoritatively stamp them from the
  // sidecar session and scrub any project/scope fields the model tried to
  // inject into metadata. Persist requires source + source_session_id to be
  // non-null (spec §3.1 source enum) so we stamp 'extracted' here.
  const scope = `project:${project ?? 'unknown'}`
  const cleanEntities = lastEntities.map(e => {
    const meta = { ...(e.metadata || {}) }
    delete meta.project
    delete meta.scope
    return {
      ...e,
      scope,
      metadata: meta,
      source: 'extracted',
      source_session_id: session_id,
    }
  })

  reconcile({ stage: 'extract', estimated_usd, actual_usd: actualCost })

  if (parseFailed) {
    logPipelineError({
      stage: 'extract',
      severity: 'error',
      session_id,
      project,
      error_message: 'parseExtractEntities failed both attempts',
      retry_count: 1,
    })
    return { entities: [], cost_usd: actualCost, error: 'parse-failed' }
  }

  return { entities: cleanEntities, cost_usd: actualCost }
}

/**
 * Wraps runExtract with a Sonnet fallback path. If the primary LLM throws
 * (not parse-failed — an actual exception), logs severity=degraded and tries
 * opts.sonnetFallback({ system, user }). On second failure, logs
 * severity=error, resolution=archived-as-error and rethrows.
 */
async function runExtractWithFallback(session, opts = {}) {
  const session_id = session?.session_id ?? null
  const project = session?.project ?? null
  try {
    return await runExtract(session, opts)
  } catch (primaryErr) {
    logPipelineError({
      stage: 'extract',
      severity: 'degraded',
      session_id,
      project,
      error_message: primaryErr?.message ?? String(primaryErr),
      error_stack: primaryErr?.stack ?? null,
      fallback_attempted: 1,
    })

    const sonnetFallback = opts?.sonnetFallback
    if (typeof sonnetFallback !== 'function') {
      logPipelineError({
        stage: 'extract',
        severity: 'error',
        session_id,
        project,
        error_message: 'no sonnetFallback provided after primary failure',
        resolution: 'archived-as-error',
      })
      throw primaryErr
    }

    const system = buildEntitiesSystemPrompt({
      urgency: opts.urgency ?? 'medium',
      suspected_kinds: opts.suspected_kinds ?? ALL_KINDS,
      strict: true,
    })
    const user = buildEntitiesUserPrompt(session)

    let fallbackRes
    try {
      fallbackRes = await sonnetFallback({ system, user })
    } catch (fallbackErr) {
      logPipelineError({
        stage: 'extract',
        severity: 'error',
        session_id,
        project,
        error_message: fallbackErr?.message ?? String(fallbackErr),
        error_stack: fallbackErr?.stack ?? null,
        fallback_attempted: 1,
        fallback_succeeded: 0,
        resolution: 'archived-as-error',
      })
      throw fallbackErr
    }

    const parsed = parseExtractEntities(fallbackRes?.text ?? '')
    const scope = `project:${project ?? 'unknown'}`
    // Same anti-leak + authoritative stamping as the primary path (see
    // runExtract above). persist.js requires source + source_session_id to be
    // non-null (spec §3.1).
    const cleanEntities = parsed.entities.map(e => {
      const meta = { ...(e.metadata || {}) }
      delete meta.project
      delete meta.scope
      return {
        ...e,
        scope,
        metadata: meta,
        source: 'extracted',
        source_session_id: session_id,
      }
    })

    logPipelineError({
      stage: 'extract',
      severity: 'degraded',
      session_id,
      project,
      error_message: 'primary failed; sonnet fallback recovered',
      fallback_attempted: 1,
      fallback_succeeded: 1,
      resolution: 'recovered',
    })

    return {
      entities: cleanEntities,
      cost_usd: typeof fallbackRes?.cost_usd === 'number' ? fallbackRes.cost_usd : 0,
    }
  }
}

module.exports = {
  // --- legacy (keep) ---
  extract, makeId, buildSystemPrompt, buildUserPrompt, parseJson,
  parseExtractOutput, parsePatterns, // parsePatterns kept for back-compat
  QUALITY_MAP, QUALITY_PRIORS, TOOL_DEFINITIONS, _resetJsonModeCache,
  // --- new (Task 9) ---
  runExtract, parseExtractEntities, runExtractWithFallback,
  buildEntitiesSystemPrompt, buildEntitiesUserPrompt,
}
