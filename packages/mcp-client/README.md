# @quoth/mcp

Quoth MCP client — connects Claude Code to the Quoth cloud platform for semantic search, memory, agent coordination, and documentation management.

## Quick Start

```bash
# Connect to Quoth cloud MCP server
claude mcp add --transport http quoth https://quoth.triqual.dev/api/mcp
```

## Features

**Search & Documents:**
- `quoth_search_index` — Semantic search with text-embedding-3-large (2000d) + Cohere reranking
- `quoth_read_doc` — Read full document content
- `quoth_read_chunks` — Read document chunks

**Memory:**
- `quoth_memory_store` — Store memory entry
- `quoth_memory_search` — Semantic search over memories
- `quoth_memory_list` — List memories
- `quoth_memory_forget` — Delete memory

**Agents:**
- `quoth_agent_register` — Register an agent
- `quoth_agent_list` — List agents
- `quoth_agent_assign` — Assign agent to task
- `quoth_agent_send_message` — Inter-agent messaging
- `quoth_agent_inbox` — Read inbox
- `quoth_agent_tasks` — List assigned tasks
- `quoth_agent_task_reassign` — Reassign task

**Projects:**
- `quoth_project_create` — Create project
- `quoth_project_invite` — Invite collaborator
- `quoth_token_generate` — Generate MCP token
- `quoth_genesis` — Bootstrap documentation from codebase

## Authentication

Public access provides read-only search. For full access (proposals, memory, agents), authenticate via the dashboard at [quoth.triqual.dev](https://quoth.triqual.dev).

## Documentation

- [quoth.triqual.dev](https://quoth.triqual.dev)
- [Changelog](https://quoth.triqual.dev/changelog)

## License

MIT
