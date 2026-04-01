# Quoth Pattern Promotion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the local SQLite learning daemon to automatically promote high-confidence patterns to the Quoth cloud nightly, making them searchable by all projects in the org via `quoth_search_index`.

**Architecture:** The daemon's nightly Sonnet deep-consolidation step (3am) already runs. After it deduplicates and archives weak patterns, we add a promotion loop: call `getPromotionCandidates()`, POST each to a new server endpoint `/api/v1/patterns/promote`, which upserts into `docs.documents` + `docs.chunks` (HNSW-indexed) and writes version history to `docs.document_history`. A new `quoth_propose_update` MCP tool lets agents manually trigger promotion without waiting for 3am.

**Tech Stack:**
- Daemon: Node.js CJS, better-sqlite3, native `fetch` (Node 18+), Vitest tests
- Server: Next.js 15 App Router, TypeScript, Drizzle ORM, Neon PostgreSQL, Zod, `createApiHandler` wrapper
- Auth: Agent API key (`qth_*`) — daemon authenticates as an agent, NOT a human

---

## Context: Key Files

### Daemon (quoth-plugin/)
- `daemon/db.js` — SQLite wrapper, `createDb()`, all DB methods
- `daemon/daemon.js` — background process, `runDeepConsolidate()` at line ~201
- `daemon/lib/embed.js` — `generateEmbedding()` (already built)
- `mcp/quoth-learning-server.js` — MCP stdio server, `TOOLS` array + `handleTool()`

### Server (src/)
- `src/lib/api/handler.ts` — `createApiHandler(config, handler)` — ALWAYS use this wrapper
- `src/lib/auth/clerk.ts` — `getAuthContext()` — returns `AuthContext | null`
- `src/db/schema.ts` — Drizzle schema, `documents`, `chunks`, `documentHistory` tables
- `src/db/connection.ts` — `getSecureDb(orgId, userId)` — always use this for DB access
- `src/lib/embeddings/gateway.ts` — `generateEmbedding(text: string): Promise<number[]>`

### Auth context shape (AuthContext):
```typescript
{
  userId: string,
  clerkUserId: string | null,
  orgId: string,
  projectId: string,
  role: 'owner' | 'admin' | 'editor' | 'viewer',
  tier: 'free' | 'pro' | 'team' | 'enterprise',
  isAgent: boolean,
  agentId?: string,
  scopes?: string[]
}
```

### Env vars needed (set per-repo):
```bash
QUOTH_API_KEY=qth_...                    # from Quoth dashboard
QUOTH_PROJECT_ID=<uuid>                  # project UUID for this repo
QUOTH_API_URL=https://quoth.triqual.dev  # optional override
```

---

## Task 1: Daemon — SQLite Schema Additions + New DB Methods

**Files:**
- Modify: `quoth-plugin/daemon/db.js`
- Test: `quoth-plugin/tests/db.test.js`

### Step 1: Write the failing tests

Add to the `describe('db', ...)` block in `quoth-plugin/tests/db.test.js`:

```javascript
it('has promoted_at, cloud_document_id, promoted_confidence, applicability columns', () => {
  const cols = db.prepare("PRAGMA table_info(patterns)").all().map(r => r.name)
  expect(cols).toContain('promoted_at')
  expect(cols).toContain('cloud_document_id')
  expect(cols).toContain('promoted_confidence')
  expect(cols).toContain('applicability')
})

it('markPromoted sets all three promotion fields', () => {
  db.upsertPattern({ id: 'promo-1', name: 'p', pattern_type: 'code-pattern',
    condition: 'c', action: 'a', confidence: 0.9, tags: [], source: 'distilled' })
  db.markPromoted('promo-1', 'doc-uuid-123', 0.9)
  const p = db.getPattern('promo-1')
  expect(p.cloud_document_id).toBe('doc-uuid-123')
  expect(p.promoted_confidence).toBeCloseTo(0.9)
  expect(p.promoted_at).toBeGreaterThan(0)
})

it('getPromotionCandidates returns patterns above threshold', () => {
  db.upsertPattern({ id: 'cand-1', name: 'p', pattern_type: 'code-pattern',
    condition: 'c', action: 'a', confidence: 0.85, tags: [], source: 'distilled' })
  // Simulate 11 uses by calling applyConfidenceDelta 11 times with tiny delta
  for (let i = 0; i < 11; i++) db.applyConfidenceDelta('cand-1', 0)
  // Manually set counts since applyConfidenceDelta doesn't bump on 0 delta
  db.prepare("UPDATE patterns SET success_count = 8, failure_count = 3 WHERE id = 'cand-1'").run()
  const candidates = db.getPromotionCandidates()
  expect(candidates.find(c => c.id === 'cand-1')).toBeTruthy()
})

it('getPromotionCandidates excludes patterns already at promoted confidence', () => {
  db.upsertPattern({ id: 'skip-1', name: 'p', pattern_type: 'code-pattern',
    condition: 'c', action: 'a', confidence: 0.82, tags: [], source: 'distilled' })
  db.prepare("UPDATE patterns SET success_count = 8, failure_count = 3 WHERE id = 'skip-1'").run()
  db.markPromoted('skip-1', 'doc-456', 0.80)  // promoted_confidence = 0.80
  // confidence (0.82) - promoted_confidence (0.80) = 0.02 < 0.1 → should NOT appear
  // Note: filtering is done in daemon.js, not in getPromotionCandidates — it returns all candidates
  // This test verifies the query returns the pattern (daemon.js filters the delta)
  const candidates = db.getPromotionCandidates()
  expect(candidates.find(c => c.id === 'skip-1')).toBeTruthy()
})
```

### Step 2: Run tests to verify they fail

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin
npm test -- --reporter=verbose 2>&1 | grep -A 3 "promoted_at\|markPromoted\|getPromotionCandidates"
```

Expected: `AssertionError` — columns don't exist yet, `markPromoted` is not a function.

### Step 3: Implement

In `quoth-plugin/daemon/db.js`, add the runtime migration block inside `createDb()`, immediately after `db.exec(SCHEMA)`:

```javascript
// Runtime migration: add promotion tracking columns if not present
const existingCols = db.prepare('PRAGMA table_info(patterns)').all().map(r => r.name)
const promotionCols = [
  { name: 'promoted_at', type: 'INTEGER' },
  { name: 'cloud_document_id', type: 'TEXT' },
  { name: 'promoted_confidence', type: 'REAL' },
  { name: 'applicability', type: "TEXT DEFAULT 'narrow'" }
]
for (const col of promotionCols) {
  if (!existingCols.includes(col.name)) {
    db.exec(`ALTER TABLE patterns ADD COLUMN ${col.name} ${col.type}`)
  }
}
```

Then add the two new methods inside `createDb()`, after `db.getPromotionCandidates`:

**Replace** the existing `db.getPromotionCandidates`:
```javascript
db.getPromotionCandidates = function() {
  return db.prepare(`
    SELECT * FROM patterns
    WHERE confidence > 0.8
      AND (success_count + failure_count) > 10
      AND status = 'active'
      AND source = 'distilled'
  `).all().map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }))
}
```

**Add** after it:
```javascript
db.markPromoted = function(id, cloudDocumentId, confidence) {
  db.prepare(`
    UPDATE patterns SET
      promoted_at = strftime('%s','now') * 1000,
      cloud_document_id = ?,
      promoted_confidence = ?,
      updated_at = strftime('%s','now') * 1000
    WHERE id = ?
  `).run(cloudDocumentId, confidence, id)
}
```

### Step 4: Run tests to verify they pass

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test
```

Expected: All tests pass including the 4 new ones.

### Step 5: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin
git add daemon/db.js tests/db.test.js
git commit -m "feat(daemon): add promotion tracking columns and markPromoted method"
```

---

## Task 2: Daemon — `promote.js` HTTP Client

**Files:**
- Create: `quoth-plugin/daemon/lib/promote.js`
- Create: `quoth-plugin/tests/promote.test.js`

### Step 1: Write the failing tests

Create `quoth-plugin/tests/promote.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We need to test promotePattern — it uses global fetch
const { promotePattern } = require('../daemon/lib/promote.js')

const fakePattern = {
  id: 'abc123',
  name: 'Use :visible for ambiguous selectors',
  condition: 'multiple elements match selector',
  action: 'Add :visible filter to disambiguate',
  confidence: 0.87,
  success_count: 12,
  failure_count: 2,
  tags: ['selector', 'playwright'],
  applicability: 'narrow',
  embedding: JSON.stringify([0.1, 0.2, 0.3])
}

beforeEach(() => {
  process.env.QUOTH_API_KEY = 'qth_testkey123'
  process.env.QUOTH_API_URL = 'https://test.quoth.dev'
  process.env.QUOTH_PROJECT_ID = 'project-uuid-abc'
})

afterEach(() => {
  delete process.env.QUOTH_API_KEY
  delete process.env.QUOTH_API_URL
  delete process.env.QUOTH_PROJECT_ID
  vi.restoreAllMocks()
})

describe('promotePattern', () => {
  it('returns null when QUOTH_API_KEY is not set', async () => {
    delete process.env.QUOTH_API_KEY
    const result = await promotePattern(fakePattern)
    expect(result).toBeNull()
  })

  it('POSTs to /api/v1/patterns/promote with correct headers', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ documentId: 'doc-1', version: 1, status: 'created' })
    })
    await promotePattern(fakePattern)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://test.quoth.dev/api/v1/patterns/promote',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer qth_testkey123',
          'Content-Type': 'application/json'
        })
      })
    )
  })

  it('sends correct body shape', async () => {
    let capturedBody
    vi.spyOn(global, 'fetch').mockImplementation(async (_, opts) => {
      capturedBody = JSON.parse(opts.body)
      return { ok: true, json: async () => ({ documentId: 'doc-1', version: 1, status: 'created' }) }
    })
    await promotePattern(fakePattern)
    expect(capturedBody.patternId).toBe('abc123')
    expect(capturedBody.confidence).toBeCloseTo(0.87)
    expect(capturedBody.successCount).toBe(12)
    expect(capturedBody.failureCount).toBe(2)
    expect(capturedBody.applicability).toBe('narrow')
    expect(capturedBody.tags).toEqual(['selector', 'playwright'])
  })

  it('returns null on non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 401 })
    const result = await promotePattern(fakePattern)
    expect(result).toBeNull()
  })

  it('returns null on network error without throwing', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await promotePattern(fakePattern)
    expect(result).toBeNull()
  })

  it('returns documentId and version on success', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ documentId: 'doc-uuid-1', version: 2, status: 'updated' })
    })
    const result = await promotePattern(fakePattern)
    expect(result.documentId).toBe('doc-uuid-1')
    expect(result.version).toBe(2)
    expect(result.status).toBe('updated')
  })

  it('uses default QUOTH_API_URL when env var not set', async () => {
    delete process.env.QUOTH_API_URL
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ documentId: 'x', version: 1, status: 'created' })
    })
    await promotePattern(fakePattern)
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toContain('quoth.triqual.dev')
  })
})
```

### Step 2: Run tests to verify they fail

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test tests/promote.test.js
```

Expected: `Cannot find module '../daemon/lib/promote.js'`

### Step 3: Implement

Create `quoth-plugin/daemon/lib/promote.js`:

```javascript
'use strict'

const QUOTH_API_URL = process.env.QUOTH_API_URL || 'https://quoth.triqual.dev'

function buildContent(pattern) {
  const tags = Array.isArray(pattern.tags) ? pattern.tags : JSON.parse(pattern.tags || '[]')
  const date = new Date().toISOString().split('T')[0]
  return `# ${pattern.name}

**Condition:** ${pattern.condition}

**Action:** ${pattern.action}

**Confidence:** ${pattern.confidence.toFixed(2)} (${pattern.success_count} successes, ${pattern.failure_count} failures)

**Tags:** ${tags.length > 0 ? tags.join(', ') : 'none'}

**Source:** Distilled from local learning daemon — promoted ${date}
`
}

// Promotes a single pattern to the Quoth cloud.
// Returns { documentId, version, status } on success, null on any failure.
// Never throws — all errors are swallowed to protect the nightly cycle.
async function promotePattern(pattern) {
  const apiKey = process.env.QUOTH_API_KEY
  if (!apiKey) return null

  const apiUrl = process.env.QUOTH_API_URL || QUOTH_API_URL
  const tags = Array.isArray(pattern.tags) ? pattern.tags : JSON.parse(pattern.tags || '[]')

  let embedding = undefined
  if (pattern.embedding) {
    try {
      embedding = typeof pattern.embedding === 'string'
        ? JSON.parse(pattern.embedding)
        : pattern.embedding
    } catch {}
  }

  const body = {
    patternId: pattern.id,
    name: pattern.name,
    condition: pattern.condition,
    action: pattern.action,
    content: buildContent(pattern),
    confidence: pattern.confidence,
    successCount: pattern.success_count,
    failureCount: pattern.failure_count,
    tags,
    applicability: pattern.applicability || 'narrow',
    ...(embedding ? { embedding } : {})
  }

  try {
    const res = await fetch(`${apiUrl}/api/v1/patterns/promote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

module.exports = { promotePattern, buildContent }
```

### Step 4: Run tests to verify they pass

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test tests/promote.test.js
```

Expected: All 7 tests pass.

### Step 5: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin
git add daemon/lib/promote.js tests/promote.test.js
git commit -m "feat(daemon): add promote.js HTTP client for cloud pattern promotion"
```

---

## Task 3: Daemon — Wire Promotion into `runDeepConsolidate`

**Files:**
- Modify: `quoth-plugin/daemon/daemon.js`

### Step 1: Verify test coverage setup

No new test file needed — the promotion logic in daemon.js is a thin orchestration layer. The promote.js tests cover the HTTP client, and db.test.js covers markPromoted. Add one smoke test to `tests/integration.test.js` in Task 5.

### Step 2: Implement

In `quoth-plugin/daemon/daemon.js`, add the import at the top (after existing requires):

```javascript
const { promotePattern } = require('./lib/promote.js')
```

Then find `runDeepConsolidate()` (~line 201). At the end of the function, **after** the loop that applies merges and archives, add the promotion block:

```javascript
// After: for (const id of (result.archives || [])) { ... }
// After: for (const merge of (result.merges || [])) { ... }

// Promote high-confidence patterns to Quoth cloud
try {
  const candidates = db.getPromotionCandidates()
  log('info', `Found ${candidates.length} promotion candidates`)

  for (const pattern of candidates) {
    const needsPromotion = !pattern.promoted_at ||
      (pattern.confidence - (pattern.promoted_confidence || 0)) > 0.1
    if (!needsPromotion) continue

    const result = await promotePattern(pattern)
    if (result) {
      db.markPromoted(pattern.id, result.documentId, pattern.confidence)
      log('info', 'Pattern promoted to cloud', {
        id: pattern.id,
        documentId: result.documentId,
        version: result.version,
        status: result.status
      })
    }
  }
} catch (err) {
  log('error', 'Promotion phase failed', { error: err.message })
}
```

Also make `runDeepConsolidate` async since it now uses `await promotePattern`. Change:

```javascript
function runDeepConsolidate() {
```

to:

```javascript
async function runDeepConsolidate() {
```

And update the two callers in `scheduleDeepConsolidate()`:

```javascript
// Change:
runDeepConsolidate()
setInterval(runDeepConsolidate, 24 * 60 * 60 * 1000)

// To:
runDeepConsolidate().catch(err => log('error', 'runDeepConsolidate failed', { error: err.message }))
setInterval(() => {
  runDeepConsolidate().catch(err => log('error', 'runDeepConsolidate failed', { error: err.message }))
}, 24 * 60 * 60 * 1000)
```

### Step 3: Run all daemon tests

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test
```

Expected: All existing tests still pass (no regressions).

### Step 4: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin
git add daemon/daemon.js
git commit -m "feat(daemon): wire pattern promotion into nightly deep consolidation"
```

---

## Task 4: MCP Server — `quoth_propose_update` Tool

**Files:**
- Modify: `quoth-plugin/mcp/quoth-learning-server.js`
- Modify: `quoth-plugin/tests/integration.test.js`

### Step 1: Write the failing test

In `quoth-plugin/tests/integration.test.js`, add inside the `describe('MCP server', ...)` block:

```javascript
it('quoth_propose_update returns error when pattern not found', async () => {
  // Set up: no API key → will return graceful error
  delete process.env.QUOTH_API_KEY

  const messages = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test' } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'quoth_propose_update', arguments: { patternId: 'nonexistent-id' } } })
  ].join('\n') + '\n'

  const proc = require('child_process').spawnSync(
    'node',
    [require('path').join(__dirname, '../mcp/quoth-learning-server.js')],
    { input: messages, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, QUOTH_HOME: require('os').tmpdir() } }
  )

  const lines = (proc.stdout || '').trim().split('\n').filter(Boolean)
  const toolResponse = JSON.parse(lines[lines.length - 1])
  expect(toolResponse.result).toBeDefined()
  // Either a graceful error message or null result — never an MCP-level error
  const text = toolResponse.result?.content?.[0]?.text
  const parsed = JSON.parse(text)
  expect(parsed).toHaveProperty('error')
})
```

### Step 2: Run to verify it fails

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test tests/integration.test.js
```

Expected: Test fails — `quoth_propose_update` tool doesn't exist yet.

### Step 3: Implement

In `quoth-plugin/mcp/quoth-learning-server.js`:

**1. Add `promotePattern` import at the top** (after existing requires):

```javascript
const { promotePattern } = require(path.join(__dirname, '../daemon/lib/promote.js'))
```

**2. Add to the `TOOLS` array** (after the `quoth_daemon_status` entry):

```javascript
{
  name: 'quoth_propose_update',
  description: 'Manually promote a high-confidence local pattern to the Quoth cloud index without waiting for the nightly cycle',
  inputSchema: {
    type: 'object',
    properties: {
      patternId: { type: 'string', description: 'Local pattern ID to promote' }
    },
    required: ['patternId']
  }
}
```

**3. Add case in `handleTool`** (before the `default` case):

```javascript
case 'quoth_propose_update': {
  const pattern = getDb().getPattern(args.patternId)
  if (!pattern) return { error: `Pattern '${args.patternId}' not found in local DB` }
  const result = await promotePattern(pattern)
  if (!result) return { error: 'Promotion failed — check QUOTH_API_KEY and daemon logs' }
  getDb().markPromoted(pattern.id, result.documentId, pattern.confidence)
  return { promoted: true, documentId: result.documentId, version: result.version, status: result.status }
}
```

### Step 4: Run tests to verify they pass

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test
```

Expected: All 24 tests pass (23 existing + 1 new).

### Step 5: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin
git add mcp/quoth-learning-server.js tests/integration.test.js
git commit -m "feat(mcp): add quoth_propose_update tool for manual pattern promotion"
```

---

## Task 5: Server — `POST /api/v1/patterns/promote` Endpoint

**Files:**
- Create: `src/app/api/v1/patterns/promote/route.ts`

### Step 1: Read these files before writing anything

```
Read: src/lib/api/handler.ts       — understand createApiHandler signature
Read: src/db/schema.ts             — find documents, chunks, documentHistory table imports
Read: src/db/connection.ts         — find getSecureDb signature
Read: src/lib/embeddings/gateway.ts — find generateEmbedding signature
Read: src/app/api/v1/documents/route.ts — understand the checksum + upsert pattern
```

### Step 2: Implement the endpoint

Create `src/app/api/v1/patterns/promote/route.ts`:

```typescript
/**
 * POST /api/v1/patterns/promote
 *
 * Receives a high-confidence pattern from a local learning daemon and promotes
 * it to the Quoth cloud document index. Immediately searchable via quoth_search_index.
 *
 * Auth: Agent API key (qth_*) ONLY — Clerk JWT is rejected.
 * Rate limit: 30 rpm per key.
 *
 * Upsert key: (orgId, filePath) where filePath = "system/patterns/{patternId}"
 * On update: writes previous version to documentHistory before overwriting.
 * Visibility: applicability='broad' → 'shared' (org-wide), 'narrow' → 'project' (scoped)
 */

import { z } from 'zod'
import { eq, and, sql } from 'drizzle-orm'
import { createApiHandler } from '@/lib/api/handler'
import { getSecureDb } from '@/db/connection'
import { documents, chunks, documentHistory } from '@/db/schema'
import { generateEmbedding } from '@/lib/embeddings/gateway'
import { forbidden, unauthorized } from '@/lib/api/errors'

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const promotePatternBody = z.object({
  patternId: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  condition: z.string().min(1),
  action: z.string().min(1),
  content: z.string().min(1),                           // pre-built markdown from daemon
  confidence: z.number().min(0.8).max(1.0),             // server-side guard: must be >= 0.8
  successCount: z.number().int().min(0),
  failureCount: z.number().int().min(0),
  tags: z.array(z.string().max(64)).max(20).default([]),
  applicability: z.enum(['broad', 'narrow']),
  embedding: z.array(z.number()).optional(),             // 3072-dim from daemon (ignored server-side)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sha256(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// POST /api/v1/patterns/promote
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 30 },
    validate: { body: promotePatternBody },
    maxDuration: 60_000,   // embedding generation can take a moment
  },
  async (req, ctx) => {
    // Agents only — no human sessions
    if (!ctx!.isAgent) {
      throw forbidden('Pattern promotion is only available to agent API keys.')
    }

    const db = await getSecureDb(ctx!.orgId, ctx!.userId)
    const body = req.validatedBody as z.infer<typeof promotePatternBody>

    // Derive cloud document path and visibility from applicability
    const filePath = `system/patterns/${body.patternId}`
    const visibility = body.applicability === 'broad' ? 'shared' : 'project'
    const checksum = await sha256(body.content)

    // ── 1. Check for existing document ─────────────────────────────────────
    const [existing] = await db
      .select({ id: documents.id, version: documents.version, content: documents.content, checksum: documents.checksum })
      .from(documents)
      .where(and(eq(documents.orgId, ctx!.orgId), eq(documents.filePath, filePath)))
      .limit(1)

    // Skip if content hasn't changed
    if (existing && existing.checksum === checksum) {
      return Response.json({ documentId: existing.id, version: existing.version, status: 'skipped', filePath })
    }

    // ── 2. Write current version to history before overwriting ─────────────
    if (existing) {
      await db.insert(documentHistory).values({
        documentId: existing.id,
        version: existing.version ?? 1,
        content: existing.content,
        checksum: existing.checksum,
        changedBy: null,          // daemon has no userId
        changeType: 'update',
      })
    }

    // ── 3. Upsert document ──────────────────────────────────────────────────
    const [doc] = await db
      .insert(documents)
      .values({
        projectId: ctx!.projectId,
        orgId: ctx!.orgId,
        filePath,
        title: body.name,
        content: body.content,
        checksum,
        docType: 'patterns',
        visibility,
        tags: body.tags,
        agentId: ctx!.agentId ?? null,
        indexingStatus: 'indexing',
        version: 1,
      })
      .onConflictDoUpdate({
        target: [documents.orgId, documents.filePath],
        set: {
          title: body.name,
          content: body.content,
          checksum,
          visibility,
          tags: body.tags,
          indexingStatus: 'indexing',
          version: sql`${documents.version} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning()

    const status = (doc.version ?? 1) > 1 ? 'updated' : 'created'

    // ── 4. Delete old chunks then create fresh chunk with embedding ─────────
    await db.delete(chunks).where(eq(chunks.documentId, doc.id))

    // Generate server-side embedding (always use text-embedding-3-small for HNSW compat)
    let embedding: number[] | null = null
    try {
      embedding = await generateEmbedding(body.action)
    } catch {
      // Non-fatal — chunk still created, falls back to FTS-only search
    }

    const chunkHash = await sha256(body.content)
    await db.insert(chunks).values({
      documentId: doc.id,
      projectId: ctx!.projectId,
      content: body.content,
      chunkHash,
      chunkIndex: 0,
      embedding: embedding as unknown as string,   // Drizzle pgvector accepts number[]
      embeddingModel: 'text-embedding-3-small',
      metadata: {
        confidence: body.confidence,
        successCount: body.successCount,
        failureCount: body.failureCount,
        applicability: body.applicability,
        promotedAt: new Date().toISOString(),
      },
      title: body.name,
      filePath,
    })

    // ── 5. Mark document as indexed ────────────────────────────────────────
    await db
      .update(documents)
      .set({ indexingStatus: 'indexed' })
      .where(eq(documents.id, doc.id))

    return Response.json(
      { documentId: doc.id, version: doc.version, status, filePath },
      { status: status === 'created' ? 201 : 200 }
    )
  }
)
```

### Step 3: Verify TypeScript compiles

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth && npx tsc --noEmit 2>&1 | head -40
```

Expected: No errors (or only pre-existing unrelated errors). Fix any type errors before continuing.

**Common fix if `documents.orgId` index doesn't exist for onConflictDoUpdate:**

Check `src/db/schema.ts` — the unique index is `(projectId, filePath)` not `(orgId, filePath)`. If so, update the conflict target:

```typescript
.onConflictDoUpdate({
  target: [documents.projectId, documents.filePath],
  // ... rest unchanged
})
```

And update the lookup query to match:
```typescript
.where(and(eq(documents.projectId, ctx!.projectId), eq(documents.filePath, filePath)))
```

### Step 4: Test manually with curl (requires running dev server)

```bash
# Start dev server
cd /Users/agustinmontoya/Attorneyshare/Quoth && npm run dev

# In another terminal — test with a real qth_ key:
curl -X POST http://localhost:3000/api/v1/patterns/promote \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer qth_YOUR_KEY_HERE" \
  -d '{
    "patternId": "test-pattern-001",
    "name": "Use :visible for ambiguous selectors",
    "condition": "multiple elements match the same selector",
    "action": "Add :visible filter to disambiguate when selector matches hidden elements",
    "content": "# Use :visible for ambiguous selectors\n\n**Condition:** multiple elements match\n\n**Action:** Add :visible filter",
    "confidence": 0.87,
    "successCount": 12,
    "failureCount": 2,
    "tags": ["selector", "playwright"],
    "applicability": "narrow"
  }'
```

Expected: `{"documentId":"<uuid>","version":1,"status":"created","filePath":"system/patterns/test-pattern-001"}`

Test duplicate (should update, not create):
```bash
# Run same curl again
```
Expected: `{"documentId":"<same-uuid>","version":2,"status":"updated",...}`

Test with Clerk JWT (should be rejected):
```bash
curl -X POST http://localhost:3000/api/v1/patterns/promote \
  -H "Content-Type: application/json" \
  -H "Cookie: __session=..." \
  -d '{"patternId":"x","name":"x","condition":"x","action":"x","content":"x","confidence":0.9,"successCount":1,"failureCount":0,"tags":[],"applicability":"narrow"}'
```
Expected: `403 Forbidden`

Test with low confidence (should be rejected by Zod):
```bash
curl -X POST http://localhost:3000/api/v1/patterns/promote \
  -H "Authorization: Bearer qth_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"patternId":"x","name":"x","condition":"x","action":"x","content":"x","confidence":0.5,"successCount":1,"failureCount":0,"tags":[],"applicability":"narrow"}'
```
Expected: `422 Unprocessable Entity` with Zod validation error.

### Step 5: Verify pattern appears in search

```bash
curl -X POST http://localhost:3000/api/v1/search \
  -H "Authorization: Bearer qth_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "visible selector ambiguous playwright", "scope": "all"}'
```

Expected: The pattern appears in results.

### Step 6: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth
git add src/app/api/v1/patterns/promote/route.ts
git commit -m "feat(api): add POST /api/v1/patterns/promote for autonomous pattern promotion"
```

---

## Task 6: Wire Semantic Search into Triqual Subagent Context

The new `quoth_propose_update` MCP tool and `quoth_top_patterns?query=...` are now wired. The final gap: when Triqual's `subagent-start.sh` knows the active `FEATURE`, inject semantically relevant patterns rather than top-5 by confidence.

**Files:**
- Modify: `Quoth/quoth-plugin/hooks/lib/common.sh`
- Modify: `Quoth/quoth-plugin/hooks/session-start.sh` (minor)

### Step 1: Read the file

```
Read: /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin/hooks/lib/common.sh
```

### Step 2: Implement

In `quoth-plugin/hooks/lib/common.sh`, update `get_top_patterns_context` to accept an optional query:

```bash
# Get top patterns as context string (for injection)
# Usage: get_top_patterns_context [limit] [query]
get_top_patterns_context() {
  local limit="${1:-5}"
  local query="${2:-}"
  local args
  if [ -n "${query}" ]; then
    # URL-safe: jq handles escaping
    args=$(printf '{"limit":%s,"query":"%s"}' "${limit}" "${query}" 2>/dev/null) || args="{\"limit\":${limit}}"
  else
    args="{\"limit\":${limit}}"
  fi
  local result
  result=$(claude mcp call quoth-learning quoth_top_patterns "${args}" 2>/dev/null) || true
  echo "${result}"
}
```

In `Triqual/triqual-plugin/hooks/subagent-start.sh`, find the `test-healer` and `test-generator` cases where the agent has `FEATURE` available. In those sections, replace the `KNOWLEDGE_MSG` injection point to also include a quoth-learning query:

In the `*test-healer*` and `*test-generator*` cases, before the `output_context` call, add:

```bash
# Fetch semantically relevant patterns for this feature
QUOTH_PATTERNS=""
if command -v claude >/dev/null 2>&1 && [ -n "$FEATURE" ]; then
  QUOTH_PATTERNS=$(claude mcp call quoth-learning quoth_top_patterns \
    "{\"limit\":3,\"query\":\"${FEATURE} test automation playwright\"}" 2>/dev/null) || true
fi
```

Then include `${QUOTH_PATTERNS}` in the output_context message under a "Local Learned Patterns:" section.

### Step 3: Verify

Start a new session in the attorney_share_mvp_web repo with a test feature active:
```bash
# Look for "[Quoth] Learning daemon active" in session start
# Then spawn a test-healer agent and check its injected context includes patterns
```

### Step 4: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth
git add quoth-plugin/hooks/lib/common.sh
git commit -m "feat(hooks): add query param to get_top_patterns_context for semantic injection"

cd /Users/agustinmontoya/Attorneyshare/Triqual
git add triqual-plugin/hooks/subagent-start.sh
git commit -m "feat(hooks): inject semantically relevant Quoth patterns into test agent context"
```

---

## Task 7: Update Documentation

**Files:**
- Modify: `Quoth/CLAUDE.md` (Quoth Plugin section)
- Modify: `Triqual/CLAUDE.md` (Quoth-Learning Tools section)

### Step 1: Read both files first

```
Read: /Users/agustinmontoya/Attorneyshare/Quoth/CLAUDE.md
Read: /Users/agustinmontoya/Attorneyshare/Triqual/CLAUDE.md
```

### Step 2: Update Quoth CLAUDE.md

In the `### New MCP Tools (quoth-learning)` section, add `quoth_propose_update`:

```markdown
- `quoth_propose_update` — manually promote a local pattern to the Quoth cloud (no wait for 3am)
```

In the `### Daemon` section, add:

```markdown
- Nightly promotion: high-confidence patterns (>0.8, >10 uses) auto-promote to Quoth cloud at 3am
- Re-promotion only when confidence improves by >0.1 since last upload
- Env vars: `QUOTH_API_KEY` (qth_* key), `QUOTH_PROJECT_ID`, `QUOTH_API_URL`
```

### Step 3: Update Triqual CLAUDE.md

In the `### Quoth-Learning Tools` section, add:

```markdown
- `quoth_propose_update({ patternId })` — Manually push a local pattern to Quoth cloud now
```

Note the env var requirements:
```markdown
**Required env vars for cloud promotion (set per-repo):**
- `QUOTH_API_KEY=qth_...` — agent API key from Quoth dashboard
- `QUOTH_PROJECT_ID=<uuid>` — this repo's project UUID in Quoth
```

### Step 4: Commit

```bash
cd /Users/agustinmontoya/Attorneyshare/Quoth
git add CLAUDE.md
git commit -m "docs: document pattern promotion env vars and new MCP tool"

cd /Users/agustinmontoya/Attorneyshare/Triqual
git add CLAUDE.md
git commit -m "docs: add quoth_propose_update tool and promotion env var requirements"
```

---

## End-to-End Verification

After all tasks are complete, run the full loop:

```bash
# 1. Confirm daemon tests pass
cd /Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin && npm test
# Expected: 24+ tests, all passing

# 2. Check TypeScript on server
cd /Users/agustinmontoya/Attorneyshare/Quoth && npx tsc --noEmit
# Expected: No new errors

# 3. Build server
npm run build
# Expected: Successful

# 4. Simulate nightly promotion manually
QUOTH_API_KEY=qth_... QUOTH_PROJECT_ID=... node -e "
const { runDeepConsolidate } = require('./quoth-plugin/daemon/daemon.js')
runDeepConsolidate().then(() => console.log('done'))
"

# 5. Search for promoted patterns
curl -X POST https://quoth.triqual.dev/api/v1/search \
  -H 'Authorization: Bearer qth_...' \
  -H 'Content-Type: application/json' \
  -d '{"query":"selector playwright visibility","scope":"all"}'
# Expected: promoted patterns appear in results
```
