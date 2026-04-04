# Quoth v2.0 - AI Memory

> Transform your AI from "search and read" to "automatic memory" - Local-first knowledge capture with bidirectional learning

Quoth is an **AI Memory** system that gives Claude persistent memory across sessions. Unlike traditional documentation tools, Quoth creates a learning loop: it both retrieves AND stores knowledge, mediated by an intelligent `quoth-memory` subagent.

```
RAG (Basic)           → Query → Vectors → Context → LLM
Agentic RAG (v1)      → Query → LLM → Tools → Context → LLM
AI Memory (v2)        → Query → LLM → Memory ⟷ Tools → Context → LLM
                                        ↑___↓
                                    Bidirectional
```

## Key Features

### 🧠 AI Memory Architecture

| Feature | Description |
|---------|-------------|
| **Local-first storage** | `.quoth/` folder persists knowledge across sessions |
| **Session logging** | Every action logged to `.quoth/sessions/{id}/` |
| **Knowledge promotion** | User-approved transfer from session → local → remote |
| **Configurable strictness** | `blocking`, `reminder`, or `off` modes |

### 🤖 quoth-memory Subagent

A Sonnet-powered memory interface that:
- Summarizes relevant context at session start (~500 tokens)
- Answers questions without bloating main context
- Prepares knowledge promotion proposals
- Exempt from all hooks (prevents loops)

### 🔧 MCP Tools

| Tool | Description |
|------|-------------|
| `quoth_search_index` | Semantic search with Vercel AI Gateway embeddings (text-embedding-3-large, 2000d) |
| `quoth_read_doc` | Retrieve full document content by ID |
| `quoth_read_chunks` | Retrieve document chunks for granular access |
| `quoth_memory_store` | Store a memory entry for the current agent/session |
| `quoth_memory_search` | Semantic search over stored memories |
| `quoth_memory_list` | List stored memory entries |
| `quoth_memory_forget` | Delete a memory entry |
| `quoth_agent_register` | Register an agent in the project |
| `quoth_agent_list` | List registered agents |
| `quoth_agent_assign` | Assign an agent to a task |
| `quoth_agent_send_message` | Send a message to another agent |
| `quoth_agent_inbox` | Read an agent's inbox |
| `quoth_agent_tasks` | List tasks assigned to an agent |
| `quoth_agent_task_reassign` | Reassign a task to a different agent |
| `quoth_project_create` | Create a new Quoth project |
| `quoth_project_invite` | Invite a collaborator to a project |
| `quoth_token_generate` | Generate an MCP access token |
| `quoth_genesis` | Bootstrap project documentation (minimal/standard/comprehensive) |

### 🪝 Hook-Enforced Documentation

| Hook | Purpose |
|------|---------|
| `SessionStart` | Initialize `.quoth/sessions/`, inject context |
| `PreToolUse` | Gate Edit/Write until reasoning documented (if blocking) |
| `PostToolUse` | Log actions to session folder |
| `SubagentStart/Stop` | Context injection and documentation prompts |
| `Stop` | Propose knowledge promotion to user |

## Installation

### Recommended: Plugin Install (Full AI Memory)

```bash
# Add marketplace (one time)
/plugin marketplace add Montinou/quoth-mcp

# Install plugin (MCP + hooks + skills + agents)
/plugin install quoth@quoth-marketplace
```

This bundles:
- **MCP Server** - All tools for search, read, propose
- **Hooks** - Automatic knowledge capture and enforcement
- **Skills** - `/quoth-init` and `/quoth-genesis`
- **Agents** - `quoth-memory` subagent for context queries

### Alternative: MCP Server Only

For just the MCP tools without local memory:

```bash
claude mcp add --transport http quoth https://quoth.triqual.dev/api/mcp
```

## Quick Start

### 1. Initialize AI Memory

```bash
# Run in your project
/quoth-init
```

This creates your `.quoth/` folder:

```
.quoth/
├── config.json         # Strictness, types, gates
├── decisions.md        # Architecture choices
├── patterns.md         # Code patterns
├── errors.md           # Failures and fixes
├── knowledge.md        # General context
└── sessions/           # Session logs (gitignored)
```

### 2. Configure Strictness

Choose how strictly Quoth enforces documentation:

| Mode | Behavior |
|------|----------|
| **blocking** | Claude cannot edit code until reasoning is documented |
| **reminder** | Gentle prompts to document, not blocking |
| **off** | Manual capture only, no enforcement |

### 3. Work Normally

With Quoth active:

1. **Session starts** → Context injected from `.quoth/*.md`
2. **Before edits** → Gate checks reasoning documented (if blocking)
3. **After actions** → Logged to `.quoth/sessions/{id}/log.md`
4. **Session ends** → Prompted to promote learnings

### 4. Auto-Memory

After init, session learnings are captured and consolidated automatically — no user action needed. On session end, Quoth silently extracts key insights and merges them into your `.quoth/*.md` files. Knowledge promotion to the remote index happens seamlessly in the background.

```
Session complete. Learnings auto-extracted and consolidated:

**Decisions:**
- Chose retry-with-backoff over circuit-breaker for token refresh

**Patterns:**
- Token refresh uses mutex to prevent race conditions

**Errors:**
- Auth header missing on redirect (fixed by preserving headers)
```

## Local Folder Structure

```
.quoth/
├── config.json              # Project configuration
│
├── decisions.md             # PERSISTENT: Architecture choices
├── patterns.md              # PERSISTENT: Code patterns
├── errors.md                # PERSISTENT: Failures and fixes
├── knowledge.md             # PERSISTENT: General context
├── [custom].md              # PERSISTENT: Project-specific types
│
└── sessions/
    └── {session-id}/        # EPHEMERAL: Current session only
        ├── context.md       # Injected context at start
        ├── log.md           # Actions taken this session
        └── pending.md       # Learnings awaiting promotion
```

### Persistence Rules

| Type | Survives Session | Survives Compaction | Synced to Quoth |
|------|------------------|---------------------|-----------------|
| Config | ✓ | ✓ | ✗ (local only) |
| Type files | ✓ | ✓ | On promotion |
| Session logs | Current only | ✓ | On promotion |

## Using quoth-memory

Query the memory subagent directly:

```
"Ask quoth-memory: What's our error handling pattern?"
```

The subagent:
1. Searches Quoth and local `.quoth/*.md` files
2. Returns a concise answer (not raw documents)
3. Keeps main context clean

## Genesis v3.0

Bootstrap documentation with configurable depth:

```bash
# In Claude Code
"Run Genesis on this project"
```

| Depth | Documents | Time | Use Case |
|-------|-----------|------|----------|
| `minimal` | 3 | ~3 min | Quick overview |
| `standard` | 5 | ~7 min | Team onboarding |
| `comprehensive` | 11 | ~20 min | Enterprise audit |

Genesis v3.0 adds **Phase 0: Configuration** - asks about strictness and types before generating docs.

## Team Collaboration

- **Multi-user projects** - Share knowledge bases with team members
- **Role-based access** - Admin, Editor, and Viewer roles
- **Email invitations** - Invite collaborators via secure tokens
- **Approval workflows** - Proposals require admin review (optional)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLERK_SECRET_KEY` | Clerk authentication secret key |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (client-side) |
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway — text-embedding-3-large (2000d vectors) |
| `JWT_SECRET` | MCP token generation |
| `RESEND_API_KEY` | Email delivery (optional) |

## Links

- **Website**: https://quoth.triqual.dev
- **Documentation**: https://quoth.triqual.dev/docs
- **Changelog**: https://quoth.triqual.dev/changelog
- **GitHub**: https://github.com/Montinou/quoth-mcp

## License

MIT
