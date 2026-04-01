'use strict'

const PROMPT = `You are analyzing which patterns contributed to the outcome of an AI agent task.

Agent: {{agent}}
Feature: {{feature}}
Outcome: {{outcome}}
Error (if failed): {{error}}

Patterns that were active during this task:
{{patterns}}

For each pattern, determine:
- "success" — this pattern directly helped achieve the outcome
- "failure" — this pattern was applied but contributed to the failure
- "irrelevant" — this pattern wasn't applicable to this task

Also extract tips:
- strategy_tip: what worked well (only on success)
- recovery_tip: what fixed a failure (only when outcome went from fail to success)
- optimization_tip: what could be faster/better

Respond with ONLY valid JSON array:
[{"patternId":"id","attribution":"success|failure|irrelevant","reason":"why","tip":{"type":"strategy|recovery|optimization","text":"tip"} or null}]`

async function attributeOutcome({ patterns, outcome, feature, agent, errorSummary }) {
  if (!patterns || patterns.length === 0) return []

  const patternList = patterns.map(p => `- ${p.id}: ${p.name || p.action || p.pattern || 'unknown'}`).join('\n')
  const prompt = PROMPT
    .replace('{{agent}}', agent || 'unknown')
    .replace('{{feature}}', feature || 'unknown')
    .replace('{{outcome}}', outcome || 'unknown')
    .replace('{{error}}', errorSummary || 'none')
    .replace('{{patterns}}', patternList)

  try {
    const proc = require('child_process').spawnSync(
      'claude', ['-p', '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text'],
      { input: prompt, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'ignore'] }
    )
    if (proc.status !== 0) return []
    const raw = (proc.stdout || '').trim()
    const start = raw.indexOf('[')
    if (start === -1) return []
    return JSON.parse(raw.slice(start))
  } catch {
    return []
  }
}

module.exports = { attributeOutcome }
