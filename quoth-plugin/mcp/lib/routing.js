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

// Order matters: first match wins. Specific intent patterns before broad domain ones.
// Use word boundaries (\b) on short/ambiguous keywords to avoid false positives.
const TASK_PATTERNS = [
  // Fix/debug — highest priority (explicit intent)
  [/\b(?:fix|bug|debug|broken|crash|hotfix|patch)\b/i, 'coder'],
  [/(?:arreglá|corregí|roto|crashea)/i, 'coder'],
  // Refactor
  [/\b(?:refactor|rename|extract|reorganize|cleanup|clean up|simplify)\b/i, 'coder'],
  [/(?:refactoreá|renombrá|reorganizá|simplificá|limpiá)/i, 'coder'],
  // Test
  [/\b(?:test|spec|coverage|unit.?test|integration.?test|assert|mock|fixture|jest|vitest)\b/i, 'tester'],
  [/(?:testea|probá|pruebas|test unitario)/i, 'tester'],
  // Review/audit
  [/\b(?:review|audit|security.?check|lint|inspect|validate)\b/i, 'reviewer'],
  [/(?:revisá|auditá|chequeá|validá|seguridad)/i, 'reviewer'],
  // Research/explore
  [/\b(?:research|explore|investigate|look.?up|summarize|documentation)\b/i, 'researcher'],
  [/(?:investigá|buscá|explorá|documentación|analizá|resumí)/i, 'researcher'],
  // Design/architecture
  [/\b(?:design|architect|blueprint|diagram|schema|model)\b/i, 'architect'],
  [/(?:diseñá|arquitectura|planificá|diagrama|esquema)/i, 'architect'],
  // Config/setup
  [/\b(?:config(?:ure)?|setup|install|env(?:ironment)?|settings)\b/i, 'devops'],
  [/(?:configurá|instalá|entorno|configuración)/i, 'devops'],
  // Deploy/infra
  [/\b(?:deploy|docker|ci.?cd|pipeline|infrastructure|vercel|nginx|systemd|cron)\b/i, 'devops'],
  [/(?:desplegá|infraestructura|servidor)/i, 'devops'],
  // Implement/create — broad coder intent
  [/\b(?:implement|create|build|add|develop|scaffold|generate|write.?code|programá)\b/i, 'coder'],
  [/(?:implementa|creá|construí|agregá|desarrollá|generá)/i, 'coder'],
  // Domain: backend
  [/\b(?:api|endpoint|backend|database|migration|postgres|sqlite|prisma|drizzle|query)\b/i, 'backend-dev'],
  // Domain: frontend
  [/\b(?:ui|frontend|component|react|css|style|layout|responsive|tailwind|shadcn)\b/i, 'frontend-dev'],
]

function routeTask(task) {
  const taskLower = task.toLowerCase()
  for (const [regex, agent] of TASK_PATTERNS) {
    if (regex.test(taskLower)) {
      return { agent, confidence: 0.8, reason: `Matched pattern: ${regex.source}` }
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
