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
```

## Architecture

### MCP Server (src/lib/quoth/)

The core MCP implementation exposes 3 tools and 2 prompts:

**Tools:**
- `quoth_search_index` - Searches documentation by topic, returns document IDs
- `quoth_read_doc` - Retrieves full document content by ID
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

## Key Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `mcp-handler` - MCP server handler for Next.js
- `gray-matter` - YAML frontmatter parsing
- `zod` - Schema validation
- `lucide-react` - Icons (1.5px stroke weight per branding)
