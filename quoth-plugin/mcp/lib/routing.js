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
  [/\b(?:fix|bug|debug|broken|crash|hotfix|patch|error|not.?working|fails?|issue|troubleshoot|stacktrace|stack.?trace|exception|segfault|undefined|null.?pointer)\b/i, 'coder'],
  [/(?:arreglá|corregí|roto|crashea|no.?funciona|falla|problema|error|rompió)/i, 'coder'],
  // Refactor
  [/\b(?:refactor|rename|extract|reorganize|cleanup|clean.?up|simplify|deduplicate|dedup|dry|modularize|split.?file|move.?to|optimize.?code)\b/i, 'coder'],
  [/(?:refactoreá|renombrá|reorganizá|simplificá|limpiá|optimizá|modularizá)/i, 'coder'],
  // Test
  [/\b(?:test|spec|coverage|unit.?test|integration.?test|assert|mock|fixture|jest|vitest|e2e|playwright|cypress|snapshot)\b/i, 'tester'],
  [/(?:testea|probá|pruebas|test unitario)/i, 'tester'],
  // Review/audit
  [/\b(?:review|audit|security.?check|lint|inspect|validate|code.?quality|sonar|eslint)\b/i, 'reviewer'],
  [/(?:revisá|auditá|chequeá|validá|seguridad)/i, 'reviewer'],
  // Git/version control
  [/\b(?:commit|push|pull|merge|rebase|cherry.?pick|stash|tag|release|branch|checkout|diff|log|blame|bisect|amend|squash|reset|revert)\b/i, 'coder'],
  [/(?:comitear|pushear|mergear|branchear|taggear|releasear)/i, 'coder'],
  // Documentation/writing
  [/\b(?:readme|changelog|write.?doc|update.?doc|jsdoc|typedoc|comment|annotate|document(?:ation)?)\b/i, 'researcher'],
  [/(?:documentá|escribí.?doc|anotá|comentá)/i, 'researcher'],
  // Research/explore
  [/\b(?:research|explore|investigate|look.?up|summarize|find.?out|compare|benchmark|evaluate|analyze|assess)\b/i, 'researcher'],
  [/(?:investigá|buscá|explorá|analizá|resumí|compará|evaluá)/i, 'researcher'],
  // Design/architecture
  [/\b(?:design|architect|blueprint|diagram|schema|model|system.?design|data.?model|erd|uml|sequence.?diagram)\b/i, 'architect'],
  [/(?:diseñá|arquitectura|planificá|diagrama|esquema|modelá)/i, 'architect'],
  // Config/setup
  [/\b(?:config(?:ure)?|setup|install|env(?:ironment)?|settings|\.env|yaml|toml|ini|dotfile|eslintrc|tsconfig|package\.json)\b/i, 'devops'],
  [/(?:configurá|instalá|entorno|configuración)/i, 'devops'],
  // Deploy/infra
  [/\b(?:deploy|docker|ci.?cd|pipeline|infrastructure|vercel|nginx|systemd|cron|kubernetes|k8s|terraform|ansible|aws|gcp|azure|cloudflare|ssl|cert|dns|domain)\b/i, 'devops'],
  [/(?:desplegá|desplegar|infraestructura|servidor|despliegue)/i, 'devops'],
  // Implement/create — broad coder intent
  [/\b(?:implement|create|build|add|develop|scaffold|generate|write.?code|programá|code|make|new.?file|new.?function|new.?class|new.?module)\b/i, 'coder'],
  [/(?:implementá|creá|construí|agregá|desarrollá|generá|hacé|programá)/i, 'coder'],
  // Domain: backend / database
  [/\b(?:api|endpoint|backend|database|migration|postgres|sqlite|prisma|drizzle|query|sql|seed|orm|graphql|rest|webhook|middleware|auth(?:entication)?|jwt|oauth|session)\b/i, 'backend-dev'],
  [/(?:base.?de.?datos|migración|consulta|semilla)/i, 'backend-dev'],
  // Domain: frontend
  [/\b(?:ui|frontend|component|react|css|style|layout|responsive|tailwind|shadcn|animation|modal|form|button|page|view|route|navigation|theme|dark.?mode)\b/i, 'frontend-dev'],
  [/(?:interfaz|estilo|pantalla|formulario|botón|navegación|tema)/i, 'frontend-dev'],
  // Conversational/questions — lower confidence (ambiguous intent)
  [/^(?:what|how|why|when|where|who|which|can you|could you|tell me|show me|explain|describe|check|verify|status|is there|are there|do we|does it|list|help)\b/i, 'researcher', 0.6],
  [/^(?:qué|cómo|por ?qué|cuándo|dónde|quién|cuál|podés|podrías|decime|mostrame|explicá|describí|chequeá|verificá|hay|tenemos|ayuda)[\s?]/i, 'researcher', 0.6],
]

function routeTask(task) {
  const taskLower = task.toLowerCase()
  for (const entry of TASK_PATTERNS) {
    const [regex, agent, confidence] = entry
    if (regex.test(taskLower)) {
      return { agent, confidence: confidence || 0.8, reason: `Matched pattern: ${regex.source}` }
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
