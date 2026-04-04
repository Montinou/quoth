'use strict'

const { callLLM } = require('../lib/llm.js')

const PROMPT = `You are evaluating whether an AI agent action was effective.

Agent: {{agent}}
Task: {{task}}
Outcome: {{outcome}}
Attempts: {{attempts}}
Tools used: {{tool_calls}}

Was this agent action effective and did it achieve the task?

Respond with ONLY valid JSON (no markdown):
{"effective": true/false, "reason": "brief explanation", "category": "selector|wait|auth|data|env|general"}`

async function judge(entry) {
  const prompt = PROMPT
    .replace('{{agent}}', entry.agent || 'unknown')
    .replace('{{task}}', entry.task || 'unknown')
    .replace('{{outcome}}', entry.outcome || 'unknown')
    .replace('{{attempts}}', String(entry.attempts || 1))
    .replace('{{tool_calls}}', String(entry.tool_calls || 0))

  try {
    const raw = await callLLM(prompt, 150)
    const start = raw.indexOf('{')
    if (start === -1) throw new Error('No JSON in response')
    const result = JSON.parse(raw.slice(start))
    return {
      effective: Boolean(result.effective),
      reason: result.reason || '',
      category: result.category || 'general'
    }
  } catch {
    return {
      effective: entry.outcome === 'success',
      reason: 'fallback: llm unavailable',
      category: 'general',
      fallback: true
    }
  }
}

module.exports = { judge }
