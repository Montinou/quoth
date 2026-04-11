# EXTRACT Pipeline — Phase 1A: Core Pipeline Replacement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-stage JUDGE->DISTILL->CONSOLIDATE pipeline with a single EXTRACT LLM call. Patterns become richer (100-200 chars with context), carry a quality_signal for Bayesian priors, and errors are never silent.

**Architecture:** One new file (`pipeline/extract.js`) replaces five deleted files. `daemon.js` is simplified: no more `pendingJudge[]` accumulation, no `flushJudgeQueue()`, no `consolidate()` call. Dedup is embedding-only (configurable threshold). Quality signal maps to initial alpha/beta via a categorical lookup table.

**Tech Stack:** Node.js, `claude -p` Sonnet (primary, $0), Gemini 2.5 Flash via AI Gateway (fallback), MiniLM-L6 384d embeddings, SQLite

**Spec:** `docs/superpowers/specs/2026-04-09-intent-outcome-temporal.md` — Phases 1A sections

**Prerequisite:** Phase 0 must be completed first (dedup threshold validated)

---

## File Structure

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `quoth-plugin/daemon/db.js` | Add `pipeline_errors` table, `format_version` column, configurable dedup threshold |
| Create | `quoth-plugin/daemon/pipeline/extract.js` | Single EXTRACT stage replacing JUDGE+DISTILL+CONSOLIDATE |
| Modify | `quoth-plugin/daemon/daemon.js` | Remove old pipeline wiring, connect EXTRACT, simplify state |
| Delete | `quoth-plugin/daemon/pipeline/batch-judge.js` | JUDGE stage removed |
| Delete | `quoth-plugin/daemon/pipeline/judge.js` | Individual JUDGE removed |
| Delete | `quoth-plugin/daemon/pipeline/consolidate.js` | CONSOLIDATE stage removed |
| Delete | `quoth-plugin/daemon/pipeline/distill.js` | Individual DISTILL removed |
| Delete | `quoth-plugin/daemon/pipeline/distill-batch.js` | Batch DISTILL removed |
| Create | `quoth-plugin/tests/extract.test.js` | Tests for EXTRACT stage |
| Modify | `quoth-plugin/tests/db.test.js` | Tests for new schema + helpers |
| Delete | `quoth-plugin/tests/batch-judge.test.js` | Tests for deleted JUDGE batch |
| Delete | `quoth-plugin/tests/judge.test.js` | Tests for deleted individual JUDGE |
| Delete | `quoth-plugin/tests/consolidate.test.js` | Tests for deleted CONSOLIDATE |
| Delete | `quoth-plugin/tests/distill.test.js` | Tests for deleted individual DISTILL |

**NOT deleted (different purpose, preserved):**
- `quoth-plugin/daemon/lib/judge.js` — pairwise LLM-as-Judge for V2 cluster uncertainty (used by `enqueueJudgePairs()` + `runJudgeBatch()` in nightly/V2 mini-pipeline)
- `quoth-plugin/tests/judge-v2.test.js` — tests for pairwise judge

---

### Task 1: DB — Add pipeline_errors table + insertPipelineError()

**Files:**
- Modify: `quoth-plugin/daemon/db.js` (after line ~331, pipeline_costs section)
- Modify: `quoth-plugin/tests/db.test.js`

- [ ] **Step 1: Write the failing test**

Add to `quoth-plugin/tests/db.test.js`:

```js
describe('pipeline_errors', () => {
  it('insertPipelineError stores error with all fields', () => {
    db.insertPipelineError({
      stage: 'extract',
      error_message: 'JSON parse failed',
      error_stack: 'Error: JSON parse failed\n  at extract.js:42',
      context: JSON.stringify({ session_id: 'sess-1', model: 'claude-sonnet' }),
      model_attempted: 'claude-sonnet-4-6',
      fallback_attempted: 1,
      fallback_succeeded: 0,
    })

    const rows = db.prepare('SELECT * FROM pipeline_errors').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].stage).toBe('extract')
    expect(rows[0].error_message).toBe('JSON parse failed')
    expect(rows[0].model_attempted).toBe('claude-sonnet-4-6')
    expect(rows[0].fallback_attempted).toBe(1)
    expect(rows[0].fallback_succeeded).toBe(0)
    expect(rows[0].created_at).toBeGreaterThan(0)
  })

  it('insertPipelineError works with minimal fields', () => {
    db.insertPipelineError({
      stage: 'embed',
      error_message: 'Model load failed',
    })
    const rows = db.prepare('SELECT * FROM pipeline_errors').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].error_stack).toBeNull()
    expect(rows[0].fallback_attempted).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd quoth-plugin && npx vitest run tests/db.test.js -t "pipeline_errors"`
Expected: FAIL — `db.insertPipelineError is not a function`

- [ ] **Step 3: Add pipeline_errors table and helper to db.js**

In `quoth-plugin/daemon/db.js`, after the `pipeline_costs` table creation (~line 331), add:

```js
  // --- pipeline_errors table for error visibility ---
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stage TEXT NOT NULL,
        error_message TEXT NOT NULL,
        error_stack TEXT,
        context TEXT,
        model_attempted TEXT,
        fallback_attempted INTEGER DEFAULT 0,
        fallback_succeeded INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_errors_stage ON pipeline_errors(stage);
      CREATE INDEX IF NOT EXISTS idx_pipeline_errors_created ON pipeline_errors(created_at DESC);
    `)
  } catch (e) { console.error('[db] pipeline_errors create failed:', e.message) }
```

Add the helper method after the existing `db.recordPipelineCost` method:

```js
  db.insertPipelineError = function(err) {
    db.prepare(`
      INSERT INTO pipeline_errors (stage, error_message, error_stack, context,
        model_attempted, fallback_attempted, fallback_succeeded)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      err.stage,
      err.error_message,
      err.error_stack || null,
      err.context || null,
      err.model_attempted || null,
      err.fallback_attempted || 0,
      err.fallback_succeeded || 0,
    )
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd quoth-plugin && npx vitest run tests/db.test.js -t "pipeline_errors"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd quoth-plugin && npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
cd quoth-plugin
git add daemon/db.js tests/db.test.js
git commit -m "feat(db): add pipeline_errors table + insertPipelineError helper"
```

---

### Task 2: DB — Add format_version column migration

**Files:**
- Modify: `quoth-plugin/daemon/db.js` (migrations section, ~line 160)
- Modify: `quoth-plugin/tests/db.test.js`

- [ ] **Step 1: Write the failing test**

Add to `quoth-plugin/tests/db.test.js`:

```js
describe('format_version', () => {
  it('patterns table has format_version column defaulting to 1', () => {
    db.upsertPattern({
      id: 'test-fv',
      name: 'test pattern',
      condition: 'test',
      action: 'test action',
      confidence: 0.5,
      tags: [],
      source: 'distilled',
    })

    const row = db.prepare('SELECT format_version FROM patterns WHERE id = ?').get('test-fv')
    expect(row.format_version).toBe(1)
  })

  it('format_version can be set to 2 for new-format patterns', () => {
    db.upsertPattern({
      id: 'test-fv2',
      name: 'rich pattern with context',
      condition: 'test',
      action: 'rich pattern text',
      confidence: 0.67,
      tags: [],
      source: 'distilled',
    })
    db.prepare('UPDATE patterns SET format_version = 2 WHERE id = ?').run('test-fv2')

    const row = db.prepare('SELECT format_version FROM patterns WHERE id = ?').get('test-fv2')
    expect(row.format_version).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd quoth-plugin && npx vitest run tests/db.test.js -t "format_version"`
Expected: FAIL — `no such column: format_version`

- [ ] **Step 3: Add format_version column migration to db.js**

In `quoth-plugin/daemon/db.js`, in the migrations section (after exposure tracking columns, ~line 159), add:

```js
  // Runtime migration: format_version for v3.4→v4 pattern format coexistence
  try { db.prepare("ALTER TABLE patterns ADD COLUMN format_version INTEGER NOT NULL DEFAULT 1").run() } catch {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd quoth-plugin && npx vitest run tests/db.test.js -t "format_version"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd quoth-plugin && npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
cd quoth-plugin
git add daemon/db.js tests/db.test.js
git commit -m "feat(db): add format_version column migration for v4 pattern format"
```

---

### Task 3: DB — Configurable dedup threshold

**Files:**
- Modify: `quoth-plugin/daemon/db.js:416-430` (`findDuplicateByEmbedding`)
- Modify: `quoth-plugin/tests/db.test.js`

- [ ] **Step 1: Write the failing test**

Add to `quoth-plugin/tests/db.test.js`:

```js
describe('findDuplicateByEmbedding configurable threshold', () => {
  it('uses QUOTH_DEDUP_THRESHOLD env var when set', () => {
    // Insert a pattern with a known embedding
    const vec = Array(384).fill(0)
    vec[0] = 1.0
    db.upsertPattern({
      id: 'dedup-test-1',
      name: 'test pattern',
      condition: 'test',
      action: 'test',
      confidence: 0.5,
      tags: [],
      embedding: JSON.stringify(vec),
    })

    // Create a slightly different vector (high similarity ~0.95 but below 1.0)
    const query = Array(384).fill(0)
    query[0] = 0.98
    query[1] = 0.2

    // With high threshold (0.99) → should NOT find duplicate
    process.env.QUOTH_DEDUP_THRESHOLD = '0.99'
    const noDup = db.findDuplicateByEmbedding(query)
    expect(noDup).toBeNull()

    // With low threshold (0.80) → should find duplicate
    process.env.QUOTH_DEDUP_THRESHOLD = '0.80'
    const yesDup = db.findDuplicateByEmbedding(query)
    expect(yesDup).not.toBeNull()
    expect(yesDup.id).toBe('dedup-test-1')

    // Cleanup
    delete process.env.QUOTH_DEDUP_THRESHOLD
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd quoth-plugin && npx vitest run tests/db.test.js -t "configurable threshold"`
Expected: FAIL — threshold is hardcoded to 0.92, env var ignored

- [ ] **Step 3: Modify findDuplicateByEmbedding to read env var**

In `quoth-plugin/daemon/db.js`, change the `findDuplicateByEmbedding` function (line ~416):

Replace:
```js
  db.findDuplicateByEmbedding = function(embedding, threshold = 0.92) {
```

With:
```js
  db.findDuplicateByEmbedding = function(embedding, threshold) {
    threshold = threshold ?? parseFloat(process.env.QUOTH_DEDUP_THRESHOLD || '0.92')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd quoth-plugin && npx vitest run tests/db.test.js -t "configurable threshold"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd quoth-plugin && npx vitest run`
Expected: All existing tests still pass (default threshold unchanged at 0.92)

- [ ] **Step 6: Commit**

```bash
cd quoth-plugin
git add daemon/db.js tests/db.test.js
git commit -m "feat(db): configurable dedup threshold via QUOTH_DEDUP_THRESHOLD env var"
```

---

### Task 4: Create pipeline/extract.js

**Files:**
- Create: `quoth-plugin/daemon/pipeline/extract.js`
- Create: `quoth-plugin/tests/extract.test.js`

- [ ] **Step 1: Write the failing test**

Create `quoth-plugin/tests/extract.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import childProcess from 'child_process'

beforeEach(() => {
  vi.spyOn(childProcess, 'execSync')
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const { extract, makeId, QUALITY_MAP, QUALITY_PRIORS } = require('../daemon/pipeline/extract.js')

// Note: extract.js uses `childProcess.execSync(...)` (module reference, not destructured),
// so vi.spyOn(childProcess, 'execSync') intercepts calls correctly.

// Mock db with insertPipelineError and recordPipelineCost
function mockDb() {
  return {
    insertPipelineError: vi.fn(),
    recordPipelineCost: vi.fn(),
  }
}

const SUMMARY = {
  project: 'quoth',
  outcome: 'success',
  success_rate: 0.9,
  user_intents: ['refactor auth module'],
  task: 'Session: 15 tool calls (Bash:8, Edit:4, Read:3). 14 ok, 1 fail.',
  session: 'sess-123',
}

const TOOL_ENTRIES = [
  { tool: 'Read', task: 'Read auth.js', outcome: 'success', llm_reasoning: 'Need to understand current auth flow' },
  { tool: 'Edit', task: 'Edit auth.js', outcome: 'success', llm_reasoning: 'Refactoring to middleware pattern' },
  { tool: 'Bash', task: 'Run npm test', outcome: 'success', llm_reasoning: 'Verify changes pass tests' },
]

describe('extract', () => {
  describe('makeId', () => {
    it('generates stable SHA1-based ID from pattern text', () => {
      const id1 = makeId('When refactoring auth, read all middleware files first')
      const id2 = makeId('When refactoring auth, read all middleware files first')
      expect(id1).toBe(id2)
      expect(id1).toHaveLength(12)
      expect(id1).toMatch(/^[a-f0-9]+$/)
    })

    it('different text produces different ID', () => {
      const id1 = makeId('pattern A')
      const id2 = makeId('pattern B')
      expect(id1).not.toBe(id2)
    })
  })

  describe('QUALITY_MAP', () => {
    it('maps categorical labels to numeric scores', () => {
      expect(QUALITY_MAP.universal).toBe(0.9)
      expect(QUALITY_MAP.domain).toBe(0.7)
      expect(QUALITY_MAP.project).toBe(0.5)
      expect(QUALITY_MAP.edge_case).toBe(0.3)
    })
  })

  describe('QUALITY_PRIORS', () => {
    it('maps categorical labels to initial alpha/beta', () => {
      expect(QUALITY_PRIORS.universal).toEqual({ alpha: 3, beta: 1 })
      expect(QUALITY_PRIORS.domain).toEqual({ alpha: 2, beta: 1 })
      expect(QUALITY_PRIORS.project).toEqual({ alpha: 1, beta: 1 })
      expect(QUALITY_PRIORS.edge_case).toEqual({ alpha: 1, beta: 2 })
    })
  })

  describe('extract() — primary model (claude -p)', () => {
    it('happy path: productive session returns patterns', async () => {
      childProcess.execSync.mockReturnValue(JSON.stringify({
        session_type: 'productive',
        patterns: [
          {
            pattern: 'When refactoring across multiple files in a monorepo, read all target files in parallel before making batch edits to ensure consistency',
            tags: ['refactoring', 'workflow'],
            intention: 'Ensure consistent refactoring across files',
            quality_signal: 'domain',
          },
        ],
      }))

      const db = mockDb()
      const result = await extract(SUMMARY, TOOL_ENTRIES, db)

      expect(result).toHaveLength(1)
      expect(result[0].pattern).toContain('refactoring across multiple files')
      expect(result[0].tags).toContain('refactoring')
      expect(result[0].intention).toBe('Ensure consistent refactoring across files')
      expect(result[0].quality_signal).toBe('domain')
      expect(result[0].id).toHaveLength(12)
      expect(result[0].source).toBe('distilled')
      // Embedding is null because we don't mock the embed module
      expect(result[0].embedding).toBeNull()
    })

    it('routine session returns empty array', async () => {
      childProcess.execSync.mockReturnValue(JSON.stringify({
        session_type: 'routine',
        patterns: [],
      }))

      const result = await extract(SUMMARY, TOOL_ENTRIES, mockDb())
      expect(result).toHaveLength(0)
    })

    it('returns 0 patterns when LLM says none are genuinely reusable', async () => {
      childProcess.execSync.mockReturnValue(JSON.stringify({
        session_type: 'productive',
        patterns: [],
      }))

      const result = await extract(SUMMARY, TOOL_ENTRIES, mockDb())
      expect(result).toHaveLength(0)
    })

    it('filters out patterns shorter than 20 chars', async () => {
      childProcess.execSync.mockReturnValue(JSON.stringify({
        session_type: 'productive',
        patterns: [
          { pattern: 'Too short', tags: [], intention: '', quality_signal: 'project' },
          {
            pattern: 'When debugging intermittent test failures, isolate the failing test first with .only then add verbose logging',
            tags: ['debugging'],
            intention: 'Fix flaky test',
            quality_signal: 'universal',
          },
        ],
      }))

      const result = await extract(SUMMARY, TOOL_ENTRIES, mockDb())
      expect(result).toHaveLength(1)
      expect(result[0].quality_signal).toBe('universal')
    })

    it('normalizes invalid quality_signal to "project"', async () => {
      childProcess.execSync.mockReturnValue(JSON.stringify({
        session_type: 'productive',
        patterns: [
          {
            pattern: 'Pattern with invalid quality signal that should be normalized to project default',
            tags: [],
            intention: '',
            quality_signal: 'legendary',
          },
        ],
      }))

      const result = await extract(SUMMARY, TOOL_ENTRIES, mockDb())
      expect(result).toHaveLength(1)
      expect(result[0].quality_signal).toBe('project')
    })

    it('caps tags at 5 per pattern', async () => {
      childProcess.execSync.mockReturnValue(JSON.stringify({
        session_type: 'productive',
        patterns: [
          {
            pattern: 'A pattern with way too many tags for any reasonable extraction scenario to produce',
            tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
            intention: '',
            quality_signal: 'project',
          },
        ],
      }))

      const result = await extract(SUMMARY, TOOL_ENTRIES, mockDb())
      expect(result[0].tags).toHaveLength(5)
    })
  })

  describe('extract() — primary failure + fallback', () => {
    it('logs primary error to pipeline_errors when claude -p fails', async () => {
      childProcess.execSync.mockImplementation(() => { throw new Error('claude not found') })

      const db = mockDb()
      // Fallback also fails (no API key in test env)
      const result = await extract(SUMMARY, TOOL_ENTRIES, db)

      // Primary error logged
      expect(db.insertPipelineError).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'extract',
          error_message: expect.stringContaining('claude not found'),
          model_attempted: 'claude-sonnet-4-6',
          fallback_attempted: 1,
        })
      )
      // Both failed → empty result
      expect(result).toHaveLength(0)
    })
  })

  describe('extract() — JSON parse failure', () => {
    it('logs parse error and returns empty on invalid JSON', async () => {
      childProcess.execSync.mockReturnValue('This is not JSON at all, just random text')

      const db = mockDb()
      const result = await extract(SUMMARY, TOOL_ENTRIES, db)

      expect(result).toHaveLength(0)
      expect(db.insertPipelineError).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'extract',
          error_message: expect.stringContaining('parse'),
        })
      )
    })
  })

  describe('extract() — multiple patterns', () => {
    it('returns all valid patterns from a productive session', async () => {
      childProcess.execSync.mockReturnValue(JSON.stringify({
        session_type: 'productive',
        patterns: [
          {
            pattern: 'When refactoring auth middleware, read all route handlers first to understand the dependency chain before making changes',
            tags: ['refactoring', 'architecture'],
            intention: 'Safe middleware refactoring',
            quality_signal: 'domain',
          },
          {
            pattern: 'For debugging intermittent test failures, isolate the failing test first with .only, then add verbose logging to setup and teardown hooks',
            tags: ['debugging', 'testing'],
            intention: 'Diagnose flaky tests',
            quality_signal: 'universal',
          },
        ],
      }))

      const result = await extract(SUMMARY, TOOL_ENTRIES, mockDb())
      expect(result).toHaveLength(2)
      expect(result[0].quality_signal).toBe('domain')
      expect(result[1].quality_signal).toBe('universal')
      // Each has a unique ID
      expect(result[0].id).not.toBe(result[1].id)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd quoth-plugin && npx vitest run tests/extract.test.js`
Expected: FAIL — module `../daemon/pipeline/extract.js` not found

- [ ] **Step 3: Write the extract.js module**

Create `quoth-plugin/daemon/pipeline/extract.js`:

```js
'use strict'

const crypto = require('crypto')
const childProcess = require('child_process')

/**
 * EXTRACT: Single-stage pipeline replacing JUDGE + DISTILL + CONSOLIDATE.
 *
 * Primary model: claude -p Sonnet --effort low ($0, Max plan)
 * Fallback model: Gemini 2.5 Flash via AI Gateway (~$0.003)
 *
 * Returns 0-N patterns with rich context, intention, and quality_signal.
 * Errors are always logged to pipeline_errors table (never silent).
 */

const QUALITY_MAP = {
  universal: 0.9,
  domain: 0.7,
  project: 0.5,
  edge_case: 0.3,
}

const QUALITY_PRIORS = {
  universal: { alpha: 3, beta: 1 },
  domain: { alpha: 2, beta: 1 },
  project: { alpha: 1, beta: 1 },
  edge_case: { alpha: 1, beta: 2 },
}

function makeId(content) {
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 12)
}

function buildPrompt(summaryEntry, recentTools) {
  const toolSummary = (summaryEntry.task || 'unknown').slice(0, 200)
  const successRate = Math.round((summaryEntry.success_rate || 0) * 100)
  const outcome = summaryEntry.outcome || 'unknown'
  const intents = (summaryEntry.user_intents || [])
    .filter(i => i && i.length > 5)
    .slice(0, 5)
    .join(' -> ') || 'Not captured'

  const actions = recentTools.map((e, i) => {
    const parts = [`${i + 1}. [${e.tool}] ${(e.task || '').slice(0, 100)}`]
    if (e.llm_reasoning) parts.push(`   Why: ${e.llm_reasoning.slice(0, 120)}`)
    if (e.outcome === 'failure') parts.push(`   FAILED`)
    return parts.join('\n')
  }).join('\n')

  return `You are analyzing a coding session to extract reusable patterns.

SESSION:
- Project: ${summaryEntry.project || 'unknown'}
- Outcome: ${outcome} (success rate: ${successRate}%)
- User intent: ${intents}
- Tools used: ${toolSummary}

RECENT ACTIONS (chronological):
${actions || 'No actions captured'}

TASK:
1. Was this session productive or routine? Routine sessions (just reading files,
   standard edits) produce NO patterns. Only extract from sessions where a genuine
   technique or workflow emerged.
   (Note: deduplication against existing patterns is handled at write time via
   embedding similarity — do NOT spend prompt tokens listing existing patterns here)

2. For productive sessions, extract EVERY relevant pattern. No minimum, no maximum.
   Each pattern must be:
   - A reusable technique/workflow, NOT a specific file path or command
   - Rich enough to match similar future situations via embedding search
   - Include context: when/why to use this approach
   - Include intention: what problem it solves

3. For each pattern, assess reusability using ONE of these labels:
   - "universal": technique applicable across any project
   - "domain": applicable to similar project types
   - "project": applicable within this specific domain
   - "edge_case": narrow, might be useful occasionally

EXAMPLES of GOOD patterns:
- "When refactoring across multiple files in a monorepo, read all target files in
  parallel before making batch edits to ensure consistency and catch dependencies"
- "For debugging intermittent test failures, isolate the failing test first with
  .only, then add verbose logging to the setup/teardown lifecycle hooks"

EXAMPLES of BAD patterns (do NOT extract these):
- "Read file then edit it" (obvious)
- "Run npm test after changes" (standard practice)
- "Use git commit to save changes" (trivial)

Respond with JSON:
{
  "session_type": "productive" | "routine",
  "patterns": [
    {
      "pattern": "rich description with context and intention (100-200 chars)",
      "tags": ["domain1", "domain2"],
      "intention": "what the user was trying to accomplish",
      "quality_signal": "universal" | "domain" | "project" | "edge_case"
    }
  ]
}

If routine, return {"session_type": "routine", "patterns": []}`
}

function parseJson(raw) {
  let content = (raw || '').replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim()
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON object in LLM response')
  return JSON.parse(content.slice(start, end + 1))
}

/**
 * Extract patterns from a session via single LLM call.
 *
 * @param {Object} summaryEntry - session_summary JSONL entry
 * @param {Object[]} toolEntries - tool_use entries from the same session
 * @param {Object} db - database instance (for error logging)
 * @returns {Promise<Object[]>} Array of pattern objects
 */
async function extract(summaryEntry, toolEntries, db) {
  const recentTools = toolEntries.slice(-30)
  const prompt = buildPrompt(summaryEntry, recentTools)

  let rawOutput
  let model = 'claude-sonnet-4-6'

  // Primary: claude -p Sonnet --effort low ($0)
  try {
    rawOutput = childProcess.execSync(
      'claude -p --model claude-sonnet-4-6 --effort low --output-format text --allowedTools ""',
      {
        input: prompt,
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 512 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )
  } catch (primaryErr) {
    // Log primary failure
    try {
      db.insertPipelineError({
        stage: 'extract',
        error_message: primaryErr.message,
        error_stack: (primaryErr.stack || '').slice(0, 500),
        context: JSON.stringify({
          session_id: summaryEntry.session,
          project: summaryEntry.project,
          entry_count: recentTools.length,
          model: 'claude-sonnet-4-6',
        }),
        model_attempted: 'claude-sonnet-4-6',
        fallback_attempted: 1,
      })
    } catch {}

    // Fallback: Gemini 2.5 Flash via AI Gateway
    try {
      const { callLLMWithUsage } = require('../lib/llm.js')
      const result = await callLLMWithUsage(prompt, 400, 'google/gemini-2.5-flash')
      rawOutput = result.content
      model = 'google/gemini-2.5-flash'

      // Record fallback cost
      try {
        db.recordPipelineCost({
          stage: 'extract',
          model: result.model || model,
          input_tokens: result.input_tokens || 0,
          output_tokens: result.output_tokens || 0,
          estimated_cost_usd: result.estimated_cost_usd || 0,
          batch_size: 1,
          session_id: summaryEntry.session || null,
          project: summaryEntry.project || null,
        })
      } catch {}

      // Mark fallback success
      try {
        db.insertPipelineError({
          stage: 'extract',
          error_message: `Primary failed, fallback succeeded: ${primaryErr.message}`,
          context: JSON.stringify({ session_id: summaryEntry.session, model: 'google/gemini-2.5-flash' }),
          model_attempted: 'claude-sonnet-4-6',
          fallback_attempted: 1,
          fallback_succeeded: 1,
        })
      } catch {}
    } catch (fallbackErr) {
      // Both failed — log and return empty
      try {
        db.insertPipelineError({
          stage: 'extract',
          error_message: `Both models failed. Fallback: ${fallbackErr.message}`,
          error_stack: (fallbackErr.stack || '').slice(0, 500),
          context: JSON.stringify({
            session_id: summaryEntry.session,
            project: summaryEntry.project,
            entry_count: recentTools.length,
            primary_error: primaryErr.message,
          }),
          model_attempted: 'google/gemini-2.5-flash',
          fallback_attempted: 1,
          fallback_succeeded: 0,
        })
      } catch {}
      return []
    }
  }

  // Parse JSON response
  let parsed
  try {
    parsed = parseJson(rawOutput)
  } catch (parseErr) {
    try {
      db.insertPipelineError({
        stage: 'extract',
        error_message: `JSON parse failed: ${parseErr.message}`,
        context: JSON.stringify({ output_preview: (rawOutput || '').slice(0, 500), model }),
        model_attempted: model,
      })
    } catch {}
    return []
  }

  // Short-circuit routine sessions
  if (parsed.session_type === 'routine' || !parsed.patterns || !Array.isArray(parsed.patterns)) {
    return []
  }

  // Filter valid patterns (100-300 chars, has text)
  const validPatterns = parsed.patterns.filter(p =>
    p.pattern && p.pattern.length >= 20 && p.pattern.length <= 300
  )
  if (validPatterns.length === 0) return []

  // Batch embed pattern texts (pattern text ONLY, not concatenated with intention)
  let embeddings = validPatterns.map(() => null)
  try {
    const { generateEmbeddingBatch } = require('../lib/embed.js')
    embeddings = await generateEmbeddingBatch(validPatterns.map(p => p.pattern))
  } catch (embedErr) {
    try {
      db.insertPipelineError({
        stage: 'embed',
        error_message: embedErr.message,
        context: JSON.stringify({ pattern_count: validPatterns.length }),
        model_attempted: 'MiniLM-L6-v2',
      })
    } catch {}
  }

  return validPatterns.map((p, i) => ({
    id: makeId(p.pattern),
    pattern: p.pattern,
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 5) : [],
    intention: p.intention || '',
    quality_signal: QUALITY_MAP[p.quality_signal] ? p.quality_signal : 'project',
    embedding: embeddings[i],
    source: 'distilled',
  }))
}

module.exports = { extract, makeId, buildPrompt, parseJson, QUALITY_MAP, QUALITY_PRIORS }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd quoth-plugin && npx vitest run tests/extract.test.js`
Expected: PASS — all tests green (primary model mocked via `childProcess.execSync`)

- [ ] **Step 5: Run full test suite**

Run: `cd quoth-plugin && npx vitest run`
Expected: All existing tests still pass (extract.js is standalone, not connected yet)

- [ ] **Step 6: Commit**

```bash
cd quoth-plugin
git add daemon/pipeline/extract.js tests/extract.test.js
git commit -m "feat(pipeline): add EXTRACT stage — single LLM call with quality_signal"
```

---

### Task 5: Rewire daemon.js — remove old pipeline, connect EXTRACT

This task makes all interconnected daemon.js changes atomically. The old pipeline files still exist on disk after this task (deleted in Task 6) but are no longer imported or called.

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js`

- [ ] **Step 1: Remove old imports (lines 31-34)**

Replace:
```js
const { judge } = require('./pipeline/judge.js')
const { distill } = require('./pipeline/distill.js')
const { distillBatch } = require('./pipeline/distill-batch.js')
const { consolidate } = require('./pipeline/consolidate.js')
```

With:
```js
const { extract, QUALITY_PRIORS } = require('./pipeline/extract.js')
```

- [ ] **Step 2: Remove JUDGE state variables (lines 72-74)**

Remove these three lines entirely:
```js
const JUDGE_BATCH_SIZE = parseInt(process.env.QUOTH_JUDGE_BATCH_SIZE || '30', 10)
let pendingJudge = []     // accumulated tool_use entries awaiting batch judge
let judgedEffective = []  // entries that passed JUDGE, waiting for distill
```

Add in their place the EXTRACT daily cap:
```js
const DAILY_EXTRACT_CAP = parseInt(process.env.QUOTH_DAILY_EXTRACT_CAP || process.env.QUOTH_DAILY_DISTILL_CAP || '50', 10)
let dailyExtractCount = 0
let dailyExtractDate = new Date().toISOString().slice(0, 10)
```

- [ ] **Step 3: Remove flushJudgeQueue() from SIGUSR1 handler (lines 109-114)**

Replace:
```js
process.on('SIGUSR1', async () => {
  log('info', 'SIGUSR1: flush triggered')
  await flushJudgeQueue()  // flush pending judge entries before processing sessions
  scanAndEnqueue()
  processQueue()
})
```

With:
```js
process.on('SIGUSR1', async () => {
  log('info', 'SIGUSR1: flush triggered')
  scanAndEnqueue()
  processQueue()
})
```

- [ ] **Step 4: Simplify processEntry() (lines 250-281)**

Replace the entire `processEntry` function with:
```js
async function processEntry({ entry, filePath, line }) {
  try {
    // Only process session_summary entries (EXTRACT pipeline).
    // Individual tool_use entries are consumed as context by EXTRACT
    // when the session_summary arrives.
    if (entry.event === 'session_summary') {
      await processSessionBatch(entry, filePath, line)
      return
    }

    // Don't mark tool_use — processSessionBatch() reads unprocessed
    // tool_use entries from the file when session_summary arrives.
    if (entry.event !== 'tool_use') {
      markProcessed(filePath, line)
    }
  } catch (err) {
    log('error', 'processEntry failed', { error: err.message })
  }
}
```

- [ ] **Step 5: Delete flushJudgeQueue() function entirely (lines 284-327)**

Remove the entire function body from `async function flushJudgeQueue()` through its closing brace. This is ~44 lines.

- [ ] **Step 6: Rewrite processSessionBatch() (lines 330-406)**

Replace the entire function with:
```js
async function processSessionBatch(summaryEntry, filePath, summaryLine) {
  const sessionId = summaryEntry.session
  const project = summaryEntry.project || 'default'
  log('info', 'EXTRACT for session', { session: sessionId, project, tools: summaryEntry.total_calls })

  // Read all tool_use entries from file for this session
  const toolEntries = []
  const toolLines = []
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
    for (const rawLine of lines) {
      try {
        const e = JSON.parse(rawLine)
        if (e.session === sessionId && e.event === 'tool_use' && !e._processed) {
          toolEntries.push(e)
          toolLines.push(rawLine)
        }
      } catch {}
    }
  } catch (err) {
    log('error', 'Failed to read session entries', { error: err.message })
    markProcessed(filePath, summaryLine)
    return
  }

  if (toolEntries.length === 0) {
    log('debug', 'No tool entries for session', { session: sessionId })
    markProcessed(filePath, summaryLine)
    return
  }

  // Daily cap check
  const today = new Date().toISOString().slice(0, 10)
  if (today !== dailyExtractDate) { dailyExtractCount = 0; dailyExtractDate = today }
  if (dailyExtractCount >= DAILY_EXTRACT_CAP) {
    log('info', 'Daily extract cap reached', { count: dailyExtractCount, cap: DAILY_EXTRACT_CAP })
    markProcessed(filePath, summaryLine)
    return
  }
  dailyExtractCount++

  // Mode switch: managed (cloud) vs local
  let extractedPatterns = []
  if (QUOTH_MODE === 'managed') {
    extractedPatterns = await processSessionManaged(summaryEntry, toolEntries, project)
  } else {
    extractedPatterns = await processSessionLocal(summaryEntry, toolEntries)
  }

  log('info', 'EXTRACT produced patterns', { count: extractedPatterns.length, session: sessionId, mode: QUOTH_MODE })

  // Insert patterns into local DB
  for (const pattern of extractedPatterns) {
    try {
      insertNewPattern(pattern, summaryEntry, project)
    } catch (err) {
      log('error', 'Pattern insertion failed', { error: err.message })
    }
  }

  // Mark all entries as processed
  for (const toolLine of toolLines) markProcessed(filePath, toolLine)
  markProcessed(filePath, summaryLine)
}
```

- [ ] **Step 7: Update processSessionLocal() (lines 459-461)**

Replace:
```js
async function processSessionLocal(summaryEntry, toolEntries) {
  return distillBatch(summaryEntry, toolEntries)
}
```

With:
```js
async function processSessionLocal(summaryEntry, toolEntries) {
  const result = await extract(summaryEntry, toolEntries, db)
  // extract() returns flat array (unlike distillBatch which returns {patterns, usage})
  return Array.isArray(result) ? result : []
}
```

- [ ] **Step 8: Remove applyDistilledPattern() (lines 464-505)**

Delete the entire `applyDistilledPattern()` function. It is no longer called — `processSessionBatch()` now calls `insertNewPattern()` directly.

- [ ] **Step 9: Rewrite insertNewPattern() (lines 507-546)**

Replace the entire function with:
```js
function insertNewPattern(distilled, summaryEntry, project) {
  // Pre-insert dedup check
  const dupByName = db.findDuplicateByName(distilled.pattern)
  const dupByEmbed = distilled.embedding
    ? db.findDuplicateByEmbedding(distilled.embedding)
    : null
  const existing = dupByEmbed || dupByName

  if (existing) {
    db.applyBayesianUpdate(existing.id, 'success')
    log('info', 'EXTRACT: deduped -> strengthened', { id: existing.id })
    return
  }

  // Quality signal -> initial alpha/beta
  const priors = QUALITY_PRIORS[distilled.quality_signal] || QUALITY_PRIORS.project
  const confidence = priors.alpha / (priors.alpha + priors.beta)

  db.upsertPattern({
    id: distilled.id,
    name: distilled.pattern.slice(0, 200),
    pattern_type: 'code-pattern',
    condition: `Session: ${(summaryEntry.task || '').slice(0, 100)}`,
    action: distilled.pattern,
    confidence,
    tags: [
      ...(distilled.tags || []),
      ...(project !== 'default' ? [`project:${project}`] : []),
      'extracted',
    ],
    source: 'distilled',
    embedding: distilled.embedding ? JSON.stringify(distilled.embedding) : undefined,
  })

  // Set alpha/beta and format_version directly (not in upsertPattern's schema)
  db.prepare('UPDATE patterns SET alpha = ?, beta = ?, format_version = 2 WHERE id = ?')
    .run(priors.alpha, priors.beta, distilled.id)

  db.emitEvent('pattern.learned', summaryEntry.agent || 'daemon', project, {
    patternId: distilled.id,
    name: distilled.pattern.slice(0, 80),
    confidence,
    quality: distilled.quality_signal,
    source: 'extracted',
  })

  if (project !== 'default') {
    db.setPatternNamespace(distilled.id, project)
  }

  log('info', 'EXTRACT: new pattern', {
    id: distilled.id,
    quality: distilled.quality_signal,
    confidence: confidence.toFixed(2),
  })
}
```

- [ ] **Step 10: Verify no remaining references to removed functions**

Run: `grep -n "pendingJudge\|judgedEffective\|flushJudgeQueue\|JUDGE_BATCH_SIZE\|distillBatch\|applyDistilledPattern\|consolidate(" quoth-plugin/daemon/daemon.js`
Expected: No matches (all removed references cleared)

- [ ] **Step 11: Run full test suite**

Run: `cd quoth-plugin && npx vitest run`
Expected: All tests pass except the 4 old test files that import deleted pipeline modules (those are deleted in Task 6)

Note: If old tests are run and fail because daemon.js no longer imports their modules, that's expected. The fix is Task 6.

- [ ] **Step 12: Commit**

```bash
cd quoth-plugin
git add daemon/daemon.js
git commit -m "refactor(daemon): replace 3-stage pipeline with single EXTRACT call

Remove JUDGE accumulation state, flushJudgeQueue(), applyDistilledPattern().
processEntry() no longer accumulates tool_use into pendingJudge.
processSessionBatch() calls extract() directly.
insertNewPattern() uses quality_signal-derived alpha/beta priors.
format_version=2 set on new patterns."
```

---

### Task 6: Delete old pipeline files and their tests

**Files:**
- Delete: `quoth-plugin/daemon/pipeline/batch-judge.js`
- Delete: `quoth-plugin/daemon/pipeline/judge.js`
- Delete: `quoth-plugin/daemon/pipeline/consolidate.js`
- Delete: `quoth-plugin/daemon/pipeline/distill.js`
- Delete: `quoth-plugin/daemon/pipeline/distill-batch.js`
- Delete: `quoth-plugin/tests/batch-judge.test.js`
- Delete: `quoth-plugin/tests/judge.test.js`
- Delete: `quoth-plugin/tests/consolidate.test.js`
- Delete: `quoth-plugin/tests/distill.test.js`

**NOT deleted:**
- `quoth-plugin/daemon/lib/judge.js` (pairwise cluster judge — different purpose)
- `quoth-plugin/tests/judge-v2.test.js` (tests pairwise cluster judge)

- [ ] **Step 1: Delete pipeline files**

```bash
cd quoth-plugin
rm daemon/pipeline/batch-judge.js
rm daemon/pipeline/judge.js
rm daemon/pipeline/consolidate.js
rm daemon/pipeline/distill.js
rm daemon/pipeline/distill-batch.js
```

- [ ] **Step 2: Delete corresponding test files**

```bash
cd quoth-plugin
rm tests/batch-judge.test.js
rm tests/judge.test.js
rm tests/consolidate.test.js
rm tests/distill.test.js
```

- [ ] **Step 3: Verify pipeline/ directory has only extract.js remaining**

Run: `ls quoth-plugin/daemon/pipeline/`
Expected: Only `extract.js` (and potentially any other non-pipeline files)

- [ ] **Step 4: Verify lib/judge.js is intact**

Run: `head -3 quoth-plugin/daemon/lib/judge.js`
Expected: Shows the pairwise LLM-as-Judge module (NOT the deleted pipeline judge)

- [ ] **Step 5: Run full test suite**

Run: `cd quoth-plugin && npx vitest run`
Expected: ALL tests pass (no test references deleted modules)

- [ ] **Step 6: Commit**

```bash
cd quoth-plugin
git add -A daemon/pipeline/ tests/
git commit -m "chore: remove JUDGE/DISTILL/CONSOLIDATE pipeline files + tests

Deleted pipeline files: batch-judge.js, judge.js, consolidate.js, distill.js, distill-batch.js
Deleted test files: batch-judge.test.js, judge.test.js, consolidate.test.js, distill.test.js
Preserved: daemon/lib/judge.js (pairwise cluster judge, different purpose)"
```

---

### Task 7: Full verification — nightly pipeline + daemon operation

This task verifies that the nightly pipeline, V2 mini-pipeline, and curation still work correctly after the pipeline simplification.

**Files:**
- None modified (verification only, fixes if needed)

- [ ] **Step 1: Verify nightly pipeline functions still resolve**

Run: `cd quoth-plugin && node -e "const d = require('./daemon/daemon.js'); console.log('Daemon loaded successfully')"` 

If this fails, it means a remaining import references a deleted file. Fix the import.

Note: This will actually start the daemon. Instead, check imports statically:

Run: `cd quoth-plugin && grep -r "require.*pipeline/" daemon/daemon.js`
Expected: Only `require('./pipeline/extract.js')` — no references to deleted files

- [ ] **Step 2: Verify runDeepConsolidate doesn't reference deleted modules**

`runDeepConsolidate()` (daemon.js:920) uses inline `claude -p Haiku` via `execSync` — NOT the deleted `pipeline/consolidate.js`. Verify:

Run: `cd quoth-plugin && grep -n "consolidate\|distill\|batch-judge" daemon/daemon.js`
Expected: Only references to `runDeepConsolidate` function name itself, log messages, and the import of `extract.js`. No imports of deleted files.

- [ ] **Step 3: Verify V2 mini-pipeline is intact**

The V2 mini-pipeline (line ~596) calls `rebuildClusters()`, `updateClusterPosteriors()`, `enqueueJudgePairs()`, `runJudgeBatch()` — these all use `daemon/lib/judge.js` (pairwise), NOT the deleted `pipeline/judge.js`. Verify:

Run: `cd quoth-plugin && grep -n "require.*judge" daemon/daemon.js daemon/lib/judge.js`
Expected: `daemon.js` requires `./lib/judge.js` (pairwise). No reference to `./pipeline/judge.js`.

- [ ] **Step 4: Verify curation is intact**

Run: `cd quoth-plugin && grep -n "require.*curation" daemon/daemon.js`
Expected: `require('./lib/curation.js')` — no reference to deleted pipeline files

- [ ] **Step 5: Run full test suite one final time**

Run: `cd quoth-plugin && npx vitest run`
Expected: ALL tests pass

- [ ] **Step 6: Commit fixes (if any were needed)**

```bash
cd quoth-plugin
git add -A
git commit -m "fix: resolve any remaining references to deleted pipeline files"
```

If no fixes were needed, skip this step.

---

## Summary of Changes After Phase 1A

| Metric | Before (v3.4) | After (v4 Phase 1A) |
|--------|---------------|---------------------|
| Pipeline files | 5 (judge, batch-judge, distill, distill-batch, consolidate) | 1 (extract.js) |
| LLM calls/session | 2-4 | 1 |
| State variables in daemon.js | pendingJudge[], judgedEffective[], JUDGE_BATCH_SIZE | dailyExtractCount, DAILY_EXTRACT_CAP |
| Pattern format | Terse 80 chars, flat confidence 0.55 | Rich 100-200 chars, quality_signal->alpha/beta |
| Dedup mechanism | LLM consolidate + embedding 0.92 | Embedding only (configurable threshold) |
| Error handling | Console.error (silent) | pipeline_errors table (never silent) |
| Test files | 4 (judge, batch-judge, distill, consolidate) | 1 (extract.test.js) + updated db.test.js |
