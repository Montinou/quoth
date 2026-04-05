---
name: quoth-genesis
description: Deep codebase analyzer that generates comprehensive technical documentation. Reads every source file and produces numbered markdown docs covering architecture, subsystems, APIs, schemas, and configuration.
---

# Quoth Genesis — Documentation Generator

Analyzes the entire project codebase and generates a complete set of technical documentation as numbered markdown files in `docs/project/`.

## When to Use

- Bootstrapping documentation for a new or undocumented project
- After major architectural changes that invalidate existing docs
- Onboarding: generate docs for a codebase you're new to
- Re-running to update docs incrementally after codebase evolution

## Phase 1: Discovery

Explore the project structure to build a documentation plan.

1. **List all source files** (exclude node_modules, .next, build artifacts, test fixtures):
   ```bash
   find . -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.py' -o -name '*.json' \) | grep -v node_modules | grep -v .next | grep -v dist | sort
   ```

2. **Read entry points**: package.json, CLAUDE.md, README.md, main index files, server entry points

3. **Identify subsystems**: Map directories to their purpose. Each major directory or cohesive module becomes a documentation topic.

4. **Check existing docs**: If `docs/project/` already exists, read them to understand what's documented and what needs updating.

5. **Create documentation plan**: A numbered list of XX-topic.md files to generate, targeting 10-20 docs depending on project complexity.

## Phase 2: Deep Analysis & Generation

For each planned doc, systematically:

1. **Read ALL relevant source files** — not just the main file, follow imports, check related files
2. **Extract**: schemas, types, function signatures, config values, constants, algorithms, error handling
3. **Write** the markdown doc following the format below

### Document Format

Each doc must follow this structure:

```markdown
# Topic Title

Introductory paragraph explaining what this subsystem does, where it lives, why it exists.

Source files:
- `path/to/main-file.ts` -- primary implementation
- `path/to/related.ts` -- supporting module

## Section Title

Detailed documentation with:
- Tables for schemas, APIs, configuration, enums, mappings
- Code blocks for key data structures (types, interfaces, SQL)
- Exact values: default values, timeouts, limits, column types
- Source attribution: which file contains what

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id     | TEXT | --      | Primary key |

## Another Section

Continue documenting...

---

Cross-references to related docs: [Related Topic](./XX-related.md)
```

### What to Extract Per Subsystem

| Aspect | What to Document |
|--------|-----------------|
| **Purpose** | What does it do, why does it exist |
| **Source files** | Exact paths to implementation files |
| **Data model** | DB schemas, types, interfaces with column details |
| **API surface** | Endpoints, functions, tools, commands with params |
| **Configuration** | Env vars with defaults, options, feature flags |
| **Algorithms** | Key logic: scoring, matching, processing flows |
| **Error handling** | How failures are managed, fallbacks |
| **Dependencies** | What does this subsystem import/require |

### Quality Rules

- **100-400 lines per doc** — not too sparse, not bloated
- **Tables over prose** for structured data (schemas, APIs, config)
- **No filler** — every sentence should add information
- **Exact values** — include actual defaults, timeouts, thresholds from the source code
- **Source references** — always name which file(s) contain the documented code

## Phase 3: README Index

After all docs are generated, create `docs/project/README.md`:

```markdown
# Project Name — Technical Documentation

> Version X.Y.Z | Last updated: YYYY-MM-DD

One-paragraph project description.

## Table of Contents

### Category Name

| Document | Description |
|----------|-------------|
| [01 — Title](./01-title.md) | One-line description |
| [02 — Title](./02-title.md) | One-line description |

### Another Category

...

## Quick Links

- **Entry point:** `path/to/main.ts`
- **Config:** `path/to/config`
- **Tests:** `path/to/tests/`
```

## Phase 4: Context File (Optional)

If the project uses Quoth, also generate a condensed `quoth-plugin/context/{project}.md` or `.quoth-context.md` in the project root. This file (under 100 lines) contains the essential architecture, subsystem map, and key technical details for session-start injection.

## Output Rules

- Write all docs to `docs/project/`
- Sequential numbering: `01-`, `02-`, etc. (zero-padded)
- Kebab-case filenames: `XX-kebab-case-topic.md`
- If docs exist, read them first, then update/replace as needed
- Do NOT document node_modules, .next, build output, or test fixtures
- Do NOT copy file contents verbatim — extract meaningful information
- Use relative links between docs (`./XX-other.md`)

## Parallelization

For large projects, spawn sub-agents to work in parallel:
- One agent for frontend/UI documentation
- One agent for backend/API documentation
- One agent for database/schema documentation

Give each sub-agent explicit file lists and doc assignments.

## Re-running Genesis

When running on a project that already has `docs/project/`:
1. Read existing docs to see what's there
2. Compare with current codebase
3. Update changed docs, add new ones for new subsystems
4. Remove docs for deleted subsystems
5. Update README.md index
