# Quoth v2.0: AI Memory Architecture

**Date:** 2026-01-28
**Status:** Design
**Authors:** Brainstorming session with Claude

---

## Executive Summary

Transform Quoth from an "Agentic RAG" documentation repository into a true "AI Memory" system. The key insight: use Claude Code's native subagent architecture to create a memory interface that doesn't bloat the main working context.

**Core changes:**
1. Quoth becomes a **Claude Code plugin** with hooks and skills
2. A **quoth-memory subagent** (Sonnet) handles all memory operations
3. **Local-first storage** with user-controlled promotion to remote Quoth
4. **Hooks enforce** documentation during work (configurable strictness)
5. **Session end** prompts user to approve knowledge promotion

---

## Problem Statement

### Current Pain Points

| Problem | Current State | Impact |
|---------|---------------|--------|
| **Takes too long** | Manual Genesis, explicit search calls | Low adoption |
| **Too much data** | Everything chunked equally | Noise overwhelms signal |
| **Hard to maintain** | No curation mechanism | Docs get stale |
| **Context bloat** | Raw docs injected into context | Wastes tokens |
| **Not persistent** | Session-scoped only | Knowledge lost between sessions |

### The Evolution Gap

```
RAG (Basic)           → Query → Vectors → Context → LLM
Agentic RAG (Quoth v1) → Query → LLM → Tools → Context → LLM
AI Memory (Quoth v2)   → Query → LLM → Memory ⟷ Tools → Context → LLM
                                        ↑___↓
                                    Bidirectional
```

The key difference: **AI Memory has a learning loop** — it both retrieves AND stores, mediated by an intelligent agent.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    QUOTH PLUGIN v2.0                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  GENESIS (First-time setup)                                      │
│  ├─ Link project to Quoth (get project_id)                      │
│  ├─ Configure strictness (blocking/reminder/off)                │
│  ├─ Configure knowledge types (decisions, patterns, errors...)  │
│  ├─ Create .quoth/ folder structure                             │
│  └─ Generate .quoth/config.json                                 │
│                                                                  │
│  LOCAL STORAGE (.quoth/)                                         │
│  ├─ config.json         - Project settings                      │
│  ├─ decisions.md        - Persistent: architecture choices      │
│  ├─ patterns.md         - Persistent: code patterns             │
│  ├─ errors.md           - Persistent: failures and fixes        │
│  ├─ knowledge.md        - Persistent: general context           │
│  ├─ [custom].md         - Persistent: project-specific types    │
│  └─ sessions/                                                    │
│      └─ {session-id}/                                           │
│          ├─ context.md  - Quoth context injected at start       │
│          ├─ log.md      - What happened this session            │
│          └─ pending.md  - Learnings awaiting promotion          │
│                                                                  │
│  HOOKS (Enforcement layer)                                       │
│  ├─ session-start.sh    → Spawn quoth-memory, inject context    │
│  ├─ subagent-start.sh   → Tell subagent what to read            │
│  ├─ subagent-stop.sh    → Tell subagent to document findings    │
│  ├─ pre-tool-gate.sh    → Enforce documentation (if blocking)   │
│  ├─ post-tool-log.sh    → Log actions to session folder         │
│  └─ stop.sh             → Spawn quoth-memory, propose promotion │
│                                                                  │
│  SUBAGENT (Memory interface)                                     │
│  └─ quoth-memory (Sonnet)                                       │
│      ├─ Searches Quoth + local files                            │
│      ├─ Summarizes (doesn't dump raw docs)                      │
│      ├─ Answers questions interactively                         │
│      └─ Prepares promotion proposals                            │
│                                                                  │
│  REMOTE (Quoth server)                                           │
│  └─ Team knowledge persisted + shared                           │
│      ├─ quoth_search_index                                      │
│      ├─ quoth_read_doc                                          │
│      └─ quoth_propose_update                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Genesis Configuration Flow

Genesis v3.0 adds a configuration phase before documentation:

### Phase 0: Project Setup

```
"Let's set up Quoth for this project."

1. Link to Quoth account
   → OAuth flow or API key
   → Creates/selects project in Quoth

2. Configure strictness
   ○ Blocking (recommended for teams)
     Claude cannot write code until reasoning is documented
   ○ Reminder
     Claude gets gentle prompts but isn't blocked
   ○ Off
     No enforcement, manual capture only

3. Configure knowledge types
   □ decisions.md    (default: ✓) - Architecture choices
   □ patterns.md     (default: ✓) - Code patterns
   □ errors.md       (default: ✓) - Failures and fixes
   □ knowledge.md    (default: ✓) - General context
   □ selectors.md    (UI projects) - UI selectors, locators
   □ api.md          (backend projects) - Endpoints, contracts
   □ [Custom...]     - Add project-specific types

4. Configure gates (if strictness = blocking)
   □ require_reasoning_before_edit (default: ✓)
   □ require_quoth_search (default: ✓)
   □ require_error_documentation (default: ○)
```

### Phase 1-5: Documentation (unchanged from current Genesis)

Standard Genesis documentation phases continue after configuration.

### Output: .quoth/config.json

```json
{
  "version": "2.0",
  "project_id": "uuid-from-quoth",
  "project_slug": "my-project",
  "strictness": "blocking",
  "types": [
    "decisions",
    "patterns",
    "errors",
    "knowledge",
    "api"
  ],
  "gates": {
    "require_reasoning_before_edit": true,
    "require_quoth_search": true,
    "require_error_documentation": false
  },
  "created_at": "2026-01-28T10:00:00Z"
}
```

---

## Local Folder Structure

```
.quoth/
├── config.json              # Project configuration (from Genesis)
│
├── decisions.md             # PERSISTENT: Architecture choices
│   └── "Why we chose X over Y, tradeoffs considered"
│
├── patterns.md              # PERSISTENT: Code patterns
│   └── "How we do X in this project"
│
├── errors.md                # PERSISTENT: Failures and fixes
│   └── "What went wrong and how we fixed it"
│
├── knowledge.md             # PERSISTENT: General context
│   └── "Project-specific knowledge, gotchas"
│
├── api.md                   # PERSISTENT: API documentation
│   └── "Endpoints, request/response formats"
│
├── [custom].md              # PERSISTENT: Project-specific types
│   └── Created organically when content doesn't fit
│
└── sessions/
    └── {session-id}/        # EPHEMERAL: Current session only
        ├── context.md       # Quoth context injected at start
        ├── log.md           # What happened this session
        └── pending.md       # Learnings awaiting promotion
```

### Persistent vs Session Files

| Type | Location | Survives Session | Survives Compaction | Synced to Quoth |
|------|----------|------------------|---------------------|-----------------|
| Config | `.quoth/config.json` | ✓ | ✓ | ✗ (local only) |
| Type files | `.quoth/*.md` | ✓ | ✓ | On promotion |
| Session logs | `.quoth/sessions/` | Current only | ✓ | On promotion |

---

## Hooks Specification

### hooks.json

```json
{
  "hooks": [
    {
      "event": "SessionStart",
      "matchers": ["startup", "resume"],
      "command": ".quoth-plugin/hooks/session-start.sh"
    },
    {
      "event": "SubagentStart",
      "matchers": ["*", "!quoth-memory"],
      "command": ".quoth-plugin/hooks/subagent-start.sh"
    },
    {
      "event": "SubagentStop",
      "matchers": ["*", "!quoth-memory"],
      "command": ".quoth-plugin/hooks/subagent-stop.sh"
    },
    {
      "event": "PreToolUse",
      "matchers": ["Edit", "Write"],
      "command": ".quoth-plugin/hooks/pre-tool-gate.sh"
    },
    {
      "event": "PostToolUse",
      "matchers": ["Edit", "Write", "Bash"],
      "command": ".quoth-plugin/hooks/post-tool-log.sh"
    },
    {
      "event": "Stop",
      "matchers": ["*"],
      "command": ".quoth-plugin/hooks/stop.sh"
    }
  ]
}
```

### Hook Details

#### session-start.sh

**Purpose:** Initialize session, inject relevant context via quoth-memory subagent

**Flow:**
1. Create `.quoth/sessions/{session-id}/` folder
2. Spawn `quoth-memory` subagent with context request
3. Subagent searches Quoth + reads local `.quoth/*.md`
4. Subagent returns summarized context (~500 tokens)
5. Write to `.quoth/sessions/{id}/context.md`
6. Inject summary into Claude's context

**Output to Claude:**
```
Session initialized. Relevant context loaded:
- Working in: auth-service
- Key patterns: Result<T> for errors, JWT in httpOnly cookies
- Recent decisions: Chose Prisma over Drizzle (see decisions.md)
- Known issues: Token refresh race condition (see errors.md:23)
```

#### subagent-start.sh

**Purpose:** Inject context before other subagents run

**Matchers:** All subagents EXCEPT `quoth-memory`

**Output to Subagent:**
```
Before starting, consult:
- .quoth/patterns.md (local patterns)
- .quoth/sessions/{id}/context.md (session context)
- .quoth/errors.md (known pitfalls)
```

#### subagent-stop.sh

**Purpose:** Instruct subagent to document findings

**Matchers:** All subagents EXCEPT `quoth-memory`

**Output to Subagent:**
```
Document your findings in .quoth/sessions/{id}/log.md:
- What approach did you take?
- What patterns did you discover?
- What errors did you encounter?
```

#### pre-tool-gate.sh

**Purpose:** Enforce documentation before code changes (if strictness = blocking)

**Flow:**
1. Read `.quoth/config.json` for strictness setting
2. If `off` → exit 0 (allow)
3. If `reminder` → output reminder, exit 0 (allow)
4. If `blocking` → check gates:
   - Gate 1: Reasoning documented in session log?
   - Gate 2: Quoth search performed (if required)?
   - Gate 3: Error context documented (if required)?
5. If any gate fails → exit 2 with instructions

**Exit Codes:**
- `0` = Allow action
- `2` = Block with message to Claude

**Exclusions:**
- `quoth-memory` subagent is always exempt
- Check via: `if [ "$subagent_name" = "quoth-memory" ]; then exit 0; fi`

#### post-tool-log.sh

**Purpose:** Log actions to session folder

**Flow:**
1. Extract tool name, file path, result from stdin JSON
2. Append to `.quoth/sessions/{id}/log.md`:
   ```markdown
   ### [timestamp] Edit: src/auth/login.ts
   - Changed: Added token refresh retry logic
   - Result: Success
   ```

#### stop.sh

**Purpose:** Propose knowledge promotion at session end

**Flow:**
1. Spawn `quoth-memory` subagent
2. Subagent reviews `.quoth/sessions/{id}/`
3. Subagent summarizes learnings and categorizes:
   - Decisions made
   - Patterns discovered
   - Errors encountered
4. Present to user for approval

**Output to User:**
```
Session complete. I captured these learnings:

**Decisions:**
- Chose retry-with-backoff over circuit-breaker for token refresh

**Patterns:**
- Token refresh uses mutex to prevent race conditions

**Errors:**
- Auth header missing on redirect (fixed by preserving headers)

Update local files? Upload to Quoth? Both? Skip?
```

---

## quoth-memory Subagent Specification

### Agent Definition

```yaml
name: quoth-memory
description: |
  Memory interface for Quoth. Handles context injection,
  interactive queries, and knowledge promotion. Exempt from
  all hooks to prevent loops.

model: sonnet
color: violet

tools:
  - quoth_search_index    # Search remote Quoth
  - quoth_read_doc        # Read full docs from Quoth
  - quoth_read_chunks     # Fetch specific chunks
  - quoth_propose_update  # Upload learnings to Quoth
  - Read                  # Read local .quoth/*.md files
  - Write                 # Update local .quoth/*.md files
  - Glob                  # Find relevant local files
  - Edit                  # Edit local files

system_prompt: |
  You are the memory interface for Quoth. Your role:

  1. CONTEXT INJECTION (SessionStart)
     - Search Quoth for relevant patterns, decisions, errors
     - Read local .quoth/*.md files
     - Summarize into ~500 tokens of actionable context
     - Focus on what's relevant to current work

  2. INTERACTIVE QUERIES (During work)
     - Answer questions from main Claude
     - Search Quoth and local files
     - Return concise answers, not raw documents

  3. KNOWLEDGE CAPTURE (Session logging)
     - Log learnings to .quoth/sessions/{id}/
     - Categorize: decisions, patterns, errors, knowledge

  4. PROMOTION PROPOSALS (SessionEnd)
     - Review session learnings
     - Prepare summary for user approval
     - If approved: update local files + quoth_propose_update

  IMPORTANT: You are exempt from hooks. Do not trigger other
  subagents. Work efficiently and return concise results.
```

### Invocation Patterns

**From SessionStart hook:**
```
Summarize relevant context for this session.
User is in: {pwd}
Recent changes: {git diff --stat HEAD~3}
Current task: {parsed from user message if available}

Return ~500 token summary covering:
- Relevant patterns for this area of code
- Recent decisions that apply
- Known errors/pitfalls to avoid
```

**From interactive query:**
```
User question: "What's our error handling pattern?"

Search Quoth and local .quoth/patterns.md.
Return a concise answer (not the full document).
```

**From Stop hook:**
```
Review .quoth/sessions/{session-id}/.
Summarize learnings into categories:
- Decisions: architectural choices made
- Patterns: reusable approaches discovered
- Errors: failures and how they were fixed
- Knowledge: other project-specific learnings

Prepare a promotion proposal for user approval.
```

---

## Promotion Flow

### During Session: Local Capture

```
Work happens
    ↓
Hooks log to .quoth/sessions/{id}/log.md
    ↓
Learnings accumulate locally
    ↓
Context survives compaction (it's in files)
```

### Session End: User Approval

```
Stop hook fires
    ↓
quoth-memory reviews session logs
    ↓
Presents categorized summary to user
    ↓
User chooses:
├─ "Update local only"  → Merge into .quoth/*.md
├─ "Upload to Quoth"    → quoth_propose_update()
├─ "Both"               → Local + Remote
└─ "Skip"               → Keep in session folder
```

### Promotion to Local Files

```
Session learning:
"Token refresh uses mutex to prevent race conditions"

    ↓ User approves "Update local"

.quoth/patterns.md gets appended:
---
## Token Refresh Pattern
Added: 2026-01-28

Use mutex to prevent race conditions during token refresh:
- Acquire lock before checking token expiry
- Release after new token is stored
- Other requests wait on lock, then use refreshed token

Source: Session 2026-01-28-abc123
---
```

### Promotion to Remote Quoth

```
User approves "Upload to Quoth"
    ↓
quoth-memory calls:
quoth_propose_update({
  path: "patterns/token-refresh.md",
  content: "...",
  evidence: "Discovered during auth-service work",
  reasoning: "Prevents race condition we encountered"
})
    ↓
If project.require_approval = true:
  → Creates proposal for admin review
If project.require_approval = false:
  → Syncs directly to Quoth
    ↓
Team members see new pattern immediately
```

---

## Hook Exemption for quoth-memory

### Why Exemption is Critical

| Without Exemption | With Exemption |
|-------------------|----------------|
| SessionStart spawns quoth-memory | SessionStart spawns quoth-memory |
| SubagentStart hook fires for quoth-memory | (no hook fires) |
| Hook tells quoth-memory to "read .quoth files" | quoth-memory already knows to do this |
| quoth-memory reads files | quoth-memory reads files |
| SubagentStop hook fires | (no hook fires) |
| Hook tells quoth-memory to "document findings" | quoth-memory returns summary |
| quoth-memory documents... to where? Loop! | Clean completion |

### Implementation

**Option A: Matcher exclusion**
```json
{
  "event": "SubagentStart",
  "matchers": ["*", "!quoth-memory"]
}
```

**Option B: Hook-level check**
```bash
# In every hook script
subagent_name=$(extract_subagent_name)
if [ "$subagent_name" = "quoth-memory" ]; then
    exit 0  # Exempt
fi
```

**Option C: Plugin-level flag**
```json
{
  "agents": [
    {
      "name": "quoth-memory",
      "exempt_from_hooks": true
    }
  ]
}
```

Recommendation: Use **Option A** (matcher exclusion) for clarity and explicit configuration.

---

## Migration Path

### For Existing Quoth Users

1. **Install new plugin version**
   ```bash
   /plugin update quoth
   ```

2. **Run migration Genesis**
   ```bash
   /quoth-migrate
   ```
   - Creates `.quoth/` folder structure
   - Generates `config.json` from existing project
   - Keeps existing Quoth docs (no data loss)

3. **Choose strictness level**
   - Default: `reminder` (non-breaking)
   - Teams can opt into `blocking`

### For New Users

Standard Genesis flow with new Phase 0 configuration.

---

## Success Metrics

### Adoption Metrics
- % of sessions with quoth-memory invocations
- Avg learnings captured per session
- Promotion rate (session → local → Quoth)

### Quality Metrics
- Context injection token count (target: <500)
- Query response relevance (user feedback)
- Documentation freshness (days since last update)

### Team Metrics
- Cross-user knowledge sharing rate
- Time to discover existing patterns
- Reduction in duplicate decisions

---

## Open Questions

1. **Session ID format** — UUID vs timestamp-based vs git-branch-based?

2. **Session cleanup** — When to delete old `.quoth/sessions/` folders?

3. **Conflict resolution** — What if local `.quoth/patterns.md` conflicts with remote Quoth?

4. **Offline mode** — Should quoth-memory work without Quoth server connection?

5. **Multi-project** — How to handle monorepos with multiple `.quoth/` folders?

---

## Next Steps

1. [ ] Validate design with user feedback
2. [ ] Create plugin scaffold with folder structure
3. [ ] Implement quoth-memory subagent
4. [ ] Implement hooks (session-start first)
5. [ ] Update Genesis with Phase 0 configuration
6. [ ] Test end-to-end flow
7. [ ] Migration tooling for existing users
8. [ ] Documentation and examples

---

## Appendix: Comparison with Triqual

This design is heavily inspired by Triqual's hook-based enforcement pattern:

| Aspect | Triqual | Quoth v2 |
|--------|---------|----------|
| **Domain** | Playwright test automation | General knowledge management |
| **Strictness** | Always blocking (6 gates) | Configurable |
| **Local storage** | `.triqual/runs/{feature}.md` | `.quoth/sessions/{id}/` + type files |
| **Subagents** | 5 specialized (planner, generator, etc.) | 1 general (quoth-memory) |
| **Remote** | Quoth + Exolar | Quoth only |
| **Capture triggers** | Test execution events | Any code changes |
| **Promotion** | Automatic to knowledge.md | User-approved |

Key difference: Quoth v2 is **domain-agnostic** while Triqual is **testing-specific**.
