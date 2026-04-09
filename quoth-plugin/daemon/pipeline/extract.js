'use strict'

const crypto = require('crypto')
const childProcess = require('child_process')

/**
 * EXTRACT: Single-stage pipeline replacing JUDGE + DISTILL + CONSOLIDATE.
 *
 * Primary model: claude -p Sonnet --effort low ($0, Max plan)
 * Fallback model: Gemini 2.5 Flash via AI Gateway (~$0.003)
 *
 * Returns 0-N patterns with rich context, intention, and quality_signal.
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

function buildPrompt(summaryEntry, recentTools) {
  const toolSummary = (summaryEntry.task || 'unknown').slice(0, 200)
  const successRate = Math.round((summaryEntry.success_rate || 0) * 100)
  const outcome = summaryEntry.outcome || 'unknown'
  const intents = (summaryEntry.user_intents || [])
    .filter(i => i && i.length > 5)
    .slice(0, 5)
    .join(' -> ') || 'Not captured'

  const actions = recentTools.map((e, i) => {
    const parts = [`${i + 1}. [${e.tool}] ${(e.task || '').slice(0, 100)}`]
    if (e.llm_reasoning) parts.push(`   Why: ${e.llm_reasoning.slice(0, 120)}`)
    if (e.outcome === 'failure') parts.push(`   FAILED`)
    return parts.join('\n')
  }).join('\n')

  return `You are analyzing a coding session to extract reusable patterns.

SESSION:
- Project: ${summaryEntry.project || 'unknown'}
- Outcome: ${outcome} (success rate: ${successRate}%)
- User intent: ${intents}
- Tools used: ${toolSummary}

RECENT ACTIONS (chronological):
${actions || 'No actions captured'}

TASK:
1. Was this session productive or routine? Routine sessions (just reading files,
   standard edits) produce NO patterns. Only extract from sessions where a genuine
   technique or workflow emerged.
   (Note: deduplication against existing patterns is handled at write time via
   embedding similarity — do NOT spend prompt tokens listing existing patterns here)

2. For productive sessions, extract EVERY relevant pattern. No minimum, no maximum.
   Each pattern must be:
   - A reusable technique/workflow, NOT a specific file path or command
   - Rich enough to match similar future situations via embedding search
   - Include context: when/why to use this approach
   - Include intention: what problem it solves

3. For each pattern, assess reusability using ONE of these labels:
   - "universal": technique applicable across any project
   - "domain": applicable to similar project types
   - "project": applicable within this specific domain
   - "edge_case": narrow, might be useful occasionally

EXAMPLES of GOOD patterns:
- "When refactoring across multiple files in a monorepo, read all target files in
  parallel before making batch edits to ensure consistency and catch dependencies"
- "For debugging intermittent test failures, isolate the failing test first with
  .only, then add verbose logging to the setup/teardown lifecycle hooks"

EXAMPLES of BAD patterns (do NOT extract these):
- "Read file then edit it" (obvious)
- "Run npm test after changes" (standard practice)
- "Use git commit to save changes" (trivial)

Respond with JSON:
{
  "session_type": "productive" | "routine",
  "patterns": [
    {
      "pattern": "rich description with context and intention (100-200 chars)",
      "tags": ["domain1", "domain2"],
      "intention": "what the user was trying to accomplish",
      "quality_signal": "universal" | "domain" | "project" | "edge_case"
    }
  ]
}

If routine, return {"session_type": "routine", "patterns": []}`
}

function parseJson(raw) {
  let content = (raw || '').replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim()
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON object in LLM response')
  return JSON.parse(content.slice(start, end + 1))
}

/**
 * Extract patterns from a session via single LLM call.
 *
 * @param {Object} summaryEntry - session_summary JSONL entry
 * @param {Object[]} toolEntries - tool_use entries from the same session
 * @param {Object} db - database instance (for error logging)
 * @returns {Promise<Object[]>} Array of pattern objects
 */
async function extract(summaryEntry, toolEntries, db) {
  const recentTools = toolEntries.slice(-30)
  const prompt = buildPrompt(summaryEntry, recentTools)

  let rawOutput
  let model = 'claude-sonnet-4-6'

  // Primary: claude -p Sonnet --effort low ($0)
  try {
    rawOutput = childProcess.execSync(
      'claude -p --model claude-sonnet-4-6 --effort low --output-format text --allowedTools ""',
      {
        input: prompt,
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 512 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )
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
          model: 'claude-sonnet-4-6',
        }),
        model_attempted: 'claude-sonnet-4-6',
        fallback_attempted: 1,
      })
    } catch {}

    // Fallback: Gemini 2.5 Flash via AI Gateway
    try {
      const { callLLMWithUsage } = require('../lib/llm.js')
      const result = await callLLMWithUsage(prompt, 400, 'google/gemini-2.5-flash')
      rawOutput = result.content
      model = 'google/gemini-2.5-flash'

      // Record fallback cost
      try {
        db.recordPipelineCost({
          stage: 'extract',
          model: result.model || model,
          input_tokens: result.input_tokens || 0,
          output_tokens: result.output_tokens || 0,
          estimated_cost_usd: result.estimated_cost_usd || 0,
          batch_size: 1,
          session_id: summaryEntry.session || null,
          project: summaryEntry.project || null,
        })
      } catch {}

      // Mark fallback success
      try {
        db.insertPipelineError({
          stage: 'extract',
          error_message: `Primary failed, fallback succeeded: ${primaryErr.message}`,
          context: JSON.stringify({ session_id: summaryEntry.session, model: 'google/gemini-2.5-flash' }),
          model_attempted: 'claude-sonnet-4-6',
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
          model_attempted: 'google/gemini-2.5-flash',
          fallback_attempted: 1,
          fallback_succeeded: 0,
        })
      } catch {}
      return []
    }
  }

  // Parse JSON response
  let parsed
  try {
    parsed = parseJson(rawOutput)
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

  // Short-circuit routine sessions
  if (parsed.session_type === 'routine' || !parsed.patterns || !Array.isArray(parsed.patterns)) {
    return []
  }

  // Filter valid patterns (20-300 chars, has text)
  const validPatterns = parsed.patterns.filter(p =>
    p.pattern && p.pattern.length >= 20 && p.pattern.length <= 300
  )
  if (validPatterns.length === 0) return []

  // Batch embed pattern texts (pattern text ONLY, not concatenated with intention)
  let embeddings = validPatterns.map(() => null)
  try {
    const { generateEmbeddingBatch } = require('../lib/embed.js')
    embeddings = await generateEmbeddingBatch(validPatterns.map(p => p.pattern))
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
    id: makeId(p.pattern),
    pattern: p.pattern,
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 5) : [],
    intention: p.intention || '',
    quality_signal: QUALITY_MAP[p.quality_signal] ? p.quality_signal : 'project',
    embedding: embeddings[i],
    source: 'distilled',
  }))
}

module.exports = { extract, makeId, buildPrompt, parseJson, QUALITY_MAP, QUALITY_PRIORS }
