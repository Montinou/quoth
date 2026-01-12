# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quoth is an MCP (Model Context Protocol) server that acts as a "Single Source of Truth" auditor for codebases. It enforces consistency between code and documentation by providing AI agents with tools to search, read, and propose updates to a knowledge base.

**Production URL**: https://quoth.ai-innovation.site

## Installation (for Claude Code Users)

### Quick Start (OAuth - Recommended)

```bash
# Add to Claude Code with OAuth authentication
claude mcp add --transport http quoth https://quoth.ai-innovation.site/api/mcp
```

When prompted, select "Authenticate" from the `/mcp` menu. Your browser will open for Quoth login, and once authenticated, Claude Code is automatically connected.

This gives access to:
- `quoth_search_index` - Semantic search across documentation
- `quoth_read_doc` - Read full document content
- `quoth_propose_update` - Submit documentation updates
- `quoth_architect` / `quoth_auditor` prompts

### Public Demo (No Auth)

For read-only access without authentication:

```bash
claude mcp add --transport http quoth-public https://quoth.ai-innovation.site/api/mcp/public
```

### Manual Configuration

If you prefer manual token-based setup:

```bash
# Option 1: HTTP Transport with header auth
claude mcp add --transport http quoth https://quoth.ai-innovation.site/api/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"

# Option 2: SSE Transport with query param (for EventSource clients)
claude mcp add --transport sse quoth "https://quoth.ai-innovation.site/api/mcp/sse?token=YOUR_TOKEN"
```

Get tokens from: https://quoth.ai-innovation.site/dashboard/api-keys

### CLI Commands

```bash
quoth login    # Authenticate and configure Claude Code
quoth logout   # Remove authentication (keeps public access)
quoth status   # Show current configuration
quoth help     # Show help message
```

## Development Commands

```bash
npm run dev      # Start Next.js development server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint

# Indexing (after adding new docs to quoth-knowledge-base/)
npx tsx scripts/index-knowledge-base.ts
```

## Architecture

Quoth uses the **Genesis Strategy** pattern:

1. **Persona Injection**: The `quoth_genesis` tool delivers a system prompt
2. **Local Analysis**: The AI client reads local files using its native capabilities
3. **Direct Save**: Changes are saved directly to Supabase (or via proposal if configured)
4. **Incremental Indexing**: Only changed chunks are re-embedded (token optimization)
5. **Automatic Versioning**: Database triggers preserve history automatically

### Key Differences from Previous Architecture

- ❌ No GitHub integration - Supabase is the single source of truth
- ❌ No GitHub webhooks - Direct writes to database
- ✅ Configurable approval flow per project (`require_approval` flag)
- ✅ Incremental re-indexing with chunk hashes (~90% token savings)
- ✅ Automatic version history via database triggers

### MCP Server (src/lib/quoth/)

The core MCP implementation exposes 4 tools and 2 prompts:

**Tools:**
- `quoth_search_index` - Semantic vector search using Gemini embeddings (768 dimensions)
- `quoth_read_doc` - Retrieves full document content from Supabase
- `quoth_propose_update` - Submits documentation update proposals with evidence
- `quoth_genesis` - Injects Genesis Architect persona for codebase analysis

**Prompts (Personas):**
- `quoth_architect` - For code generation, enforces "Single Source of Truth" rules
- `quoth_auditor` - For code review, distinguishes between "New Features" and "Bad Code"

### API Routes

**MCP Endpoints:**
- `src/app/api/[transport]/route.ts` - Authenticated MCP at `/api/mcp` (OAuth or API key)
- `src/app/api/mcp/sse/route.ts` - SSE transport at `/api/mcp/sse` (query param token)
- `src/app/api/mcp/public/route.ts` - Public demo at `/api/mcp/public` (no auth)

**OAuth Endpoints:**
- `src/app/.well-known/oauth-authorization-server/route.ts` - OAuth metadata (RFC 8414)
- `src/app/api/oauth/authorize/route.ts` - Authorization endpoint
- `src/app/api/oauth/token/route.ts` - Token exchange
- `src/app/api/oauth/register/route.ts` - Dynamic client registration

### Knowledge Base (quoth-knowledge-base/)

Markdown files with YAML frontmatter organized by type:
- `patterns/` - Testing patterns (Vitest, Playwright, integration)
- `architecture/` - Repo structure documentation
- `contracts/` - API schemas, database models, shared types
- `meta/` - Validation log for update proposals

Document frontmatter schema:
```yaml
id: string
type: testing-pattern | architecture | contract | meta
related_stack: string[] (optional)
last_verified_commit: string (optional)
last_updated_date: string
status: active | deprecated | draft
```

### Landing Page (src/app/)

Next.js 16 App Router with "Intellectual Neo-Noir" design system:
- `page.tsx` - Landing page components (Navbar, Hero, CodeDemo, Features, Footer)
- `globals.css` - Tailwind v4 theme with custom colors and glassmorphism utilities
- `layout.tsx` - Root layout with Cinzel (serif), Geist Sans, Geist Mono fonts

## Tailwind v4 Configuration

Uses CSS-first configuration with `@theme` directive in `globals.css`:
- Colors: `obsidian`, `charcoal`, `graphite`, `violet-spectral`, `violet-glow`, `violet-ghost`
- Custom utilities: `.glass-panel`, `.glass-btn`, `.drift-highlight`, `.card-glow`

## Vector Search Architecture

Quoth uses Supabase + Gemini for semantic search:

**Storage (Supabase):**
- `projects` - Multi-tenant project support
- `documents` - Markdown content with checksums
- `document_embeddings` - 768-dimension vectors from Gemini

**Embedding (Gemini):**
- Model: `text-embedding-004` (768 dimensions)
- Chunking: Split by H2 headers
- Rate limit: 15 RPM (4s delay between requests)

**Search Flow:**
1. User query → Gemini embedding
2. Supabase `match_documents` RPC (cosine similarity)
3. Return ranked results with snippets

**Environment Variables:**
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GEMINIAI_API_KEY=AIza...
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
JWT_SECRET=your-secret-here-32-bytes
```

## Authentication & Multi-Tenancy

Quoth implements comprehensive multi-tenant authentication using Supabase Auth + RLS + JWT tokens:

### Architecture Overview

**Authentication Layer:**
- Email/password authentication via Supabase Auth
- Cookie-based sessions using `@supabase/ssr`
- JWT tokens for MCP server authentication
- Auto-created default project on user signup

**Multi-Tenancy:**
- Project-based isolation with Row Level Security (RLS)
- Role-based access control: `admin`, `editor`, `viewer`
- Each user auto-gets `{username}-knowledge-base` project
- Existing `quoth-knowledge-base` remains public demo

### Database Schema

**Core Tables:**
```sql
profiles              -- User metadata (synced with auth.users)
  ├─ id (uuid, FK to auth.users)
  ├─ email, username, full_name
  └─ default_project_id

project_members       -- User-project-role relationships
  ├─ project_id (FK to projects)
  ├─ user_id (FK to profiles)
  ├─ role (admin|editor|viewer)
  ├─ invited_by (FK to profiles)
  └─ UNIQUE(project_id, user_id)

project_invitations   -- Pending team invitations
  ├─ id (uuid)
  ├─ project_id (FK to projects)
  ├─ email (invited email address)
  ├─ role (admin|editor|viewer)
  ├─ token (unique secure token)
  ├─ expires_at (7-day expiration)
  ├─ invited_by (FK to profiles)
  └─ UNIQUE(project_id, email)

project_api_keys      -- JWT tokens for MCP
  ├─ id (jti from JWT)
  ├─ project_id
  ├─ key_hash (SHA256 of token)
  ├─ key_prefix (first 12 chars)
  ├─ label, expires_at
  └─ last_used_at

projects             -- Extended with multi-tenancy
  ├─ is_public (boolean)
  └─ owner_id (FK to profiles)
```

**RLS Policies:**
- All tables have RLS enabled
- Users see public projects + their own projects
- Helper functions: `has_project_access()`, `is_project_admin()`, `can_edit_project()`
- Auto-create profile + project on signup via trigger

### MCP Authentication Flow

**Option A: CLI (Recommended)**

```bash
quoth login
# Opens browser → Sign in → Generate token → Paste in terminal
# Automatically configures Claude Code
```

**Option B: Manual Dashboard**

1. **Generate Token:**
   - User visits [/dashboard/api-keys](https://quoth.ai-innovation.site/dashboard/api-keys)
   - Clicks "Generate New Key"
   - System creates JWT token with HS256 algorithm
   - Token payload: `{ project_id, user_id, role, label }`
   - Token stored as SHA256 hash in `project_api_keys`

2. **Use Token:**
   - Add to Claude Desktop config:
   ```json
   {
     "mcpServers": {
       "quoth": {
         "url": "https://quoth.ai-innovation.site/api/mcp",
         "headers": {
           "Authorization": "Bearer YOUR_TOKEN"
         }
       }
     }
   }
   ```

3. **Verify Token:**
   - `createAuthenticatedMcpHandler` wraps MCP endpoint
   - Extracts `Authorization: Bearer <token>` header
   - Verifies JWT using `jose` library
   - Extracts `authContext` from payload
   - Passes context to MCP tools

4. **Enforce Isolation:**
   - All MCP tools receive `authContext.project_id`
   - `searchDocuments(query, projectId)` filters by project
   - `readDocument(docId, projectId)` filters by project
   - `quoth_propose_update` checks role (`viewer` cannot propose)

### Role-Based Access Control

**Viewer:**
- Can search and read documents
- Cannot propose updates
- Read-only access

**Editor:**
- All viewer permissions
- Can propose documentation updates via MCP
- Proposals require admin approval

**Admin:**
- All editor permissions
- Can approve/reject proposals
- Can generate API keys
- Can invite and manage team members
- Can change member roles
- Can remove team members
- Full project management

### API Routes Protection

**Dashboard Routes:**
- `/dashboard` - Protected by middleware, shows user's projects
- `/dashboard/api-keys` - Generate and manage MCP tokens
- `/dashboard/[projectSlug]/team` - Team management page (view/manage members)
- `/invitations/accept` - Accept team invitation via token
- Middleware redirects unauthenticated users to `/auth/login`

**Auth Routes:**
- `/auth/login` - Email/password login with redirect support
- `/auth/signup` - Create account + auto-create project
- `/auth/verify-email` - Email verification instructions
- `/auth/cli` - CLI authentication page (token generation for `quoth login`)

**Proposals API:**
- `GET /api/proposals` - List proposals (filtered by user's projects)
- `GET /api/proposals/:id` - Get proposal (verify project access)
- `POST /api/proposals/:id/approve` - Approve (admin only)
- `POST /api/proposals/:id/reject` - Reject (admin only)

**Team Management API:**
- `GET /api/projects/by-slug/:slug` - Get project by slug
- `GET /api/projects/:projectId/team` - List team members
- `PATCH /api/projects/:projectId/team/:memberId` - Update member role (admin only)
- `DELETE /api/projects/:projectId/team/:memberId` - Remove member (admin or self)
- `GET /api/projects/:projectId/invitations` - List pending invitations (admin only)
- `POST /api/projects/:projectId/invitations` - Invite user by email (admin only)
- `DELETE /api/projects/:projectId/invitations/:invitationId` - Cancel invitation (admin only)
- `POST /api/invitations/accept` - Accept invitation with token
- `GET /api/invitations/pending` - List user's pending invitations

**MCP Token API:**
- `POST /api/mcp-token/generate` - Generate JWT (editor/admin only)
- `GET /api/mcp-token/list` - List user's API keys

### Security Features

**Token Security:**
- 90-day expiration
- SHA256 hashed storage
- Only prefix visible in UI
- Rate limiting on generation
- Revocation via database deletion

**Session Security:**
- HTTP-only cookies
- Secure flag in production
- SameSite=Lax protection
- Automatic refresh
- Cleanup on logout

**RLS Enforcement:**
- Database-level isolation
- Cannot bypass via direct queries
- Supabase Service Role for MCP server
- User sessions for web UI

**Team Invitation Security:**
- Invitations expire after 7 days
- Unique crypto-generated tokens (32 bytes)
- Email verification on acceptance
- Cannot invite existing members
- Admin-only invitation capability
- Automatic cleanup of expired invitations

## Team Collaboration

Quoth supports multi-user collaboration on projects through a comprehensive invitation system:

### Inviting Team Members

**Admin Capabilities:**
1. Visit `/dashboard/[projectSlug]/team`
2. Click "Invite Member" button
3. Enter email address and select role (admin/editor/viewer)
4. System sends invitation email with secure token
5. Invitation valid for 7 days

**Invitation Email:**
- Branded "Intellectual Neo-Noir" design via Resend
- Includes project name, inviter name, and role description
- One-click acceptance link with embedded token
- Lists role-specific permissions

**Accepting Invitations:**
1. User clicks link in email
2. If not signed in, prompted to sign in or create account
3. Email verification ensures invitation sent to correct user
4. Upon acceptance, automatically added to project with specified role
5. Invitation deleted after successful acceptance

### Managing Team Members

**For Admins:**
- View all team members with roles
- Change member roles (viewer → editor → admin)
- Remove members from project
- View and cancel pending invitations
- Protected actions: cannot remove last admin

**For All Users:**
- View team member list
- See own role and permissions
- Leave project (if not the last admin)

## Key Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `mcp-handler` - MCP server handler for Next.js
- `@supabase/supabase-js` - Supabase client for vector storage
- `@supabase/ssr` - Server-side Supabase client with cookie management
- `@google/generative-ai` - Gemini embeddings
- `gray-matter` - YAML frontmatter parsing
- `zod` - Schema validation
- `jose` - JWT token verification
- `resend` - Email delivery service for team invitations
- `@react-email/components` - Email template components
- `lucide-react` - Icons (1.5px stroke weight per branding)
