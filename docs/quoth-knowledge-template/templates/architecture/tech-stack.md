---
id: template-architecture-tech-stack
type: template
status: active
last_updated_date: "2026-01-13"
category: architecture
target_type: architecture
keywords: [template, tech-stack, dependencies, libraries, framework, runtime, database]
related_stack: []
common_queries: ["What technology does this use?", "What database?", "What framework?"]
---

# Tech Stack Template

## Purpose (What This Template Is For)

**Tech stack documents** catalog the technologies used in a project. Use this template when documenting dependencies, frameworks, and infrastructure choices. Helps developers understand what technologies they need to learn.

- Use for: Technology inventory and version documentation
- Creates: `architecture/tech-stack.md`

**Summary:** Tech stack template for technology inventory.

## Runtime (Platform, Environment, Node)

**Runtime environment** configuration:

- **Platform**: [Node.js 20.x / Python 3.11 / Go 1.21]
- **Package Manager**: [npm / yarn / pnpm / pip]
- **Engine Requirements**: See `package.json` engines field

```json
"engines": {
  "node": ">=20.0.0"
}
```

**Summary:** Runtime platform and version requirements.

## Language (TypeScript, JavaScript, Primary)

**Primary language** configuration:

- **Language**: [TypeScript 5.x / JavaScript ES2022]
- **Strict Mode**: [Yes/No]
- **Module System**: [ESM / CommonJS]

Key compiler options: Reference `tsconfig.json`

**Summary:** Primary language and compiler settings.

## Framework (Web, Application)

**Application framework**:

- **Framework**: [Next.js 14 / Express / FastAPI]
- **Rendering**: [SSR / CSR / Static / Hybrid]
- **Router**: [App Router / Pages Router]

Reference: `package.json` main framework dependency

**Summary:** Application framework and architecture.

## Database (Storage, Persistence, ORM)

**Data layer** configuration:

- **Database**: [PostgreSQL / MongoDB / SQLite]
- **Provider**: [Supabase / PlanetScale / Local]
- **ORM/Client**: [Prisma / Drizzle / none]

Connection: See `DATABASE_URL` in `.env.example`

**Summary:** Database and data access layer.

## Key Dependencies (Packages, Libraries)

**Core dependencies** (from `package.json`):

| Package | Purpose | Version |
|---------|---------|---------|
| [package-1] | [Primary purpose] | ^X.Y.Z |
| [package-2] | [Primary purpose] | ^X.Y.Z |
| [package-3] | [Primary purpose] | ^X.Y.Z |

Reference: `package.json` dependencies section

**Summary:** Key packages and their purposes.

## Common Questions (FAQ)

- **What database does this use?** [Database name] via [provider], accessed through [ORM]
- **What's the primary language?** [Language] with [strict mode status]
- **What framework?** [Framework name and version]
- **How do I add dependencies?** Use `npm install [package]` or `yarn add [package]`
- **Where are versions defined?** See `package.json` for dependencies, `.nvmrc` for Node

**Summary:** FAQ for tech stack questions.

## Anti-Patterns (Never Do This)

- **Outdated versions**: Keep version numbers current with actual `package.json`
- **Missing ORM info**: Always document how data is accessed
- **Vague descriptions**: "Database stuff" - be specific about technology choices

**Summary:** Anti-patterns to avoid in tech stack docs.
