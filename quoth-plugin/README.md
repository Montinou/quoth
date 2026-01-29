# Quoth Plugin v2.0 - AI Memory for Claude Code

AI Memory plugin with local-first storage, configurable strictness, and quoth-memory subagent. Transforms documentation from "search and read" to "automatic memory".

## What's New in v2.0

- **Local-first storage** - `.quoth/` folder persists knowledge across sessions
- **quoth-memory subagent** - Sonnet-powered memory interface for context queries
- **Configurable strictness** - `blocking`, `reminder`, or `off` modes
- **Session logging** - All actions captured to `.quoth/sessions/`
- **Knowledge promotion** - User-approved transfer to local/remote storage

## Quick Install

### From Marketplace (Recommended)

```bash
# Add the Quoth marketplace (one time)
/plugin marketplace add Montinou/quoth-mcp

# Install the plugin
/plugin install quoth@quoth-marketplace
```

This installs:
- **MCP Server** - All tools (search, read, propose, genesis)
- **Hooks** - Session management, gate enforcement, logging
- **Skills** - `/quoth-init`, `/quoth-genesis`
- **Agents** - `quoth-memory` subagent

### MCP Only (No Local Memory)

```bash
claude mcp add --transport http quoth https://quoth.ai-innovation.site/api/mcp
```

## Getting Started

### 1. Initialize AI Memory

```bash
/quoth-init
```

This creates your local memory structure:

```
.quoth/
├── config.json         # Strictness, types, gates
├── decisions.md        # Architecture choices
├── patterns.md         # Code patterns
├── errors.md           # Failures and fixes
├── knowledge.md        # General context
└── sessions/           # Session logs (gitignored)
```

### 2. Choose Strictness

During init, choose how strictly to enforce documentation:

| Mode | Behavior |
|------|----------|
| **blocking** | Cannot edit code until reasoning documented |
| **reminder** | Gentle prompts, not blocking |
| **off** | Manual capture only |

### 3. Work Normally

The plugin automatically:
1. Injects relevant context at session start
2. Logs your actions to session folder
3. Prompts for knowledge promotion at session end

## Components

### MCP Tools

| Tool | Purpose |
|------|---------|
| `quoth_search_index` | Semantic search across documentation |
| `quoth_read_doc` | Read full document content |
| `quoth_propose_update` | Submit documentation updates |
| `quoth_genesis` | Bootstrap project documentation |
| `quoth_guidelines` | Adaptive guidelines (code/review/document modes) |

### Hooks

| Hook | Event | Purpose |
|------|-------|---------|
| `session-start.sh` | SessionStart | Initialize session, inject context |
| `pre-tool-gate.sh` | PreToolUse | Gate Edit/Write (if blocking mode) |
| `post-tool-log.sh` | PostToolUse | Log actions to session |
| `subagent-start.sh` | SubagentStart | Context injection (excludes quoth-memory) |
| `subagent-stop.sh` | SubagentStop | Documentation prompts (excludes quoth-memory) |
| `stop.sh` | Stop | Knowledge promotion prompt |

### quoth-memory Subagent

A Sonnet-powered memory interface that:
- Summarizes relevant context (~500 tokens)
- Answers questions without bloating main context
- Prepares knowledge promotion proposals
- **Exempt from all hooks** (prevents infinite loops)

Query it directly:
```
"Ask quoth-memory: What's our error handling pattern?"
```

### Skills

- `/quoth-init` - Initialize AI Memory with configuration wizard
- `/quoth-genesis` - Bootstrap documentation (minimal/standard/comprehensive)

## Configuration

### .quoth/config.json

```json
{
  "version": "2.0",
  "project_id": "uuid-or-empty",
  "project_slug": "my-project",
  "strictness": "reminder",
  "types": ["decisions", "patterns", "errors", "knowledge"],
  "gates": {
    "require_reasoning_before_edit": true,
    "require_quoth_search": true,
    "require_error_documentation": false
  }
}
```

### Strictness Modes

**blocking** (Recommended for teams)
- Cannot edit code until reasoning is documented
- Must search Quoth before generating patterns
- Gates enforced via `pre-tool-gate.sh`

**reminder** (Default)
- Gentle prompts when editing code
- Not blocking, Claude decides when to document
- Good balance for solo development

**off**
- No enforcement, manual capture only
- Use for quick prototyping

## Plugin Structure

```
quoth-plugin/
├── .claude-plugin/
│   ├── plugin.json           # v2.0.0 manifest
│   ├── hooks/
│   │   ├── hooks.json        # Hook definitions
│   │   ├── lib/
│   │   │   └── common.sh     # Shared utilities
│   │   ├── session-start.sh  # SessionStart hook
│   │   ├── pre-tool-gate.sh  # PreToolUse gate
│   │   ├── post-tool-log.sh  # PostToolUse logging
│   │   ├── subagent-start.sh # SubagentStart context
│   │   ├── subagent-stop.sh  # SubagentStop prompts
│   │   └── stop.sh           # Stop promotion
│   ├── lib/
│   │   ├── memory-schema.sh  # Local folder operations
│   │   └── config-schema.sh  # Config file operations
│   ├── agents/
│   │   └── quoth-memory.md   # Memory subagent definition
│   └── skills/
│       ├── quoth-init/       # Init skill
│       └── genesis/          # Genesis skill
├── .mcp.json                 # MCP server config
└── README.md
```

## Knowledge Flow

```
Session Start
    ↓
Context injected from .quoth/*.md
    ↓
Work happens (edit, write, bash)
    ↓
Actions logged to .quoth/sessions/{id}/log.md
    ↓
Session End
    ↓
quoth-memory reviews logs
    ↓
User prompted to promote learnings:
├─ "Update local" → Merge into .quoth/*.md
├─ "Upload to Quoth" → quoth_propose_update()
├─ "Both" → Local + Remote
└─ "Skip" → Keep in session folder
```

## Links

- [Quoth Website](https://quoth.ai-innovation.site)
- [Documentation](https://quoth.ai-innovation.site/docs)
- [Changelog](https://quoth.ai-innovation.site/changelog)
- [GitHub](https://github.com/Montinou/quoth-mcp)
