---
name: quoth-help
description: Show Quoth plugin documentation - tools, hooks, daemon, skills, and troubleshooting. Pass a topic argument for specific help.
user_invocable: true
arguments: "[topic]"
---

# Quoth Help

Display documentation for the Quoth self-learning plugin based on the requested topic.

## Behavior

Parse the argument (if any) and display the matching section below. If no argument is given, show the **Overview** section.

Valid topics: `tools`, `hooks`, `daemon`, `skills`, `cloud`, `troubleshooting`

---

## Overview (default)

Display this when no topic is provided:

```
Quoth v3.3.0 — Self-Learning Plugin for Claude Code

Quoth gives Claude autonomous learning through trajectory capture,
pattern extraction, and intelligence routing. Local SQLite + HNSW storage.

Available topics (/quoth-help <topic>):

  tools            22 MCP tools (patterns, agents, intelligence, skills)
  hooks            9 hook events (routing, capture, injection, safety)
  daemon           Background trajectory processor (triage → extract → embed → persist)
  skills           /quoth:patterns, /quoth:learn
  cloud            Cloud MCP server (search, memory, agents, genesis)
  troubleshooting  Common issues and fixes

Quick start:
  /quoth:patterns    View learned pattern library
  /quoth:learn       Trigger manual consolidation
  /quoth-help tools  See all 22 MCP tools
```

---

## tools

```
Quoth MCP Tools (22 via quoth-learning stdio server)
=====================================================

PATTERNS (8):
  quoth_log_outcome        Record success/failure for a pattern
  quoth_score_pattern      Adjust pattern confidence manually
  quoth_top_patterns       View highest-confidence patterns
  quoth_search_patterns    Semantic search over pattern library
  quoth_project_patterns   Get patterns scoped to current project
  quoth_promote_global     Promote pattern to global scope
  quoth_seed_from_exolar   Import patterns from external source
  quoth_propose_update     Propose pattern text update

AGENTS (6):
  quoth_daemon_status      Check daemon health and stats
  quoth_ingest_trajectory  Manually ingest a trajectory file
  quoth_agent_register     Register an agent identity
  quoth_agent_heartbeat    Send agent heartbeat
  quoth_agent_list         List registered agents
  quoth_assign_task        Assign task to an agent

INTELLIGENCE (6):
  quoth_route_task         Route task to optimal agent type
  quoth_intelligence_init  Initialize intelligence graph
  quoth_intelligence_context  Get context for current task
  quoth_intelligence_consolidate  Consolidate graph, recompute PageRank
  quoth_intelligence_stats  View graph statistics
  quoth_intelligence_feedback  Provide feedback to intelligence

SKILLS (2):
  quoth_extract_skill      Extract a reusable skill from trajectory
  quoth_list_skills        List extracted skills
```

---

## hooks

```
Quoth Hooks (via hook-dispatch.js)
===================================

All hooks run through a unified dispatcher. Zero API calls in automatic hooks.

UserPromptSubmit     Route task to optimal agent, show relevant patterns
SessionStart         Init intelligence graph, inject top patterns (>= 0.6)
SessionEnd           Consolidate intelligence graph, recompute PageRank
PreCompact           Same as SessionEnd (pre-context-compression)
PostToolUse(W/E)     Record edits for intelligence tracking
PostToolUse(B/W/E/A) Capture tool calls to trajectory file
PreToolUse(Bash)     Block dangerous commands (rm -rf /, fork bombs)
SubagentStart        Inject domain-relevant patterns via additionalContext
SubagentStop         Implicit positive feedback to intelligence
```

---

## daemon

```
Quoth Daemon
============

Background process that converts raw trajectories into learned patterns.

Pipeline: triage → extract → embed → persist

  triage    Gemini Flash Lite classifies sessions worth mining
  extract   Kimi K2.5 emits the four knowledge entity kinds
  embed     Local MiniLM-L6 encodes each entity (384d)
  persist   Single-tx upsert into knowledge_entities + HNSW

Storage: ~/.quoth/memory.db (SQLite + HNSW vector index)
PID:     ~/.quoth/daemon.pid
Log:     ~/.quoth/daemon.log
Debug:   QUOTH_DEBUG=true

Auto-starts on SessionStart hook.
Nightly promotion: patterns with confidence > 0.8 and > 10 uses
  promote to Quoth cloud at 3am (requires QUOTH_API_KEY).

Confidence scoring: Beta(alpha, beta) Bayesian distribution
Source tags: distilled, exolar-seeded, healer-learned, attributed, skill-derived
```

---

## skills

```
Quoth Skills
============

/quoth:patterns
  Browse the confidence-scored pattern library.
  Shows top patterns sorted by confidence with scores, tags, and use counts.
  Optional: pass tags to filter (e.g., /quoth:patterns react testing)

/quoth:learn
  Trigger manual pattern consolidation from recent trajectories.
  Sends SIGUSR1 to the daemon for immediate processing.
  Shows updated pattern library after processing.
```

---

## cloud

```
Quoth Cloud MCP Server
=======================

Separate from the plugin. Connect via HTTP for cloud features:

  claude mcp add --transport http quoth https://quoth.triqual.dev/api/mcp

Cloud tools include:
  quoth_search_index       Semantic search (text-embedding-3-large, 2000d)
  quoth_read_doc           Read full document
  quoth_read_chunks        Read document chunks
  quoth_memory_store       Store memory entry
  quoth_memory_search      Search memories
  quoth_memory_list        List memories
  quoth_memory_forget      Delete memory
  quoth_agent_register     Register agent
  quoth_agent_list         List agents
  quoth_agent_assign       Assign agent to task
  quoth_agent_send_message Inter-agent messaging
  quoth_agent_inbox        Read inbox
  quoth_agent_tasks        List assigned tasks
  quoth_agent_task_reassign Reassign task
  quoth_project_create     Create project
  quoth_project_invite     Invite collaborator
  quoth_token_generate     Generate MCP token
  quoth_genesis            Bootstrap documentation
```

---

## troubleshooting

```
Quoth Troubleshooting
=====================

PROBLEM: "Daemon not running"
  Check: cat ~/.quoth/daemon.pid && kill -0 $(cat ~/.quoth/daemon.pid)
  Fix: Restart Claude Code session (daemon auto-starts on SessionStart)

PROBLEM: "No patterns showing"
  The daemon needs trajectories to learn from. Work normally for a few
  sessions, then check: quoth_top_patterns({ limit: 10 })

PROBLEM: "Hooks not firing"
  1. Verify hooks in ~/.claude/settings.json
  2. Re-run: bash quoth-plugin/scripts/setup.sh
  3. Check hook logs for errors

PROBLEM: "Intelligence routing wrong agent"
  Use quoth_intelligence_feedback to correct routing decisions.
  The graph learns from feedback over time.

PROBLEM: "Cloud sync failing"
  Check QUOTH_API_KEY is set (qth_* format).
  Verify: curl https://quoth.triqual.dev/api/health

Plugin config:  ~/.quoth/hooks/ (symlinks)
Plugin MCP:     ~/.mcp.json (quoth-learning server)
Hook config:    ~/.claude/settings.json
```
