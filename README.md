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

### 🎭 Prompts (Personas)

| Prompt | Description |
|--------|-------------|
| `quoth_architect` | Code generation persona - enforces "Single Source of Truth" rules |
| `quoth_auditor` | Documentation review persona - distinguishes between new features and technical debt |

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

1. AI receives a coding task
2. Calls `quoth_search_index` to find relevant patterns
3. Calls `quoth_read_doc` to get exact syntax and rules
4. Generates code following documented patterns strictly
5. If code contradicts docs, prioritizes documentation

### Using the Auditor Persona

1. AI reviews existing code
2. Compares against documented standards
3. Reports **VIOLATIONS** (code that breaks rules)
4. Reports **UPDATES_NEEDED** (new patterns needing documentation)
5. Uses `quoth_propose_update` for legitimate new patterns

## Deployment

### Vercel

1. Push to GitHub
2. Connect to Vercel
3. Deploy

The MCP endpoint will be available at `https://your-app.vercel.app/api/mcp`

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_TOKEN` | For external repo integration | No |
| `REDIS_URL` | For SSE transport | No |

## License

MIT

## Based On

This implementation follows the [Quoth Whitepaper](../WHITEPAPER.md) specifications.
