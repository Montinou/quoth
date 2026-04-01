# MCP Auth Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix MCP connectivity by deleting the legacy auth system and creating a single clean `/api/mcp` endpoint with auto-agent creation for token generation.

**Architecture:** Delete three legacy files (mcp-auth.ts, sse-auth.ts, mcp/sse/route.ts), create one new route at `/api/mcp/route.ts` using `verifyMcpToken`, and patch the token generate endpoint to auto-upsert a `claude-code` agent per org on first call.

**Tech Stack:** Next.js 15, TypeScript, Clerk (`@clerk/backend`), Drizzle ORM, Neon, `mcp-handler`, `@modelcontextprotocol/sdk`

---

## Task 1: Delete legacy auth files

These three files are dead weight. Removing them first forces TypeScript to surface every import that needs updating.

**Files:**
- Delete: `src/lib/auth/mcp-auth.ts`
- Delete: `src/lib/auth/sse-auth.ts`
- Delete: `src/app/api/mcp/sse/route.ts`

**Step 1: Delete the files**

```bash
rm src/lib/auth/mcp-auth.ts
rm src/lib/auth/sse-auth.ts
rm src/app/api/mcp/sse/route.ts
```

**Step 2: Verify no other files import them**

```bash
grep -r "mcp-auth\|sse-auth\|mcp/sse" src/ --include="*.ts" --include="*.tsx"
```

Expected: no output. If any hits appear, note the files — they'll need updating in the next task.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete legacy mcp-auth, sse-auth, and sse route"
```

---

## Task 2: Create `/api/mcp/route.ts`

This is the single MCP endpoint. It uses `verifyMcpToken` from `src/lib/mcp/auth.ts` which already handles both Clerk JWTs and `qth_` agent keys.

**Files:**
- Create: `src/app/api/mcp/route.ts`
- Reference (read-only): `src/lib/mcp/auth.ts` — `verifyMcpToken`, `AuthContext`
- Reference (read-only): `src/lib/mcp/register.ts` — `registerAllTools`
- Reference (read-only): `src/lib/quoth/prompts.ts` — `getArchitectPrompt`, `getAuditorPrompt`, `getDocumenterPrompt`

**Step 1: Create the route file**

```typescript
// src/app/api/mcp/route.ts

import { createMcpHandler } from 'mcp-handler';
import { verifyMcpToken } from '@/lib/mcp/auth';
import { registerAllTools } from '@/lib/mcp/register';
import { getArchitectPrompt, getAuditorPrompt, getDocumenterPrompt } from '@/lib/quoth/prompts';
import type { NextRequest } from 'next/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '@/lib/auth/types';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.triqual.dev';

function setupServer(server: McpServer, authContext: AuthContext) {
  registerAllTools(server, authContext);

  server.registerPrompt(
    'quoth_architect',
    {
      description:
        "Code Generation Persona - Activate with '/prompt quoth_architect' in Claude Code. " +
        "Enforces 'Single Source of Truth' rules by searching Quoth before generating any code.",
    },
    async () => getArchitectPrompt()
  );

  server.registerPrompt(
    'quoth_auditor',
    {
      description:
        "Code Review Persona - Activate with '/prompt quoth_auditor' in Claude Code. " +
        "Reviews existing code against documented standards.",
    },
    async () => getAuditorPrompt()
  );

  server.registerPrompt(
    'quoth_documenter',
    {
      description:
        "Incremental Documentation Persona - Activate with '/prompt quoth_documenter' in Claude Code. " +
        "Documents new code immediately after implementation.",
    },
    async () => getDocumenterPrompt()
  );
}

function createOAuthErrorResponse(): Response {
  const resourceMetadataUrl = `${APP_URL}/.well-known/oauth-protected-resource`;
  return new Response(
    JSON.stringify({ error: 'invalid_token', error_description: 'Missing or invalid token' }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"`,
      },
    }
  );
}

async function handler(req: NextRequest): Promise<Response> {
  const authContext = await verifyMcpToken(req);

  if (!authContext) {
    return createOAuthErrorResponse();
  }

  const mcpHandler = createMcpHandler(
    (server: McpServer) => setupServer(server, authContext),
    {},
    {
      basePath: '/api/mcp',
      maxDuration: 60,
      verboseLogs: process.env.NODE_ENV === 'development',
    }
  );

  return mcpHandler(req);
}

export const GET = handler;
export const POST = handler;
```

**Step 2: Check TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. If errors appear about missing imports in `src/lib/mcp/auth.ts` or `register.ts`, fix those imports before continuing.

**Step 3: Commit**

```bash
git add src/app/api/mcp/route.ts
git commit -m "feat: add unified /api/mcp route with verifyMcpToken auth"
```

---

## Task 3: Fix token generation — auto-create `claude-code` agent

When a Clerk-authenticated user clicks "Generate Token" and has no `agentId`, the endpoint auto-upserts a `claude-code` agent for their org, then generates the key against it.

**Files:**
- Modify: `src/app/api/mcp-token/generate/route.ts`

**Step 1: Read the current file before editing**

Open `src/app/api/mcp-token/generate/route.ts` and locate the section starting at line 50:

```typescript
// Current (broken) code — lines ~50-78:
let agentId: string;

if (body.agentId) {
  // ...verify agent belongs to org...
} else if (ctx.isAgent && ctx.agentId) {
  agentId = ctx.agentId;
} else {
  return Response.json(
    { error: 'Provide "agentId" in the request body to specify the target agent.' },
    { status: 400 },
  );
}
```

**Step 2: Add the `randomBytes` import and `getDb` import at the top**

The file already imports `generateAgentApiKey`. Add `randomBytes` from crypto and `getDb`:

```typescript
// Add alongside existing imports:
import { randomBytes } from 'crypto';
import { getDb } from '@/db/connection';
import { agentRegistry } from '@/db/schema';
```

Note: `agentRegistry` and `eq` are already imported. Check the existing imports to avoid duplicates.

**Step 3: Replace the broken `agentId` resolution block**

Replace the entire `let agentId` block (the `if/else if/else` that returns 400) with:

```typescript
let agentId: string;

if (body.agentId) {
  // Caller specified an agent — verify it belongs to this org
  const [agent] = await db
    .select({ id: agentRegistry.id })
    .from(agentRegistry)
    .where(
      and(
        eq(agentRegistry.id, body.agentId),
        eq(agentRegistry.orgId, ctx.orgId),
      ),
    )
    .limit(1);

  if (!agent) {
    return Response.json({ error: 'Agent not found in your organization.' }, { status: 404 });
  }

  agentId = agent.id;
} else if (ctx.isAgent && ctx.agentId) {
  // Agent generating a key for itself
  agentId = ctx.agentId;
} else {
  // Human caller with no agentId — auto-upsert the org's default claude-code agent
  const rawDb = getDb();

  const [existing] = await rawDb
    .select({ id: agentRegistry.id })
    .from(agentRegistry)
    .where(
      and(
        eq(agentRegistry.orgId, ctx.orgId),
        eq(agentRegistry.agentName, 'claude-code'),
      ),
    )
    .limit(1);

  if (existing) {
    agentId = existing.id;
  } else {
    const [created] = await rawDb
      .insert(agentRegistry)
      .values({
        orgId: ctx.orgId,
        agentName: 'claude-code',
        displayName: 'Claude Code',
        instance: `user-${ctx.userId}`,
        role: 'agent',
        signingKey: randomBytes(32).toString('hex'),
      })
      .returning({ id: agentRegistry.id });

    if (!created) {
      return Response.json({ error: 'Failed to initialize agent.' }, { status: 500 });
    }

    agentId = created.id;
  }
}
```

**Step 4: Check TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. Common mistake: duplicate imports. Check that `eq`, `and`, `agentRegistry` aren't imported twice.

**Step 5: Commit**

```bash
git add src/app/api/mcp-token/generate/route.ts
git commit -m "fix: auto-create claude-code agent for token generation"
```

---

## Task 4: Remove the `clerk.ts` backward-compat comment

The comment in `src/lib/auth/clerk.ts` still references the deleted `mcp-auth.ts` as "preserved for backward compatibility". Clean it up.

**Files:**
- Modify: `src/lib/auth/clerk.ts:7`

**Step 1: Remove the stale reference**

Find line 7 in `src/lib/auth/clerk.ts`:
```typescript
 * Legacy MCP JWT auth is preserved in mcp-auth.ts for backward compatibility.
```

Delete that line entirely.

**Step 2: Commit**

```bash
git add src/lib/auth/clerk.ts
git commit -m "chore: remove stale mcp-auth backward-compat comment"
```

---

## Task 5: Build verification + end-to-end test

**Step 1: Run full build**

```bash
npm run build
```

Expected: successful build, zero TypeScript errors, zero broken imports. If the build fails, fix errors before proceeding.

**Step 2: Verify token generation works**

1. Open `https://quoth.triqual.dev/dashboard/api-keys` (or local dev)
2. Click "+ Generate Token", enter a label, click "Generate Token"
3. Expected: token is displayed. Error toast should no longer appear.

**Step 3: Verify MCP connection**

In Claude Code, check the Triqual plugin MCP status:
- Status should change from "needs authentication" to the OAuth flow
- Complete the OAuth flow (login at `/auth/mcp-login`)
- Expected: MCP server connects, tools are available

**Step 4: Verify `qth_` token works**

Copy the generated token from Step 2 and add to local `.mcp.json` or Claude Code config:
```json
{
  "mcpServers": {
    "quoth": {
      "url": "https://quoth.triqual.dev/api/mcp",
      "headers": { "Authorization": "Bearer qth_..." }
    }
  }
}
```
Expected: connects without auth prompt, tools available immediately.

**Step 5: Final commit**

```bash
git add -A
git commit -m "fix: complete mcp auth redesign - single endpoint, auto-agent, clerk-native"
```

---

## Summary of Changes

| File | Action |
|------|--------|
| `src/lib/auth/mcp-auth.ts` | Deleted |
| `src/lib/auth/sse-auth.ts` | Deleted |
| `src/app/api/mcp/sse/route.ts` | Deleted |
| `src/app/api/mcp/route.ts` | Created |
| `src/app/api/mcp-token/generate/route.ts` | Modified |
| `src/lib/auth/clerk.ts` | Minor comment cleanup |
