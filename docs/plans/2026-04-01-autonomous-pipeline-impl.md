# Autonomous Test Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove all human approval gates from Triqual + Quoth + Exolar pipeline. Add mutation testing, decision attribution, skill extraction, and Bayesian scoring.

**Architecture:** Three layers — closed-loop autonomy (remove gates, close feedback loops), decision attribution (track which patterns caused outcomes), skill library (extract reusable test templates). Quality gates replace human approval: 2 consecutive passes + mutation test + duplication check.

**Tech Stack:** Node.js CJS (daemon/MCP), Vitest (daemon tests), TypeScript (Quoth server), Drizzle ORM, Playwright (Triqual tests), Bash (hooks), Sonnet 4.6 + /skill-creator (skill extraction), Haiku (attribution/mutation)

---

## Context: Key Files

### Quoth Plugin (quoth-plugin/)
- `daemon/db.js` — SQLite wrapper, patterns table, all DB methods
- `daemon/daemon.js` — background process, processEntry, runDeepConsolidate
- `daemon/pipeline/distill.js` — Haiku-based pattern extraction from trajectories
- `daemon/lib/promote.js` — HTTP client for cloud promotion
- `daemon/lib/embed.js` — text-embedding-3-large via Vercel AI SDK
- `mcp/quoth-learning-server.js` — MCP stdio server, TOOLS + handleTool
- `hooks/lib/common.sh` — get_top_patterns_context, shared utils

### Triqual Plugin (triqual-plugin/)
- `.agents/test-healer.md` — Lines 86-94: "MUST NOT promote", "STOP and inform user"
- `.agents/pattern-learner.md` — Line 352: "MUST present proposal to user"
- `hooks/subagent-start.sh` — Injects context per agent type
- `hooks/subagent-stop.sh` — Post-agent guidance, pattern-learner case at line 217
- `hooks/pre-spec-write.sh` — 8 blocking gates including .draft/ enforcement
- `hooks/stop.sh` — Session end, Exolar seeding, lines 131-134
- `hooks/lib/common.sh` — is_draft_spec_path, run log helpers

### Quoth Server (src/)
- `src/app/api/v1/patterns/promote/route.ts` — Pattern promotion endpoint
- `src/db/schema.ts` — documents, chunks, documentHistory tables

---

## Task 1: Bayesian Confidence Scoring — SQLite Schema + DB Methods

**Files:**
- Modify: `quoth-plugin/daemon/db.js`
- Test: `quoth-plugin/tests/db.test.js`

### Step 1: Write the failing tests

Add to `tests/db.test.js` inside the `describe('db', ...)` block:

```javascript
it('has alpha and beta columns for Bayesian scoring', () => {
  const cols = db.prepare("PRAGMA table_info(patterns)").all().map(r => r.name)
  expect(cols).toContain('alpha')
  expect(cols).toContain('beta')
})

it('upsertPattern sets default alpha=1 beta=1 for new patterns', () => {
  db.upsertPattern({ id: 'bayes-1', name: 'b', pattern_type: 'code-pattern',
    condition: 'c', action: 'a', confidence: 0.5, tags: [], source: 'distilled' })
  const p = db.prepare("SELECT alpha, beta FROM patterns WHERE id = 'bayes-1'").get()
  expect(p.alpha).toBe(1)
  expect(p.beta).toBe(1)
})

it('applyBayesianUpdate increments alpha on success', () => {
  db.upsertPattern({ id: 'bayes-2', name: 'b', pattern_type: 'code-pattern',
    condition: 'c', action: 'a', confidence: 0.5, tags: [], source: 'distilled' })
  db.applyBayesianUpdate('bayes-2', 'success')
  const p = db.prepare("SELECT alpha, beta, confidence FROM patterns WHERE id = 'bayes-2'").get()
  expect(p.alpha).toBe(2)
  expect(p.beta).toBe(1)
  expect(p.confidence).toBeCloseTo(2 / 3) // alpha / (alpha + beta)
})

it('applyBayesianUpdate increments beta on failure', () => {
  db.upsertPattern({ id: 'bayes-3', name: 'b', pattern_type: 'code-pattern',
    condition: 'c', action: 'a', confidence: 0.5, tags: [], source: 'distilled' })
  db.applyBayesianUpdate('bayes-3', 'failure')
  const p = db.prepare("SELECT alpha, beta, confidence FROM patterns WHERE id = 'bayes-3'").get()
  expect(p.alpha).toBe(1)
  expect(p.beta).toBe(2)
  expect(p.confidence).toBeCloseTo(1 / 3)
})

it('applyHourlyDecay decays alpha slowly', () => {
  db.upsertPattern({ id: 'decay-bayes', name: 'b', pattern_type: 'code-pattern',
    condition: 'c', action: 'a', confidence: 0.9, tags: [], source: 'distilled' })
  db.prepare("UPDATE patterns SET alpha = 10, beta = 2 WHERE id = 'decay-bayes'").run()
  db.applyHourlyDecay()
  const p = db.prepare("SELECT alpha FROM patterns WHERE id = 'decay-bayes'").get()
  expect(p.alpha).toBeLessThan(10)
  expect(p.alpha).toBeGreaterThan(9) // small decay
})
```

### Step 2: Run tests to verify they fail

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test
```

Expected: Failures — alpha/beta columns don't exist, applyBayesianUpdate not defined.

### Step 3: Implement

In `daemon/db.js`:

**A) Add runtime migration** (after existing promotion migration block, ~line 108):

```javascript
// Runtime migration: add Bayesian scoring columns if not present
const existingCols2 = db.prepare('PRAGMA table_info(patterns)').all().map(r => r.name)
if (!existingCols2.includes('alpha')) {
  db.exec(`ALTER TABLE patterns ADD COLUMN alpha REAL DEFAULT 1`)
}
if (!existingCols2.includes('beta')) {
  db.exec(`ALTER TABLE patterns ADD COLUMN beta REAL DEFAULT 1`)
}
```

**B) Add `applyBayesianUpdate` method** (after `applyConfidenceDelta`):

```javascript
db.applyBayesianUpdate = function(id, outcome) {
  if (outcome === 'success') {
    db.prepare(`
      UPDATE patterns SET
        alpha = alpha + 1,
        success_count = success_count + 1,
        confidence = (alpha + 1.0) / (alpha + 1.0 + beta),
        last_matched_at = strftime('%s','now') * 1000,
        updated_at = strftime('%s','now') * 1000
      WHERE id = ?
    `).run(id)
  } else {
    db.prepare(`
      UPDATE patterns SET
        beta = beta + 1,
        failure_count = failure_count + 1,
        confidence = alpha / (alpha + beta + 1.0),
        last_matched_at = strftime('%s','now') * 1000,
        updated_at = strftime('%s','now') * 1000
      WHERE id = ?
    `).run(id)
  }
}
```

**C) Update `applyHourlyDecay`** to decay alpha instead of confidence:

Replace existing `applyHourlyDecay`:

```javascript
db.applyHourlyDecay = function() {
  db.prepare(`
    UPDATE patterns
    SET alpha = MAX(1.0, alpha - (decay_rate * alpha * 0.01)),
        confidence = MAX(0.0, alpha / (alpha + beta)),
        updated_at = strftime('%s','now') * 1000
    WHERE status = 'active'
  `).run()
}
```

### Step 4: Run tests to verify they pass

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test
```

### Step 5: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin
git add daemon/db.js tests/db.test.js
git commit -m "feat(daemon): add Bayesian confidence scoring with alpha/beta columns"
```

---

## Task 2: Source Tagging in Distill Pipeline

**Files:**
- Modify: `quoth-plugin/daemon/pipeline/distill.js`
- Modify: `quoth-plugin/daemon/daemon.js`

### Step 1: Implement source tagging in distill.js

In `daemon/pipeline/distill.js`, the `distill` function returns an object. Add `source` field.

Change the return at line 45:
```javascript
return { id, pattern: result.pattern, tags: result.tags || [], applicability: result.applicability || 'narrow', embedding, source: 'distilled' }
```

And the fallback return at line 54:
```javascript
return {
  id: makeId(fallbackContent),
  pattern: fallbackContent,
  tags: [],
  applicability: 'narrow',
  fallback: true,
  error: err.message,
  embedding: null,
  source: 'distilled'
}
```

### Step 2: Update daemon.js to pass source through to upsertPattern

In `daemon/daemon.js`, find the `db.upsertPattern` call (~line 143). Add `source: distilled.source`:

```javascript
db.upsertPattern({
  id: distilled.id,
  name: distilled.pattern.slice(0, 60),
  pattern_type: 'code-pattern',
  condition: entry.task || 'agent task',
  action: distilled.pattern,
  confidence: 0.5,
  tags: distilled.tags,
  source: distilled.source || 'distilled',
  embedding: distilled.embedding ? JSON.stringify(distilled.embedding) : undefined
})
```

### Step 3: Update quoth_seed_from_exolar to tag source

In `mcp/quoth-learning-server.js`, the `quoth_seed_from_exolar` case spawns a subprocess that writes trajectory events. Update the prompt template (~line 109) to include `"source":"exolar-seeded"` in the JSON format:

Change the format line to:
```javascript
const prompt = `Query Exolar for clustered failures (dataset: clustered_failures${args.projectId ? `, project: ${args.projectId}` : ''}).
For each cluster, write a JSON line to: ${trajFile}
Format: {"event":"exolar_seed","session":"${sessionId}","task":"<cluster description>","outcome":"failure","pattern_used":"<error type>","agent":"exolar-importer","source":"exolar-seeded"}
One line per cluster. Use the mcp__plugin_triqual-plugin_exolar-qa__query_exolar_data tool.`
```

Then in `daemon/daemon.js` processEntry, check for entry.source and pass it through:

```javascript
source: distilled.source || entry.source || 'distilled',
```

### Step 4: Run tests

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test
```

### Step 5: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin
git add daemon/pipeline/distill.js daemon/daemon.js mcp/quoth-learning-server.js
git commit -m "feat(daemon): add source tagging through distill pipeline"
```

---

## Task 3: Decision Attribution Module

**Files:**
- Create: `quoth-plugin/daemon/lib/attribute.js`
- Create: `quoth-plugin/tests/attribute.test.js`

### Step 1: Write the failing tests

Create `quoth-plugin/tests/attribute.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { attributeOutcome } = require('../daemon/lib/attribute.js')

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('attributeOutcome', () => {
  it('returns attributions array for each pattern', async () => {
    vi.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      status: 0,
      stdout: JSON.stringify([
        { patternId: 'pat-1', attribution: 'success', reason: 'helped' },
        { patternId: 'pat-2', attribution: 'irrelevant', reason: 'not used' }
      ])
    })
    const result = await attributeOutcome({
      patterns: [{ id: 'pat-1', name: 'p1' }, { id: 'pat-2', name: 'p2' }],
      outcome: 'success',
      feature: 'login',
      agent: 'test-healer',
      errorSummary: null
    })
    expect(result).toHaveLength(2)
    expect(result[0].patternId).toBe('pat-1')
    expect(result[0].attribution).toBe('success')
  })

  it('returns empty array when no patterns provided', async () => {
    const result = await attributeOutcome({
      patterns: [],
      outcome: 'success',
      feature: 'login',
      agent: 'test-healer'
    })
    expect(result).toEqual([])
  })

  it('returns empty array on subprocess failure', async () => {
    vi.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      status: 1, stdout: ''
    })
    const result = await attributeOutcome({
      patterns: [{ id: 'pat-1', name: 'p1' }],
      outcome: 'failure',
      feature: 'login',
      agent: 'test-healer',
      errorSummary: 'timeout'
    })
    expect(result).toEqual([])
  })
})
```

### Step 2: Run tests to verify they fail

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test tests/attribute.test.js
```

### Step 3: Implement

Create `quoth-plugin/daemon/lib/attribute.js`:

```javascript
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
- recovery_tip: what fixed a failure (only when outcome went from fail→success)
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
```

### Step 4: Run tests

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test
```

### Step 5: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin
git add daemon/lib/attribute.js tests/attribute.test.js
git commit -m "feat(daemon): add decision attribution module"
```

---

## Task 4: Mutation Testing Module

**Files:**
- Create: `quoth-plugin/daemon/lib/mutate.js`
- Create: `quoth-plugin/tests/mutate.test.js`

### Step 1: Write the failing tests

Create `quoth-plugin/tests/mutate.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { generateMutations } = require('../daemon/lib/mutate.js')

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('generateMutations', () => {
  it('returns array of mutation objects', async () => {
    vi.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      status: 0,
      stdout: JSON.stringify([
        { description: 'Comment out button render', file: 'src/Login.tsx', line: 42, original: '<Button>Login</Button>', mutated: '{/* <Button>Login</Button> */}' },
        { description: 'Change API response', file: 'src/api/auth.ts', line: 10, original: 'return { token }', mutated: 'return { token: null }' }
      ])
    })
    const result = await generateMutations({
      testFile: 'tests/login.spec.ts',
      feature: 'login'
    })
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveProperty('description')
    expect(result[0]).toHaveProperty('file')
    expect(result[0]).toHaveProperty('original')
    expect(result[0]).toHaveProperty('mutated')
  })

  it('returns empty array on failure', async () => {
    vi.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      status: 1, stdout: ''
    })
    const result = await generateMutations({ testFile: 'x.spec.ts', feature: 'x' })
    expect(result).toEqual([])
  })
})
```

### Step 2: Run tests to verify fail

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test tests/mutate.test.js
```

### Step 3: Implement

Create `quoth-plugin/daemon/lib/mutate.js`:

```javascript
'use strict'

const PROMPT = `You are generating targeted mutations to verify a Playwright test catches real failures.

Test file: {{testFile}}
Feature: {{feature}}
Test code:
{{testCode}}

Generate 2-3 targeted mutations to the APPLICATION code (NOT the test code) that should cause this test to FAIL. Each mutation should break a specific behavior the test is supposed to verify.

Good mutations:
- Comment out a DOM element the test asserts on
- Change an API response value the test checks
- Break a navigation route the test follows
- Remove a click handler the test triggers

Bad mutations (avoid):
- Syntax errors that prevent compilation
- Changes unrelated to what the test verifies
- Changes to the test file itself

Respond with ONLY valid JSON array:
[{"description":"what this mutation does","file":"src/path/to/file.ext","line":42,"original":"original code","mutated":"mutated code"}]`

async function generateMutations({ testFile, feature, testCode }) {
  const fs = require('fs')
  let code = testCode || ''
  if (!code && testFile) {
    try { code = fs.readFileSync(testFile, 'utf8') } catch {}
  }

  const prompt = PROMPT
    .replace('{{testFile}}', testFile || 'unknown')
    .replace('{{feature}}', feature || 'unknown')
    .replace('{{testCode}}', code.slice(0, 3000)) // cap to avoid token overflow

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

module.exports = { generateMutations }
```

### Step 4: Run tests

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test
```

### Step 5: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin
git add daemon/lib/mutate.js tests/mutate.test.js
git commit -m "feat(daemon): add mutation testing module for false positive detection"
```

---

## Task 5: Skill Extraction Orchestrator

**Files:**
- Create: `quoth-plugin/daemon/lib/skill-extract.js`
- Create: `quoth-plugin/tests/skill-extract.test.js`

### Step 1: Write the failing tests

Create `quoth-plugin/tests/skill-extract.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { extractSkill } = require('../daemon/lib/skill-extract.js')

beforeEach(() => {
  process.env.QUOTH_API_KEY = 'qth_testkey'
  process.env.QUOTH_API_URL = 'https://test.quoth.dev'
  process.env.QUOTH_PROJECT_ID = 'project-uuid'
  vi.restoreAllMocks()
})

afterEach(() => {
  delete process.env.QUOTH_API_KEY
  delete process.env.QUOTH_API_URL
  delete process.env.QUOTH_PROJECT_ID
  vi.restoreAllMocks()
})

describe('extractSkill', () => {
  it('dispatches Sonnet 4.6 with skill-creator for extraction', async () => {
    const spawnSpy = vi.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        name: 'verify-login-redirect',
        description: 'Verify login redirects to dashboard',
        template: 'await page.goto("{{url}}")',
        params: ['url'],
        selectors: ['[data-testid="login"]'],
        assertions: ['toHaveURL']
      })
    })
    const result = await extractSkill({
      testFile: 'tests/login.spec.ts',
      testCode: 'test("login", async ({ page }) => { ... })',
      feature: 'login'
    })
    expect(result).toHaveProperty('name')
    expect(result).toHaveProperty('template')
    // Verify Sonnet model used (not Haiku)
    const args = spawnSpy.mock.calls[0][1]
    expect(args).toContain('claude-sonnet-4-6')
  })

  it('returns null on failure', async () => {
    vi.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      status: 1, stdout: ''
    })
    const result = await extractSkill({ testFile: 'x.spec.ts', feature: 'x' })
    expect(result).toBeNull()
  })
})
```

### Step 2: Run tests to verify fail

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test tests/skill-extract.test.js
```

### Step 3: Implement

Create `quoth-plugin/daemon/lib/skill-extract.js`:

```javascript
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
    // Use Sonnet 4.6 for skill extraction (high-quality output needed)
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
```

### Step 4: Run tests

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test
```

### Step 5: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin
git add daemon/lib/skill-extract.js tests/skill-extract.test.js
git commit -m "feat(daemon): add skill extraction using Sonnet 4.6"
```

---

## Task 6: New MCP Tools — quoth_extract_skill + quoth_list_skills

**Files:**
- Modify: `quoth-plugin/mcp/quoth-learning-server.js`
- Modify: `quoth-plugin/tests/integration.test.js`

### Step 1: Write failing test

Add to `tests/integration.test.js`:

```javascript
it('tools/list includes quoth_extract_skill and quoth_list_skills', () => {
  const result = execSync(
    `printf '%s\\n%s\\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | QUOTH_HOME=${tmpDir} node ${join(__dirname, '../mcp/quoth-learning-server.js')}`,
    { encoding: 'utf8', timeout: 5000 }
  )
  const lines = result.trim().split('\n').map(l => JSON.parse(l))
  const toolsListResponse = lines.find(l => l.id === 2)
  const toolNames = toolsListResponse.result.tools.map(t => t.name)
  expect(toolNames).toContain('quoth_extract_skill')
  expect(toolNames).toContain('quoth_list_skills')
})
```

### Step 2: Run to verify fail

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test tests/integration.test.js
```

### Step 3: Implement

In `mcp/quoth-learning-server.js`:

**A) Add import** at top (after promotePattern require):

```javascript
const { extractSkill } = require(path.join(__dirname, '../daemon/lib/skill-extract.js'))
```

**B) Add to TOOLS array** (after quoth_propose_update):

```javascript
{
  name: 'quoth_extract_skill',
  description: 'Extract a reusable test skill from a passing test file using Sonnet 4.6',
  inputSchema: {
    type: 'object',
    properties: {
      testFile: { type: 'string', description: 'Path to the passing test file' },
      feature: { type: 'string', description: 'Feature name for context' }
    },
    required: ['testFile']
  }
},
{
  name: 'quoth_list_skills',
  description: 'List all extracted skills from the local pattern database',
  inputSchema: {
    type: 'object',
    properties: {
      tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' }
    }
  }
}
```

**C) Add cases in handleTool** (before default):

```javascript
case 'quoth_extract_skill': {
  const skill = await extractSkill({
    testFile: args.testFile,
    feature: args.feature || path.basename(args.testFile, '.spec.ts')
  })
  if (!skill) return { error: 'Skill extraction failed — check test file exists and is readable' }
  // Store as a pattern with source 'skill-derived'
  const id = require('crypto').createHash('sha1').update(skill.name).digest('hex').slice(0, 12)
  getDb().upsertPattern({
    id: `skill-${id}`,
    name: skill.name,
    pattern_type: 'skill',
    condition: skill.description,
    action: skill.template,
    confidence: 0.85,
    tags: [...(skill.assertions || []), ...(skill.pageObjects || [])],
    source: 'skill-derived'
  })
  return { extracted: true, skill }
}

case 'quoth_list_skills': {
  const patterns = getDb().getTopPatterns(50, args.tags || [])
  const skills = patterns.filter(p => p.source === 'skill-derived' || p.pattern_type === 'skill')
  return { skills }
}
```

### Step 4: Run tests

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test
```

### Step 5: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin
git add mcp/quoth-learning-server.js tests/integration.test.js
git commit -m "feat(mcp): add quoth_extract_skill and quoth_list_skills tools"
```

---

## Task 7: Remove Human Approval from test-healer Agent

**Files:**
- Modify: `Triqual/triqual-plugin/.agents/test-healer.md`

### Step 1: Read the file

```
Read: /Users/agustinmontoya/Attorneyshare/Triqual/triqual-plugin/.agents/test-healer.md
```

### Step 2: Implement

**A) Replace lines 86-94** (the "MUST NOT promote" block):

Find:
```markdown
**CRITICAL: You MUST NOT promote files from .draft/ to tests/ automatically.**

When tests PASS:
1. Document SUCCESS in run log
2. **STOP and inform the user** that tests are passing
3. **Wait for explicit user approval** before promoting
4. Only the user (or the orchestrating /test skill) can approve promotion

**You do NOT have permission to move files out of .draft/.**
```

Replace with:
```markdown
**AUTONOMOUS PROMOTION: After quality gates pass, auto-promote.**

When tests PASS:
1. Run test a second time (consecutive pass #2 required)
2. If second pass succeeds → run mutation test (quality gate)
3. If mutation test passes (test catches the mutation) → auto-promote:
   - Move files from `.draft/tests/` → `tests/`
   - Move files from `.draft/pages/` → `pages/` (if applicable)
   - Commit with message: `test(auto): add {feature} test`
4. If mutation test fails (false positive) → strengthen assertions and retry
5. Run duplication check → if existing helpers cover same action, refactor to reuse
6. Document SUCCESS + promotion in run log
7. Call `quoth_log_outcome` for patterns that helped (Decision Attribution)

**No user approval needed. Quality gates replace human review.**
```

**B) Replace lines 299-337** (the SUCCESS exit condition):

Find the `**SUCCESS (any attempt):**` section and replace with:

```markdown
**SUCCESS (any attempt):**

1. **Run consecutive pass #2:**
   ```bash
   npx playwright test {test-file} --reporter=line
   ```

2. **If second pass succeeds, run quality gates:**
   - Call `quoth_extract_skill` or use mutation testing logic
   - Verify test catches at least one mutation
   - Check for code duplication against existing tests/

3. **If quality gates pass → auto-promote:**
   ```bash
   # Move from .draft/ to tests/
   mv .draft/tests/{feature}.spec.ts tests/{feature}.spec.ts
   mv .draft/pages/{Page}.ts pages/{Page}.ts  # if applicable
   git add tests/ pages/
   git commit -m "test(auto): add {feature} test - {N} attempts"
   ```

4. **Document in run log:**
   ```markdown
   ### Stage: SUCCESS
   **Timestamp:** {ISO timestamp}
   **Attempts Required:** {N}
   **Quality Gates:**
   - Consecutive passes: ✓ (2/2)
   - Mutation test: ✓ (caught {M}/{total} mutations)
   - Duplication check: ✓
   **Promoted:** .draft/tests/{feature}.spec.ts → tests/{feature}.spec.ts
   **Patterns Used:** {list pattern IDs}
   ```

5. **Call Decision Attribution** for confidence scoring
6. **Extract skill** via `quoth_extract_skill` (Sonnet 4.6)
7. **Exit with success**
```

**C) Update "What This Agent Does NOT Do" section** (line ~474):

Remove: `❌ **Promote files from .draft/ to tests/** (requires user approval)`
Add: `✅ Auto-promotes from .draft/ to tests/ after quality gates pass`

### Step 3: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Triqual
git add triqual-plugin/.agents/test-healer.md
git commit -m "feat(agents): make test-healer fully autonomous with quality gates"
```

---

## Task 8: Remove Human Approval from pattern-learner Agent

**Files:**
- Modify: `Triqual/triqual-plugin/.agents/pattern-learner.md`

### Step 1: Read the file

```
Read: /Users/agustinmontoya/Attorneyshare/Triqual/triqual-plugin/.agents/pattern-learner.md
```

### Step 2: Implement

**Replace lines 350-386** (the "MUST present proposal" block):

Find:
```markdown
**IMPORTANT:** You MUST present the proposal to the user and get explicit confirmation before calling `quoth_propose_update`. Never auto-push.
```

And the entire proposal flow below it. Replace with:

```markdown
**AUTONOMOUS:** Promote generalizable patterns to Quoth automatically. No user approval needed.

**Steps for Quoth promotion:**

1. Search Quoth to verify pattern doesn't already exist:
   ```
   mcp__quoth__quoth_search_index({
     query: "{pattern keywords}"
   })
   ```

2. **If pattern is new and generalizable, auto-promote:**
   ```
   quoth_propose_update({
     patternId: "{local-pattern-id}"
   })
   ```

3. **Log the promotion in run log:**
   ```markdown
   **Auto-promoted to Quoth:** {pattern title}
   - Pattern ID: {id}
   - Evidence: {from which run logs}
   - Confidence: {score}
   ```

**Promote when:**
- Pattern is generalizable (not project-specific)
- Same fix worked across 3+ features
- Confidence > 0.7 in local DB

**For project-specific patterns**, update knowledge.md directly (no Quoth promotion).
```

### Step 3: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Triqual
git add triqual-plugin/.agents/pattern-learner.md
git commit -m "feat(agents): make pattern-learner fully autonomous for Quoth promotion"
```

---

## Task 9: Auto-dispatch pattern-learner at Session End

**Files:**
- Modify: `Triqual/triqual-plugin/hooks/stop.sh`

### Step 1: Read the file

```
Read: /Users/agustinmontoya/Attorneyshare/Triqual/triqual-plugin/hooks/stop.sh
```

### Step 2: Implement

After the Exolar seeding block (line 134), add pattern-learner auto-dispatch:

```bash
# Auto-dispatch pattern-learner if completed run logs exist with LEARN stages
if [ -n "$latest_log" ] && [ "$needs_learnings" = "false" ]; then
    # Run logs have accumulated learnings — dispatch pattern-learner to extract and promote
    (claude mcp call quoth-learning quoth_top_patterns '{"limit":1}' >/dev/null 2>&1 && \
     claude -p --model claude-haiku-4-5-20251001 --output-format text \
       "You are the pattern-learner. Read all run logs at .triqual/runs/*.md. Extract generalizable patterns. For each pattern with 3+ occurrences, call quoth_propose_update to promote to Quoth. Update .triqual/knowledge.md with project-specific patterns. Be autonomous — no user approval needed." \
       >> "${HOME}/.quoth/mcp-calls.log" 2>&1) &
    log_debug "Auto-dispatched pattern-learner at session end"
fi
```

### Step 3: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Triqual
git add triqual-plugin/hooks/stop.sh
git commit -m "feat(hooks): auto-dispatch pattern-learner at session end"
```

---

## Task 10: Decision Attribution in Subagent Hooks

**Files:**
- Modify: `Triqual/triqual-plugin/hooks/subagent-start.sh`
- Modify: `Triqual/triqual-plugin/hooks/subagent-stop.sh`

### Step 1: Implement pattern ID logging in subagent-start.sh

In `subagent-start.sh`, the test-healer and test-generator cases already inject `QUOTH_PATTERNS`. After fetching patterns, log the injected pattern IDs to the trajectory file.

After each `QUOTH_PATTERNS=$(claude mcp call ...)` block, add:

```bash
# Log injected pattern IDs to trajectory for Decision Attribution
if [ -n "$QUOTH_PATTERNS" ] && [ -n "$FEATURE" ]; then
    local quoth_home="${HOME}/.quoth"
    local session_id
    session_id=$(cat "${quoth_home}/current_session" 2>/dev/null || echo "unknown")
    local traj_file="${quoth_home}/trajectories/${session_id}.jsonl"
    echo "{\"event\":\"patterns_injected\",\"agent\":\"${AGENT_TYPE}\",\"feature\":\"${FEATURE}\",\"patterns\":${QUOTH_PATTERNS},\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >> "${traj_file}" 2>/dev/null || true
fi
```

### Step 2: Add Decision Attribution call in subagent-stop.sh

In `subagent-stop.sh`, in the `*test-healer*` case (line 130), after the existing log_updated check, add attribution:

```bash
    *test-healer*)
        # Decision Attribution: score patterns based on outcome
        if [ -n "$FEATURE" ]; then
            local outcome="unknown"
            if [ -n "$LATEST_LOG" ]; then
                # Check if SUCCESS stage exists
                if grep -q "Stage: SUCCESS" "$LATEST_LOG" 2>/dev/null; then
                    outcome="success"
                else
                    outcome="failure"
                fi
            fi
            # Fire-and-forget attribution call
            (claude mcp call quoth-learning quoth_log_outcome \
                "{\"patternId\":\"attributed-${FEATURE}\",\"result\":\"${outcome}\"}" \
                >> "${HOME}/.quoth/mcp-calls.log" 2>&1) &
        fi
```

### Step 3: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Triqual
git add triqual-plugin/hooks/subagent-start.sh triqual-plugin/hooks/subagent-stop.sh
git commit -m "feat(hooks): add Decision Attribution to subagent lifecycle"
```

---

## Task 11: Update pre-spec-write.sh to Allow Autonomous Promotion

**Files:**
- Modify: `Triqual/triqual-plugin/hooks/pre-spec-write.sh`
- Modify: `Triqual/triqual-plugin/hooks/lib/common.sh`

### Step 1: Read the files

```
Read: /Users/agustinmontoya/Attorneyshare/Triqual/triqual-plugin/hooks/pre-spec-write.sh
Read: /Users/agustinmontoya/Attorneyshare/Triqual/triqual-plugin/hooks/lib/common.sh
```

### Step 2: Implement

In `pre-spec-write.sh`, find the GATE 0 (draft folder enforcement) section. The current logic blocks ALL writes to `tests/` for new files. We need to allow writes to `tests/` when the source is `.draft/` (i.e., a promotion, not a fresh write).

The key function is `is_draft_spec_path` in `hooks/lib/common.sh`. We need to add a companion function `is_promotion_write` that checks if the file being written to `tests/` already exists in `.draft/tests/`:

In `hooks/lib/common.sh`, add:

```bash
# Check if this is a promotion write (file exists in .draft/ and is being written to tests/)
is_promotion_write() {
  local file_path="$1"
  # If writing to tests/ and the same file exists in .draft/tests/
  local basename
  basename=$(basename "$file_path")
  if [[ "$file_path" == *"tests/"* ]] && [[ "$file_path" != *".draft/"* ]]; then
    local draft_path=".draft/tests/${basename}"
    if [ -f "$draft_path" ]; then
      return 0  # This is a promotion
    fi
  fi
  return 1
}
```

Then in `pre-spec-write.sh`, at the GATE 0 check, add the promotion exception:

Find the block that checks `is_draft_spec_path` and add before the block:

```bash
# Allow promotion writes (moving from .draft/ to tests/)
if is_promotion_write "$file_path"; then
    log_debug "Promotion write detected for $file_path — allowing"
    output_empty
    exit 0
fi
```

### Step 3: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Triqual
git add triqual-plugin/hooks/pre-spec-write.sh triqual-plugin/hooks/lib/common.sh
git commit -m "feat(hooks): allow autonomous promotion writes from .draft/ to tests/"
```

---

## Task 12: Wire Exolar Cross-Validation into Nightly Consolidation

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js`

### Step 1: Implement

In `daemon/daemon.js`, in `runDeepConsolidate()`, after the promotion block, add Exolar cross-validation:

```javascript
// Cross-validate pattern confidence against Exolar execution logs
try {
  const candidates = db.getTopPatterns(20)
  for (const pattern of candidates) {
    if (!pattern.tags || pattern.tags.length === 0) continue
    // Query tag to see if this pattern's tags appear in failures
    // This is a best-effort check — Exolar queries may fail
    log('debug', 'Exolar cross-validation skipped (requires MCP context)', { id: pattern.id })
  }
} catch (err) {
  log('debug', 'Exolar cross-validation not available in daemon context', { error: err.message })
}
```

**Note:** Full Exolar cross-validation requires MCP context (the daemon runs outside Claude Code). For now, add the placeholder. The actual cross-validation happens when `triqual_load_context` runs and can compare Exolar failure rates against pattern confidence. This will be enhanced in a future iteration when the daemon can make HTTP calls to Exolar's API directly.

### Step 2: Run tests

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test
```

### Step 3: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin
git add daemon/daemon.js
git commit -m "feat(daemon): add Exolar cross-validation placeholder in nightly consolidation"
```

---

## Task 13: Documentation Updates

**Files:**
- Modify: `Quoth/CLAUDE.md`
- Modify: `Triqual/CLAUDE.md`

### Step 1: Update Quoth CLAUDE.md

Add to the `### New MCP Tools (quoth-learning)` section:

```markdown
- `quoth_extract_skill` — extract a reusable test skill from a passing test (Sonnet 4.6)
- `quoth_list_skills` — list all extracted skills from local pattern database
```

Add to the `### Daemon` section:

```markdown
- Bayesian confidence scoring: Beta(alpha, beta) distribution replaces simple +/-
- Decision Attribution: tracks which patterns caused success/failure outcomes
- Source tagging: distilled, exolar-seeded, healer-learned, attributed, skill-derived
```

### Step 2: Update Triqual CLAUDE.md

In the agent behavior section, add:

```markdown
### Autonomous Behavior (No Human Approval)
- test-healer: auto-promotes from .draft/ → tests/ after quality gates (2 consecutive passes + mutation test + duplication check)
- pattern-learner: auto-promotes generalizable patterns to Quoth (no user confirmation)
- pattern-learner: auto-dispatched at session end when completed run logs exist
- failure-classifier: auto-updates pattern confidence via quoth_log_outcome
```

In the MCP tools section, add:

```markdown
- `quoth_extract_skill({ testFile, feature })` — Extract reusable test skill (Sonnet 4.6)
- `quoth_list_skills({ tags? })` — List extracted skills
```

### Step 3: Commit both repos

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth
git add CLAUDE.md
git commit -m "docs: document Bayesian scoring, skills, and decision attribution"

cd /Users/agustinmontoya/Attorneyshare/Triqual
git add CLAUDE.md
git commit -m "docs: document autonomous behavior and new MCP tools"
```

---

## End-to-End Verification

After all tasks are complete:

```bash
# 1. Daemon tests
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test
# Expected: All tests pass (40+)

# 2. Verify new MCP tools
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | \
  QUOTH_HOME=/tmp/quoth-verify node quoth-plugin/mcp/quoth-learning-server.js | \
  grep -o '"name":"[^"]*"'
# Expected: includes quoth_extract_skill, quoth_list_skills

# 3. Verify Triqual agent files
grep -c "AUTONOMOUS" /Users/agustinmontoya/Attorneyshare/Triqual/triqual-plugin/.agents/test-healer.md
# Expected: > 0

grep -c "MUST present the proposal" /Users/agustinmontoya/Attorneyshare/Triqual/triqual-plugin/.agents/pattern-learner.md
# Expected: 0 (removed)

# 4. Verify hook changes
grep "is_promotion_write" /Users/agustinmontoya/Attorneyshare/Triqual/triqual-plugin/hooks/lib/common.sh
# Expected: function defined

grep "pattern-learner" /Users/agustinmontoya/Attorneyshare/Triqual/triqual-plugin/hooks/stop.sh
# Expected: auto-dispatch block present
```
