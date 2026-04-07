# Security Model

**Version:** 1.0.1 | **Updated:** 2026-04-07

Complete documentation of the Quoth security architecture across both the local plugin and the cloud SaaS platform.

## Authentication Layers

Quoth uses three independent authentication mechanisms, each protecting different surfaces:

### 1. Web Users -- Clerk

**Provider**: `@clerk/nextjs` (server-side middleware)

**Middleware**: `src/middleware.ts` intercepts all requests via `clerkMiddleware()`. The matcher excludes static assets:

```typescript
matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)']
```

**Public routes** (no auth required):

| Pattern | Purpose |
|---------|---------|
| `/api/webhooks/clerk(.*)` | Clerk webhook endpoint |
| `/api/v1/health(.*)` | Health check |
| `/api/mcp(.*)` | MCP endpoints (own auth layer) |
| `/api/v1(.*)` | Agent API (own auth layer) |
| `/api/auth/(.*)`, `/api/oauth/(.*)` | OAuth flows |
| `/.well-known/(.*)` | OAuth discovery |
| `/`, `/landing`, `/manifesto`, `/protocol`, `/guide`, `/pricing` | Marketing pages |
| `/docs`, `/blog`, `/changelog`, `/compare`, `/integrations`, `/glossary`, `/terms`, `/onboarding` | Public content |
| `/sign-in`, `/sign-up` | Clerk auth components |
| `/auth/(.*)` | Auth flow pages |

**Protected routes** (Clerk session required):
- `/dashboard` and all sub-routes
- `/agents` and all sub-routes
- `/knowledge-base` and all sub-routes
- `/proposals` and all sub-routes
- Any route not matching the public route list

**Behavior**:
- Authenticated users visiting `/` are redirected to `/dashboard`
- Protected routes call `auth.protect()` which returns 401 if no valid session
- Protected pages get `X-Robots-Tag: noindex, nofollow` header
- Public marketing pages get `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`

**AI crawler tracking**: User agents matching `GPTBot`, `ClaudeBot`, `CCBot`, `Perplexity`, `OAI-SearchBot`, `Google-Extended` are logged for GEO analytics.

### 2. Agent API Keys

**Format**: `qth_` prefix + 32 random bytes as hex = 68 characters total.

Example: `qth_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2`

**Key prefix**: First 12 characters (`qth_a1b2c3d4`) stored in cleartext for identification in logs and UI.

**Storage**: SHA-256 hash of the full key stored in `agents.api_keys` table. The raw key is returned exactly once at generation time and cannot be retrieved later.

**Verification flow** (`src/lib/auth/agent-keys.ts`):

1. Check `qth_` prefix
2. SHA-256 hash the raw key
3. Look up hash in DB where `revoked_at IS NULL`
4. Check expiration (`expires_at < now()` = expired)
5. Fire-and-forget update of `last_used_at`
6. Return `AgentKeyPayload` with scopes, project restrictions, rate limit

**Scopes**: Array of permission strings, default `['read', 'write']`.

**Project restriction**: Optional `project_ids` UUID array. When set, the key can only access resources in those specific projects.

**Rate limiting**: Per-key RPM stored in `rate_limit_rpm` (default 60).

**Expiration**: Default 90 days from creation. Configurable via `expiresDays` parameter.

**Revocation**: Sets `revoked_at` timestamp. The `key_hash` index is filtered on `revoked_at IS NULL` for efficient lookup of only active keys.

**Rotation**: `rotateApiKey()` atomically revokes the old key and generates a new one with the same parameters (agent, org, scopes, project restrictions, rate limit). The old key's label gets `(rotated)` appended.

**Routes**: All `/api/v1/*` routes accept `Authorization: Bearer <qth_...>` headers. These routes are marked as public in Clerk middleware (they bypass Clerk) and authenticate via the `getAuthContext()` function which tries both Clerk JWT and agent API key.

### 3. MCP Authentication

OAuth 2.1 flow for MCP (Model Context Protocol) client authentication:

| Endpoint | Purpose |
|----------|---------|
| `/api/oauth/authorize` | OAuth authorization endpoint |
| `/api/oauth/token` | Token exchange endpoint |
| `/api/oauth/register` | Dynamic client registration |
| `/.well-known/oauth-authorization-server` | OAuth server metadata discovery |
| `/.well-known/oauth-protected-resource` | Protected resource metadata |
| `/api/mcp-token/generate` | MCP-specific token generation |
| `/api/mcp/public` | Public MCP endpoint |

MCP endpoints have their own auth layer separate from both Clerk and agent API keys.

### 4. Message Signing

Each agent in `agents.registry` has a `signing_key` field (required, NOT NULL). Messages in the `comms.messages` table carry a `signature` field for verification. This enables:

- Verifying message authenticity (the claimed sender actually sent it)
- Webhook delivery verification via HMAC signatures using the subscription's `secret` field

## API Handler Middleware Stack

Source: `src/lib/api/handler.ts`

The `createApiHandler()` wrapper applies a consistent middleware stack to all API v1 routes, executed in order:

### 1. Authentication

Three modes configured per-route:

| Mode | Behavior |
|------|----------|
| `required` | 401 if no auth context (default) |
| `optional` | Null auth context allowed, handler decides |
| `none` | Skip auth entirely |

The `getAuthContext()` function (from `src/lib/auth/clerk.ts`) attempts authentication in order:
1. Clerk JWT session
2. Agent API key from `Authorization: Bearer` header

Returns an `AuthContext` object with `userId`, `orgId`, `agentId`, etc.

### 2. Rate Limiting

Provider: `@upstash/ratelimit` with Redis sliding window algorithm.

Configuration:
- Redis connection: `KV_REST_API_URL` + `KV_REST_API_TOKEN` environment variables
- Rate limiter instances are cached per RPM value in a `Map<number, Ratelimit>`
- Cache prefix: `rl:quoth:v1:{rpm}`
- Identifier: `authCtx.agentId ?? authCtx.userId`

**Graceful fallback**: If Upstash Redis is not configured (env vars missing), all requests are allowed. This supports local development without Redis.

When rate limit is exceeded, returns HTTP 429 with `Retry-After` header:

```json
{
  "type": "https://quoth.dev/errors/rate-limited",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Rate limit exceeded. Retry after 42 seconds.",
  "retryAfter": 42
}
```

### 3. Input Validation

Source: `src/lib/api/validate.ts`

Uses Zod schemas for type-safe validation:

- **Body validation**: `validateBody(req, schema)` -- parses JSON body against Zod schema
- **Query validation**: `validateQuery(url, schema)` -- parses URL search params against Zod schema

Validation failures return HTTP 400 with structured error details:

```json
{
  "type": "https://quoth.dev/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Validation failed.",
  "validationErrors": [
    { "path": "name", "message": "Required" },
    { "path": "confidence", "message": "Expected number, received string" }
  ]
}
```

### 4. Request Timeout

Default: 30,000ms (configurable via `maxDuration` in handler config).

Uses `Promise.race()` between the handler and a timeout promise. On timeout, returns HTTP 504:

```json
{
  "type": "https://quoth.dev/errors/timeout",
  "title": "Request Timeout",
  "status": 504,
  "detail": "Request exceeded the 30000ms time limit."
}
```

## Error Handling

Source: `src/lib/api/errors.ts`

All API errors follow RFC 7807 Problem Details format with `Content-Type: application/problem+json`:

```json
{
  "type": "https://quoth.dev/errors/{error-type}",
  "title": "Human-Readable Title",
  "status": 404,
  "detail": "Longer explanation of what went wrong.",
  "instance": "/api/v1/patterns/abc123"
}
```

**Error factory functions**:

| Function | Status | Type URI |
|----------|--------|----------|
| `notFound()` | 404 | `https://quoth.dev/errors/not-found` |
| `unauthorized()` | 401 | `https://quoth.dev/errors/unauthorized` |
| `forbidden()` | 403 | `https://quoth.dev/errors/forbidden` |
| `badRequest()` | 400 | `https://quoth.dev/errors/bad-request` |
| `rateLimited()` | 429 | `https://quoth.dev/errors/rate-limited` |
| `internal()` | 500 | `https://quoth.dev/errors/internal` |

**Critical**: Unknown errors (non-AppError) are caught by `errorResponse()` and produce a generic 500 response. Internal details (stack traces, database errors, etc.) are NEVER exposed to the client. The actual error is logged server-side via `console.error`.

## Command Safety (Plugin)

Source: `quoth-plugin/hooks/hook-dispatch.js` -- `pre-bash` handler

The `PreToolUse` hook for Bash commands checks against a blocklist before allowing execution:

```javascript
const dangerous = ['rm -rf /', 'format c:', 'del /s /q c:\\', ':(){:|:&};:']
```

If a dangerous pattern is detected:
- Prints `[BLOCKED] Dangerous command detected: <pattern>` to stderr
- Exits with code 1, which causes Claude Code to abort the command

If the command is safe, prints `[OK] Command validated` to stdout.

The check is case-insensitive (`cmd.toLowerCase()`).

## Secret Management

### Cloud (SaaS)

- **API keys**: Never stored in plaintext. Only SHA-256 hashes are persisted; the raw key is returned exactly once at generation and cannot be retrieved.
- **Webhook secrets**: Stored in `agents.webhook_subscriptions.secret` for HMAC signature computation.
- **Agent signing keys**: Stored in `agents.registry.signing_key` for message authentication.
- **Environment variables**: All sensitive configuration via env vars:
  - `CLERK_SECRET_KEY` -- Clerk authentication
  - `KV_REST_API_URL`, `KV_REST_API_TOKEN` -- Upstash Redis for rate limiting
  - `DATABASE_URL` -- Neon Postgres connection
  - `AI_GATEWAY_API_KEY` -- Vercel AI Gateway for embeddings

### Plugin (Local)

- `QUOTH_API_KEY` -- Cloud sync API key (qth_* format)
- `MOONSHOT_API_KEY` -- Referenced via `file:~/.openclaw/credentials/moonshot.key`
- `AI_GATEWAY_API_KEY` -- For embedding generation
- No secrets in source code (enforced by CLAUDE.md rules)
- No `.env` files committed

## Data Isolation

### Multi-Tenancy (Cloud)

- `org_id` is present on ALL cloud tables that contain user data
- Tables: organizations, projects, agent_registry, api_keys, webhook_subscriptions, documents, chunks, messages, tasks, channels, activity, usage, etc.
- Foreign key cascades ensure data cleanup when an org is deleted

### Project Scoping (Cloud)

- `project_id` on: documents, chunks, proposals, patterns, tasks, search logs, coverage snapshots, usage, drift events
- Agent API keys can be restricted to specific `project_ids`

### Namespace Isolation (Plugin)

- Local SQLite patterns have a `namespace` column (default: `'default'`)
- Project name is auto-detected from git remote origin
- `getProjectPatterns(namespace, limit)` returns patterns matching the project namespace OR the `'global'` namespace
- Trajectory files are segregated by project: `{repo-name}-{date}.jsonl`

### Namespace Correction

The daemon's `detectProjectFromTask()` function corrects namespace misattribution when sessions run from `~` but edit project-specific files:

```javascript
const WORKSPACE_REPO_MAP = {
  ads: 'studio-pipeline',
  billing: 'billing-processor',
  curator: 'quoth',
  // ... 11 total mappings
}
```

Path patterns are matched against the task description to determine the actual project, overriding the session's default namespace.

## Database Security

### Cloud (Neon Postgres)

- **Parameterized queries**: All database access via Drizzle ORM which uses parameterized queries, preventing SQL injection
- **CHECK constraints**: Enforced on all enum-like fields:
  - Slug format: `^[a-z0-9-]+$` on organizations, projects, agent names, channel names
  - Status enums: Explicit `IN (...)` checks on all status columns
  - Role enums: Explicit `IN (...)` checks on all role columns
  - Priority ranges: `BETWEEN 1 AND 10` on task priority
- **Filtered indexes**: Indexes on `revoked_at IS NULL` for active API keys, `status = 'pending'` for pending messages, etc.
- **Row-Level Security**: Migration `005_rls.sql` sets up RLS policies

### Plugin (SQLite)

- **WAL mode**: `PRAGMA journal_mode = WAL` for concurrent read/write
- **Foreign keys**: `PRAGMA foreign_keys = ON`
- **Prepared statements**: All queries use `db.prepare()` with parameter binding
- **Lock file**: `processing.lock` prevents concurrent daemon processing

## Network Security

### Plugin

- Most hook execution is local; however, three hooks communicate with the background daemon via Unix socket (`~/.quoth/daemon.sock`) for pattern injection and routing:
  - `route`: queries daemon with `type: 'route+inject'` for task routing, pattern injection, and doc chunks
  - `session-restore`: queries daemon with `type: 'inject'` for context-aware pattern injection using prior session context
  - `subagent-start`: queries daemon with `type: 'inject'` for domain-relevant patterns scoped to the subagent's task
  - If the daemon is not running, `ensureDaemon()` auto-starts it (waits up to 5s for socket readiness)
  - All daemon queries have a 500ms timeout; hooks degrade gracefully if the daemon is unavailable
- Daemon cloud promotion uses HTTPS with 15-second timeout
- Daemon communicates locally via Unix socket (`~/.quoth/daemon.sock`), filesystem (trajectory files), and signals (SIGUSR1/SIGTERM)

### Cloud

- Public routes are explicitly allowlisted; everything else requires authentication
- API v1 routes require either Clerk JWT or agent API key
- Webhook deliveries use HMAC signature verification
- Rate limiting via distributed Redis prevents abuse
- Request timeout (30s default) prevents resource exhaustion
