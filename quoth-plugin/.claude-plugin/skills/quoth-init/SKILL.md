---
name: quoth-init
description: Initialize Quoth Memory v2 for a project. Creates .quoth/ folder, config.json with strictness/gates, and type files.
---

# Quoth Memory v2 Initialization

This skill initializes Quoth Memory v2 for the current project.

## Steps

### 1. Check Current State

First, check if `.quoth/` already exists:

```bash
ls -la .quoth/ 2>/dev/null || echo "Not initialized"
```

If exists, ask user if they want to reinitialize (will preserve existing content).

### 2. Gather Configuration

Ask the user using AskUserQuestion:

**Question 1: Strictness Level**
- **Blocking** (recommended for teams) - Claude cannot write code until reasoning is documented
- **Reminder** - Claude gets gentle prompts but isn't blocked
- **Off** - No enforcement, manual capture only

**Question 2: Knowledge Types**
Multi-select from:
- decisions (default: on) - Architecture choices
- patterns (default: on) - Code patterns
- errors (default: on) - Failures and fixes
- knowledge (default: on) - General context
- selectors - UI selectors (for frontend projects)
- api - API documentation (for backend projects)

**Question 3: Gates (if strictness = blocking)**
Multi-select from:
- require_reasoning_before_edit (default: on)
- require_quoth_search (default: on)
- require_error_documentation (default: off)

### 3. Create Structure

Create the `.quoth/` folder structure:

```bash
mkdir -p .quoth/sessions

# Create config.json with user choices
cat > .quoth/config.json << 'EOF'
{
  "version": "2.0",
  "project_id": "",
  "project_slug": "PROJECT_NAME",
  "strictness": "STRICTNESS_CHOICE",
  "types": [TYPE_ARRAY],
  "gates": {
    "require_reasoning_before_edit": GATE_1,
    "require_quoth_search": GATE_2,
    "require_error_documentation": GATE_3
  },
  "created_at": "TIMESTAMP"
}
EOF
```

### 4. Create Type Files

For each selected type, create the corresponding `.quoth/{type}.md` file with a header:

**decisions.md:**
```markdown
# Decisions

Architecture and design decisions for this project.

<!-- Add entries using the format:
## [YYYY-MM-DD] Decision Title

**Context:** Why was this decision needed?

**Decision:** What was decided?

**Consequences:** What are the implications?
-->
```

**patterns.md:**
```markdown
# Patterns

Code patterns and conventions used in this project.

<!-- Add entries using the format:
## Pattern Name

**When to use:** Describe the use case

**Example:**
\`\`\`language
code example
\`\`\`

**Anti-pattern:** What to avoid
-->
```

**errors.md:**
```markdown
# Errors

Failures encountered and their fixes.

<!-- Add entries using the format:
## [YYYY-MM-DD] Error Title

**Error:** The error message or symptom

**Cause:** What caused it

**Fix:** How it was resolved

**Prevention:** How to avoid in future
-->
```

**knowledge.md:**
```markdown
# Knowledge

General context and learnings for this project.

<!-- Add entries as needed -->
```

**selectors.md (if selected):**
```markdown
# Selectors

UI selectors for testing and automation.

<!-- Add entries using the format:
## Component Name

| Element | Selector | Notes |
|---------|----------|-------|
| Button  | [data-testid="submit"] | Main form submit |
-->
```

**api.md (if selected):**
```markdown
# API Documentation

API endpoints and contracts.

<!-- Add entries using the format:
## Endpoint Name

**Method:** GET/POST/PUT/DELETE
**Path:** /api/resource
**Auth:** Required/Optional

**Request:**
\`\`\`json
{}
\`\`\`

**Response:**
\`\`\`json
{}
\`\`\`
-->
```

### 5. Add to .gitignore

Ensure `.quoth/sessions/` is in `.gitignore` (session logs are ephemeral):

```bash
# Check if already in .gitignore
grep -q ".quoth/sessions/" .gitignore 2>/dev/null || echo ".quoth/sessions/" >> .gitignore
```

### 6. Confirm Success

Output summary:
```
Quoth Memory v2 initialized!

Configuration:
- Strictness: {strictness}
- Types: {types}
- Gates: {gates}

Files created:
- .quoth/config.json
- .quoth/decisions.md
- .quoth/patterns.md
- .quoth/errors.md
- .quoth/knowledge.md
- .quoth/sessions/ (gitignored)

Next steps:
1. Run /quoth-genesis to populate documentation from codebase
2. Start coding - hooks will enforce documentation as configured
```

## Usage

```
/quoth-init
```

## Reinitializing

If `.quoth/` already exists, this skill will:
1. Preserve existing documentation content
2. Update config.json with new settings
3. Create any missing type files
4. Not overwrite existing type files with content
