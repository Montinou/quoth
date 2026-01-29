# Quoth v2.0 - AI Memory Flow

> How Quoth transforms Claude Code from "search and read" to "automatic memory"

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           QUOTH PLUGIN v2.0                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LOCAL STORAGE (.quoth/)                                                    │
│  ├─ config.json          - Project settings (strictness, gates, types)     │
│  ├─ decisions.md         - Persistent: architecture choices                │
│  ├─ patterns.md          - Persistent: code patterns                       │
│  ├─ errors.md            - Persistent: failures and fixes                  │
│  ├─ knowledge.md         - Persistent: general context                     │
│  └─ sessions/{id}/       - Ephemeral session logs                          │
│      ├─ log.md           - Tool actions timeline                           │
│      └─ learnings.md     - Pending knowledge to promote                    │
│                                                                             │
│  HOOKS (Enforcement layer)                                                  │
│  ├─ session-start.sh     → Init session, inject context from .quoth/       │
│  ├─ user-prompt.sh       → Track user intent for context                   │
│  ├─ pre-tool-gate.sh     → Enforce documentation gates (Edit/Write)        │
│  ├─ post-tool-log.sh     → Log tool actions to session (Edit/Write/Bash)   │
│  ├─ subagent-start.sh    → Inject memory context (excludes quoth-memory)   │
│  ├─ subagent-stop.sh     → Prompt documentation (excludes quoth-memory)    │
│  └─ stop.sh              → Knowledge promotion prompt                      │
│                                                                             │
│  SUBAGENT (Memory interface)                                                │
│  └─ quoth-memory (Sonnet) - Context summarization & queries                │
│      Tools: quoth_search_index, quoth_read_doc, Read, Write, Glob, Edit    │
│                                                                             │
│  SKILLS                                                                     │
│  ├─ /quoth-init          → Initialize .quoth/ for new projects             │
│  └─ /quoth-genesis       → Bootstrap documentation to Quoth server         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Session Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SESSION LIFECYCLE                                 │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐
  │ User starts  │
  │ Claude Code  │
  └──────┬───────┘
         │
         ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ SessionStart Hook (session-start.sh)                                     │
  │ ┌──────────────────────────────────────────────────────────────────────┐ │
  │ │ 1. Create session folder: .quoth/sessions/{uuid}/                    │ │
  │ │ 2. Read config.json for strictness settings                          │ │
  │ │ 3. Inject context from persistent type files:                        │ │
  │ │    - decisions.md → Architecture context                             │ │
  │ │    - patterns.md  → Code patterns                                    │ │
  │ │    - errors.md    → Known issues                                     │ │
  │ │ 4. Return session ID for tracking                                    │ │
  │ └──────────────────────────────────────────────────────────────────────┘ │
  └──────────────────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ Active Session                                                           │
  │ ┌──────────────────────────────────────────────────────────────────────┐ │
  │ │                                                                      │ │
  │ │  User Prompt ──► UserPromptSubmit Hook ──► Track intent              │ │
  │ │       │                                                              │ │
  │ │       ▼                                                              │ │
  │ │  Claude processes request                                            │ │
  │ │       │                                                              │ │
  │ │       ├──► Edit/Write tool ──► PreToolUse Hook (gate check)          │ │
  │ │       │                              │                               │ │
  │ │       │                              ├─ blocking: Block if no search │ │
  │ │       │                              ├─ reminder: Gentle hint         │ │
  │ │       │                              └─ off: Pass through            │ │
  │ │       │                                                              │ │
  │ │       ├──► Tool executes ──► PostToolUse Hook (log action)           │ │
  │ │       │                              │                               │ │
  │ │       │                              └─► .quoth/sessions/{id}/log.md │ │
  │ │       │                                                              │ │
  │ │       └──► Subagent spawned ──► SubagentStart Hook                   │ │
  │ │                                      │                               │ │
  │ │                                      └─► Inject memory context       │ │
  │ │                                          (skips quoth-memory)        │ │
  │ │                                                                      │ │
  │ └──────────────────────────────────────────────────────────────────────┘ │
  └──────────────────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ Stop Hook (stop.sh)                                                      │
  │ ┌──────────────────────────────────────────────────────────────────────┐ │
  │ │ 1. Check if learnings.md has pending items                           │ │
  │ │ 2. Prompt user: "Promote learnings to persistent storage?"           │ │
  │ │ 3. If approved:                                                      │ │
  │ │    - Append to .quoth/{type}.md (local)                              │ │
  │ │    - Optionally sync to Quoth server (remote)                        │ │
  │ │ 4. Cleanup old sessions (>48h)                                       │ │
  │ └──────────────────────────────────────────────────────────────────────┘ │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

## Knowledge Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           KNOWLEDGE FLOW                                    │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────┐
                    │    USER ACTION      │
                    │  (code, decisions)  │
                    └──────────┬──────────┘
                               │
                               ▼
         ┌─────────────────────────────────────────────┐
         │              SESSION CAPTURE                │
         │  .quoth/sessions/{id}/log.md               │
         │  - Tool actions with timestamps            │
         │  - File paths modified                     │
         │  - Commands executed                       │
         └─────────────────────┬───────────────────────┘
                               │
                               │ Claude identifies learning
                               ▼
         ┌─────────────────────────────────────────────┐
         │            PENDING LEARNINGS                │
         │  .quoth/sessions/{id}/learnings.md         │
         │  - Type: decision|pattern|error|knowledge  │
         │  - Content: What was learned               │
         │  - Context: Why it matters                 │
         └─────────────────────┬───────────────────────┘
                               │
                               │ Session ends (Stop hook)
                               ▼
         ┌─────────────────────────────────────────────┐
         │           USER APPROVAL PROMPT              │
         │  "You discovered 3 learnings this session: │
         │   - 1 pattern (test structure)             │
         │   - 2 decisions (auth approach)            │
         │  Promote to persistent storage?"           │
         └─────────────────────┬───────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
    ┌─────────────────┐              ┌─────────────────┐
    │    APPROVED     │              │    DECLINED     │
    └────────┬────────┘              └────────┬────────┘
             │                                │
             ▼                                ▼
    ┌─────────────────┐              ┌─────────────────┐
    │  LOCAL STORAGE  │              │    DISCARDED    │
    │  .quoth/*.md    │              │  (session only) │
    └────────┬────────┘              └─────────────────┘
             │
             │ Optional: User runs /quoth-genesis
             ▼
    ┌─────────────────┐
    │  QUOTH SERVER   │
    │  (team shared)  │
    └─────────────────┘
```

---

## Strictness Modes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         STRICTNESS CONFIGURATION                            │
└─────────────────────────────────────────────────────────────────────────────┘

  .quoth/config.json
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ {                                                                        │
  │   "strictness": "blocking" | "reminder" | "off",                         │
  │   "gates": {                                                             │
  │     "require_quoth_search": true,                                        │
  │     "require_reasoning_before_edit": true                                │
  │   },                                                                     │
  │   "knowledge_types": ["decisions", "patterns", "errors", "knowledge"]    │
  │ }                                                                        │
  └──────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────┐
  │ BLOCKING MODE                                                           │
  │ ┌─────────────────────────────────────────────────────────────────────┐ │
  │ │ Claude tries Edit/Write                                             │ │
  │ │         │                                                           │ │
  │ │         ▼                                                           │ │
  │ │ pre-tool-gate.sh checks:                                            │ │
  │ │ - Did Claude search Quoth first?                                    │ │
  │ │ - Did Claude explain reasoning?                                     │ │
  │ │         │                                                           │ │
  │ │         ├── YES ──► Tool executes                                   │ │
  │ │         │                                                           │ │
  │ │         └── NO ──► Exit code 2 (BLOCKS tool)                        │ │
  │ │                    Returns: "Search Quoth for patterns first"       │ │
  │ └─────────────────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────┐
  │ REMINDER MODE                                                           │
  │ ┌─────────────────────────────────────────────────────────────────────┐ │
  │ │ Claude tries Edit/Write                                             │ │
  │ │         │                                                           │ │
  │ │         ▼                                                           │ │
  │ │ pre-tool-gate.sh checks same conditions                             │ │
  │ │         │                                                           │ │
  │ │         ├── YES ──► Tool executes (no message)                      │ │
  │ │         │                                                           │ │
  │ │         └── NO ──► Exit code 0 (ALLOWS tool)                        │ │
  │ │                    Returns: "Consider checking Quoth first"         │ │
  │ │                    (gentle nudge, doesn't block)                    │ │
  │ └─────────────────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────┐
  │ OFF MODE                                                                │
  │ ┌─────────────────────────────────────────────────────────────────────┐ │
  │ │ Claude tries Edit/Write                                             │ │
  │ │         │                                                           │ │
  │ │         ▼                                                           │ │
  │ │ pre-tool-gate.sh: Exit code 0                                       │ │
  │ │ (no checks, no messages)                                            │ │
  │ │         │                                                           │ │
  │ │         ▼                                                           │ │
  │ │ Tool executes normally                                              │ │
  │ │                                                                     │ │
  │ │ Note: Logging still happens via post-tool-log.sh                    │ │
  │ └─────────────────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────────┘
```

---

## quoth-memory Subagent

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        QUOTH-MEMORY SUBAGENT                                │
└─────────────────────────────────────────────────────────────────────────────┘

  WHY A SUBAGENT?
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                          │
  │  Problem: Memory operations consume main Claude context                  │
  │                                                                          │
  │  ┌─────────────────────┐      ┌─────────────────────┐                    │
  │  │ Without Subagent    │      │ With Subagent       │                    │
  │  │                     │      │                     │                    │
  │  │ Main Claude Context │      │ Main Claude Context │                    │
  │  │ ┌─────────────────┐ │      │ ┌─────────────────┐ │                    │
  │  │ │ User task       │ │      │ │ User task       │ │                    │
  │  │ │ + Quoth search  │ │      │ │                 │ │                    │
  │  │ │ + Quoth results │ │      │ │ (clean context) │ │                    │
  │  │ │ + Analysis      │ │      │ │                 │ │                    │
  │  │ │ = BLOATED       │ │      │ └─────────────────┘ │                    │
  │  │ └─────────────────┘ │      │         │           │                    │
  │  └─────────────────────┘      │         ▼           │                    │
  │                               │ ┌─────────────────┐ │                    │
  │                               │ │ quoth-memory    │ │                    │
  │                               │ │ (separate ctx)  │ │                    │
  │                               │ │ Searches, reads │ │                    │
  │                               │ │ Returns summary │ │                    │
  │                               │ └─────────────────┘ │                    │
  │                               └─────────────────────┘                    │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘

  SUBAGENT RESPONSIBILITIES
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                          │
  │  1. CONTEXT INJECTION                                                    │
  │     Main Claude: "I need patterns for Vitest mocking"                    │
  │           │                                                              │
  │           ▼                                                              │
  │     quoth-memory: Searches Quoth, reads docs, summarizes                 │
  │           │                                                              │
  │           ▼                                                              │
  │     Returns: "Use vi.mock() with factory. See patterns.md line 45"       │
  │                                                                          │
  │  2. INTERACTIVE QUERIES                                                  │
  │     Main Claude: "What's our error handling pattern?"                    │
  │           │                                                              │
  │           ▼                                                              │
  │     quoth-memory: Searches local .quoth/ + remote Quoth                  │
  │           │                                                              │
  │           ▼                                                              │
  │     Returns: Consolidated answer with sources                            │
  │                                                                          │
  │  3. KNOWLEDGE CAPTURE                                                    │
  │     Main Claude: "We decided to use JWT for auth"                        │
  │           │                                                              │
  │           ▼                                                              │
  │     quoth-memory: Formats as decision, writes to learnings.md            │
  │           │                                                              │
  │           ▼                                                              │
  │     Returns: "Captured decision. Will prompt for promotion at end."      │
  │                                                                          │
  │  4. PROMOTION PROPOSALS                                                  │
  │     At session end, proposes what to keep permanently                    │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘

  HOOK EXEMPTION
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                          │
  │  hooks.json matcher: "!quoth-memory"                                     │
  │                                                                          │
  │  This EXCLUDES quoth-memory from:                                        │
  │  - SubagentStart hook (no double context injection)                      │
  │  - SubagentStop hook (no documentation prompts for memory ops)           │
  │                                                                          │
  │  Why? Prevents infinite loops:                                           │
  │  - quoth-memory searches → hook fires → spawns quoth-memory → ...        │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

## Getting Started

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GETTING STARTED                                   │
└─────────────────────────────────────────────────────────────────────────────┘

  STEP 1: Install Plugin
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                          │
  │  # Add marketplace (one time)                                            │
  │  /plugin marketplace add Montinou/quoth-mcp                              │
  │                                                                          │
  │  # Install plugin                                                        │
  │  /plugin install quoth@quoth-marketplace                                 │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘

  STEP 2: Initialize Project
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                          │
  │  # Run in your project directory                                         │
  │  /quoth-init                                                             │
  │                                                                          │
  │  Creates:                                                                │
  │  .quoth/                                                                 │
  │  ├─ config.json      (default: reminder mode)                            │
  │  ├─ decisions.md     (empty)                                             │
  │  ├─ patterns.md      (empty)                                             │
  │  ├─ errors.md        (empty)                                             │
  │  └─ knowledge.md     (empty)                                             │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘

  STEP 3: Configure Strictness
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                          │
  │  Edit .quoth/config.json:                                                │
  │                                                                          │
  │  {                                                                       │
  │    "strictness": "reminder",     // or "blocking" or "off"               │
  │    "gates": {                                                            │
  │      "require_quoth_search": true,                                       │
  │      "require_reasoning_before_edit": false                              │
  │    }                                                                     │
  │  }                                                                       │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘

  STEP 4: Start Coding
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                          │
  │  Claude Code now automatically:                                          │
  │                                                                          │
  │  ✓ Injects context from .quoth/ at session start                         │
  │  ✓ Logs tool actions to session folder                                   │
  │  ✓ Enforces gates based on strictness mode                               │
  │  ✓ Prompts for knowledge promotion at session end                        │
  │                                                                          │
  │  You can also:                                                           │
  │                                                                          │
  │  • Ask Claude to use quoth-memory subagent for queries                   │
  │  • Run /quoth-genesis to sync to team-shared Quoth server                │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SUMMARY                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  BEFORE (Agentic RAG)              AFTER (AI Memory)                        │
│  ─────────────────────             ─────────────────                        │
│  Manual search required     →      Automatic context injection              │
│  Search consumes context    →      Subagent handles memory                  │
│  No persistence             →      Local .quoth/ storage                    │
│  All-or-nothing capture     →      User-approved promotion                  │
│  One strictness level       →      Configurable per-project                 │
│  No session history         →      Ephemeral logs preserved                 │
│                                                                             │
│  KEY INNOVATION: Bidirectional learning loop                                │
│  ─────────────────────────────────────────────                              │
│  • Claude RETRIEVES context automatically at session start                  │
│  • Claude STORES learnings with user approval at session end                │
│  • Knowledge grows organically through normal development                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
