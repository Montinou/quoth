'use strict'

const crypto = require('crypto')
const { callLLM } = require('../lib/llm.js')

const PROMPT = `Extract a reusable pattern from this AI agent action.

Agent: {{agent}}
Task: {{task}}
User intent: {{user_intent}}
Conversation context: {{conversation_context}}
Pattern used: {{pattern_used}}

RULES:
- The pattern name MUST describe the TECHNIQUE or STRATEGY, not the specific file/command
- NEVER include file paths, directory names, or raw commands in the pattern name
- Focus on WHAT was achieved and WHY it worked, not HOW (specific tool calls)
- Pattern should be applicable across projects, not tied to one codebase

BAD examples (too specific, raw tool calls):
- "claude-code: Bash find /home/user/projects/foo"
- "claude-code: Write /home/user/src/index.js"
- "claude-code: Edit /home/user/config.ts"

GOOD examples (reusable techniques):
- "Recursive file search before editing unfamiliar codebase"
- "Source env vars with set -a before running integration tests"
- "Read existing file before writing to preserve structure"
- "Run git status before committing to verify staged changes"
- "Use grep to find all references before renaming a symbol"

Respond with ONLY valid JSON (no markdown):
{"pattern": "technique/strategy description (max 80 chars)", "tags": ["domain-tag","technique-tag"], "applicability": "broad|narrow"}`

function makeId(content) {
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 12)
}

async function distill(entry) {
  const contextParts = []
  if (entry.conversation_context && entry.conversation_context.length > 0) {
    contextParts.push('Recent user messages: ' + entry.conversation_context.join(' → '))
  }
  if (entry.llm_reasoning) {
    contextParts.push('LLM reasoning: ' + entry.llm_reasoning)
  }

  const prompt = PROMPT
    .replace('{{agent}}', entry.agent || 'unknown')
    .replace('{{task}}', entry.task || 'unknown')
    .replace('{{user_intent}}', entry.user_intent || 'unknown')
    .replace('{{conversation_context}}', contextParts.join(' | ') || 'none')
    .replace('{{pattern_used}}', entry.pattern_used || 'none')

  try {
    const raw = await callLLM(prompt, 200)
    const start = raw.indexOf('{')
    if (start === -1) throw new Error('No JSON')
    const result = JSON.parse(raw.slice(start))
    const id = makeId(result.pattern)
    let embedding = null
    try {
      const { generateEmbedding } = require('../lib/embed.js')
      embedding = await generateEmbedding(result.pattern)
    } catch {}
    return { id, pattern: result.pattern, tags: result.tags || [], applicability: result.applicability || 'narrow', embedding, source: 'distilled' }
  } catch {
    // Build a meaningful fallback instead of raw tool call
    const task = (entry.task || '').slice(0, 200)
    const agent = entry.agent || 'agent'
    // Strip file paths and commands to extract the intent
    const cleaned = task
      .replace(/\/home\/[^\s]+/g, '')
      .replace(/\/tmp\/[^\s]+/g, '')
      .replace(/~\/[^\s]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    const fallbackContent = cleaned.length > 10
      ? `${agent}: ${cleaned}`.slice(0, 80)
      : `${agent}: task execution`
    return {
      id: makeId(fallbackContent),
      pattern: fallbackContent,
      tags: [],
      applicability: 'narrow',
      fallback: true,
      embedding: null,
      source: 'distilled'
    }
  }
}

module.exports = { distill }
