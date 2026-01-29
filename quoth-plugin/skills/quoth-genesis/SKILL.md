---
name: quoth-genesis
description: Bootstrap Quoth documentation from codebase. Phase 0 configures memory settings, then generates documentation at chosen depth level.
---

# Quoth Genesis v3.0

Generates comprehensive documentation from your codebase with configurable depth.

## Prerequisites

- Quoth MCP must be connected (`claude mcp add quoth`)
- Project should be initialized (`/quoth-init` or existing `.quoth/config.json`)

## Phase 0: Configuration Check

First, check if `.quoth/config.json` exists:

```bash
ls -la .quoth/config.json 2>/dev/null || echo "Not initialized"
```

**If not initialized:** Run `/quoth-init` first to configure:
- Strictness level (blocking/reminder/off)
- Knowledge types (decisions, patterns, errors, knowledge, selectors, api)
- Documentation gates (require_reasoning_before_edit, require_quoth_search)

**If already initialized:** Proceed to Phase 1.

## Phase 1: Choose Depth

Ask the user to select documentation depth:

| Depth | Documents | Time | Use Case |
|-------|-----------|------|----------|
| **minimal** | 3 | ~3 min | Quick overview, basic context |
| **standard** | 5 | ~7 min | Team onboarding, regular development |
| **comprehensive** | 11 | ~20 min | Enterprise audit, full documentation |

### Document Coverage by Depth

**Minimal (3 docs):**
- project-overview.md
- tech-stack.md
- repo-structure.md

**Standard (5 docs):**
- All minimal docs +
- coding-conventions.md
- testing-patterns.md

**Comprehensive (11 docs):**
- All standard docs +
- api-schemas.md
- database-models.md
- shared-types.md
- error-handling.md
- security-patterns.md
- tech-debt.md

## Phase 2-5: Documentation Generation

Use the `quoth_genesis` tool with the selected depth:

```
quoth_genesis({ depth: "standard" })
```

The tool handles:
- Reading local files using native file access
- Analyzing codebase structure and patterns
- Generating documentation with YAML frontmatter
- Uploading to Quoth incrementally (not batched)
- Automatic versioning via database triggers

### Genesis Phases

- **Phase 1: Foundation** (all depths) - `project-overview.md`, `tech-stack.md`
- **Phase 2: Architecture** (all depths) - `repo-structure.md`
- **Phase 3: Patterns** (standard+) - `coding-conventions.md`, `testing-patterns.md`
- **Phase 4: Contracts** (comprehensive) - `api-schemas.md`, `database-models.md`, `shared-types.md`
- **Phase 5: Advanced** (comprehensive) - `error-handling.md`, `security-patterns.md`, `tech-debt.md`

## Phase 6: Local Integration

After Genesis completes, synchronize local `.quoth/*.md` files with discovered patterns:

### 1. Update patterns.md

Extract coding patterns discovered during genesis and add to `.quoth/patterns.md`:

```markdown
## Pattern Name

**When to use:** Context from genesis analysis

**Example:**
```language
code example from codebase
```

**Anti-pattern:** What to avoid
```

### 2. Update decisions.md

Document any architectural decisions discovered:

```markdown
## [YYYY-MM-DD] Decision Title

**Context:** Why this architecture was chosen

**Decision:** The approach used

**Consequences:** Trade-offs and implications
```

### 3. Update knowledge.md

Add general project context discovered:

```markdown
## Project Context

- Tech stack summary
- Key dependencies
- Development patterns
```

## Output

Upon completion, display summary:

```
Genesis Complete!

Remote (Quoth):
- project-overview.md
- tech-stack.md
- repo-structure.md
- coding-conventions.md (standard+)
- testing-patterns.md (standard+)
- api-schemas.md (comprehensive)
- database-models.md (comprehensive)
- shared-types.md (comprehensive)
- error-handling.md (comprehensive)
- security-patterns.md (comprehensive)
- tech-debt.md (comprehensive)

Local (.quoth/):
- patterns.md - Updated with discovered patterns
- decisions.md - Updated with architectural decisions
- knowledge.md - Updated with project context

Your project is now ready for AI Memory!

Next steps:
1. Review generated documentation in Quoth dashboard
2. Start coding - hooks will enforce documentation as configured
3. Use /prompt quoth_architect for code generation with pattern enforcement
```

## Usage

```
/quoth-genesis
```

## Re-running Genesis

Running Genesis again will:
1. Compare existing documentation with codebase
2. Update changed documents (incremental re-indexing)
3. Skip unchanged content (~90% token savings)
4. Preserve version history automatically

## Troubleshooting

### "Quoth MCP not connected"

Run:
```bash
claude mcp add --transport http quoth https://quoth.ai-innovation.site/api/mcp
```

Then authenticate via the `/mcp` menu.

### "Project not initialized"

Run `/quoth-init` first to create `.quoth/config.json` with your preferences.

### "Genesis tool not available"

Verify Quoth MCP connection:
```bash
claude mcp list
```

Should show `quoth` in the list. If not, re-add the MCP server.
