---
title: MCP Auth Redesign — Clean-Start
date: 2026-04-01
status: approved
---

## Problem

Two bugs block all MCP connectivity:

1. **404 on `/api/mcp`** — The MCP handler lives at `/api/mcp/sse` but every client (Triqual plugin, Claude Code OAuth flow, token config snippets) points to `/api/mcp`. The OAuth discovery step receives an HTML 404 instead of the expected `401 WWW-Authenticate` header, so authentication cannot even begin.

2. **Token generation always fails** — `POST /api/mcp-token/generate` requires an `agentId` from human callers, but users have no agent in the DB. The UI sends only `{ label }`, so every request returns *"Provide agentId in the request body to specify the target agent."*

Secondary issue: two competing auth implementations exist (`src/lib/auth/mcp-auth.ts` legacy JWT + `src/lib/mcp/auth.ts` Clerk-native), connected via a `toV2AuthContext` compatibility shim. The database is clean so there is no reason to keep the legacy system.

## Design

### 1. Single MCP endpoint at `/api/mcp`

Create `src/app/api/mcp/route.ts` as the one and only MCP handler.

- Auth via `verifyMcpToken` from `src/lib/mcp/auth.ts` — supports both Clerk JWTs (OAuth PKCE flow) and `qth_` agent API keys natively
- Returns `401` with `WWW-Authenticate: Bearer resource_metadata="..."` when unauthenticated, enabling OAuth discovery
- Calls `setupServer` to register all tools and prompts
- `basePath: '/api/mcp'`, `maxDuration: 60`

### 2. Delete legacy auth files

| File | Action |
|------|--------|
| `src/lib/auth/mcp-auth.ts` | Delete — legacy HS256 JWT system |
| `src/lib/auth/sse-auth.ts` | Delete — thin wrapper around above |
| `src/app/api/mcp/sse/route.ts` | Delete — wrong URL, uses legacy auth |

No backward compatibility needed (clean DB, fresh start).

### 3. Auto-create user agent for token generation

In `POST /api/mcp-token/generate`, when the caller is a Clerk user and no `agentId` is provided:

1. Query `agentRegistry` for `orgId = ctx.orgId AND agentName = 'claude-code'`
2. If found → use its `id`
3. If not found → insert agent: `agentName: 'claude-code'`, `instance: user-{userId}`, `role: 'agent'`, `signingKey: randomBytes(32).toString('hex')`
4. Generate `qth_` key against that agent ID

The UI requires no changes — the label-only form works as intended.

## Auth Flow (post-redesign)

```
Claude Code / MCP Client
        │
        ▼
GET https://quoth.triqual.dev/api/mcp
        │
        ├─ No token → 401 WWW-Authenticate → OAuth PKCE flow
        │     └─ /api/oauth/authorize → Clerk login → /api/oauth/token → JWT
        │
        └─ Token present
              ├─ starts with "qth_" → verifyAgentApiKey (DB lookup)
              └─ Clerk JWT → verifyToken (@clerk/backend)
                    └─ AuthContext → MCP tools
```

## Files Changed

| File | Change |
|------|--------|
| `src/app/api/mcp/route.ts` | **Create** — unified handler |
| `src/app/api/mcp/sse/route.ts` | **Delete** |
| `src/lib/auth/mcp-auth.ts` | **Delete** |
| `src/lib/auth/sse-auth.ts` | **Delete** |
| `src/app/api/mcp-token/generate/route.ts` | **Modify** — auto-create agent |

## Out of Scope

- Changes to MCP tools (`registerAllTools`)
- Changes to OAuth authorize/token endpoints
- Changes to the UI beyond what works automatically
