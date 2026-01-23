# Quoth Evolution Design: Plugin, Insights & Adoption

**Date:** 2026-01-23
**Status:** Draft
**Authors:** Agustin Montoya + Claude

---

## Executive Summary

This design document outlines a cohesive strategy to improve Quoth across three interconnected areas:

1. **Discovery & Adoption** - Position Quoth as the MCP-native documentation layer for AI-native developers
2. **Day-to-day Workflow** - Replace manual prompt activation with an intelligent Claude Code plugin
3. **Visualization & Insights** - Build a dashboard showing documentation coverage, drift, usage, and health

**Target Audience:** Solo developers and small teams (2-10) who use AI tools (Claude Code, Cursor, Copilot).

**Key Differentiators (priority order):**
1. MCP-native - First-class integration with the AI tooling ecosystem
2. Zero-friction setup - Genesis bootstraps docs in minutes
3. Living documentation - Docs that stay in sync with code
4. AI guardrails - Prevent hallucinations with verified patterns

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     QUOTH ECOSYSTEM                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐         │
│  │   Plugin     │   │  MCP Server  │   │  Dashboard   │         │
│  │ (Claude Code)│◄─►│   (Quoth)    │◄─►│   (Web UI)   │         │
│  └──────────────┘   └──────────────┘   └──────────────┘         │
│        │                   │                   │                 │
│        │    Hooks &        │   Tools &         │   Insights &    │
│        │    Context        │   Search          │   Management    │
│        ▼                   ▼                   ▼                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Unified Activity & Metrics Store               ││
│  │  (Every AI query, pattern match, drift detection logged)   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Plugin** = Invisible copilot that auto-triggers hooks and injects Quoth context
**MCP Server** = The existing brain (search, read, propose, genesis)
**Dashboard** = Visualization layer showing coverage, drift, usage, health
**Activity Store** = Every interaction logged for insights

---

## Component 1: Quoth Plugin for Claude Code

### Core Behavior

Runs silently in the background, making every AI interaction Quoth-aware without user effort.

### Hooks Implemented

| Hook | Trigger | Action |
|------|---------|--------|
| `SessionStart` | Conversation begins | Detect project, check for Quoth docs, inject context |
| `PreToolUse` (Edit/Write) | Before code generation | Search Quoth for relevant patterns, add to context |
| `PostToolUse` (Edit/Write) | After code written | Audit against patterns, flag potential drift |
| `Stop` | Claude finishes response | Show summary badge: "✓ Verified" or "⚠ Review needed" |

### SessionStart Logic

```
1. Check if project has .quoth/ config or is connected to Quoth
2. If no → Offer Genesis: "No docs found. Run /quoth genesis?"
3. If yes → Silently load project context, set architect mode
4. Check if user manually invoked a prompt → Defer to that
```

### Token Efficiency Principles

- Only inject pattern *signatures* (name + 1-line summary), not full content
- Let Claude call `quoth_read_doc` if it needs details
- Badge output is 1-2 lines max, expandable only on demand
- PreToolUse context: ~50-100 tokens max (relevant pattern names only)

### Quoth Badge (Stop Hook Output)

```
┌─────────────────────────────────────────┐
│ 🔮 Quoth: ✓ 2 patterns applied          │
│          ⚠ 1 undocumented area          │
└─────────────────────────────────────────┘
```

### Plugin vs Manual Prompt Coexistence

**Design principle:** Plugin runs intelligent background behavior by default, but respects explicit user intent when they invoke a manual prompt.

- User has plugin installed → Plugin auto-injects architect context on SessionStart
- User types `/prompt quoth_auditor` → Plugin detects this and defers, auditor persona takes over
- User starts new session → Back to plugin's default behavior

---

## Component 2: Insights Dashboard

### Four Views (Priority Order)

#### 1. Coverage View (Primary)

```
┌─────────────────────────────────────────────────────────────────┐
│  Documentation Coverage                              78% ████░  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  By Category:                                                    │
│  ├── API Endpoints      ████████████░░  85%  (17/20 documented) │
│  ├── Components         ██████████░░░░  71%  (25/35 documented) │
│  ├── Testing Patterns   ████████████░░  82%  (14/17 documented) │
│  └── Database Models    ██████░░░░░░░░  45%  (9/20 documented)  │
│                                                                  │
│  [Undocumented areas →]                                          │
└─────────────────────────────────────────────────────────────────┘
```

#### 2. Drift Detection

- Timeline showing when code diverged from docs
- Clickable violations with diff view: "Doc says X, code does Y"
- Severity levels: Info → Warning → Critical

#### 3. Usage Analytics

- Queries per day/week (how often is your team using Quoth?)
- Top searched terms (what patterns are people looking for?)
- "Miss rate" - searches that returned no results (gaps in docs)

#### 4. Health Dashboard

- Staleness indicator per document (last updated vs last code change)
- Suggested updates based on code changes
- One-click "refresh this doc" action

### Coverage Calculation Logic

**Convention-based (automatic, no prompt):**

```
/api/* routes           → should have API schema docs
/components/* exports   → should have component patterns
database models         → should have data model docs
test files              → should have testing pattern docs
config files            → should have architecture docs
```

**AI-assisted (asks user only for non-conventional):**

```
"Found /lib/legal-matching/ - custom domain logic. Document?"
"Found /utils/pdf-parser.ts - internal utility. Include?"
User confirms or skips
```

---

## Component 3: Discovery & Adoption Strategy

### Positioning Statement

> "The documentation layer built for AI-native development. Your AI already knows how to code—Quoth teaches it *your* codebase."

### Three Adoption Vectors

#### 1. MCP Ecosystem Presence

- Listed in MCP server directories (Anthropic's official list, community catalogs)
- One-command install: `claude mcp add quoth`
- "Works with Claude Code" badge prominently featured

#### 2. The "Genesis Demo" Hook

- Landing page shows Genesis running live on a sample repo
- Visitor sees docs being generated in real-time (30-second video/animation)
- CTA: "Try Genesis on your repo in 3 minutes"

#### 3. The Insights Hook

- "See what you're missing" - run a free coverage scan without signup
- Shows: "Your codebase has ~23% documentation coverage. Here's what's undocumented."
- Converts curiosity into "I need this"

### Landing Page Flow

```
Hero: "Your AI hallucinates because it doesn't know your codebase"
  ↓
Demo: Watch Genesis document a repo in real-time
  ↓
Proof: Coverage scan showing the gap
  ↓
CTA: "Add Quoth in one command"
```

---

## Aesthetic Evolution

### Seamless Gradient from Marketing to Product

| Layer | Mood | Design Choices |
|-------|------|----------------|
| **Landing/Marketing** | Atmospheric, dramatic | Full neo-noir: orbs, glows, glass panels, Cinzel headings |
| **Onboarding/Genesis** | Focused, guided | Reduced orbs, more whitespace, violet accents remain |
| **Dashboard** | Functional, clear | Minimal glass effects, clean cards, data-first layout |
| **Plugin output** | Invisible, subtle | Plain text badges, no decoration, max 2 lines |

### Consistent Thread Across All Layers

- Violet accent color (#8B5CF6) appears everywhere
- Geist Sans typography throughout
- Dark backgrounds (progressively lighter: obsidian → charcoal → graphite cards)
- 1.5px Lucide icons maintained

**The transition feel:** Like walking from a dramatic theater lobby into a well-lit professional workspace—same building, different energy.

---

## Implementation Phases

### Phase 1: Foundation (Ship first, prove value)

- [ ] Quoth Plugin v1 with SessionStart + Stop hooks
- [ ] Activity logging table in Supabase
- [ ] Basic dashboard: usage analytics only (easiest metric)
- [ ] Landing page refresh with Genesis demo video

**Outcome:** Users can install plugin, see basic activity stats

### Phase 2: Intelligence (The "aha" moment)

- [ ] PreToolUse/PostToolUse hooks for pattern injection + audit
- [ ] Coverage view in dashboard (convention-based calculation)
- [ ] Genesis auto-detection of undocumented projects
- [ ] "Quoth Badge" output after responses

**Outcome:** Plugin actively helps during development, coverage metrics visible

### Phase 3: Insights (Prove ongoing value)

- [ ] Drift detection with timeline view
- [ ] Health dashboard with staleness indicators
- [ ] Miss rate analytics (searches with no results)
- [ ] Weekly health report emails for teams

**Outcome:** Full observability into documentation health

### Phase 4: Adoption (Growth engine)

- [ ] Free coverage scan without signup
- [ ] MCP directory listings
- [ ] "See what you're missing" landing page flow
- [ ] Public case studies / testimonials

**Outcome:** Self-serve discovery and conversion funnel

---

## Technical Considerations

### Database Schema Additions

```sql
-- Activity logging
CREATE TABLE quoth_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  user_id UUID REFERENCES profiles(id),
  event_type TEXT NOT NULL, -- 'search', 'read', 'pattern_match', 'drift_detected'
  query TEXT,
  patterns_matched TEXT[], -- pattern IDs that matched
  drift_detected BOOLEAN DEFAULT false,
  context JSONB, -- additional metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Coverage tracking
CREATE TABLE coverage_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  total_documentable INTEGER,
  total_documented INTEGER,
  coverage_percentage NUMERIC(5,2),
  breakdown JSONB, -- by category
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Plugin File Structure

```
quoth-plugin/
├── plugin.json           # Plugin manifest
├── hooks/
│   ├── session-start.md  # SessionStart hook
│   ├── pre-tool-use.md   # PreToolUse hook
│   ├── post-tool-use.md  # PostToolUse hook
│   └── stop.md           # Stop hook
├── skills/
│   └── quoth-genesis.md  # Genesis skill (manual trigger)
└── README.md
```

---

## Success Metrics

| Metric | Phase 1 Target | Phase 4 Target |
|--------|----------------|----------------|
| Plugin installs | 50 | 500 |
| Daily active projects | 10 | 100 |
| Avg queries per project/day | 5 | 20 |
| Coverage scans completed | - | 1000 |
| Conversion (scan → signup) | - | 15% |

---

## Open Questions

1. **Drift detection algorithm** - How do we semantically compare code to documentation?
2. **Coverage scan without auth** - How much can we scan without requiring signup?
3. **Plugin distribution** - Host on npm? Claude Code plugin registry?

---

## Appendix: User Flow Diagrams

### New User Flow

```
Discovers Quoth (MCP directory / landing page)
  ↓
Runs coverage scan (free, no signup)
  ↓
Sees "23% coverage" → "I need this"
  ↓
`claude mcp add quoth` + OAuth
  ↓
Plugin auto-installs
  ↓
Next session: Genesis auto-offered
  ↓
Docs generated → Coverage improves
  ↓
Dashboard shows progress over time
```

### Existing User Daily Flow

```
Opens Claude Code in project
  ↓
Plugin SessionStart: loads Quoth context
  ↓
User asks Claude to write code
  ↓
PreToolUse: injects relevant patterns (50 tokens)
  ↓
Claude generates code following patterns
  ↓
PostToolUse: audits against docs
  ↓
Stop: shows badge "✓ 2 patterns applied"
  ↓
Activity logged → Dashboard updated
```
