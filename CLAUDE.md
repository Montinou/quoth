# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quoth is an MCP (Model Context Protocol) server that acts as a "Single Source of Truth" auditor for codebases. It enforces consistency between code and documentation by providing AI agents with tools to search, read, and propose updates to a knowledge base.

**Production URL**: https://quoth.ai-innovation.site

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

### MCP Server (src/lib/quoth/)

The core MCP implementation exposes 3 tools and 2 prompts:

**Tools:**
- `quoth_search_index` - Semantic vector search using Gemini embeddings (768 dimensions)
- `quoth_read_doc` - Retrieves full document content from Supabase
- `quoth_propose_update` - Submits documentation update proposals with evidence

**Prompts (Personas):**
- `quoth_architect` - For code generation, enforces "Single Source of Truth" rules
- `quoth_auditor` - For code review, distinguishes between "New Features" and "Bad Code"

### API Route

`src/app/api/[transport]/route.ts` - MCP endpoint using `mcp-handler` package. Supports Streamable HTTP transport at `/api/mcp`.

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
  └─ UNIQUE(project_id, user_id)

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
- Full project management

### API Routes Protection

**Dashboard Routes:**
- `/dashboard` - Protected by middleware, shows user's projects
- `/dashboard/api-keys` - Generate and manage MCP tokens
- Middleware redirects unauthenticated users to `/auth/login`

**Auth Routes:**
- `/auth/login` - Email/password login with redirect support
- `/auth/signup` - Create account + auto-create project
- `/auth/verify-email` - Email verification instructions

**Proposals API:**
- `GET /api/proposals` - List proposals (filtered by user's projects)
- `GET /api/proposals/:id` - Get proposal (verify project access)
- `POST /api/proposals/:id/approve` - Approve (admin only)
- `POST /api/proposals/:id/reject` - Reject (admin only)

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

## Key Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `mcp-handler` - MCP server handler for Next.js
- `@supabase/supabase-js` - Supabase client for vector storage
- `@google/generative-ai` - Gemini embeddings
- `gray-matter` - YAML frontmatter parsing
- `zod` - Schema validation
- `lucide-react` - Icons (1.5px stroke weight per branding)
