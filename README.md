# Quoth MCP Server

> AI-Driven Technical Documentation MCP Server - A "Living Source of Truth" for AI Agents

Quoth is a Model Context Protocol (MCP) server designed to prevent AI hallucinations by enforcing a "Read-Contrast-Update" workflow. AI agents never blindly generate code patterns but instead verify against documented standards.

## Features

### 🔧 Tools

| Tool | Description |
|------|-------------|
| `quoth_search_index` | Search the documentation index for patterns, architecture notes, and contracts |
| `quoth_read_doc` | Retrieve full document content by ID with parsed YAML frontmatter |
| `quoth_propose_update` | Submit documentation updates with evidence and reasoning for review |
| `quoth_genesis` | Inject Genesis Architect persona for codebase analysis and bootstrapping |

### 🎭 Prompts (Personas)

**How to trigger prompts in Claude Code:**
```bash
/prompt quoth_architect    # Activate code generation persona
/prompt quoth_auditor      # Activate documentation review persona
/prompt quoth_documenter   # Activate incremental documentation persona
```

| Prompt | When to Use | Description |
|--------|-------------|-------------|
| `quoth_architect` | Before writing code/tests | Enforces "Single Source of Truth" rules - searches Quoth before generating code |
| `quoth_auditor` | During code review | Distinguishes between new features vs technical debt - identifies violations |
| `quoth_documenter` | While building features | Documents new code immediately - creates searchable, well-structured docs |

**Note:** Prompts are NOT tools. They configure Claude's behavior for the conversation. Use `/prompt <name>` in Claude Code to activate them.

### 👥 Team Collaboration

- **Multi-user projects** - Share knowledge bases with team members
- **Role-based access** - Admin, Editor, and Viewer roles with granular permissions
- **Email invitations** - Invite collaborators via email with secure 7-day tokens
- **Team management** - Add, remove, and manage member roles through dashboard
- **Secure isolation** - Row-level security ensures projects remain private

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm

### Installation

```bash
cd quoth-mcp
npm install
```

### Development

```bash
npm run dev
```

The MCP server will be available at `http://localhost:3000/api/mcp`

### Build

```bash
npm run build
```

## Connecting Clients

### Claude Desktop / Cursor / Windsurf

If your client supports Streamable HTTP, add to your MCP configuration:

```json
{
  "quoth": {
    "url": "http://localhost:3000/api/mcp"
  }
}
```

For stdio-only clients, use mcp-remote:

```json
{
  "quoth": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "http://localhost:3000/api/mcp"]
  }
}
```

## Knowledge Base Structure

```
quoth-knowledge-base/
├── contracts/           # API schemas, DTOs, database models
│   ├── api-schemas.md
│   ├── database-models.md
│   └── shared-types.md
├── patterns/            # Testing patterns and code recipes
│   ├── backend-unit-vitest.md
│   ├── frontend-e2e-playwright.md
│   └── backend-integration.md
├── architecture/        # Folder structure and ADRs
│   ├── backend-repo-structure.md
│   ├── frontend-repo-structure.md
│   └── decision-records.md
└── meta/                # System health and validation
    └── validation-log.md
```

### Document Format

All documentation files use YAML frontmatter for AI consumption:

```yaml
---
id: pattern-backend-unit
type: testing-pattern
related_stack: [vitest, node]
last_verified_commit: "a1b2c3d"
last_updated_date: "2026-01-10"
status: active
---

# Pattern Title

## The Golden Rule
1. Rule one
2. Rule two

## Code Example (Canonical)
...

## Anti-Patterns (Do NOT do this)
...
```

## Workflow

### Using the Architect Persona

**Trigger with:** `/prompt quoth_architect` in Claude Code

**What happens:**
1. You give Claude a coding task (e.g., "Create a test for Feature X")
2. Claude automatically calls `quoth_search_index` to find relevant patterns
3. Claude calls `quoth_read_doc` to get exact syntax and rules
4. Claude generates code following documented patterns strictly
5. If code contradicts docs, Claude prioritizes documentation (docs = intended design)

**Example:**
```
You: /prompt quoth_architect
Claude: [Architect persona activated]
You: Create a Vitest unit test for the authentication service
Claude: [Searches Quoth for "vitest authentication test patterns"]
Claude: [Reads the testing-patterns.md document]
Claude: [Generates test following canonical examples]
```

### Using the Auditor Persona

**Trigger with:** `/prompt quoth_auditor` in Claude Code

**What happens:**
1. You ask Claude to review existing code
2. Claude compares code against documented standards
3. Claude reports **VIOLATIONS** (code that breaks documented rules)
4. Claude reports **UPDATES_NEEDED** (new patterns that should be documented)
5. Claude uses `quoth_propose_update` for legitimate new patterns

**Example:**
```
You: /prompt quoth_auditor
Claude: [Auditor persona activated]
You: Review the src/services/auth.ts file
Claude: [Searches Quoth for authentication patterns]
Claude: [Compares code vs documentation]
Claude: VIOLATIONS: Using localStorage instead of cookies (violates security-patterns.md)
Claude: UPDATES_NEEDED: New OAuth provider integration pattern found
```

### Using the Documenter Persona

**Trigger with:** `/prompt quoth_documenter` in Claude Code

**What happens:**
1. You say "document this [code/feature]"
2. Claude analyzes the code and determines the correct document type
3. Claude searches for existing documentation with `quoth_search_index`
4. Claude fetches the appropriate template with `quoth_get_template`
5. Claude creates or updates documentation following the template structure
6. Claude submits via `quoth_propose_update`

**Example:**
```
You: /prompt quoth_documenter
Claude: [Documenter persona activated]
You: Document this new API endpoint [paste code]
Claude: [Analyzes code → determines it's an API schema]
Claude: [Searches for existing api-schemas.md]
Claude: [Fetches api-schemas template]
Claude: [Creates documentation with proper structure]
Claude: [Submits proposal with code as evidence]
```

## Deployment

### Vercel

1. Push to GitHub
2. Connect to Vercel
3. Deploy

The MCP endpoint will be available at `https://your-app.vercel.app/api/mcp`

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Yes |
| `GEMINIAI_API_KEY` | Google Gemini API key for embeddings | Yes |
| `JWT_SECRET` | Secret for MCP token generation | Yes |
| `RESEND_API_KEY` | Resend API key for email delivery | Optional (for notifications) |
| `RESEND_FROM_EMAIL` | Sender email address | Optional (for notifications) |
| `NEXT_PUBLIC_APP_URL` | Production app URL | Yes |

## License

MIT

## Based On

This implementation follows the [Quoth Whitepaper](../WHITEPAPER.md) specifications.
