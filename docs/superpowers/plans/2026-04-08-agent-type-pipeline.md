# Agent-Type Pipeline Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire agent-type awareness into the pattern pipeline — batch JUDGE gates quality, tags enable domain-filtered injection, cost tracking provides visibility.

**Architecture:** Batch JUDGE (gemini-2.5-flash) evaluates 30 entries at once and classifies domain. Only effective entries reach DISTILL (gemini-2.5-flash-lite). Agent-type tags flow from JUDGE → pattern insert → filtered injection. Cost tracked per LLM call.

**Tech Stack:** Node.js (CommonJS), SQLite (better-sqlite3), Vercel AI Gateway, Vitest

**Spec:** `docs/superpowers/specs/2026-04-08-agent-type-pipeline-design.md`

---

### Task 1: Cost Tracking Infrastructure

**Files:**
- Modify: `quoth-plugin/daemon/db.js` (add pipeline_costs table + methods)
- Modify: `quoth-plugin/daemon/lib/llm.js` (add callLLMWithUsage + recordCost)
- Create: `quoth-plugin/tests/cost-tracking.test.js`

- [ ] **Step 1: Write failing test for pipeline_costs table**

```js
// tests/cost-tracking.test.js
import { describe, it, expect, beforeEach } from 'vitest'

let db
beforeEach(() => {
  db = require('../daemon/db.js').createDb(':memory:')
})

describe('pipeline cost tracking', () => {
  it('records a pipeline cost entry', () => {
    db.recordPipelineCost({
      stage: 'judge-batch',
      model: 'google/gemini-2.5-flash',
      input_tokens: 1500,
      output_tokens: 300,
      estimated_cost_usd: 0.0012,
      batch_size: 30,
      session_id: 'test-session',
      project: 'quoth',
    })
    const summary = db.getCostSummary()
    expect(summary.total_calls).toBe(1)
    expect(summary.total_cost_usd).toBeCloseTo(0.0012)
  })

  it('getCostSummary filters by date range', () => {
    db.recordPipelineCost({ stage: 'distill-batch', model: 'google/gemini-2.5-flash-lite', input_tokens: 800, output_tokens: 200, estimated_cost_usd: 0.0002, batch_size: 5 })
    db.recordPipelineCost({ stage: 'judge-batch', model: 'google/gemini-2.5-flash', input_tokens: 2000, output_tokens: 500, estimated_cost_usd: 0.002, batch_size: 30 })
    const summary = db.getCostSummary('today')
    expect(summary.total_calls).toBe(2)
    expect(summary.by_stage['judge-batch'].calls).toBe(1)
    expect(summary.by_stage['distill-batch'].calls).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/cost-tracking.test.js`
Expected: FAIL — `db.recordPipelineCost is not a function`

- [ ] **Step 3: Add pipeline_costs table and methods to db.js**

In `quoth-plugin/daemon/db.js`, add runtime migration after existing migrations (~line 177):

```js
v2Migrate('add pipeline_costs table', () => db.exec(`
  CREATE TABLE IF NOT EXISTS pipeline_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    estimated_cost_usd REAL DEFAULT 0,
    batch_size INTEGER DEFAULT 1,
    session_id TEXT,
    project TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_costs_stage ON pipeline_costs(stage);
  CREATE INDEX IF NOT EXISTS idx_costs_created ON pipeline_costs(created_at DESC);
`))
```

Add methods after existing db methods:

```js
db.recordPipelineCost = function({ stage, model, input_tokens, output_tokens, estimated_cost_usd, batch_size, session_id, project }) {
  db.prepare(`
    INSERT INTO pipeline_costs (stage, model, input_tokens, output_tokens, estimated_cost_usd, batch_size, session_id, project)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(stage, model, input_tokens || 0, output_tokens || 0, estimated_cost_usd || 0, batch_size || 1, session_id || null, project || null)
}

db.getCostSummary = function(range) {
  let where = ''
  if (range === 'today') {
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0)
    where = `WHERE created_at >= ${startOfDay.getTime()}`
  } else if (range === 'week') {
    where = `WHERE created_at >= ${Date.now() - 7 * 24 * 60 * 60 * 1000}`
  }
  const rows = db.prepare(`SELECT stage, model, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, SUM(estimated_cost_usd) as cost, COUNT(*) as calls FROM pipeline_costs ${where} GROUP BY stage`).all()
  const by_stage = {}
  let total_cost = 0, total_calls = 0
  for (const r of rows) {
    by_stage[r.stage] = { calls: r.calls, cost: r.cost, input_tokens: r.input_tokens, output_tokens: r.output_tokens, model: r.model }
    total_cost += r.cost
    total_calls += r.calls
  }
  return { total_calls, total_cost_usd: total_cost, by_stage }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/cost-tracking.test.js`
Expected: PASS

- [ ] **Step 5: Add callLLMWithUsage to llm.js**

Modify `quoth-plugin/daemon/lib/llm.js`. Add model-specific pricing and a new function that returns usage data:

```js
// After line 20 (DEFAULT_MODEL)
const MODEL_PRICING = {
  'google/gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
  'google/gemini-2.5-flash': { input: 0.30, output: 2.50 },
}

function estimateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING[DEFAULT_MODEL]
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}
```

Modify `callGateway` to also return usage data (currently it only returns content string). Add new export:

```js
async function callLLMWithUsage(prompt, maxTokens = 200, model) {
  const m = model || getModel()
  if (!getGatewayKey()) throw new Error('callLLMWithUsage requires AI_GATEWAY_API_KEY')
  const apiKey = getGatewayKey()
  const body = JSON.stringify({
    model: m,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.3,
  })
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: GATEWAY_HOST, path: GATEWAY_PATH, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000,
    }, (res) => {
      let chunks = ''
      res.on('data', c => { chunks += c })
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks)
          if (data.error) { reject(new Error(data.error.message || JSON.stringify(data.error))); return }
          let content = data.choices?.[0]?.message?.content || ''
          content = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim()
          const usage = data.usage || {}
          resolve({
            content,
            model: m,
            input_tokens: usage.prompt_tokens || 0,
            output_tokens: usage.completion_tokens || 0,
            estimated_cost_usd: estimateCost(m, usage.prompt_tokens || 0, usage.completion_tokens || 0),
          })
        } catch { reject(new Error('Invalid JSON response')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body); req.end()
  })
}
```

Add to exports: `module.exports = { callLLM, callLLMWithUsage, callGateway, callMoonshot, getModel, estimateCost, MODEL_PRICING, DEFAULT_MODEL }`

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All 181+ tests PASS (no regressions), cost-tracking tests PASS

- [ ] **Step 7: Commit**

```bash
git add quoth-plugin/daemon/db.js quoth-plugin/daemon/lib/llm.js quoth-plugin/tests/cost-tracking.test.js
git commit -m "feat(daemon): cost tracking infrastructure — pipeline_costs table + callLLMWithUsage"
```

---

### Task 2: Batch JUDGE Pipeline Stage

**Files:**
- Create: `quoth-plugin/daemon/pipeline/batch-judge.js`
- Create: `quoth-plugin/tests/batch-judge.test.js`

- [ ] **Step 1: Write failing test for batch judge**

```js
// tests/batch-judge.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../daemon/lib/llm.js', () => ({
  callLLMWithUsage: vi.fn(),
  callLLM: vi.fn(),
  getModel: () => 'google/gemini-2.5-flash',
}))

const { batchJudge } = require('../daemon/pipeline/batch-judge.js')
const { callLLMWithUsage } = require('../daemon/lib/llm.js')

describe('batchJudge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('judges a batch of entries and returns domain classification', async () => {
    callLLMWithUsage.mockResolvedValue({
      content: JSON.stringify({
        judgments: [
          { index: 0, effective: true, domain: 'coder', reason: 'fixed bug' },
          { index: 1, effective: false, domain: 'tester', reason: 'test was flaky' },
          { index: 2, effective: true, domain: 'devops', reason: 'deployed successfully' },
        ]
      }),
      model: 'google/gemini-2.5-flash',
      input_tokens: 1200,
      output_tokens: 150,
      estimated_cost_usd: 0.0007,
    })

    const entries = [
      { agent: 'claude-code', task: 'fix auth bug', outcome: 'success', tool_calls: 5 },
      { agent: 'claude-code', task: 'write unit test', outcome: 'failure', tool_calls: 3 },
      { agent: 'claude-code', task: 'deploy to staging', outcome: 'success', tool_calls: 8 },
    ]

    const result = await batchJudge(entries)
    expect(result.judgments).toHaveLength(3)
    expect(result.judgments[0]).toEqual({ index: 0, effective: true, domain: 'coder', reason: 'fixed bug' })
    expect(result.judgments[1].effective).toBe(false)
    expect(result.usage.input_tokens).toBe(1200)
    expect(callLLMWithUsage).toHaveBeenCalledTimes(1)
  })

  it('returns fallback judgments on LLM failure', async () => {
    callLLMWithUsage.mockRejectedValue(new Error('timeout'))
    const entries = [
      { agent: 'claude-code', task: 'fix bug', outcome: 'success', tool_calls: 3 },
      { agent: 'claude-code', task: 'broke things', outcome: 'failure', tool_calls: 2 },
    ]
    const result = await batchJudge(entries)
    expect(result.judgments).toHaveLength(2)
    expect(result.judgments[0].effective).toBe(true)   // outcome='success' → effective
    expect(result.judgments[1].effective).toBe(false)   // outcome='failure' → not effective
    expect(result.judgments[0].fallback).toBe(true)
    expect(result.judgments[0].domain).toBe('coder')    // fallback uses routeTask
  })

  it('assigns domain via routeTask as fallback per entry', async () => {
    callLLMWithUsage.mockRejectedValue(new Error('timeout'))
    const entries = [
      { agent: 'claude-code', task: 'write unit tests for auth', outcome: 'success', tool_calls: 4 },
    ]
    const result = await batchJudge(entries)
    expect(result.judgments[0].domain).toBe('tester')  // routeTask should match 'test'
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/batch-judge.test.js`
Expected: FAIL — `Cannot find module '../daemon/pipeline/batch-judge.js'`

- [ ] **Step 3: Implement batch-judge.js**

```js
// quoth-plugin/daemon/pipeline/batch-judge.js
'use strict'

const { callLLMWithUsage } = require('../lib/llm.js')
const { routeTask } = require('../../mcp/lib/routing.js')

const JUDGE_MODEL = 'google/gemini-2.5-flash'

const VALID_DOMAINS = ['coder', 'tester', 'reviewer', 'researcher', 'architect', 'backend-dev', 'frontend-dev', 'devops']

const PROMPT_TEMPLATE = `You are evaluating a batch of AI agent actions for effectiveness and domain classification.

For each entry, determine:
1. Was it effective? (did the action achieve the task?)
2. Which domain does it belong to? Must be one of: ${VALID_DOMAINS.join(', ')}

Entries:
{{entries}}

Respond with ONLY valid JSON (no markdown):
{"judgments": [{"index": 0, "effective": true/false, "domain": "coder|tester|...", "reason": "brief"}]}`

async function batchJudge(entries) {
  const entrySummaries = entries.map((e, i) =>
    `[${i}] Agent: ${e.agent || 'unknown'} | Task: ${(e.task || 'unknown').slice(0, 150)} | Outcome: ${e.outcome || 'unknown'} | Tools: ${e.tool_calls || 0}`
  ).join('\n')

  const prompt = PROMPT_TEMPLATE.replace('{{entries}}', entrySummaries)

  try {
    const response = await callLLMWithUsage(prompt, 50 + entries.length * 40, JUDGE_MODEL)
    const start = response.content.indexOf('{')
    if (start === -1) throw new Error('No JSON in response')
    const parsed = JSON.parse(response.content.slice(start))

    if (!parsed.judgments || !Array.isArray(parsed.judgments)) throw new Error('No judgments array')

    // Validate and normalize
    const judgments = entries.map((entry, i) => {
      const j = parsed.judgments.find(j => j.index === i) || {}
      return {
        index: i,
        effective: Boolean(j.effective),
        domain: VALID_DOMAINS.includes(j.domain) ? j.domain : routeTask(entry.task || '').agent,
        reason: (j.reason || '').slice(0, 100),
      }
    })

    return {
      judgments,
      usage: {
        model: response.model,
        input_tokens: response.input_tokens,
        output_tokens: response.output_tokens,
        estimated_cost_usd: response.estimated_cost_usd,
      }
    }
  } catch {
    // Fallback: use outcome field + routeTask for domain
    return {
      judgments: entries.map((e, i) => ({
        index: i,
        effective: e.outcome === 'success',
        domain: routeTask(e.task || '').agent,
        reason: 'fallback: llm unavailable',
        fallback: true,
      })),
      usage: { model: JUDGE_MODEL, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 },
    }
  }
}

module.exports = { batchJudge, JUDGE_MODEL, VALID_DOMAINS }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/batch-judge.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quoth-plugin/daemon/pipeline/batch-judge.js quoth-plugin/tests/batch-judge.test.js
git commit -m "feat(daemon): batch JUDGE pipeline stage — domain classification + effectiveness gating"
```

---

### Task 3: Wire Batch JUDGE into Daemon Pipeline

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js` (~lines 234-310, 412-446)

- [ ] **Step 1: Add pending judge queue to daemon.js**

At the top of daemon.js (near other state variables ~line 70), add:

```js
const JUDGE_BATCH_SIZE = parseInt(process.env.QUOTH_JUDGE_BATCH_SIZE || '30', 10)
let pendingJudge = []     // accumulated tool_use entries awaiting batch judge
let judgedEffective = []  // entries that passed JUDGE, waiting for distill
```

- [ ] **Step 2: Modify processEntry to accumulate instead of skip**

In `processEntry()` (~line 234), change the `tool_use` handling from marking processed immediately to accumulating:

```js
// Replace lines 244-248 (the "mark tool_use as processed immediately" block) with:
if (entry.event === 'tool_use') {
  const rawProject = entry.project || 'default'
  const project = detectProjectFromTask(entry.task, rawProject)
  pendingJudge.push({ entry, filePath, line, project })

  // Batch judge when threshold reached
  if (pendingJudge.length >= JUDGE_BATCH_SIZE) {
    await flushJudgeQueue()
  }
  return
}
```

- [ ] **Step 3: Add flushJudgeQueue function**

Add after `processEntry()`:

```js
async function flushJudgeQueue() {
  if (pendingJudge.length === 0) return

  const batch = pendingJudge.splice(0)  // drain queue
  const entries = batch.map(b => b.entry)

  log('info', 'Batch judging entries', { count: entries.length })

  const { batchJudge } = require('./pipeline/batch-judge.js')
  const result = await batchJudge(entries)

  // Record cost
  if (result.usage && result.usage.input_tokens > 0) {
    try {
      db.recordPipelineCost({
        stage: 'judge-batch',
        model: result.usage.model,
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        estimated_cost_usd: result.usage.estimated_cost_usd,
        batch_size: entries.length,
        session_id: entries[0]?.session || null,
        project: batch[0]?.project || null,
      })
    } catch {}
  }

  let effectiveCount = 0
  for (let i = 0; i < result.judgments.length; i++) {
    const j = result.judgments[i]
    const b = batch[i]

    if (j.effective) {
      // Store effective entries with domain for later distill
      judgedEffective.push({ ...b, domain: j.domain })
      effectiveCount++
    } else {
      // Mark ineffective entries as processed
      markProcessed(b.filePath, b.line)
    }
  }

  log('info', 'Batch judge complete', { effective: effectiveCount, discarded: entries.length - effectiveCount })
}
```

- [ ] **Step 4: Wire SIGUSR1 to flush judge queue before batch distill**

Find the existing SIGUSR1 handler in daemon.js (search for `SIGUSR1`). Modify it to flush the judge queue first:

```js
// In the SIGUSR1 handler, add before existing logic:
await flushJudgeQueue()
```

- [ ] **Step 5: Modify processSessionBatch to use judgedEffective entries**

In `processSessionBatch()` (~line 256), after reading toolEntries from the JSONL file, merge in judgedEffective entries and their domain data:

```js
// After toolEntries is populated (~line 279), add:
// Merge in judged-effective entries from the batch queue for this session
const sessionJudged = judgedEffective.filter(j => j.entry.session === sessionId)
judgedEffective = judgedEffective.filter(j => j.entry.session !== sessionId)

// Use judged entries if available, otherwise fall back to file entries
const effectiveEntries = sessionJudged.length > 0
  ? sessionJudged.map(j => ({ ...j.entry, _domain: j.domain }))
  : toolEntries  // fallback: no judge data (e.g. old format)
```

Pass `effectiveEntries` to `distillBatch()` instead of `toolEntries`.

- [ ] **Step 6: Pass domain data through to pattern insert**

In `insertNewPattern()` (~line 431), add agent-type tags from the domain data:

```js
// Compute dominant domains from the effective entries
// This needs to be passed through from processSessionBatch
// Add parameter: insertNewPattern(distilled, summaryEntry, project, domains)

// In the tags array at line 431:
tags: [
  ...distilled.tags,
  ...(domains || []).map(d => `agent:${d}`),
  ...(project !== 'default' ? [`project:${project}`] : []),
  'batch-distilled'
],
```

Compute `domains` in `processSessionBatch` from the judged entries:

```js
// After effectiveEntries is built, compute dominant domains
const domainCounts = {}
for (const e of effectiveEntries) {
  const d = e._domain || 'coder'
  domainCounts[d] = (domainCounts[d] || 0) + 1
}
const totalEntries = effectiveEntries.length
const dominantDomains = Object.entries(domainCounts)
  .filter(([, count]) => count / totalEntries > 0.3)
  .map(([domain]) => domain)
  .slice(0, 2)
```

Pass `dominantDomains` through `applyDistilledPattern` → `insertNewPattern`.

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add quoth-plugin/daemon/daemon.js
git commit -m "feat(daemon): wire batch JUDGE into pipeline — accumulate, judge, gate distill"
```

---

### Task 4: Tag-Filtered Injection

**Files:**
- Modify: `quoth-plugin/daemon/lib/query-server.js` (~line 137-237)
- Modify: `quoth-plugin/hooks/hook-dispatch.js` (~lines 147-259, 590-624)
- Create: `quoth-plugin/tests/injection-tags.test.js`

- [ ] **Step 1: Write failing test for tag-filtered injection**

```js
// tests/injection-tags.test.js
import { describe, it, expect, beforeEach } from 'vitest'

let db
beforeEach(() => {
  db = require('../daemon/db.js').createDb(':memory:')
  // Insert patterns with agent tags
  db.upsertPattern({ id: 'p1', name: 'debug technique', pattern_type: 'code-pattern', condition: 'task', action: 'debug approach', confidence: 0.8, tags: ['agent:coder', 'debugging'] })
  db.upsertPattern({ id: 'p2', name: 'test strategy', pattern_type: 'code-pattern', condition: 'task', action: 'test strategy', confidence: 0.8, tags: ['agent:tester', 'testing'] })
  db.upsertPattern({ id: 'p3', name: 'review checklist', pattern_type: 'code-pattern', condition: 'task', action: 'review approach', confidence: 0.8, tags: ['agent:reviewer', 'review'] })
})

describe('tag-filtered pattern retrieval', () => {
  it('getTopPatterns filters by agent tag', () => {
    const results = db.getTopPatterns(5, ['agent:coder'])
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('p1')
  })

  it('getTopPatterns returns all when no tags', () => {
    const results = db.getTopPatterns(5, [])
    expect(results).toHaveLength(3)
  })

  it('getTopPatterns handles unknown agent tag gracefully', () => {
    const results = db.getTopPatterns(5, ['agent:devops'])
    expect(results).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it passes (existing infra)**

Run: `npm test -- tests/injection-tags.test.js`
Expected: PASS — the tag filtering already works in db.js. This confirms the existing infra.

- [ ] **Step 3: Add tags parameter to query server**

In `quoth-plugin/daemon/lib/query-server.js`, line 138, add `tags` to destructured params:

```js
const { prompt, project, session_id, limit = 7, type = 'route+inject', tags = [] } = body
```

In the injection section (~line 172), pass tags to search:

```js
// V2 path (line 172): change empty array to tags param
const candidates = db.searchBySimilarity(embedding, 20, tags)

// V1 path (line 184): pass tags to rankByThompsonAndTrigram
// This requires adding tags support to the function signature
patterns = rankByThompsonAndTrigram(db, ns, prompt, limit, {
  minConfidence: 0.3,
  excludeRecentMinutes: 2,
  tags,
})
```

- [ ] **Step 4: Add tags support to rankByThompsonAndTrigram in injection.js**

In `quoth-plugin/daemon/lib/injection.js`, modify the function to accept and pass tags:

```js
// In the options destructuring, add tags:
function rankByThompsonAndTrigram(db, namespace, queryText, limit = 5, { minConfidence, excludeRecentMinutes, tags } = {}) {
  // When fetching candidates, pass tags to the DB query
  // Modify the internal call that fetches patterns to use tags
}
```

- [ ] **Step 5: Modify subagent-start handler**

In `quoth-plugin/hooks/hook-dispatch.js`, the `subagent-start` handler (~line 598-601):

```js
// Change from:
const resp = await queryDaemon({
  prompt: [taskText, agentType].filter(Boolean).join(' ') || 'subagent task',
  project, session_id: sessionId, limit: 5, type: 'inject'
})

// To:
const agentTag = agentType ? [`agent:${agentType}`] : []
let resp = await queryDaemon({
  prompt: taskText || 'subagent task',
  project, session_id: sessionId, limit: 5, type: 'inject',
  tags: agentTag,
})

// Fallback: if too few results with tag filter, retry without
if (agentTag.length > 0 && (resp.patterns || []).length < 2) {
  resp = await queryDaemon({
    prompt: taskText || 'subagent task',
    project, session_id: sessionId, limit: 5, type: 'inject',
    tags: [],
  })
}
```

- [ ] **Step 6: Modify route handler**

In the `route` handler (~line 186-189), after routing decision is made, pass agent tag:

```js
// The daemon query already includes routing. But the injection happens in the same call.
// Modify the queryDaemon call to include tags:
const resp = await queryDaemon({
  prompt, project, session_id: sessionId, limit: 5,
  type: 'route+inject',
  tags: [],  // Don't filter on route — we want broad patterns for the user prompt
})
// Note: route handler should NOT filter by agent tag since the routing decision
// itself is what's being shown. Filtering would create a circular dependency.
// Only subagent-start benefits from filtering.
```

Actually, on reflection: the route handler should NOT filter by agent tag. The routing decision is being made in the same call, and the patterns shown are for the human to see context — not for agent injection. Only `subagent-start` benefits from domain filtering.

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add quoth-plugin/daemon/lib/query-server.js quoth-plugin/hooks/hook-dispatch.js quoth-plugin/daemon/lib/injection.js quoth-plugin/tests/injection-tags.test.js
git commit -m "feat(injection): tag-filtered pattern injection — subagent-start uses agent:<type> tags"
```

---

### Task 5: Type Unification + Cleanup

**Files:**
- Modify: `quoth-plugin/mcp/lib/routing.js` (add canonical export)
- Delete: `agents/coder.yaml`, `agents/architect.yaml`, `agents/reviewer.yaml`, `agents/security-architect.yaml`, `agents/tester.yaml`
- Modify: `quoth-plugin/daemon/pipeline/judge.js` (update categories comment)

- [ ] **Step 1: Export canonical agent types from routing.js**

Add to `quoth-plugin/mcp/lib/routing.js` after the `AGENT_CAPABILITIES` object:

```js
/**
 * Canonical agent role types. Single source of truth for:
 * - Task routing (routeTask)
 * - Batch JUDGE domain classification
 * - Pattern agent:<type> tags
 * - Injection tag filtering
 *
 * NOT the same as MCP agent_register types (claude-code, openclaw, daemon, worker)
 * which classify the platform/runtime, not the domain role.
 */
const AGENT_TYPES = Object.keys(AGENT_CAPABILITIES)
```

Add to exports: `module.exports = { routeTask, getAlternatives, AGENT_CAPABILITIES, AGENT_TYPES }`

- [ ] **Step 2: Delete dead agent YAML files**

```bash
rm agents/coder.yaml agents/architect.yaml agents/reviewer.yaml agents/security-architect.yaml agents/tester.yaml
rmdir agents/
```

- [ ] **Step 3: Update batch-judge.js to import VALID_DOMAINS from routing.js**

In `quoth-plugin/daemon/pipeline/batch-judge.js`, replace the hardcoded `VALID_DOMAINS`:

```js
// Replace:
const VALID_DOMAINS = ['coder', 'tester', 'reviewer', 'researcher', 'architect', 'backend-dev', 'frontend-dev', 'devops']

// With:
const { AGENT_TYPES: VALID_DOMAINS } = require('../../mcp/lib/routing.js')
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add quoth-plugin/mcp/lib/routing.js quoth-plugin/daemon/pipeline/batch-judge.js
git rm agents/coder.yaml agents/architect.yaml agents/reviewer.yaml agents/security-architect.yaml agents/tester.yaml
git commit -m "refactor: unify agent types — routing.js canonical, delete dead YAML stubs"
```

---

### Task 6: Extend daemon_status with Cost Summary

**Files:**
- Modify: `quoth-plugin/mcp/handlers/agents.js` (daemon_status handler)

- [ ] **Step 1: Add cost summary to daemon_status response**

In `quoth-plugin/mcp/handlers/agents.js`, in the `quoth_daemon_status` handler, add cost data:

```js
// After existing status checks, add:
let costSummary = null
try {
  costSummary = {
    today: db.getCostSummary('today'),
    week: db.getCostSummary('week'),
    all_time: db.getCostSummary(),
  }
} catch {}
// Include in response
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add quoth-plugin/mcp/handlers/agents.js
git commit -m "feat(mcp): expose pipeline cost summary in quoth_daemon_status"
```

---

### Task 7: Update Documentation + Presentation

**Files:**
- Modify: `CLAUDE.md` (update CONSOLIDATE model, mention batch JUDGE, agent-type tags)
- Modify: `docs/presentations/quoth-product-overview.html` (update pipeline section)

- [ ] **Step 1: Update CLAUDE.md pipeline description**

Update the daemon pipeline section to reflect:
- Batch JUDGE stage (gemini-2.5-flash, batches of 30)
- Domain classification in JUDGE
- Agent-type tags on patterns
- Cost tracking
- Delete references to Kimi K2.5

- [ ] **Step 2: Update presentation pipeline section**

In `docs/presentations/quoth-product-overview.html`, the pipeline flow section already has JUDGE → DISTILL → CONSOLIDATE. Update:
- JUDGE model tag: `Gemini 2.5 Flash`
- DISTILL model tag: `Gemini 2.5 Flash Lite`
- CONSOLIDATE model tag: already fixed to `Claude Haiku 4.5`
- Add "Batch of 30" note to JUDGE card

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/presentations/quoth-product-overview.html
git commit -m "docs: update pipeline docs — batch JUDGE, agent-type tags, cost tracking"
```

---

### Task 8: Integration Test

**Files:**
- Modify: `quoth-plugin/tests/integration.test.js`

- [ ] **Step 1: Add integration test for the full pipeline flow**

Add a test that verifies the end-to-end flow: entries accumulate → batch judge → effective entries get distilled → patterns have agent tags → tag-filtered search works.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All 190+ tests PASS (original 181 + new tests)

- [ ] **Step 3: Final commit**

```bash
git add quoth-plugin/tests/integration.test.js
git commit -m "test: integration test for batch JUDGE → DISTILL → tagged injection pipeline"
```
