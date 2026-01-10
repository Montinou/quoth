---
id: arch-decision-records
type: architecture
last_verified_commit: "initial"
last_updated_date: "2026-01-10"
status: active
---

# Architecture Decision Records (ADRs)

## ADR Template
Use this format for documenting significant architectural decisions.

```markdown
# ADR-XXX: [Title]

## Status
[Proposed | Accepted | Deprecated | Superseded]

## Context
[Why is this decision needed?]

## Decision
[What was decided?]

## Consequences
[What are the positive and negative outcomes?]
```

---

## Active Decisions

### ADR-001: Use Next.js App Router
**Status**: Accepted  
**Context**: Need modern React framework with SSR/SSG support  
**Decision**: Use Next.js 16+ with App Router  
**Consequences**: 
- ✅ Better performance with React Server Components
- ✅ Simplified data fetching
- ⚠️ Learning curve for team

### ADR-002: Vitest for Backend Testing
**Status**: Accepted  
**Context**: Need fast, ESM-native test runner  
**Decision**: Use Vitest instead of Jest  
**Consequences**:
- ✅ Native ESM support
- ✅ Faster execution
- ⚠️ Some Jest patterns don't apply

### ADR-003: Playwright for E2E Testing
**Status**: Accepted  
**Context**: Need reliable cross-browser E2E testing  
**Decision**: Use Playwright over Cypress  
**Consequences**:
- ✅ Better multi-browser support
- ✅ Faster parallel execution
- ✅ Better TypeScript integration
