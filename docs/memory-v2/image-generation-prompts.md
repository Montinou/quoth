# Quoth v2.0 - Image Generation Prompts

> Standalone prompts for Gemini Imagen 3 - each section is copy-paste ready

---

## 1. System Architecture Diagram

```
Create a technical system architecture diagram for "Quoth Plugin v2.0" AI memory system.

STYLE REQUIREMENTS:
- Dark mode, intellectual neo-noir aesthetic
- Background: #0A0A0A (near black/obsidian)
- Cards/panels: #1A1A1A (charcoal) with glassmorphism effect (subtle blur, transparency)
- Borders: #262626 (graphite)
- Primary accent: #8B5CF6 (violet) with subtle glow effects
- Secondary accent: #A78BFA (lighter violet)
- Body text: #9CA3AF (gray)
- Headings: #FFFFFF (white)
- Typography: Sans-serif for labels, monospace for code/file names
- No gradients. Flat colors with subtle shadows
- Professional technical documentation style

LAYOUT:
Single large container with nested sections.

Main container titled "QUOTH PLUGIN v2.0" at top in white.

Inside, show 4 horizontal sections stacked vertically:

SECTION 1 - "LOCAL STORAGE (.quoth/)"
Glass panel with violet left border.
Show folder tree structure with file icons:
├─ config.json         - Project settings
├─ decisions.md        - Architecture choices
├─ patterns.md         - Code patterns
├─ errors.md           - Failures and fixes
├─ knowledge.md        - General context
└─ sessions/{id}/      - Ephemeral session logs

SECTION 2 - "HOOKS (Enforcement layer)"
Glass panel. Show 7 hook files as connected nodes with arrows:
- session-start.sh → Init session, inject context
- user-prompt.sh → Track user intent
- pre-tool-gate.sh → Enforce documentation gates
- post-tool-log.sh → Log tool actions
- subagent-start.sh → Memory context injection
- subagent-stop.sh → Documentation prompts
- stop.sh → Knowledge promotion

SECTION 3 - "SUBAGENT (Memory interface)"
Glass panel with stronger violet glow highlight.
Single node: "quoth-memory (Sonnet)"
Show tool icons around it: search, read, write, edit, glob
Label: "Context summarization & queries"

SECTION 4 - "SKILLS"
Glass panel. Two pill-shaped badges:
- /quoth-init → Initialize .quoth/ folder
- /quoth-genesis → Bootstrap to Quoth server
```

---

## 2. Session Lifecycle Diagram

```
Create a vertical flowchart showing "Session Lifecycle" for Quoth AI memory system.

STYLE REQUIREMENTS:
- Dark mode, intellectual neo-noir aesthetic
- Background: #0A0A0A (near black/obsidian)
- Cards/panels: #1A1A1A (charcoal) with glassmorphism effect (subtle blur, transparency)
- Borders: #262626 (graphite)
- Primary accent: #8B5CF6 (violet) with subtle glow effects
- Secondary accent: #A78BFA (lighter violet)
- Body text: #9CA3AF (gray)
- Headings: #FFFFFF (white)
- Arrows: #4B5563 (dark gray) with violet tips
- Typography: Sans-serif for labels, monospace for file names
- Clean technical aesthetic

LAYOUT:
Vertical flow, top to bottom.

START NODE:
Rounded rectangle "User starts Claude Code" with subtle violet border.

ARROW DOWN TO:

BOX 1 - "SessionStart Hook" (session-start.sh)
Glassmorphism panel with violet left border accent.
Inside show 4 numbered steps:
1. Create session folder: .quoth/sessions/{uuid}/
2. Read config.json for strictness settings
3. Inject context from persistent type files
4. Return session ID for tracking

ARROW DOWN TO:

BOX 2 - "Active Session" (largest box, takes most space)
Large glassmorphism panel.
Contains internal flow diagram showing:

User Prompt → UserPromptSubmit Hook → Track intent
      │
      ▼
Claude processes request
      │
      ├──► Edit/Write tool ──► PreToolUse Hook (gate check)
      │                              │
      │                              ├─ blocking: Block if no search
      │                              ├─ reminder: Gentle hint
      │                              └─ off: Pass through
      │
      ├──► Tool executes ──► PostToolUse Hook (log action)
      │                              │
      │                              └─► .quoth/sessions/{id}/log.md
      │
      └──► Subagent spawned ──► SubagentStart Hook
                                     │
                                     └─► Inject memory context
                                         (skips quoth-memory)

Use small icons for each step. Dotted lines for optional paths.

ARROW DOWN TO:

BOX 3 - "Stop Hook" (stop.sh)
Glassmorphism panel with violet left border accent.
4 numbered steps:
1. Check if learnings.md has pending items
2. Prompt user: "Promote learnings to persistent storage?"
3. If approved: Append to .quoth/{type}.md
4. Cleanup old sessions (>48h)

ARROW DOWN TO:

END NODE:
Rounded rectangle "Session ends" with subtle violet border.
```

---

## 3. Knowledge Flow Diagram

```
Create a vertical flowchart showing "Knowledge Flow" - how information moves from user actions to permanent storage in Quoth AI memory system.

STYLE REQUIREMENTS:
- Dark mode, intellectual neo-noir aesthetic
- Background: #0A0A0A (near black/obsidian)
- Cards/panels: #1A1A1A (charcoal) with glassmorphism effect (subtle blur, transparency)
- Borders: #262626 (graphite)
- Primary accent: #8B5CF6 (violet) with subtle glow effects
- Light violet: #DDD6FE (ghost violet)
- Body text: #9CA3AF (gray)
- Headings: #FFFFFF (white)
- Success: #10B981 (green)
- Warning: #F59E0B (amber/orange)
- Error: #EF4444 (red)
- Typography: Sans-serif for labels, monospace for file paths

LAYOUT:
Vertical flow, top to bottom.

LEVEL 1 - TOP:
Rounded box with violet glow: "USER ACTION"
Subtitle: "(code, decisions)"

ARROW DOWN TO:

LEVEL 2 - "SESSION CAPTURE"
Glassmorphism panel with subtle violet border.
File path in monospace: .quoth/sessions/{id}/log.md
Bullet points:
• Tool actions with timestamps
• File paths modified
• Commands executed

ARROW DOWN (labeled "Claude identifies learning"):

LEVEL 3 - "PENDING LEARNINGS"
Glassmorphism panel with amber/orange tint to indicate "pending" state.
File path: .quoth/sessions/{id}/learnings.md
Show type options as tags: decision | pattern | error | knowledge
Fields: Content, Context, Source

ARROW DOWN (labeled "Session ends - Stop hook"):

LEVEL 4 - "USER APPROVAL PROMPT"
Dialog-style box, prominent placement.
Text inside:
"You discovered 3 learnings this session:
 - 1 pattern (test structure)
 - 2 decisions (auth approach)
Promote to persistent storage?"

Two buttons below:
[Approve] - violet button with glow
[Decline] - gray button

SPLIT INTO TWO BRANCHES:

LEFT BRANCH (Approved path):
Green checkmark icon.
Arrow down to:
Box: "LOCAL STORAGE"
Subtitle: ".quoth/*.md"
Glassmorphism with green tint.

Then dotted arrow down to:
Box: "QUOTH SERVER"
Subtitle: "(team shared)"
Cloud icon. Label: "Optional: /quoth-genesis"

RIGHT BRANCH (Declined path):
Red X icon.
Arrow down to:
Box: "DISCARDED"
Subtitle: "(session only)"
Faded/dimmed appearance, gray tint.
```

---

## 4. Strictness Modes Diagram

```
Create a comparison diagram showing three "Strictness Modes" for Quoth gate enforcement system.

STYLE REQUIREMENTS:
- Dark mode, intellectual neo-noir aesthetic
- Background: #0A0A0A (near black/obsidian)
- Cards/panels: #1A1A1A (charcoal) with glassmorphism effect (subtle blur, transparency)
- Borders: #262626 (graphite)
- Primary accent: #8B5CF6 (violet)
- Body text: #9CA3AF (gray)
- Headings: #FFFFFF (white)
- Blocking mode accent: #EF4444 (red) mixed with violet
- Reminder mode accent: #EAB308 (yellow/amber)
- Off mode accent: #6B7280 (gray)
- Success: #10B981 (green)
- Typography: Sans-serif for labels, monospace for code

LAYOUT:
Header at top, then three equal columns side by side.

HEADER:
Title: "STRICTNESS CONFIGURATION"
Code block showing config.json:
{
  "strictness": "blocking" | "reminder" | "off",
  "gates": {
    "require_quoth_search": true,
    "require_reasoning_before_edit": true
  }
}

THREE COLUMNS:

COLUMN 1 - "BLOCKING MODE"
Red-violet accent color on border and icons.
Icon: Shield or stop sign.
Badge: "Strict enforcement"

Flow diagram inside glassmorphism panel:
┌─────────────────────────┐
│ Claude tries Edit/Write │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ pre-tool-gate.sh checks │
│ • Did Claude search?    │
│ • Did Claude explain?   │
└───────────┬─────────────┘
            ▼
      ┌─────────┐
      │ Passed? │
      └────┬────┘
     YES   │   NO
      │    │    │
      ▼    │    ▼
  ┌──────┐ │ ┌──────────────┐
  │ Tool │ │ │ Exit code 2  │
  │ runs │ │ │ BLOCKS tool  │
  │  ✓   │ │ │      ✗       │
  └──────┘ │ └──────────────┘
           │        │
           │        ▼
           │  Message bubble:
           │  "Search Quoth for
           │   patterns first"

COLUMN 2 - "REMINDER MODE"
Yellow-amber accent color.
Icon: Bell or lightbulb.
Badge: "Gentle nudge"

Flow diagram inside glassmorphism panel:
┌─────────────────────────┐
│ Claude tries Edit/Write │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ pre-tool-gate.sh checks │
└───────────┬─────────────┘
            ▼
      ┌─────────┐
      │ Passed? │
      └────┬────┘
     YES   │   NO
      │    │    │
      ▼    │    ▼
  ┌──────┐ │ ┌──────────────┐
  │ Tool │ │ │ Exit code 0  │
  │ runs │ │ │ ALLOWS tool  │
  │ (no  │ │ │      ⚠       │
  │ msg) │ │ └──────────────┘
  └──────┘ │        │
           │        ▼
           │  Message bubble:
           │  "Consider checking
           │   Quoth first"

COLUMN 3 - "OFF MODE"
Gray accent color.
Icon: Toggle switch (off position).
Badge: "Manual only"

Flow diagram inside glassmorphism panel:
┌─────────────────────────┐
│ Claude tries Edit/Write │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ pre-tool-gate.sh        │
│ Exit code 0             │
│ (no checks)             │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ Tool executes normally  │
└─────────────────────────┘

Note at bottom:
"Logging still happens via post-tool-log.sh"

FOOTER:
Banner spanning all columns:
"All modes log actions to .quoth/sessions/{id}/log.md"
```

---

## 5. Subagent Architecture Diagram

```
Create a technical diagram explaining "quoth-memory Subagent" for Quoth AI memory system.

STYLE REQUIREMENTS:
- Dark mode, intellectual neo-noir aesthetic
- Background: #0A0A0A (near black/obsidian)
- Cards/panels: #1A1A1A (charcoal) with glassmorphism effect (subtle blur, transparency)
- Borders: #262626 (graphite)
- Primary accent: #8B5CF6 (violet) with subtle glow effects
- Body text: #9CA3AF (gray)
- Headings: #FFFFFF (white)
- Success/healthy: #10B981 (green)
- Warning/bloated: #EF4444 (red)
- Typography: Sans-serif for labels, monospace for code

LAYOUT:
Two-part diagram, stacked vertically.

PART 1 - "WHY A SUBAGENT?" (top half)
Title in white with question mark icon.

Side-by-side comparison with arrow between:

LEFT BOX - "Without Subagent"
Red-tinted glassmorphism panel.
Large rectangle representing "Main Claude Context"
Inside, stacked items eating up space:
┌─────────────────────────┐
│ User task               │
│ + Quoth search call     │
│ + Quoth results (large) │
│ + Analysis overhead     │
│ ═══════════════════════ │
│ = CONTEXT BLOATED       │
└─────────────────────────┘
Context usage bar: 80% full, red color
Label: "Memory operations consume context"

CENTER:
Large arrow pointing right.
Gradient from red to green.

RIGHT BOX - "With Subagent"
Green-tinted glassmorphism panel.
Large rectangle "Main Claude Context"
Inside, minimal content:
┌─────────────────────────┐
│ User task               │
│                         │
│ (clean context)         │
│                         │
└─────────────────────────┘
Context usage bar: 20% full, green color

Arrow pointing down to separate smaller box:
┌─────────────────────────┐
│ quoth-memory            │
│ (separate context)      │
│                         │
│ Searches → Reads →      │
│ Returns summary only    │
└─────────────────────────┘
Violet glow around this box.
Label: "Subagent has own context window"

PART 2 - "RESPONSIBILITIES" (bottom half)
Title in white.

Four horizontal cards in a row:

CARD 1 - "Context Injection"
Icon: Download arrow into brain.
Violet accent.
Mini-flow:
Main Claude asks → quoth-memory searches → Returns summary
Example: "Use vi.mock() with factory. See patterns.md:45"

CARD 2 - "Interactive Queries"
Icon: Question mark / chat bubble.
Violet accent.
Mini-flow:
"What's our auth pattern?" → Search local + remote → Answer with sources

CARD 3 - "Knowledge Capture"
Icon: Save / floppy disk.
Violet accent.
Mini-flow:
Learning identified → Format by type → Write to learnings.md

CARD 4 - "Promotion Proposals"
Icon: Upload arrow.
Violet accent.
Note: "At session end, proposes what to keep permanently"

BOTTOM BANNER:
Glassmorphism panel spanning full width.
Title: "HOOK EXEMPTION"
Content: hooks.json matcher: "!quoth-memory"

Visual: Show hook icons (session-start, subagent-start, subagent-stop) with prohibition symbol (🚫) over quoth-memory

Explanation: "Excludes quoth-memory from SubagentStart/SubagentStop hooks to prevent infinite loops"
```

---

## 6. Getting Started Guide

```
Create a step-by-step "Getting Started" guide diagram for Quoth AI memory plugin.

STYLE REQUIREMENTS:
- Dark mode, intellectual neo-noir aesthetic
- Background: #0A0A0A (near black/obsidian)
- Cards/panels: #1A1A1A (charcoal) with glassmorphism effect (subtle blur, transparency)
- Borders: #262626 (graphite)
- Primary accent: #8B5CF6 (violet) with subtle glow effects
- Light violet: #DDD6FE (ghost violet)
- Body text: #9CA3AF (gray)
- Headings: #FFFFFF (white)
- Success: #10B981 (green)
- Typography: Sans-serif for labels, monospace for commands

LAYOUT:
Four cards arranged in 2x2 grid or vertical stack.
Connected by dotted arrow path showing progression.

STEP 1 - "Install Plugin"
Large violet circle with white "1" inside.
Icon: Download/plugin puzzle piece.

Glassmorphism card containing:
Code block (dark background, monospace):
# Add marketplace (one time)
/plugin marketplace add Montinou/quoth-mcp

# Install plugin
/plugin install quoth@quoth-marketplace

Green checkmark in corner indicating "complete"

STEP 2 - "Initialize Project"
Large violet circle with white "2" inside.
Icon: Folder with plus sign.

Glassmorphism card containing:
Code block:
/quoth-init

Created folder structure visualization:
.quoth/
├─ config.json      (default: reminder mode)
├─ decisions.md     (empty)
├─ patterns.md      (empty)
├─ errors.md        (empty)
└─ knowledge.md     (empty)

STEP 3 - "Configure Strictness"
Large violet circle with white "3" inside.
Icon: Sliders/settings gear.

Glassmorphism card containing:
Text: "Edit .quoth/config.json:"

Code block:
{
  "strictness": "reminder",
  "gates": {
    "require_quoth_search": true,
    "require_reasoning_before_edit": false
  }
}

Three mode badges below:
[blocking] [reminder] [off]
With "reminder" highlighted as default.

STEP 4 - "Start Coding"
Large violet circle with white "4" inside.
Icon: Rocket or play button.
Subtle celebratory glow effect around this card.

Glassmorphism card containing:
Title: "Claude Code now automatically:"

Checklist with green checkmarks:
✓ Injects context from .quoth/ at session start
✓ Logs tool actions to session folder
✓ Enforces gates based on strictness mode
✓ Prompts for knowledge promotion at session end

Optional actions:
• Use quoth-memory subagent for queries
• Run /quoth-genesis to sync to team server

FOOTER:
Quoth raven logo watermark in bottom right corner.
```

---

## 7. Before/After Comparison

```
Create a before/after comparison diagram showing evolution from "Agentic RAG" to "AI Memory" in Quoth system.

STYLE REQUIREMENTS:
- Dark mode, intellectual neo-noir aesthetic
- Background: #0A0A0A (near black/obsidian)
- Cards/panels: #1A1A1A (charcoal) with glassmorphism effect (subtle blur, transparency)
- Borders: #262626 (graphite)
- Primary accent: #8B5CF6 (violet) with subtle glow effects
- Body text: #9CA3AF (gray)
- Headings: #FFFFFF (white)
- Success: #10B981 (green)
- Error/old: #EF4444 (red)
- Typography: Sans-serif for labels

LAYOUT:
Split design - two columns with dramatic center transformation divider.

LEFT SIDE - "BEFORE: Agentic RAG"
Muted/desaturated colors (grays, faded).
Slightly faded, aged appearance.
Glassmorphism panel with gray border.

Icon at top: Static database or simple brain icon (gray).

List with red X marks:
✗ Manual search required
✗ Search consumes context
✗ No persistence
✗ All-or-nothing capture
✗ One strictness level
✗ No session history

Visual metaphor: User manually pulling information from a filing cabinet.

CENTER DIVIDER:
Large dramatic arrow pointing from left to right.
Gradient transitioning from gray (#6B7280) to violet (#8B5CF6).
Text on arrow: "TRANSFORMS TO"
Quoth raven logo integrated into the arrow.
Subtle particle/energy effect along the arrow.

RIGHT SIDE - "AFTER: AI Memory"
Vibrant colors with violet (#8B5CF6) accents.
Glowing, energized appearance.
Glassmorphism panel with violet border and subtle glow.

Icon at top: Glowing brain or neural network icon (violet glow).

List with green checkmarks:
✓ Automatic context injection
✓ Subagent handles memory
✓ Local .quoth/ storage
✓ User-approved promotion
✓ Configurable per-project
✓ Ephemeral logs preserved

Visual metaphor: Knowledge flowing automatically, bidirectional arrows.

BOTTOM BANNER - "KEY INNOVATION"
Glassmorphism panel spanning full width.
Title: "Bidirectional Learning Loop"

Three connected nodes in a cycle:
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  RETRIEVES   │────►│   STORES     │────►│   GROWS      │
│ (at start)   │     │  (at end)    │     │ (organically)│
└──────────────┘     └──────────────┘     └──────────────┘
        ▲                                        │
        └────────────────────────────────────────┘

Circular arrow suggesting continuous cycle.
Violet glow on the cycle arrows.

Tagline: "Claude RETRIEVES context automatically • STORES learnings with approval • Knowledge GROWS through normal development"
```

---

## 8. Hook Execution Timeline

```
Create a technical timeline diagram showing "Hook Execution Flow" - when each hook fires during a Quoth/Claude Code session.

STYLE REQUIREMENTS:
- Dark mode, intellectual neo-noir aesthetic
- Background: #0A0A0A (near black/obsidian)
- Cards/panels: #1A1A1A (charcoal) with glassmorphism effect (subtle blur, transparency)
- Borders: #262626 (graphite)
- Primary accent: #8B5CF6 (violet) with subtle glow effects
- Body text: #9CA3AF (gray)
- Headings: #FFFFFF (white)
- Gate hooks: #F59E0B (orange/amber)
- Log hooks: #10B981 (green)
- Context hooks: #8B5CF6 (violet)
- Typography: Sans-serif for labels, monospace for file names

LAYOUT:
Horizontal timeline with vertical swimlanes.

HEADER:
Title: "HOOK EXECUTION TIMELINE"
Subtitle: "When each hook fires during a Claude Code session"
Arrow spanning full width indicating time flow (left to right).

TIME MARKERS:
"Session Start" | "Active Session" | "Session End"

SWIMLANE 1 - "User Events" (top row)
Gray color scheme.
Dots on timeline connected by line:
● Start session → ● Send prompt → ● Send prompt → ● End session

SWIMLANE 2 - "Claude Actions" (middle row)
Blue color scheme (#3B82F6).
Dots on timeline:
● Initialize → ● Process → ● Edit file → ● Spawn agent → ● Bash cmd → ● Complete

SWIMLANE 3 - "Hooks Fire" (bottom row, largest)
Show blocks/badges when hooks activate, positioned under corresponding actions:

At "Start session":
┌─────────────────────┐
│ session-start.sh    │ ← VIOLET (context hook)
│ Init + inject ctx   │
└─────────────────────┘

At each "Send prompt":
┌─────────────────────┐
│ user-prompt.sh      │ ← VIOLET (context hook)
│ Track intent        │
└─────────────────────┘

Before "Edit file":
┌─────────────────────┐
│ pre-tool-gate.sh    │ ← ORANGE (gate hook)
│ Check gates         │
│ Can BLOCK (exit 2)  │
└─────────────────────┘

After "Edit file":
┌─────────────────────┐
│ post-tool-log.sh    │ ← GREEN (log hook)
│ Record action       │
└─────────────────────┘

At "Spawn agent":
┌─────────────────────┐
│ subagent-start.sh   │ ← VIOLET (context hook)
│ Inject memory ctx   │
└─────────────────────┘

When agent completes:
┌─────────────────────┐
│ subagent-stop.sh    │ ← VIOLET (context hook)
│ Doc prompts         │
└─────────────────────┘

At "End session":
┌─────────────────────┐
│ stop.sh             │ ← VIOLET with star icon
│ Promotion prompt    │
│ Cleanup sessions    │
└─────────────────────┘

LEGEND (bottom left):
Three colored badges:
[ORANGE] Gate hooks - Can block execution (exit 2)
[GREEN] Log hooks - Record only (exit 0)
[VIOLET] Context hooks - Inject or prompt (exit 0)

EXIT CODES (bottom center):
Exit 0 = Allow tool to proceed
Exit 2 = Block tool with message

CALLOUT BOX (bottom right):
Glassmorphism panel with violet border.
Icon: Info or warning.
Text: "quoth-memory subagent bypasses SubagentStart/SubagentStop hooks"
Code: matcher: "!quoth-memory"
Reason: "Prevents infinite loops"
```

---

## 9. Local Storage Structure

```
Create a detailed diagram showing ".quoth/ Local Storage Structure" for Quoth AI memory system.

STYLE REQUIREMENTS:
- Dark mode, intellectual neo-noir aesthetic
- Background: #0A0A0A (near black/obsidian)
- Cards/panels: #1A1A1A (charcoal) with glassmorphism effect (subtle blur, transparency)
- Borders: #262626 (graphite)
- Primary accent: #8B5CF6 (violet) with subtle glow effects
- Body text: #9CA3AF (gray)
- Headings: #FFFFFF (white)
- File icons: Appropriate colors per type
- Typography: Sans-serif for labels, monospace for file names and paths

LAYOUT:
Main folder tree visualization with detail panels.

MAIN TREE (left side):
Large glassmorphism panel showing folder structure.
Title: ".quoth/" with folder icon.

.quoth/
│
├─ 📄 config.json          [gear icon, violet]
│
├─ 📝 decisions.md         [document icon, blue]
│
├─ 📝 patterns.md          [code icon, green]
│
├─ 📝 errors.md            [bug icon, red]
│
├─ 📝 knowledge.md         [brain icon, purple]
│
└─ 📁 sessions/            [folder icon, amber]
    │
    ├─ 📁 a1b2c3d4-...     [session folder]
    │   ├─ 📄 log.md
    │   └─ 📄 learnings.md
    │
    └─ 📁 e5f6g7h8-...     [session folder]
        ├─ 📄 log.md
        └─ 📄 learnings.md

DETAIL PANELS (right side):
Four smaller glassmorphism panels explaining each type:

PANEL 1 - "config.json"
Violet accent.
Purpose: Project settings.
Contains:
{
  "strictness": "reminder",
  "gates": {...},
  "knowledge_types": [...]
}

PANEL 2 - "Type Files (*.md)"
Multi-color accent (blue, green, red, purple).
Purpose: Persistent knowledge.
Types: decisions, patterns, errors, knowledge
Survives sessions. User-approved content only.
Format: H2 sections with metadata.

PANEL 3 - "sessions/{id}/"
Amber accent.
Purpose: Ephemeral session data.
UUID-named folders (one per session).
Auto-cleanup after 48 hours.
Contains tool logs and pending learnings.

PANEL 4 - "Session Files"
Amber accent.
log.md: Timestamped tool actions.
learnings.md: Pending items for promotion.
Format shown:
## [timestamp] Edit
- File: src/app.ts
- Action: Modified function
- Reasoning: ...

FOOTER:
Lifecycle arrow showing:
Session capture → User approval → Type file storage → (optional) Quoth server sync
```
