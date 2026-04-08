'use strict'

const { callLLMWithUsage } = require('../lib/llm.js')
const { routeTask, AGENT_TYPES } = require('../../mcp/lib/routing.js')

const MODEL = 'google/gemini-2.5-flash'

const VALID_DOMAINS = new Set(AGENT_TYPES)

function buildPrompt(entries) {
  const lines = entries.map((e, i) =>
    `[${i}] Agent: ${e.agent || 'unknown'} | Task: ${e.task || 'unknown'} | Outcome: ${e.outcome || 'unknown'} | Tools: ${e.tool_calls || 0}`
  )
  return `You are evaluating a batch of AI agent actions for effectiveness and domain classification.

For each entry, determine:
1. Was it effective? (did the action achieve the task?)
2. Which domain does it belong to? Must be one of: coder, tester, reviewer, researcher, architect, backend-dev, frontend-dev, devops

Entries:
${lines.join('\n')}

Respond with ONLY valid JSON (no markdown):
{"judgments": [{"index": 0, "effective": true/false, "domain": "coder|tester|...", "reason": "brief"}]}`
}

function makeFallback(entry, index, _routeTask) {
  const rt = _routeTask || routeTask
  const routed = rt(entry.task || '')
  return {
    index,
    effective: entry.outcome === 'success',
    domain: routed.agent,
    reason: 'fallback: llm unavailable',
    fallback: true,
  }
}

function normalizeDomain(domain, task, _routeTask) {
  if (VALID_DOMAINS.has(domain)) return domain
  const rt = _routeTask || routeTask
  return rt(task || '').agent
}

/**
 * Batch-judge an array of trajectory entries in a single LLM call.
 * @param {Array} entries - Each: { agent, task, outcome, tool_calls }
 * @param {Object} [deps] - Optional dependency injection for testing
 * @returns {{ judgments: Array, usage: Object }}
 */
async function batchJudge(entries, deps = {}) {
  const _callLLM = deps.callLLMWithUsage || callLLMWithUsage
  const _routeTask = deps.routeTask || routeTask

  const maxTokens = 50 + entries.length * 40
  const prompt = buildPrompt(entries)

  try {
    const result = await _callLLM(prompt, maxTokens, MODEL)
    const parsed = JSON.parse(result.content)
    const llmJudgments = parsed.judgments || []

    // Index LLM results by their index field
    const byIndex = new Map()
    for (const j of llmJudgments) {
      byIndex.set(j.index, j)
    }

    // Build final judgments, filling gaps with fallback
    const judgments = entries.map((entry, i) => {
      const j = byIndex.get(i)
      if (!j) return makeFallback(entry, i, _routeTask)
      return {
        index: i,
        effective: Boolean(j.effective),
        domain: normalizeDomain(j.domain, entry.task, _routeTask),
        reason: j.reason || '',
      }
    })

    return {
      judgments,
      usage: {
        model: result.model,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        estimated_cost_usd: result.estimated_cost_usd,
      },
    }
  } catch {
    // Full fallback
    const judgments = entries.map((entry, i) => makeFallback(entry, i, _routeTask))
    return {
      judgments,
      usage: { model: MODEL, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 },
    }
  }
}

module.exports = { batchJudge, VALID_DOMAINS, MODEL }
