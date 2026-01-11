# @quoth/mcp

The Living Source of Truth - AI-driven documentation auditor that enforces consistency between code and docs.

## Quick Start

```bash
# Install and add to Claude Code (public demo)
npm install -g @quoth/mcp
claude mcp add quoth

# Authenticate for private projects
quoth login
```

## Features

**Tools:**
- `quoth_search_index` - Semantic search across documentation using AI embeddings
- `quoth_read_doc` - Read full document content from the knowledge base
- `quoth_propose_update` - Propose documentation updates (requires authentication)

**Prompts:**
- `quoth_architect` - Persona for writing code with Single Source of Truth enforcement
- `quoth_auditor` - Persona for code review and documentation updates

## CLI Commands

```bash
quoth login    # Authenticate with your Quoth account
quoth logout   # Remove authentication (keeps public access)
quoth status   # Show current configuration
quoth help     # Show help message
```

## Authentication

The public demo allows read-only access to the `quoth-knowledge-base` project.

For full access including:
- Private knowledge bases
- Documentation update proposals
- Team collaboration

Run `quoth login` to authenticate.

## Documentation

Visit [quoth.ai-innovation.site](https://quoth.ai-innovation.site) for full documentation.

## License

MIT
