'use strict'

// Agent routing — ported from router.js

const AGENT_CAPABILITIES = {
  coder: ['code-generation', 'refactoring', 'debugging', 'implementation'],
  tester: ['unit-testing', 'integration-testing', 'coverage', 'test-generation'],
  reviewer: ['code-review', 'security-audit', 'quality-check', 'best-practices'],
  researcher: ['web-search', 'documentation', 'analysis', 'summarization'],
  architect: ['system-design', 'architecture', 'patterns', 'scalability'],
  'backend-dev': ['api', 'database', 'server', 'authentication'],
  'frontend-dev': ['ui', 'react', 'css', 'components'],
  devops: ['ci-cd', 'docker', 'deployment', 'infrastructure'],
}

const TASK_PATTERNS = {
  'implement|create|build|add|write code': 'coder',
  'test|spec|coverage|unit test|integration': 'tester',
  'review|audit|check|validate|security': 'reviewer',
  'research|find|search|documentation|explore': 'researcher',
  'design|architect|structure|plan': 'architect',
  'api|endpoint|server|backend|database': 'backend-dev',
  'ui|frontend|component|react|css|style': 'frontend-dev',
  'deploy|docker|ci|cd|pipeline|infrastructure': 'devops',
}

function routeTask(task) {
  const taskLower = task.toLowerCase()
  for (const [pattern, agent] of Object.entries(TASK_PATTERNS)) {
    const regex = new RegExp(pattern, 'i')
    if (regex.test(taskLower)) {
      return { agent, confidence: 0.8, reason: `Matched pattern: ${pattern}` }
    }
  }
  return { agent: 'coder', confidence: 0.5, reason: 'Default routing - no specific pattern matched' }
}

function getAlternatives(primaryAgent) {
  const alts = Object.keys(AGENT_CAPABILITIES).filter(a => a !== primaryAgent)
  return alts.slice(0, 2).map((agent, i) => ({
    agent,
    confidence: 0.6 - i * 0.1,
    reason: `Alternative agent for ${agent} capabilities`
  }))
}

module.exports = { routeTask, getAlternatives, AGENT_CAPABILITIES, TASK_PATTERNS }
