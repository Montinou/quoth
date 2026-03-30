# UI Upgrade + Missing Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all broken dashboard pages by implementing missing API endpoints, then upgrade key UI components with shadcn premium blocks.

**Architecture:** Three phases — (1) install shadcn components, (2) implement API endpoints using Clerk auth + Drizzle ORM matching the shapes the frontend already expects, (3) upgrade UI pages with premium shadcn blocks. All endpoints use `getAuthContext()` from `src/lib/auth/clerk.ts` for auth.

**Tech Stack:** Next.js App Router, Clerk auth, Drizzle ORM + Neon, shadcn/ui premium, Vercel AI Gateway

---

## Phase 1: Install shadcn premium components

### Task 1: Install missing shadcn components

**Files:**
- Modify: `src/components/ui/` (new component files auto-generated)

- [ ] **Step 1: Install base components needed by premium blocks**

```bash
cd /home/lord_montino/projects/agents-tools/quoth
npx shadcn@latest add tabs table dialog alert-dialog avatar form label select textarea switch progress chart command popover scroll-area breadcrumb toggle-group drawer pagination -y
```

- [ ] **Step 2: Verify installation**

```bash
ls src/components/ui/ | wc -l
```
Expected: ~30+ component files

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/ package.json package-lock.json
git commit -m "feat(ui): install shadcn premium components (tabs, table, dialog, chart, etc.)"
```

---

## Phase 2: Implement missing API endpoints

All endpoints use this auth pattern:

```typescript
import { getAuthContext } from '@/lib/auth/clerk';
const ctx = await getAuthContext();
if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
```

DB access via:
```typescript
import { getDb } from '@/db/connection';
import { eq, and, desc } from 'drizzle-orm';
```

### Task 2: Knowledge Base endpoints

**Files:**
- Create: `src/app/api/knowledge-base/ask/route.ts`
- Create: `src/app/api/knowledge-base/[id]/route.ts`
- Create: `src/app/api/knowledge-base/[id]/rollback/route.ts`

The KB search page calls `POST /api/knowledge-base/ask` with `{ query }`.
It expects `{ results, aiAnswer, sources, relatedQuestions, aiEnabled }`.

- [ ] **Step 1: Implement `/api/knowledge-base/ask`**

Use the existing search pipeline at `src/lib/search/pipeline.ts` to perform semantic search.
Return results from `docs.documents` + `docs.document_chunks` tables.
Set `aiAnswer: null` and `aiEnabled: false` for now (no LLM in search).

```typescript
// POST /api/knowledge-base/ask
import { getAuthContext } from '@/lib/auth/clerk';
import { getDb } from '@/db/connection';
import { generateEmbedding } from '@/lib/embeddings/gateway';
import { sql } from 'drizzle-orm';

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { query } = await req.json();
  if (!query || typeof query !== 'string') {
    return Response.json({ error: 'Query required' }, { status: 400 });
  }

  const db = getDb();
  const embedding = await generateEmbedding(query);

  // Semantic search across document chunks
  const results = await db.execute(sql`
    SELECT d.id, d.title, d.file_path as path,
           c.content as snippet, d.doc_type as type,
           d.version, d.updated_at as "lastUpdated",
           1 - (c.embedding <=> ${sql`${JSON.stringify(embedding)}::vector`}) as relevance
    FROM docs.document_chunks c
    JOIN docs.documents d ON d.id = c.document_id
    WHERE d.org_id = ${ctx.orgId}::uuid
      AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${sql`${JSON.stringify(embedding)}::vector`}
    LIMIT 10
  `);

  return Response.json({
    results: results.rows.map(r => ({
      ...r,
      snippet: (r.snippet as string)?.slice(0, 200) + '...',
      relevance: Number(r.relevance),
    })),
    aiAnswer: null,
    sources: [],
    relatedQuestions: [],
    aiEnabled: false,
  });
}
```

- [ ] **Step 2: Implement `/api/knowledge-base/[id]`**

```typescript
// GET /api/knowledge-base/[id]
import { getAuthContext } from '@/lib/auth/clerk';
import { getDb } from '@/db/connection';
import { sql } from 'drizzle-orm';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  const rows = await db.execute(sql`
    SELECT id, title, content, version, updated_at as "lastUpdated", file_path as path
    FROM docs.documents
    WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid
    LIMIT 1
  `);

  if (!rows.rows[0]) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json({ ...rows.rows[0], history: [] });
}
```

- [ ] **Step 3: Implement `/api/knowledge-base/[id]/rollback`**

```typescript
// POST /api/knowledge-base/[id]/rollback — stub (no version history table yet)
import { getAuthContext } from '@/lib/auth/clerk';

export async function POST() {
  const ctx = await getAuthContext();
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json({ success: false, error: 'Version history not yet implemented' }, { status: 501 });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/knowledge-base/
git commit -m "feat(api): implement knowledge-base search and detail endpoints"
```

---

### Task 3: Proposals endpoints

**Files:**
- Create: `src/app/api/proposals/route.ts`
- Create: `src/app/api/proposals/[id]/route.ts`
- Create: `src/app/api/proposals/[id]/approve/route.ts`
- Create: `src/app/api/proposals/[id]/reject/route.ts`

Frontend expects proposals from the DB. Check if a proposals table exists in schema, otherwise stub with empty results.

- [ ] **Step 1: Check schema for proposals table**

```bash
grep -n "proposals" src/db/schema.ts
```

If no table exists, the endpoints return empty arrays / 501 stubs.

- [ ] **Step 2: Implement all 4 proposal endpoints**

`GET /api/proposals` — list proposals (filter by ?status)
`GET /api/proposals/[id]` — detail
`POST /api/proposals/[id]/approve` — approve
`POST /api/proposals/[id]/reject` — reject

If table exists, use Drizzle. If not, return empty/stub responses that the frontend handles gracefully (empty state UI already exists).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/proposals/
git commit -m "feat(api): implement proposals list, detail, approve, reject endpoints"
```

---

### Task 4: API Keys (MCP Token) endpoints

**Files:**
- Create: `src/app/api/mcp-token/list/route.ts`
- Create: `src/app/api/mcp-token/generate/route.ts`

Frontend calls these with Bearer token from Clerk. Uses `agents.api_keys` table.

- [ ] **Step 1: Implement `/api/mcp-token/list`**

Query `agents.api_keys` for the authenticated user's org.

```typescript
// GET /api/mcp-token/list
import { getAuthContext } from '@/lib/auth/clerk';
import { getDb } from '@/db/connection';
import { sql } from 'drizzle-orm';

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const rows = await db.execute(sql`
    SELECT ak.id, ak.key_prefix, ak.label, ak.created_at, ak.expires_at, ak.last_used_at
    FROM agents.api_keys ak
    JOIN agents.registry ar ON ar.id = ak.agent_id
    WHERE ar.org_id = ${ctx.orgId}::uuid
    ORDER BY ak.created_at DESC
  `);

  return Response.json({ keys: rows.rows });
}
```

- [ ] **Step 2: Implement `/api/mcp-token/generate`**

Generate a new API key using the `createAgentApiKey` function from `src/lib/auth/agent-keys.ts` if it exists, or implement inline.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/mcp-token/
git commit -m "feat(api): implement MCP token list and generate endpoints"
```

---

### Task 5: Project team + invitations endpoints

**Files:**
- Create: `src/app/api/projects/by-slug/[slug]/route.ts`
- Create: `src/app/api/projects/[projectId]/team/route.ts`
- Create: `src/app/api/projects/[projectId]/team/[memberId]/route.ts`
- Create: `src/app/api/projects/[projectId]/invitations/route.ts`
- Create: `src/app/api/projects/[projectId]/invitations/[invitationId]/route.ts`
- Create: `src/app/api/invitations/accept/route.ts`

These use `public.projects`, `public.project_members`, `public.users`, and `public.org_members` tables.

- [ ] **Step 1: Implement project by-slug lookup**

```typescript
// GET /api/projects/by-slug/[slug]
const project = await db.execute(sql`
  SELECT p.id, p.slug, pm.role as "userRole"
  FROM public.projects p
  LEFT JOIN public.project_members pm ON pm.project_id = p.id
  LEFT JOIN public.users u ON u.id = pm.user_id AND u.clerk_user_id = ${ctx.clerkUserId}
  WHERE p.slug = ${slug} AND p.org_id = ${ctx.orgId}::uuid
  LIMIT 1
`);
```

- [ ] **Step 2: Implement team list (GET) + member management (PATCH/DELETE)**

- [ ] **Step 3: Implement invitations (GET/POST/DELETE)**

- [ ] **Step 4: Implement invitation accept**

- [ ] **Step 5: Commit**

```bash
git add src/app/api/projects/ src/app/api/invitations/
git commit -m "feat(api): implement team management and invitation endpoints"
```

---

## Phase 3: UI upgrades with shadcn premium

### Task 6: Upgrade dashboard with charts

**Files:**
- Modify: `src/components/dashboard/UsageAnalytics.tsx`
- Modify: `src/components/dashboard/CoverageCard.tsx`

- [ ] **Step 1: Replace custom chart implementations with shadcn chart components**

Use `@shadcn/chart` (Recharts-based) for analytics. Import `ChartContainer`, `ChartTooltip`, etc.

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/
git commit -m "feat(ui): upgrade dashboard charts with shadcn premium"
```

---

### Task 7: Upgrade data lists with shadcn table + tabs

**Files:**
- Modify: `src/app/(app)/proposals/page.tsx`
- Modify: `src/app/(app)/agents/page.tsx`
- Modify: `src/app/(app)/dashboard/api-keys/page.tsx`

- [ ] **Step 1: Replace custom filter buttons with shadcn Tabs**
- [ ] **Step 2: Replace custom lists with shadcn Table for proposals and agents**
- [ ] **Step 3: Add shadcn Dialog for confirmation modals (approve/reject/delete)**

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/
git commit -m "feat(ui): upgrade data views with shadcn table, tabs, dialog"
```

---

### Task 8: Upgrade team page with avatar + dialog

**Files:**
- Modify: `src/app/(app)/dashboard/[projectSlug]/team/page.tsx`

- [ ] **Step 1: Add shadcn Avatar for team member display**
- [ ] **Step 2: Add AlertDialog for member removal confirmation**
- [ ] **Step 3: Add Select for role changes**

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/dashboard/
git commit -m "feat(ui): upgrade team management with shadcn avatar, dialog, select"
```

---

## Summary

| Phase | Tasks | What |
|-------|-------|------|
| 1 | Task 1 | Install 15+ shadcn premium components |
| 2 | Tasks 2-5 | Implement 15+ missing API endpoints |
| 3 | Tasks 6-8 | Upgrade UI with premium blocks |

**Parallelization:** Tasks 2-5 are fully independent (different API domains). Tasks 6-8 are fully independent (different pages). Each phase must complete before the next starts.
