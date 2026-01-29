# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quoth v2.0 is an **AI Memory** system that gives Claude persistent memory across sessions. Unlike traditional documentation tools, Quoth creates a bidirectional learning loop: it both retrieves AND stores knowledge, mediated by an intelligent `quoth-memory` subagent.

**Key v2.0 Features:**
- **Local-first storage** - `.quoth/` folder persists knowledge across sessions
- **quoth-memory subagent** - Sonnet-powered memory interface (~500 token summaries)
- **Configurable strictness** - `blocking`, `reminder`, or `off` modes
- **Session logging** - All actions captured to `.quoth/sessions/`
- **Knowledge promotion** - User-approved transfer to local/remote storage

**Production URL**: https://quoth.ai-innovation.site

## Quick Reference - Using Quoth Prompts

**IMPORTANT:** Quoth prompts are personas that change Claude's behavior. They are NOT tools.

**How to activate:**
```bash
# In Claude Code, type one of these slash commands:
/prompt quoth_architect     # Before writing code - enforces documented patterns
/prompt quoth_auditor       # During code review - identifies violations vs new patterns
/prompt quoth_documenter    # While building - documents new code immediately
```

**What happens when you activate a prompt:**
- Claude loads a specialized system prompt
- Claude automatically uses Quoth tools (`quoth_search_index`, `quoth_read_doc`, etc.)
- Claude follows the persona's rules for that conversation

**Common mistake:** Trying to call prompts like tools (e.g., asking "use quoth_architect"). They're activated with `/prompt` command.

## Installation (for Claude Code Users)

### Recommended: Plugin Install (MCP + Hooks + Skills)

Install the complete Quoth plugin via Claude Code marketplace:

```bash
# 1. Add marketplace (one time)
/plugin marketplace add Montinou/quoth-mcp

# 2. Install plugin
/plugin install quoth@quoth-marketplace
```

This bundles:
- MCP server with all tools
- Session hooks for memory management
- `/quoth-init` and `/quoth-genesis` skills
- `quoth-memory` subagent for context queries

**What you get:**

**Tools (called automatically by Claude):**
- `quoth_search_index` - Semantic search across documentation
- `quoth_read_doc` - Read full document content
- `quoth_propose_update` - Submit documentation updates
- `quoth_guidelines` - Adaptive guidelines tool (replaces heavy personas)
- `quoth_list_templates` - List available document templates
- `quoth_get_template` - Fetch template structure
- `quoth_read_chunks` - Fetch specific chunks by ID

**Prompts (YOU trigger manually with slash commands):**
- `/prompt quoth_architect` - Activate code generation persona (enforces "Single Source of Truth")
- `/prompt quoth_auditor` - Activate documentation review persona (distinguishes new features from bad code)
- `/prompt quoth_documenter` - Activate incremental documentation persona (document code as you build)

**Skills:**
- `/quoth-init` - Initialize AI Memory for a project (creates `.quoth/` folder)
- `/quoth-genesis` - Bootstrap project documentation (minimal/standard/comprehensive)

**Agents:**
- `quoth-memory` - Sonnet-powered memory interface for context queries

**Hooks:**
- `SessionStart` - Initialize session, inject context from `.quoth/*.md`
- `PreToolUse` - Gate enforcement for Edit/Write (if blocking mode)
- `PostToolUse` - Log actions to `.quoth/sessions/{id}/`
- `SubagentStart/Stop` - Context injection (excludes quoth-memory)
- `Stop` - Knowledge promotion prompt at session end

### Alternative: MCP Server Only (No Hooks)

If you prefer just the MCP server without hooks:

```bash
# Add to Claude Code with OAuth authentication
claude mcp add --transport http quoth https://quoth.ai-innovation.site/api/mcp
```

When prompted, select "Authenticate" from the `/mcp` menu. Your browser will open for Quoth login, and once authenticated, Claude Code is automatically connected.

This gives access to all MCP tools but requires manual invocation (no automatic hook reminders).

### How to Use Prompts

**MCP prompts are NOT tools** - they configure Claude's behavior/persona for the conversation. To use them:

1. **In Claude Code CLI**, type:
   ```
   /prompt quoth_architect
   ```

2. **Claude will load the architect persona** and start following "Single Source of Truth" rules

3. **Continue your conversation** - Claude will now search Quoth before generating code

**Example Workflow:**
```
You: /prompt quoth_architect
Claude: [Loads architect system prompt]
You: Create a Vitest test for the login function
Claude: [Searches quoth_search_index for "vitest test patterns"]
Claude: [Reads relevant docs with quoth_read_doc]
Claude: [Generates code following documented patterns]
```

**When to Use Each Prompt:**
- **quoth_architect**: When you want Claude to write code/tests that strictly follow documented patterns
- **quoth_auditor**: When you want Claude to review existing code and identify violations vs. new patterns
- **quoth_documenter**: When you want Claude to document new code immediately after building it

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
npm run dev          # Start Next.js development server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Run ESLint

# RAG Pipeline
npm run verify:rag   # Test RAG pipeline works correctly
npm run reindex      # Re-index all documents (clears and regenerates all embeddings)
npm run setup:wasm   # Setup Tree-sitter WASM files for AST chunking
```

## Database Migrations

Migrations are stored in `supabase/migrations/` and must be applied to the production database.

### Applying Migrations via psql

The recommended way to apply migrations is using `psql` with the database password from `.env`:

```bash
# Apply a specific migration file
PGPASSWORD="YOUR_DB_PASSWORD" psql "postgres://postgres.PROJECT_REF@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require" -f supabase/migrations/XXX_migration_name.sql

# Example with actual values from .env
PGPASSWORD="$(grep POSTGRES_PASSWORD .env | cut -d '=' -f2 | tr -d '"')" \
psql "$(grep POSTGRES_URL_NON_POOLING .env | cut -d '=' -f2 | tr -d '"')" \
-f supabase/migrations/012_fix_user_deletion_cascade.sql
```

### Alternative: Supabase CLI (if configured)

```bash
# This requires proper authentication setup
supabase db push --linked
```

**Note**: The Supabase CLI method may require password configuration. Use the `psql` method above for more reliable migrations.

### Migration Best Practices

1. Always test migrations locally first
2. Use transactions (`BEGIN;` / `COMMIT;`) in migration files
3. Include rollback instructions as comments
4. Name migrations sequentially: `XXX_descriptive_name.sql`
5. Document breaking changes in migration comments

## Architecture

Quoth uses the **Genesis Strategy v2.0** pattern:

1. **User Confirmation**: Genesis asks user about documentation depth before starting
2. **Persona Injection**: The `quoth_genesis` tool delivers a phased system prompt
3. **Local Analysis**: The AI client reads local files using its native capabilities
4. **Incremental Upload**: Each document is uploaded immediately after creation (not batched)
5. **Automatic Versioning**: Database triggers preserve history automatically

### Genesis v2.0 Depth Levels

| Level | Documents | Time | Use Case |
|-------|-----------|------|----------|
| `minimal` | 3 | ~3 min | Quick overview, basic context |
| `standard` | 5 | ~7 min | Team onboarding, regular development |
| `comprehensive` | 11 | ~20 min | Enterprise audit, full documentation |

### Genesis Phases

- **Phase 0: Configuration** - Present settings, wait for user confirmation
- **Phase 1: Foundation** (all depths) - `project-overview.md`, `tech-stack.md`
- **Phase 2: Architecture** (all depths) - `repo-structure.md`
- **Phase 3: Patterns** (standard+) - `coding-conventions.md`, `testing-patterns.md`
- **Phase 4: Contracts** (comprehensive) - `api-schemas.md`, `database-models.md`, `shared-types.md`
- **Phase 5: Advanced** (comprehensive) - `error-handling.md`, `security-patterns.md`, `tech-debt.md`

### Key Differences from Previous Architecture

- ❌ No GitHub integration - Supabase is the single source of truth
- ❌ No GitHub webhooks - Direct writes to database
- ✅ Configurable approval flow per project (`require_approval` flag)
- ✅ Incremental re-indexing with chunk hashes (~90% token savings)
- ✅ Automatic version history via database triggers

### MCP Server (src/lib/quoth/)

The core MCP implementation exposes 4 tools and 2 prompts:

**Tools:**
- `quoth_search_index` - Semantic vector search using Jina embeddings (512d) + Cohere reranking
- `quoth_read_doc` - Retrieves full document content from Supabase
- `quoth_propose_update` - Submits documentation update proposals with evidence
- `quoth_genesis` - Genesis v2.0: phased documentation with depth levels (minimal/standard/comprehensive)

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

## Accessibility Guidelines

### Text Contrast on Dark Backgrounds

When using dark backgrounds (`bg-obsidian`, `bg-charcoal`), follow these color patterns:

- **Body text**: `text-gray-400` (8.03:1 contrast, WCAG AAA)
- **Headings**: `text-white` (21:1 contrast)
- **Accent labels**: `text-violet-ghost` (14.68:1 contrast)
- **Never use**: `text-graphite` (only 1.35:1 contrast - accessibility failure)

### Design System Color Usage

| Color | Purpose | Usage |
|-------|---------|-------|
| `graphite` (#262626) | Background | Card backgrounds, subtle dividers |
| `gray-400` (#9CA3AF) | Body text | Primary readable text on dark backgrounds |
| `white` (#FFFFFF) | Headings | Maximum contrast for emphasis |
| `violet-ghost` (#DDD6FE) | Accent text | Small labels, secondary text with violet theme |

**Important**: The `graphite` color is defined as a background color (see "Backgrounds (The Void)" in [tailwind.config.ts](tailwind.config.ts#L15-L17)). Using it for text on dark backgrounds results in WCAG accessibility failures. Always use `text-gray-400` for readable body text.

## Vector Search Architecture

Quoth uses a RAG pipeline: Jina Embeddings → Supabase Vector Search → Cohere Rerank.

**Storage (Supabase):**
- `projects` - Multi-tenant project support
- `documents` - Markdown content with checksums
- `document_embeddings` - 512-dimension vectors from Jina

**Embedding (Jina):**
- Model: `jina-embeddings-v3` (512 dimensions)
- Chunking: AST-aware via Tree-sitter for code, fallback to H2 headers for markdown

**Reranking (Cohere):**
- Model: `rerank-english-v3.0`
- Initial fetch: 50 candidates from vector search
- Final return: Top 15 after rerank (min relevance score: 0.5)
- Fallback: Returns top 10 vector results if Cohere unavailable

**Search Flow:**
1. User query → Jina embedding (512d)
2. Supabase `match_documents` RPC (cosine similarity, fetch 50)
3. Cohere rerank candidates
4. Return top 15 results with snippets

**Environment Variables:**
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
JWT_SECRET=your-secret-here-32-bytes
JINA_API_KEY=jina_xxx...              # Jina embeddings (512d vectors)
COHERE_API_KEY=xxx...                 # Cohere reranking (optional, improves search quality)
GEMINIAI_API_KEY=AIza...              # Gemini 2.0 Flash for dashboard UI responses
```

**RAG Pipeline Flows:**

```
Dashboard UI (/api/knowledge-base/ask):
┌─────────────┐    ┌──────────────┐    ┌────────────────┐    ┌─────────────────┐
│ User Query  │───▶│ Jina Embed   │───▶│ Supabase       │───▶│ Cohere Rerank   │
│             │    │ (512d)       │    │ Vector Search  │    │ (top 15)        │
└─────────────┘    └──────────────┘    └────────────────┘    └────────┬────────┘
                                                                      │
                                                                      ▼
┌─────────────┐    ┌──────────────────────────────────────────────────────────┐
│ Natural     │◀───│ Gemini 2.0 Flash (XML prompt transforms RAG → response) │
│ Response    │    └──────────────────────────────────────────────────────────┘
└─────────────┘

MCP Clients (quoth_search_index):
┌─────────────┐    ┌──────────────┐    ┌────────────────┐    ┌─────────────────┐
│ AI Query    │───▶│ Jina Embed   │───▶│ Supabase       │───▶│ Cohere Rerank   │
│             │    │ (512d)       │    │ Vector Search  │    │ (top 15)        │
└─────────────┘    └──────────────┘    └────────────────┘    └────────┬────────┘
                                                                      │
                                                                      ▼
┌─────────────┐    ┌──────────────────────────────────────────────────────────┐
│ Claude/     │◀───│ Raw XML results (AI client transforms using own model)  │
│ Cursor/etc  │    └──────────────────────────────────────────────────────────┘
└─────────────┘
```

- **Dashboard**: Gemini 2.0 Flash receives an XML-structured prompt with pipeline context and generates human-readable responses
- **MCP**: AI agents receive structured XML results with trust levels and handle transformation themselves

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
- `cohere-ai` - Cohere reranking for improved search relevance
- `web-tree-sitter` - AST-aware code chunking
- `gray-matter` - YAML frontmatter parsing
- `zod` - Schema validation
- `jose` - JWT token verification
- `resend` - Email delivery service for team invitations
- `lucide-react` - Icons (1.5px stroke weight per branding)

## Troubleshooting Quoth Prompts

### "The architect/auditor prompt isn't working"

**Problem:** You're trying to use prompts like tools

**Wrong approach:**
```
❌ "Use quoth_architect to generate this code"
❌ "Call the quoth_auditor tool"
❌ Expecting Claude to automatically use architect mode
```

**Correct approach:**
```
✅ /prompt quoth_architect
   [Then continue with your request]

✅ /prompt quoth_auditor
   [Then ask for code review]
```

### "I don't see the prompts available"

**Check:**
1. Verify Quoth MCP is connected: `claude mcp list` should show `quoth`
2. Verify authentication: Try using a Quoth tool first (e.g., "search for test patterns in Quoth")
3. Check MCP server logs for errors
4. Try reconnecting: `claude mcp remove quoth` then `claude mcp add --transport http quoth https://quoth.ai-innovation.site/api/mcp`

### "Prompts list in /prompt menu but don't activate"

**Possible causes:**
1. **MCP server not responding** - Check server is running at https://quoth.ai-innovation.site
2. **Invalid token** - Regenerate API key from dashboard
3. **Project access** - Verify you have access to a project with documentation

**Test:**
```bash
# Test if MCP server is accessible
curl -H "Authorization: Bearer YOUR_TOKEN" https://quoth.ai-innovation.site/api/mcp
```

### "How do I know if a prompt is active?"

**Signs the architect prompt is active:**
- Claude searches Quoth before generating code
- Claude mentions "searching for patterns in Quoth"
- Claude cites documentation paths in responses

**Signs the auditor prompt is active:**
- Claude compares code against docs
- Claude reports "VIOLATIONS" and "UPDATES_NEEDED"
- Claude proposes documentation updates

**Signs the documenter prompt is active:**
- Claude asks about documentation type
- Claude fetches templates before writing
- Claude structures docs with H2 sections

### "Prompts vs Tools - What's the difference?"

| Aspect | Tools | Prompts |
|--------|-------|---------|
| **What they are** | Functions that perform actions | System prompts that configure behavior |
| **How to use** | Claude calls them automatically | You activate with `/prompt` command |
| **Examples** | `quoth_search_index`, `quoth_read_doc` | `quoth_architect`, `quoth_auditor` |
| **When to use** | Never - Claude decides | Before starting a task |
| **Visibility** | Appear in tool calls | Change Claude's persona |

### "Can I use multiple prompts at once?"

**No.** Each `/prompt` command replaces the previous persona. Choose one based on your task:
- **Writing code?** → `/prompt quoth_architect`
- **Reviewing code?** → `/prompt quoth_auditor`
- **Documenting code?** → `/prompt quoth_documenter`

### "Do I need to reactivate prompts for each message?"

**No.** Once activated with `/prompt quoth_architect`, the persona stays active for the entire conversation until you:
- Start a new conversation
- Activate a different prompt
- Reset the context

### "Prompts work but Claude isn't searching Quoth"

**This means the prompt activated but Claude decided not to search.** Possible reasons:
1. Your request doesn't require documentation (e.g., "What time is it?")
2. The task is too general (be specific: "Create a Vitest test" not "write a test")
3. Claude thinks it already knows the pattern (remind it: "Check Quoth first")

**Force search:**
```
You: /prompt quoth_architect
Claude: [Architect activated]
You: Before generating any code, search Quoth for "vitest mocking patterns"
```
