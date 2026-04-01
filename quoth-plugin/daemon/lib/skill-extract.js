'use strict'

const PROMPT = `You are extracting a reusable Playwright test skill from a passing test.

A "skill" is a parameterized, composable test recipe that other tests can reuse.

Test file: {{testFile}}
Feature: {{feature}}
Test code:
{{testCode}}

Extract a skill by:
1. Identifying the reusable pattern (login flow, table verification, form submission, etc.)
2. Parameterizing selectors, URLs, and expected values with {{variable}} placeholders
3. Listing which Page Objects are used
4. Listing which assertion types are used

Respond with ONLY valid JSON:
{
  "name": "kebab-case-skill-name",
  "description": "What this skill does in one sentence",
  "template": "parameterized Playwright code with {{variables}}",
  "params": ["param1", "param2"],
  "selectors": ["[data-testid=x]", ".class"],
  "pageObjects": ["PageName"],
  "assertions": ["toHaveText", "toHaveURL"]
}`

async function extractSkill({ testFile, testCode, feature }) {
  const fs = require('fs')
  let code = testCode || ''
  if (!code && testFile) {
    try { code = fs.readFileSync(testFile, 'utf8') } catch {}
  }
  if (!code) return null

  const prompt = PROMPT
    .replace('{{testFile}}', testFile || 'unknown')
    .replace('{{feature}}', feature || 'unknown')
    .replace('{{testCode}}', code.slice(0, 4000))

  try {
    const proc = require('child_process').spawnSync(
      'claude', ['-p', '--model', 'claude-sonnet-4-6', '--output-format', 'text'],
      { input: prompt, encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'ignore'] }
    )
    if (proc.status !== 0) return null
    const raw = (proc.stdout || '').trim()
    const start = raw.indexOf('{')
    if (start === -1) return null
    return JSON.parse(raw.slice(start))
  } catch {
    return null
  }
}

module.exports = { extractSkill }
