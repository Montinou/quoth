---
name: quoth-help
description: Show Quoth plugin documentation - skills, tools, prompts, agents, setup, and troubleshooting. Pass a topic argument for specific help.
user_invocable: true
arguments: "[topic]"
---

# Quoth Help

Display documentation for the Quoth AI Memory plugin based on the requested topic.

## Behavior

Parse the argument (if any) and display the matching section below. If no argument is given, show the **Overview** section.

Valid topics: `skills`, `prompts`, `tools`, `agents`, `setup`, `troubleshooting`

---

## Overview (default)

Display this when no topic is provided:

```
Quoth v2.0 — AI Memory for Claude Code

Quoth gives Claude persistent memory across sessions through local-first
storage (.quoth/) and remote knowledge bases (Supabase + RAG pipeline).

Available topics (/quoth-help <topic>):

  skills           /quoth-init, /quoth-genesis
  prompts          /prompt quoth_architect, quoth_auditor, quoth_documenter
  tools            8 MCP tools (search, read, propose, guidelines, templates, chunks, genesis)
  agents           quoth-memory subagent
  setup            Plugin install, MCP-only, public demo, CLI commands
  troubleshooting  Common issues and fixes

Quick start:
  /quoth-init        Initialize AI Memory for your project
  /quoth-genesis     Bootstrap documentation from codebase
  /quoth-help setup  See all installation methods
```

---

## skills

```
Quoth Skills
============

/quoth-init
  Initialize Quoth Memory v2 for a project.
  Creates .quoth/ folder with config.json, strictness settings, gates,
  and type files (decisions, patterns, errors, knowledge, selectors, api).

  Usage: /quoth-init

/quoth-genesis
  Bootstrap project documentation from codebase with configurable depth.
  Reads local files, generates docs, uploads to Quoth incrementally.

  Depth levels:
    minimal       3 docs   — project-overview, tech-stack, repo-structure
    standard      5 docs   — + coding-conventions, testing-patterns
    comprehensive 11 docs  — + api-schemas, database-models, shared-types,
                              error-handling, security-patterns, tech-debt

  Usage: /quoth-genesis

/quoth-help
  This command. Shows plugin documentation.

  Usage: /quoth-help [topic]
```

---

## prompts

```
Quoth Prompts (Personas)
========================

Prompts configure Claude's behavior for the conversation. They are NOT tools.
Activate with /prompt <name> in Claude Code.

/prompt quoth_architect
  Code Generation persona. Enforces "Single Source of Truth" rules.
  - Searches knowledge base before generating code
  - Cites specific documents in suggestions
  - Refuses to generate code that violates patterns
  - Proposes documentation updates for new patterns

/prompt quoth_auditor
  Code Review persona. Distinguishes "New Features" from "Bad Code".
  - Flags violations with specific document citations
  - Suggests compliant alternatives
  - Tracks drift patterns over time

/prompt quoth_documenter
  Incremental Documentation persona. Documents code as you build.
  - Asks about documentation type before writing
  - Fetches templates from Quoth
  - Structures docs with H2 sections and YAML frontmatter

Note: Only one prompt can be active at a time. Each /prompt command
replaces the previous persona. The persona stays active for the entire
conversation until a new one is activated or a new session starts.
```

---

## tools

```
Quoth MCP Tools
===============

These are called automatically by Claude when connected to the Quoth MCP server.

quoth_search_index
  Semantic vector search across documentation.
  Params: query (string), limit (number, default 5)
  Returns: Array of document IDs with relevance scores

quoth_read_doc
  Retrieves full document content from knowledge base.
  Params: doc_id (string)
  Returns: Full document content with metadata

quoth_propose_update
  Submits documentation update proposal when drift is detected.
  Params: doc_id (string), proposed_change (string), evidence (string)
  Returns: Proposal ID for tracking
  Access: editor/admin only (viewers cannot propose)

quoth_guidelines
  Adaptive guidelines tool — returns context-relevant guidelines
  based on the current task. Replaces heavy persona injection.
  Params: context (string)
  Returns: Relevant guidelines for the task

quoth_list_templates
  Lists available document templates for genesis and manual creation.
  Returns: Array of template names with descriptions

quoth_get_template
  Fetches a specific template structure for document creation.
  Params: template_name (string)
  Returns: Template content with YAML frontmatter schema

quoth_read_chunks
  Fetches specific chunks by ID for granular retrieval.
  Params: chunk_ids (string[])
  Returns: Array of chunk contents

quoth_genesis
  Genesis v2.0 — phased documentation bootstrapping with depth levels.
  Params: depth (minimal | standard | comprehensive)
  Returns: Status and list of generated documents
```

---

## agents

```
Quoth Agents
============

quoth-memory
  Sonnet-powered memory interface for context queries.
  Produces ~500 token summaries from Quoth knowledge base.
  Automatically invoked by hooks to inject relevant context
  before subagent execution.

  The quoth-memory agent:
  - Receives the current task context
  - Searches Quoth for relevant documentation
  - Returns a concise summary for the requesting agent
  - Excludes itself from recursive context injection
```

---

## setup

```
Quoth Setup
===========

OPTION 1: Plugin Install (Recommended)
  Bundles MCP server + hooks + skills + agents.

  # Add marketplace (one time)
  /plugin marketplace add Montinou/quoth-mcp

  # Install plugin
  /plugin install quoth@quoth-marketplace

  Alternative via Triqual marketplace:
  /plugin marketplace add Montinou/triqual
  /plugin install quoth@triqual

OPTION 2: MCP Only (No Hooks)
  Just the MCP server, no automatic enforcement.

  claude mcp add --transport http quoth https://quoth.ai-innovation.site/api/mcp

  Then run /mcp → select quoth → Authenticate

OPTION 3: Public Demo (No Auth)
  Read-only access for testing.

  claude mcp add --transport http quoth-public https://quoth.ai-innovation.site/api/mcp/public

CLI COMMANDS:
  quoth login     Authenticate and configure Claude Code
  quoth logout    Remove authentication (keeps public access)
  quoth status    Show current configuration
  quoth help      Show help message

AFTER INSTALL:
  1. /quoth-init        Configure local AI Memory
  2. /quoth-genesis     Bootstrap documentation from codebase
  3. Start coding — hooks enforce documentation automatically
```

---

## troubleshooting

```
Quoth Troubleshooting
=====================

PROBLEM: "Prompts aren't working"
  Prompts are NOT tools. Activate with: /prompt quoth_architect
  Wrong: "Use quoth_architect to generate code"
  Right: /prompt quoth_architect → then ask your question

PROBLEM: "I don't see prompts available"
  1. Verify MCP connected: claude mcp list (should show quoth)
  2. Test a tool first: "search for test patterns in Quoth"
  3. Reconnect: claude mcp remove quoth → then re-add

PROBLEM: "MCP tools not responding"
  Check server status: curl https://quoth.ai-innovation.site/api/mcp
  If down, use public endpoint as fallback:
  claude mcp add --transport http quoth-public https://quoth.ai-innovation.site/api/mcp/public

PROBLEM: "Plugin not loading after install"
  1. Restart Claude Code
  2. Check /plugin list for errors
  3. Verify .claude-plugin/plugin.json exists in project root

PROBLEM: "Hooks blocking my edits"
  Your strictness is set to "blocking". Options:
  - Document your reasoning first (recommended)
  - Change strictness in .quoth/config.json to "reminder" or "off"
  - Re-run /quoth-init to reconfigure

PROBLEM: "Genesis not finding all files"
  Genesis reads files using Claude's native file access.
  Ensure you're running from the project root directory.
  Try: /quoth-genesis (re-running skips unchanged content)

Dashboard: https://quoth.ai-innovation.site/dashboard
API Keys:  https://quoth.ai-innovation.site/dashboard/api-keys
```
