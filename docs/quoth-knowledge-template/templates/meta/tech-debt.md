---
id: template-meta-tech-debt
type: template
status: active
last_updated_date: "2026-01-13"
category: meta
target_type: meta
keywords: [template, tech-debt, todo, fixme, refactoring, issues, improvements]
related_stack: []
common_queries: ["Technical debt?", "What needs refactoring?", "Known issues?", "TODOs?"]
---

# Technical Debt Template

## Purpose (What This Template Is For)

**Technical debt documents** track known issues, inconsistencies, and improvement opportunities. Use this template when documenting TODOs, FIXMEs, architectural concerns, and refactoring priorities. Helps teams understand and prioritize technical improvements.

- Use for: TODOs, known issues, refactoring needs, improvement opportunities
- Creates: `meta/tech-debt.md`

**Summary:** Technical debt template for tracking improvements.

## Known Issues (Bugs, Workarounds)

**Current known issues** that need attention:

| Issue | Location | Severity | Workaround |
|-------|----------|----------|------------|
| [Description] | `src/file.ts:LINE` | High/Medium/Low | [Temporary fix] |

Search for: `// HACK`, `// WORKAROUND`, `// BUG`

**Summary:** Known issues requiring fixes.

## Code TODOs (Pending Work)

**Outstanding TODOs** found in codebase:

```
// TODO: [description] - src/file.ts:LINE
// TODO: [description] - src/other.ts:LINE
```

Priority levels:
- **Critical**: Blocks functionality
- **High**: Affects user experience
- **Medium**: Code quality issue
- **Low**: Nice to have

Search for: `// TODO`, `// FIXME`

**Summary:** Pending TODO items from codebase.

## Architectural Concerns (Design Issues)

**Architectural issues** that may need refactoring:

1. **[Concern name]**
   - Current: [What exists now]
   - Problem: [Why it's an issue]
   - Proposed: [Better approach]
   - Effort: High/Medium/Low

2. **[Another concern]**
   - Current: [Description]
   - Problem: [Issue]
   - Proposed: [Solution]
   - Effort: [Level]

**Summary:** Architectural concerns and proposed solutions.

## Dependency Updates (Outdated Packages)

**Dependencies that may need updating**:

| Package | Current | Latest | Breaking Changes |
|---------|---------|--------|------------------|
| [name] | [ver] | [ver] | Yes/No |

Run `npm outdated` to check for updates.

**Summary:** Package update requirements.

## Refactoring Priorities (What to Fix First)

**Recommended refactoring order**:

1. **[High priority]** - [Reason: security/performance/maintainability]
   - Files: `src/path/*`
   - Estimated effort: X hours/days

2. **[Medium priority]** - [Reason]
   - Files: `src/other/*`
   - Estimated effort: X hours/days

3. **[Low priority]** - [Reason]
   - Files: Various
   - Estimated effort: X hours/days

**Summary:** Prioritized refactoring recommendations.

## Common Questions (FAQ)

- **What's the biggest tech debt?** [Answer - highest priority item]
- **How much effort to fix X?** [Answer - estimation approach]
- **Should we refactor Y?** [Answer - criteria for deciding]
- **How to find TODOs?** Search codebase for `TODO`, `FIXME`, `HACK`
- **When to address debt?** Allocate 10-20% of sprint capacity

**Summary:** FAQ for technical debt management.

## Tracking History (Updates Log)

| Date | Change | By |
|------|--------|-----|
| [YYYY-MM-DD] | [What was added/fixed/updated] | [Author] |

**Summary:** Technical debt tracking history.
