'use strict'

/**
 * TRIAGE pipeline stage.
 *
 * One LLM call per session via Gemini 2.5 Flash Lite (Vercel AI Gateway).
 * Decides whether to spend deeper budget on the extract stage, and gives
 * extract a shape hint (urgency + suspected_kinds) without pre-committing
 * cost on low-value sessions.
 *
 * Contract:
 *   runTriage(session, { llm, retries?, sleep? }) -> {
 *     productive, urgency, suspected_kinds,
 *     degraded?, reason?
 *   }
 *
 * - Reserves budget BEFORE each LLM call (race-free via llm-budget.js).
 * - On budget-exhausted: safe-default with degraded=true, reason='budget'.
 *   Does NOT retry (cap is daily; retrying won't help this session).
 * - On LLM error: refund via reconcile(actual_usd=0), log pipeline_errors,
 *   back off, retry up to `retries` times.
 * - On total failure after retries: safe-default with productive=true so
 *   extract still runs. Failing closed (productive=false) would silently
 *   drop learning signal, which is worse than paying for one extract.
 */

const { reserve, reconcile } = require('../lib/llm-budget.js')
const { logPipelineError } = require('../db.js')

const VALID_URGENCY = new Set(['low', 'medium', 'high'])
const VALID_KINDS = new Set(['pattern', 'decision', 'anti_pattern', 'fact'])
const TRIAGE_EST_USD = 0.0005

const SYSTEM_PROMPT = `You are the TRIAGE stage of a knowledge-extraction pipeline.
You receive a FULL Claude Code session (all tool calls in chronological order) and decide:
1. Whether it is worth running a deeper EXTRACT stage on it.
2. Which areas of the session are most interesting for knowledge extraction.

Return ONLY a single JSON object with this exact shape, no prose, no code fence:
{
  "productive": boolean,
  "urgency": "low" | "medium" | "high",
  "suspected_kinds": ["pattern" | "decision" | "anti_pattern" | "fact", ...],
  "suggested_queries": ["query1", "query2", ...]
}

Guidance:
- "productive": true if the session likely contains reusable knowledge (new patterns, decisions, anti-patterns, or stable facts). false for trivial/routine sessions (exploration only, aborted attempts with no lesson, duplicated work).
- "urgency": how much prompt depth the extract stage should invest.
  - "low": routine session, cheap extract
  - "medium": normal productive session
  - "high": rich session with many decisions / anti-patterns worth capturing carefully. Sessions with 30+ entries that involve architecture changes, bug fixes, or multi-step implementations are typically "high".
- "suspected_kinds": which entity kinds the session plausibly contains. Only include kinds you have positive evidence for. Empty array is NOT valid — if productive is true, at least one kind must be listed.
- "suggested_queries": 5-10 natural language search queries that target the most interesting/valuable parts of this session. These will be used for semantic search to provide the EXTRACT stage with focused context. Think: "what would I search for to find the key decisions, patterns, and anti-patterns in this session?"
  Examples: "database connection singleton pattern", "error handling for failed API calls", "schema migration decision", "why this approach was chosen over alternatives"`

function summarize(session) {
  const project = session?.project ?? 'unknown'
  const entries = Array.isArray(session?.entries) ? session.entries : []

  // Full session dump for Gemini (1M context). Each entry gets generous
  // space — Gemini Flash Lite is cheap ($0.10/M input) so we optimize for
  // triage quality over token savings.
  const fullEntries = entries.map((e, i) => {
    const tool = e.tool || e.event || '?'
    let rawInput = e.tool_input || e.task || ''
    if (typeof rawInput !== 'string') rawInput = JSON.stringify(rawInput)
    const input = rawInput.slice(0, 500).replace(/\n/g, ' ')
    const intent = e.user_intent ? ` | intent: ${e.user_intent}` : ''
    const reasoning = e.llm_reasoning ? ` | reasoning: ${(e.llm_reasoning + '').slice(0, 200)}` : ''
    const fail = e.outcome === 'failure' ? ' | FAILED' : ''
    return `${i + 1}. [${tool}] ${input}${intent}${reasoning}${fail}`
  }).join('\n')

  return [
    `project=${project}`,
    `entries=${entries.length}`,
    '',
    'FULL SESSION (chronological):',
    fullEntries || 'No entries',
  ].join('\n')
}

function safeDefault(reason) {
  return {
    productive: true,
    urgency: 'low',
    suspected_kinds: ['pattern', 'fact'],
    degraded: true,
    reason,
  }
}

function parseTriageResponse(text) {
  if (typeof text !== 'string') throw new Error('triage llm returned non-string')
  let trimmed = text.trim()
  // Strip optional code fences if the model wrapped its output.
  if (trimmed.startsWith('```')) {
    trimmed = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('triage llm returned no JSON object')
  }
  const obj = JSON.parse(trimmed.slice(start, end + 1))

  const urgency = VALID_URGENCY.has(obj.urgency) ? obj.urgency : 'low'
  const rawKinds = Array.isArray(obj.suspected_kinds) ? obj.suspected_kinds : []
  const suspected_kinds = rawKinds.filter(k => VALID_KINDS.has(k))
  const productive = Boolean(obj.productive)

  // suggested_queries: validated array of non-empty strings, max 10.
  const rawQueries = Array.isArray(obj.suggested_queries) ? obj.suggested_queries : []
  const suggested_queries = rawQueries
    .filter(q => typeof q === 'string' && q.trim().length > 3)
    .map(q => q.trim())
    .slice(0, 10)

  return { productive, urgency, suspected_kinds, suggested_queries }
}

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms))

async function runTriage(session, deps = {}) {
  const { llm, retries = 2, sleep = defaultSleep } = deps
  if (typeof llm !== 'function') {
    throw new Error('runTriage requires a `llm` callable in deps')
  }

  const session_id = session?.session_id ?? null
  const userPrompt = summarize(session)

  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    const reservation = reserve({ stage: 'triage', estimated_usd: TRIAGE_EST_USD })
    if (!reservation.ok) {
      // Budget hard-gate: do NOT retry, do NOT refund (no reservation was held).
      return safeDefault('budget')
    }

    let out
    try {
      out = await llm({
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        stage: 'triage',
      })
    } catch (err) {
      lastError = err
      // Refund the reservation — no actual spend occurred.
      reconcile({ stage: 'triage', estimated_usd: TRIAGE_EST_USD, actual_usd: 0 })
      logPipelineError({
        stage: 'triage',
        severity: 'error',
        session_id,
        error_message: err?.message ?? String(err),
        error_stack: err?.stack ?? null,
        retry_count: attempt,
      })
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1))
        continue
      }
      break
    }

    try {
      const parsed = parseTriageResponse(out?.text ?? '')
      const actual_usd = typeof out?.cost_usd === 'number' ? out.cost_usd : TRIAGE_EST_USD
      reconcile({ stage: 'triage', estimated_usd: TRIAGE_EST_USD, actual_usd })
      return parsed
    } catch (err) {
      lastError = err
      // Parse failure: the LLM call DID happen; treat estimated as spent.
      reconcile({
        stage: 'triage',
        estimated_usd: TRIAGE_EST_USD,
        actual_usd: typeof out?.cost_usd === 'number' ? out.cost_usd : TRIAGE_EST_USD,
      })
      logPipelineError({
        stage: 'triage',
        severity: 'error',
        session_id,
        error_message: `parse: ${err?.message ?? String(err)}`,
        retry_count: attempt,
      })
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1))
        continue
      }
      break
    }
  }

  logPipelineError({
    stage: 'triage',
    severity: 'degraded',
    session_id,
    error_message: lastError?.message ?? 'triage exhausted retries',
    retry_count: retries,
    resolution: 'safe-default',
  })
  return safeDefault('llm-failed')
}

module.exports = { runTriage, summarize, parseTriageResponse }
