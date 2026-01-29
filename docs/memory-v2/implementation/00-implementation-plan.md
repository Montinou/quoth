# Quoth v2.0 AI Memory - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Quoth from Agentic RAG into AI Memory with local-first storage, quoth-memory subagent, and hook-enforced knowledge capture.

**Architecture:** Plugin-based with 6 hooks enforcing documentation during work, a Sonnet-powered quoth-memory subagent for context summarization/queries, and `.quoth/` local storage with user-controlled promotion to remote Quoth.

**Tech Stack:** Bash hooks, Claude Code plugin system, TypeScript (Vitest), Supabase, existing MCP tools

---

## Implementation Phases

| Phase | Tasks | Description |
|-------|-------|-------------|
| **Phase 1** | Tasks 1-3 | Local folder structure + config schema |
| **Phase 2** | Tasks 4-9 | Hook implementations (6 hooks) |
| **Phase 3** | Tasks 10-12 | quoth-memory subagent |
| **Phase 4** | Tasks 13-14 | Genesis v3.0 Phase 0 configuration |
| **Phase 5** | Tasks 15-16 | Integration tests + PR |

---

## Task 1: Create Local Folder Structure Schema

**Files:**
- Create: `quoth-plugin/.claude-plugin/lib/memory-schema.sh`
- Modify: `quoth-plugin/.claude-plugin/hooks/lib/common.sh`
- Test: Manual verification

**Step 1: Create memory schema library**

Create file `quoth-plugin/.claude-plugin/lib/memory-schema.sh`:

```bash
#!/usr/bin/env bash
# Quoth Memory v2.0 - Local Folder Schema
# Source this file for memory operations

# ============================================================================
# CONSTANTS
# ============================================================================

QUOTH_LOCAL_DIR=".quoth"
QUOTH_SESSIONS_DIR=".quoth/sessions"

# ============================================================================
# LOCAL FOLDER STRUCTURE
# ============================================================================

# Initialize .quoth/ folder structure for a project
# Usage: init_quoth_local_folder
init_quoth_local_folder() {
    mkdir -p "$QUOTH_LOCAL_DIR"
    mkdir -p "$QUOTH_SESSIONS_DIR"

    # Create default type files if they don't exist
    local default_types=("decisions" "patterns" "errors" "knowledge")
    for type in "${default_types[@]}"; do
        local file="$QUOTH_LOCAL_DIR/${type}.md"
        if [ ! -f "$file" ]; then
            cat > "$file" << EOF
# ${type^}

<!--
  This file accumulates ${type} across sessions.
  Updated via quoth-memory subagent with user approval.
-->

---

EOF
        fi
    done
}

# Initialize session folder
# Usage: init_session_folder "$SESSION_ID"
init_session_folder() {
    local session_id="$1"
    local session_dir="$QUOTH_SESSIONS_DIR/$session_id"
    mkdir -p "$session_dir"

    # Create session files
    touch "$session_dir/context.md"
    touch "$session_dir/log.md"
    touch "$session_dir/pending.md"

    # Initialize log.md with header
    cat > "$session_dir/log.md" << EOF
# Session Log: $session_id

Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)

---

EOF

    echo "$session_dir"
}

# Get current session folder path
# Usage: get_session_folder "$SESSION_ID"
get_session_folder() {
    local session_id="$1"
    echo "$QUOTH_SESSIONS_DIR/$session_id"
}

# Check if .quoth/ folder exists
quoth_local_exists() {
    [ -d "$QUOTH_LOCAL_DIR" ]
}

# Check if session folder exists
session_folder_exists() {
    local session_id="$1"
    [ -d "$QUOTH_SESSIONS_DIR/$session_id" ]
}

# ============================================================================
# SESSION LOG OPERATIONS
# ============================================================================

# Append entry to session log
# Usage: append_session_log "$SESSION_ID" "$ENTRY"
append_session_log() {
    local session_id="$1"
    local entry="$2"
    local log_file="$QUOTH_SESSIONS_DIR/$session_id/log.md"

    if [ -f "$log_file" ]; then
        echo "" >> "$log_file"
        echo "### $(date -u +%H:%M:%S) - $entry" >> "$log_file"
    fi
}

# Append tool action to session log
# Usage: append_tool_log "$SESSION_ID" "$TOOL" "$FILE" "$RESULT"
append_tool_log() {
    local session_id="$1"
    local tool="$2"
    local file="$3"
    local result="$4"
    local log_file="$QUOTH_SESSIONS_DIR/$session_id/log.md"

    if [ -f "$log_file" ]; then
        cat >> "$log_file" << EOF

### $(date -u +%H:%M:%S) - $tool: $file

- **Result:** $result

EOF
    fi
}

# ============================================================================
# PENDING LEARNINGS
# ============================================================================

# Add pending learning to session
# Usage: add_pending_learning "$SESSION_ID" "$TYPE" "$CONTENT"
add_pending_learning() {
    local session_id="$1"
    local type="$2"
    local content="$3"
    local pending_file="$QUOTH_SESSIONS_DIR/$session_id/pending.md"

    if [ -f "$pending_file" ]; then
        cat >> "$pending_file" << EOF

## $type

$content

---

EOF
    fi
}

# ============================================================================
# TYPE FILE OPERATIONS
# ============================================================================

# Append learning to a type file (decisions, patterns, errors, knowledge)
# Usage: append_to_type_file "$TYPE" "$CONTENT" "$SOURCE_SESSION"
append_to_type_file() {
    local type="$1"
    local content="$2"
    local source_session="$3"
    local type_file="$QUOTH_LOCAL_DIR/${type}.md"

    if [ -f "$type_file" ]; then
        cat >> "$type_file" << EOF

## Entry $(date +%Y-%m-%d)

$content

_Source: Session $source_session_

---

EOF
    fi
}

# List configured types from config.json
# Usage: get_configured_types
get_configured_types() {
    local config_file="$QUOTH_LOCAL_DIR/config.json"
    if [ -f "$config_file" ]; then
        grep -o '"types"[[:space:]]*:[[:space:]]*\[[^]]*\]' "$config_file" | \
            grep -o '"[^"]*"' | tr -d '"' | grep -v 'types'
    else
        echo "decisions patterns errors knowledge"
    fi
}

# ============================================================================
# CLEANUP
# ============================================================================

# Clean up old session folders (older than N days)
# Usage: cleanup_old_sessions 7
cleanup_old_sessions() {
    local days="${1:-7}"
    if [ -d "$QUOTH_SESSIONS_DIR" ]; then
        find "$QUOTH_SESSIONS_DIR" -maxdepth 1 -type d -mtime "+$days" -exec rm -rf {} \; 2>/dev/null || true
    fi
}
```

**Step 2: Run verification**

Run: `bash -n quoth-plugin/.claude-plugin/lib/memory-schema.sh`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add quoth-plugin/.claude-plugin/lib/memory-schema.sh
git commit -m "feat(memory-v2): add local folder structure schema library"
```

---

## Task 2: Create Config Schema

**Files:**
- Create: `quoth-plugin/.claude-plugin/lib/config-schema.sh`
- Test: Manual verification

**Step 1: Create config schema library**

Create file `quoth-plugin/.claude-plugin/lib/config-schema.sh`:

```bash
#!/usr/bin/env bash
# Quoth Memory v2.0 - Config Schema
# Manages .quoth/config.json

# ============================================================================
# CONFIG FILE OPERATIONS
# ============================================================================

QUOTH_CONFIG_FILE=".quoth/config.json"

# Create default config
# Usage: create_default_config "$PROJECT_ID" "$PROJECT_SLUG"
create_default_config() {
    local project_id="${1:-}"
    local project_slug="${2:-local}"
    local strictness="${3:-reminder}"

    mkdir -p ".quoth"

    cat > "$QUOTH_CONFIG_FILE" << EOF
{
  "version": "2.0",
  "project_id": "$project_id",
  "project_slug": "$project_slug",
  "strictness": "$strictness",
  "types": [
    "decisions",
    "patterns",
    "errors",
    "knowledge"
  ],
  "gates": {
    "require_reasoning_before_edit": true,
    "require_quoth_search": true,
    "require_error_documentation": false
  },
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
}

# Read config value
# Usage: read_config_value "strictness"
read_config_value() {
    local key="$1"
    if [ -f "$QUOTH_CONFIG_FILE" ]; then
        grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$QUOTH_CONFIG_FILE" 2>/dev/null | \
            head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo ""
    fi
}

# Read config boolean
# Usage: read_config_bool "gates.require_reasoning_before_edit"
read_config_bool() {
    local key="$1"
    if [ -f "$QUOTH_CONFIG_FILE" ]; then
        if grep -q "\"$key\"[[:space:]]*:[[:space:]]*true" "$QUOTH_CONFIG_FILE" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Get strictness level
# Returns: blocking, reminder, or off
get_strictness() {
    local strictness=$(read_config_value "strictness")
    echo "${strictness:-reminder}"
}

# Check if config exists
config_exists() {
    [ -f "$QUOTH_CONFIG_FILE" ]
}

# Update config value
# Usage: update_config_value "strictness" "blocking"
update_config_value() {
    local key="$1"
    local value="$2"
    if [ -f "$QUOTH_CONFIG_FILE" ]; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"$key\": \"$value\"/" "$QUOTH_CONFIG_FILE"
        else
            sed -i "s/\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"$key\": \"$value\"/" "$QUOTH_CONFIG_FILE"
        fi
    fi
}

# ============================================================================
# GATE CHECKS
# ============================================================================

# Check if a gate is enabled
# Usage: gate_enabled "require_reasoning_before_edit"
gate_enabled() {
    local gate="$1"
    if [ -f "$QUOTH_CONFIG_FILE" ]; then
        if grep -q "\"$gate\"[[:space:]]*:[[:space:]]*true" "$QUOTH_CONFIG_FILE" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Check if strictness is blocking
is_blocking_mode() {
    [ "$(get_strictness)" = "blocking" ]
}

# Check if strictness is reminder
is_reminder_mode() {
    [ "$(get_strictness)" = "reminder" ]
}

# Check if strictness is off
is_off_mode() {
    [ "$(get_strictness)" = "off" ]
}
```

**Step 2: Run verification**

Run: `bash -n quoth-plugin/.claude-plugin/lib/config-schema.sh`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add quoth-plugin/.claude-plugin/lib/config-schema.sh
git commit -m "feat(memory-v2): add config schema library with strictness/gates"
```

---

## Task 3: Update common.sh to Source New Libraries

**Files:**
- Modify: `quoth-plugin/.claude-plugin/hooks/lib/common.sh`

**Step 1: Add source statements to common.sh**

Add at line 7 (after `set -e`):

```bash
# Source memory v2 libraries
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../lib/memory-schema.sh" ]; then
    source "$SCRIPT_DIR/../lib/memory-schema.sh"
fi
if [ -f "$SCRIPT_DIR/../lib/config-schema.sh" ]; then
    source "$SCRIPT_DIR/../lib/config-schema.sh"
fi
```

**Step 2: Create the lib directory structure**

Run: `mkdir -p quoth-plugin/.claude-plugin/lib && mv quoth-plugin/.claude-plugin/lib/memory-schema.sh quoth-plugin/.claude-plugin/lib/ 2>/dev/null || true`

**Step 3: Run verification**

Run: `bash -n quoth-plugin/.claude-plugin/hooks/lib/common.sh`
Expected: No syntax errors

**Step 4: Commit**

```bash
git add quoth-plugin/.claude-plugin/hooks/lib/common.sh
git commit -m "feat(memory-v2): integrate memory and config libraries into common.sh"
```

---

## Task 4: Implement session-start.sh v2

**Files:**
- Modify: `quoth-plugin/.claude-plugin/hooks/session-start.sh`

**Step 1: Read current session-start.sh**

First, read the existing file to understand current implementation.

**Step 2: Rewrite session-start.sh for v2**

Replace content with:

```bash
#!/usr/bin/env bash
# Quoth Memory v2.0 - Session Start Hook
# Initializes session, spawns quoth-memory for context injection

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# Read input from stdin
INPUT=$(cat)

# Get session ID
SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"

# ============================================================================
# MAIN LOGIC
# ============================================================================

main() {
    # 1. Initialize session state (existing behavior)
    local config_path=$(find_quoth_config)
    local project_id=""
    if [ -n "$config_path" ]; then
        project_id=$(get_config_value "project_id" "$config_path")
    fi
    init_session "$project_id"

    # 2. Initialize .quoth/ folder if config exists
    if config_exists; then
        # Ensure local folder structure exists
        init_quoth_local_folder

        # Initialize session folder
        init_session_folder "$SESSION_ID"

        # Clean up old sessions (7 days)
        cleanup_old_sessions 7

        # 3. Build context injection message
        # Note: In full implementation, this spawns quoth-memory subagent
        # For now, output a lightweight context reminder

        local strictness=$(get_strictness)
        local context_msg="**Quoth Memory v2 Active**
- Strictness: $strictness
- Session: $SESSION_ID
- Local storage: .quoth/

Use \`quoth-memory\` subagent for context queries.
Session logs: .quoth/sessions/$SESSION_ID/"

        output_context "$context_msg"
    else
        # No config - output standard hint
        output_context "Quoth plugin active. Run \`/quoth-genesis\` to initialize memory for this project."
    fi
}

main
```

**Step 3: Run verification**

Run: `bash -n quoth-plugin/.claude-plugin/hooks/session-start.sh`
Expected: No syntax errors

**Step 4: Commit**

```bash
git add quoth-plugin/.claude-plugin/hooks/session-start.sh
git commit -m "feat(memory-v2): rewrite session-start hook with local folder init"
```

---

## Task 5: Implement pre-tool-gate.sh (New Hook)

**Files:**
- Create: `quoth-plugin/.claude-plugin/hooks/pre-tool-gate.sh`
- Modify: `quoth-plugin/.claude-plugin/hooks/hooks.json`

**Step 1: Create pre-tool-gate.sh**

Create file `quoth-plugin/.claude-plugin/hooks/pre-tool-gate.sh`:

```bash
#!/usr/bin/env bash
# Quoth Memory v2.0 - Pre-Tool Gate Hook
# Enforces documentation gates before Edit/Write (if strictness=blocking)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# Read input from stdin
INPUT=$(cat)

SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"

# ============================================================================
# GATE CHECKS
# ============================================================================

# Check if quoth-memory subagent (exempt from gates)
is_quoth_memory_subagent() {
    # Check if we're in a subagent context and it's quoth-memory
    local subagent_name=$(echo "$INPUT" | grep -o '"subagent_name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/' || echo "")
    [ "$subagent_name" = "quoth-memory" ]
}

# Check if reasoning is documented in session log
reasoning_documented() {
    local session_dir=$(get_session_folder "$SESSION_ID")
    local log_file="$session_dir/log.md"

    if [ -f "$log_file" ]; then
        # Check if log has content beyond header (at least one ### entry)
        if grep -q "^### " "$log_file" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Check if Quoth search was performed in this session
quoth_search_performed() {
    local search_count=$(get_session_counter "search_index")
    [ "$search_count" -gt 0 ]
}

# ============================================================================
# MAIN LOGIC
# ============================================================================

main() {
    # Skip if no config (not initialized)
    if ! config_exists; then
        output_empty
        exit 0
    fi

    # Exempt quoth-memory subagent from all gates
    if is_quoth_memory_subagent; then
        output_empty
        exit 0
    fi

    # Get strictness
    local strictness=$(get_strictness)

    # If off, do nothing
    if [ "$strictness" = "off" ]; then
        output_empty
        exit 0
    fi

    # Extract file being edited
    local file_path=$(extract_file_path "$INPUT")

    # Skip non-code files
    if is_non_code_file "$file_path" || should_skip_file "$file_path"; then
        output_empty
        exit 0
    fi

    # =========================================================================
    # GATE CHECKS (only if blocking mode)
    # =========================================================================

    if [ "$strictness" = "blocking" ]; then
        local blocked=false
        local block_reason=""

        # Gate 1: Reasoning documented
        if gate_enabled "require_reasoning_before_edit" && ! reasoning_documented; then
            blocked=true
            block_reason="**Gate Failed: Reasoning not documented**

Before editing code, document your reasoning in the session log.
Use: \`append_session_log \"$SESSION_ID\" \"Reasoning: [your approach]\"\`

Or describe your approach and I'll log it for you."
        fi

        # Gate 2: Quoth search performed
        if gate_enabled "require_quoth_search" && ! quoth_search_performed; then
            blocked=true
            block_reason="**Gate Failed: Quoth search not performed**

Before editing code, search Quoth for relevant patterns:
\`quoth_search_index({ query: \"$(build_search_query $(detect_file_category "$file_path"))\" })\`

This ensures you're following documented conventions."
        fi

        # If blocked, output message and exit with code 2
        if [ "$blocked" = true ]; then
            output_context "$block_reason"
            exit 2
        fi
    fi

    # =========================================================================
    # REMINDER MODE
    # =========================================================================

    if [ "$strictness" = "reminder" ]; then
        local category=$(detect_file_category "$file_path")
        local hint_key="pre_edit_${category}"

        # Only remind once per category per session
        if ! hint_delivered_for "$hint_key"; then
            mark_hint_delivered "$hint_key"

            local reminder="**Reminder:** Consider searching Quoth for $category patterns before editing.
\`quoth_search_index({ query: \"$(build_search_query $category)\" })\`"

            output_context "$reminder"
            exit 0
        fi
    fi

    output_empty
}

main
```

**Step 2: Make executable**

Run: `chmod +x quoth-plugin/.claude-plugin/hooks/pre-tool-gate.sh`

**Step 3: Run verification**

Run: `bash -n quoth-plugin/.claude-plugin/hooks/pre-tool-gate.sh`
Expected: No syntax errors

**Step 4: Commit**

```bash
git add quoth-plugin/.claude-plugin/hooks/pre-tool-gate.sh
git commit -m "feat(memory-v2): add pre-tool-gate hook with blocking/reminder modes"
```

---

## Task 6: Implement post-tool-log.sh (New Hook)

**Files:**
- Create: `quoth-plugin/.claude-plugin/hooks/post-tool-log.sh`

**Step 1: Create post-tool-log.sh**

Create file `quoth-plugin/.claude-plugin/hooks/post-tool-log.sh`:

```bash
#!/usr/bin/env bash
# Quoth Memory v2.0 - Post-Tool Log Hook
# Logs tool actions to session folder

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# Read input from stdin
INPUT=$(cat)

SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"

# ============================================================================
# MAIN LOGIC
# ============================================================================

main() {
    # Skip if no config
    if ! config_exists; then
        output_empty
        exit 0
    fi

    # Skip if session folder doesn't exist
    if ! session_folder_exists "$SESSION_ID"; then
        output_empty
        exit 0
    fi

    # Extract tool info from input
    local tool_name=$(echo "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/' || echo "unknown")
    local file_path=$(extract_file_path "$INPUT")

    # Skip if no file path (not a file operation)
    if [ -z "$file_path" ]; then
        output_empty
        exit 0
    fi

    # Extract result status (simplified - check for error indicators)
    local result="Success"
    if echo "$INPUT" | grep -qi "error\|failed\|exception"; then
        result="Error"
    fi

    # Log the action
    append_tool_log "$SESSION_ID" "$tool_name" "$file_path" "$result"

    output_empty
}

main
```

**Step 2: Make executable**

Run: `chmod +x quoth-plugin/.claude-plugin/hooks/post-tool-log.sh`

**Step 3: Run verification**

Run: `bash -n quoth-plugin/.claude-plugin/hooks/post-tool-log.sh`
Expected: No syntax errors

**Step 4: Commit**

```bash
git add quoth-plugin/.claude-plugin/hooks/post-tool-log.sh
git commit -m "feat(memory-v2): add post-tool-log hook for session logging"
```

---

## Task 7: Update subagent-start.sh for Memory Context

**Files:**
- Modify: `quoth-plugin/.claude-plugin/hooks/subagent-start.sh`

**Step 1: Read current implementation**

Read existing file first.

**Step 2: Update with memory context injection**

Update to include memory context for non-quoth-memory subagents:

```bash
#!/usr/bin/env bash
# Quoth Memory v2.0 - Subagent Start Hook
# Injects context before subagents run (except quoth-memory)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# Read input from stdin
INPUT=$(cat)

SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"

# ============================================================================
# MAIN LOGIC
# ============================================================================

main() {
    # Extract subagent name
    local subagent_name=$(echo "$INPUT" | grep -o '"subagent_name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/' || echo "")

    # Exempt quoth-memory from context injection
    if [ "$subagent_name" = "quoth-memory" ]; then
        output_empty
        exit 0
    fi

    # Skip if no config
    if ! config_exists; then
        output_empty
        exit 0
    fi

    # Build context message for subagent
    local session_dir=$(get_session_folder "$SESSION_ID")
    local context_msg="**Quoth Memory Context**

Before starting, consult these local knowledge files:
- \`.quoth/patterns.md\` - Local patterns and conventions
- \`.quoth/errors.md\` - Known pitfalls to avoid
- \`.quoth/decisions.md\` - Architecture decisions"

    # Add session context if exists
    if [ -d "$session_dir" ]; then
        context_msg="$context_msg
- \`.quoth/sessions/$SESSION_ID/context.md\` - Session-specific context"
    fi

    output_context "$context_msg"
}

main
```

**Step 3: Run verification**

Run: `bash -n quoth-plugin/.claude-plugin/hooks/subagent-start.sh`
Expected: No syntax errors

**Step 4: Commit**

```bash
git add quoth-plugin/.claude-plugin/hooks/subagent-start.sh
git commit -m "feat(memory-v2): update subagent-start with memory context injection"
```

---

## Task 8: Update subagent-stop.sh for Documentation

**Files:**
- Modify: `quoth-plugin/.claude-plugin/hooks/subagent-stop.sh`

**Step 1: Update with documentation instructions**

```bash
#!/usr/bin/env bash
# Quoth Memory v2.0 - Subagent Stop Hook
# Instructs subagent to document findings (except quoth-memory)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# Read input from stdin
INPUT=$(cat)

SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"

# ============================================================================
# MAIN LOGIC
# ============================================================================

main() {
    # Extract subagent name
    local subagent_name=$(echo "$INPUT" | grep -o '"subagent_name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/' || echo "")

    # Exempt quoth-memory
    if [ "$subagent_name" = "quoth-memory" ]; then
        output_empty
        exit 0
    fi

    # Skip if no config
    if ! config_exists; then
        output_empty
        exit 0
    fi

    # Check if session folder exists
    if ! session_folder_exists "$SESSION_ID"; then
        output_empty
        exit 0
    fi

    # Only remind if quoth tools were used
    if quoth_tools_were_used; then
        local doc_msg="**Document your findings**

Before completing, update the session log with:
- What approach did you take?
- What patterns did you discover?
- What errors did you encounter?

Log location: \`.quoth/sessions/$SESSION_ID/log.md\`"

        output_context "$doc_msg"
    else
        output_empty
    fi
}

main
```

**Step 2: Run verification**

Run: `bash -n quoth-plugin/.claude-plugin/hooks/subagent-stop.sh`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add quoth-plugin/.claude-plugin/hooks/subagent-stop.sh
git commit -m "feat(memory-v2): update subagent-stop with documentation instructions"
```

---

## Task 9: Update stop.sh for Promotion Prompt

**Files:**
- Modify: `quoth-plugin/.claude-plugin/hooks/stop.sh`

**Step 1: Update with promotion prompt**

```bash
#!/usr/bin/env bash
# Quoth Memory v2.0 - Stop Hook
# Proposes knowledge promotion at session end

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# Read input from stdin
INPUT=$(cat)

SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"

# ============================================================================
# MAIN LOGIC
# ============================================================================

main() {
    # Skip if no config
    if ! config_exists; then
        cleanup_session
        output_empty
        exit 0
    fi

    # Check if session folder exists and has content
    local session_dir=$(get_session_folder "$SESSION_ID")
    local log_file="$session_dir/log.md"
    local pending_file="$session_dir/pending.md"

    local has_learnings=false

    # Check if log has entries (more than just header)
    if [ -f "$log_file" ]; then
        local line_count=$(wc -l < "$log_file" | tr -d ' ')
        if [ "$line_count" -gt 10 ]; then
            has_learnings=true
        fi
    fi

    # Check if pending has content
    if [ -f "$pending_file" ] && [ -s "$pending_file" ]; then
        has_learnings=true
    fi

    if [ "$has_learnings" = true ]; then
        local promotion_msg="**Session Complete - Review Learnings?**

Session log: \`.quoth/sessions/$SESSION_ID/log.md\`

Would you like me to:
1. **Update local files** - Merge learnings into .quoth/*.md
2. **Upload to Quoth** - Share with team via quoth_propose_update
3. **Both** - Local + Remote
4. **Skip** - Keep in session folder for later

Reply with your choice or 'skip' to dismiss."

        output_context "$promotion_msg"
    else
        output_empty
    fi

    # Clean up session state (temp files, not .quoth/)
    cleanup_session
}

main
```

**Step 2: Run verification**

Run: `bash -n quoth-plugin/.claude-plugin/hooks/stop.sh`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add quoth-plugin/.claude-plugin/hooks/stop.sh
git commit -m "feat(memory-v2): update stop hook with knowledge promotion prompt"
```

---

## Task 10: Update hooks.json with New Hooks

**Files:**
- Modify: `quoth-plugin/.claude-plugin/hooks/hooks.json`

**Step 1: Update hooks.json**

Replace with updated configuration:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/user-prompt.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-gate.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-log.sh"
          }
        ]
      },
      {
        "matcher": "quoth_*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/post-quoth-tool.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh"
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "matcher": "!quoth-memory",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/subagent-start.sh"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "!quoth-memory",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/subagent-stop.sh"
          }
        ]
      }
    ]
  }
}
```

**Step 2: Validate JSON**

Run: `python3 -m json.tool quoth-plugin/.claude-plugin/hooks/hooks.json > /dev/null`
Expected: No errors

**Step 3: Commit**

```bash
git add quoth-plugin/.claude-plugin/hooks/hooks.json
git commit -m "feat(memory-v2): update hooks.json with new PostToolUse and subagent exclusions"
```

---

## Task 11: Create quoth-memory Agent Definition

**Files:**
- Create: `quoth-plugin/.claude-plugin/agents/quoth-memory.md`

**Step 1: Create agents directory**

Run: `mkdir -p quoth-plugin/.claude-plugin/agents`

**Step 2: Create quoth-memory.md**

Create file `quoth-plugin/.claude-plugin/agents/quoth-memory.md`:

```markdown
---
name: quoth-memory
description: |
  Memory interface for Quoth. Handles context injection, interactive queries,
  and knowledge promotion. Exempt from all hooks to prevent loops.
model: sonnet
color: violet
tools:
  - quoth_search_index
  - quoth_read_doc
  - quoth_read_chunks
  - quoth_propose_update
  - Read
  - Write
  - Glob
  - Edit
---

# Quoth Memory Agent

You are the memory interface for Quoth. Your role is to mediate between the knowledge base and the working context, providing summarized, relevant information without bloating the main conversation.

## Core Responsibilities

### 1. CONTEXT INJECTION (SessionStart)

When invoked at session start:
- Search Quoth for patterns relevant to the current working directory
- Read local `.quoth/*.md` files (decisions, patterns, errors, knowledge)
- Summarize into ~500 tokens of actionable context
- Focus on what's immediately relevant, not comprehensive documentation

**Output format:**
```
Working in: [directory/project area]
Key patterns: [2-3 most relevant patterns]
Recent decisions: [any relevant architectural decisions]
Known issues: [pitfalls to avoid]
```

### 2. INTERACTIVE QUERIES (During work)

When asked a question:
- Search Quoth and local `.quoth/*.md` files
- Return a concise, direct answer
- Do NOT dump full documents - extract the relevant section
- If multiple sources, synthesize into one coherent answer

**Keep responses under 300 tokens unless asked for detail.**

### 3. KNOWLEDGE CAPTURE (Session logging)

When instructed to log learnings:
- Write to `.quoth/sessions/{session_id}/log.md`
- Categorize entries: decisions, patterns, errors, knowledge
- Include timestamp and context
- Keep entries atomic and searchable

### 4. PROMOTION PROPOSALS (SessionEnd)

When reviewing session learnings:
- Read `.quoth/sessions/{session_id}/` contents
- Categorize learnings by type
- Prepare a summary for user approval
- If approved, use appropriate tools:
  - Local: Edit `.quoth/{type}.md` files
  - Remote: `quoth_propose_update()` with evidence and reasoning

## IMPORTANT Rules

1. **You are exempt from hooks** - Do not expect or respond to hook context
2. **Be concise** - Main Claude should receive summaries, not raw docs
3. **Prioritize relevance** - Better to return nothing than irrelevant info
4. **Preserve attribution** - When promoting, note the source session
5. **Never trigger other subagents** - Work independently

## Example Invocations

**Context injection:**
```
Summarize relevant context for this session.
User is in: /src/auth
Recent changes: Added login validation
Return ~500 token summary.
```

**Query:**
```
What's our error handling pattern for API routes?
```

**Capture:**
```
Log this learning to the session:
Type: pattern
Content: Use zod for request validation at API boundaries
```

**Promotion:**
```
Review session learnings and prepare promotion proposal.
Session: 2026-01-28-abc123
```
```

**Step 3: Commit**

```bash
git add quoth-plugin/.claude-plugin/agents/quoth-memory.md
git commit -m "feat(memory-v2): add quoth-memory subagent definition"
```

---

## Task 12: Update plugin.json for v2

**Files:**
- Modify: `quoth-plugin/.claude-plugin/plugin.json`

**Step 1: Update plugin.json**

```json
{
  "name": "quoth",
  "version": "2.0.0",
  "description": "AI Memory plugin with local-first storage, configurable strictness, and quoth-memory subagent for context summarization. Transforms documentation from 'search and read' to 'automatic memory'.",
  "author": {
    "name": "Montinou",
    "url": "https://github.com/Montinou"
  },
  "homepage": "https://quoth.ai-innovation.site",
  "repository": "https://github.com/Montinou/quoth-mcp",
  "license": "MIT",
  "keywords": ["documentation", "mcp", "ai", "claude-code", "memory", "patterns", "quoth", "ai-memory"],
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json",
  "agents": "./agents/"
}
```

**Step 2: Commit**

```bash
git add quoth-plugin/.claude-plugin/plugin.json
git commit -m "feat(memory-v2): bump plugin version to 2.0.0 with AI Memory features"
```

---

## Task 13: Create Genesis Init Skill

**Files:**
- Create: `quoth-plugin/.claude-plugin/skills/quoth-init.md`

**Step 1: Create quoth-init skill**

Create file `quoth-plugin/.claude-plugin/skills/quoth-init.md`:

```markdown
---
name: quoth-init
description: Initialize Quoth Memory v2 for a project. Creates .quoth/ folder, config.json with strictness/gates, and type files.
---

# Quoth Memory v2 Initialization

This skill initializes Quoth Memory v2 for the current project.

## Steps

### 1. Check Current State

First, check if `.quoth/` already exists:

```bash
ls -la .quoth/ 2>/dev/null || echo "Not initialized"
```

If exists, ask user if they want to reinitialize (will preserve existing content).

### 2. Gather Configuration

Ask the user using AskUserQuestion:

**Question 1: Strictness Level**
- **Blocking** (recommended for teams) - Claude cannot write code until reasoning is documented
- **Reminder** - Claude gets gentle prompts but isn't blocked
- **Off** - No enforcement, manual capture only

**Question 2: Knowledge Types**
Multi-select from:
- decisions (default: on) - Architecture choices
- patterns (default: on) - Code patterns
- errors (default: on) - Failures and fixes
- knowledge (default: on) - General context
- selectors - UI selectors (for frontend projects)
- api - API documentation (for backend projects)

**Question 3: Gates (if strictness = blocking)**
Multi-select from:
- require_reasoning_before_edit (default: on)
- require_quoth_search (default: on)
- require_error_documentation (default: off)

### 3. Create Structure

Create the `.quoth/` folder structure:

```bash
mkdir -p .quoth/sessions

# Create config.json with user choices
cat > .quoth/config.json << 'EOF'
{
  "version": "2.0",
  "project_id": "",
  "project_slug": "PROJECT_NAME",
  "strictness": "STRICTNESS_CHOICE",
  "types": [TYPE_ARRAY],
  "gates": {
    "require_reasoning_before_edit": GATE_1,
    "require_quoth_search": GATE_2,
    "require_error_documentation": GATE_3
  },
  "created_at": "TIMESTAMP"
}
EOF
```

### 4. Create Type Files

For each selected type, create the corresponding `.quoth/{type}.md` file with a header.

### 5. Add to .gitignore

Ensure `.quoth/sessions/` is in `.gitignore` (session logs are ephemeral):

```bash
echo ".quoth/sessions/" >> .gitignore
```

### 6. Confirm Success

Output summary:
```
✅ Quoth Memory v2 initialized!

Configuration:
- Strictness: {strictness}
- Types: {types}
- Gates: {gates}

Files created:
- .quoth/config.json
- .quoth/decisions.md
- .quoth/patterns.md
- .quoth/errors.md
- .quoth/knowledge.md
- .quoth/sessions/ (gitignored)

Next steps:
1. Run /quoth-genesis to populate documentation from codebase
2. Start coding - hooks will enforce documentation as configured
```
```

**Step 2: Commit**

```bash
git add quoth-plugin/.claude-plugin/skills/quoth-init.md
git commit -m "feat(memory-v2): add quoth-init skill for project initialization"
```

---

## Task 14: Update quoth-genesis Skill

**Files:**
- Modify: `quoth-plugin/.claude-plugin/skills/quoth-genesis.md` (if exists, or create)

**Step 1: Check if skill exists**

Run: `ls -la quoth-plugin/.claude-plugin/skills/`

**Step 2: Create/update quoth-genesis.md**

Create file `quoth-plugin/.claude-plugin/skills/quoth-genesis.md`:

```markdown
---
name: quoth-genesis
description: Bootstrap Quoth documentation from codebase. Phase 0 configures memory settings, then generates documentation at chosen depth level.
---

# Quoth Genesis v3.0

Generates comprehensive documentation from your codebase with configurable depth.

## Prerequisites

- Quoth MCP must be connected (`claude mcp add quoth`)
- Project should be initialized (`/quoth-init` or existing `.quoth/config.json`)

## Phase 0: Configuration (if not initialized)

If `.quoth/config.json` doesn't exist, first run `/quoth-init` to configure:
- Strictness level (blocking/reminder/off)
- Knowledge types
- Documentation gates

## Phase 1: Choose Depth

Ask user to select documentation depth:

| Depth | Documents | Time | Use Case |
|-------|-----------|------|----------|
| **minimal** | 3 | ~3 min | Quick overview |
| **standard** | 5 | ~7 min | Team onboarding |
| **comprehensive** | 11 | ~20 min | Enterprise audit |

## Phase 2-5: Documentation Generation

Use the `quoth_genesis` tool with the selected depth:

```
quoth_genesis({ depth: "standard" })
```

The tool handles:
- Reading local files
- Analyzing codebase structure
- Generating documentation
- Uploading to Quoth incrementally

## Phase 6: Local Integration

After Genesis completes, populate local `.quoth/*.md` files:

1. **patterns.md** - Extract coding patterns from genesis output
2. **decisions.md** - Note any architectural decisions discovered
3. **knowledge.md** - General project context

This ensures local memory is synchronized with remote Quoth.

## Output

```
✅ Genesis Complete!

Remote (Quoth):
- project-overview.md
- tech-stack.md
- repo-structure.md
- coding-conventions.md (standard+)
- testing-patterns.md (standard+)
- [additional docs for comprehensive]

Local (.quoth/):
- patterns.md - Updated with discovered patterns
- knowledge.md - Updated with project context

Your project is now ready for AI Memory!
```
```

**Step 3: Commit**

```bash
git add quoth-plugin/.claude-plugin/skills/quoth-genesis.md
git commit -m "feat(memory-v2): add quoth-genesis skill with Phase 0 configuration"
```

---

## Task 15: Create Integration Test Script

**Files:**
- Create: `quoth-plugin/tests/memory-v2-integration.sh`

**Step 1: Create test script**

Create file `quoth-plugin/tests/memory-v2-integration.sh`:

```bash
#!/usr/bin/env bash
# Quoth Memory v2.0 - Integration Tests
# Run: bash quoth-plugin/tests/memory-v2-integration.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$SCRIPT_DIR/../.claude-plugin"

echo "=== Quoth Memory v2.0 Integration Tests ==="
echo ""

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Test helper
test_pass() {
    echo "✅ PASS: $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

test_fail() {
    echo "❌ FAIL: $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

# ============================================================================
# Test 1: Library syntax validation
# ============================================================================
echo "--- Test 1: Library Syntax Validation ---"

if bash -n "$PLUGIN_DIR/lib/memory-schema.sh" 2>/dev/null; then
    test_pass "memory-schema.sh syntax valid"
else
    test_fail "memory-schema.sh syntax invalid"
fi

if bash -n "$PLUGIN_DIR/lib/config-schema.sh" 2>/dev/null; then
    test_pass "config-schema.sh syntax valid"
else
    test_fail "config-schema.sh syntax invalid"
fi

if bash -n "$PLUGIN_DIR/hooks/lib/common.sh" 2>/dev/null; then
    test_pass "common.sh syntax valid"
else
    test_fail "common.sh syntax invalid"
fi

# ============================================================================
# Test 2: Hook syntax validation
# ============================================================================
echo ""
echo "--- Test 2: Hook Syntax Validation ---"

for hook in session-start pre-tool-gate post-tool-log subagent-start subagent-stop stop; do
    if bash -n "$PLUGIN_DIR/hooks/${hook}.sh" 2>/dev/null; then
        test_pass "${hook}.sh syntax valid"
    else
        test_fail "${hook}.sh syntax invalid"
    fi
done

# ============================================================================
# Test 3: JSON validation
# ============================================================================
echo ""
echo "--- Test 3: JSON Validation ---"

if python3 -m json.tool "$PLUGIN_DIR/hooks/hooks.json" > /dev/null 2>&1; then
    test_pass "hooks.json valid JSON"
else
    test_fail "hooks.json invalid JSON"
fi

if python3 -m json.tool "$PLUGIN_DIR/plugin.json" > /dev/null 2>&1; then
    test_pass "plugin.json valid JSON"
else
    test_fail "plugin.json invalid JSON"
fi

# ============================================================================
# Test 4: Local folder creation
# ============================================================================
echo ""
echo "--- Test 4: Local Folder Creation ---"

# Create temp test directory
TEST_DIR=$(mktemp -d)
cd "$TEST_DIR"

# Source libraries
source "$PLUGIN_DIR/lib/memory-schema.sh"
source "$PLUGIN_DIR/lib/config-schema.sh"

# Test folder creation
init_quoth_local_folder
if [ -d ".quoth" ] && [ -f ".quoth/decisions.md" ]; then
    test_pass "init_quoth_local_folder creates structure"
else
    test_fail "init_quoth_local_folder failed"
fi

# Test config creation
create_default_config "test-project-id" "test-project" "reminder"
if [ -f ".quoth/config.json" ]; then
    test_pass "create_default_config creates config.json"
else
    test_fail "create_default_config failed"
fi

# Test config reading
strictness=$(get_strictness)
if [ "$strictness" = "reminder" ]; then
    test_pass "get_strictness returns correct value"
else
    test_fail "get_strictness returned: $strictness (expected: reminder)"
fi

# Test session folder creation
session_dir=$(init_session_folder "test-session-123")
if [ -d "$session_dir" ] && [ -f "$session_dir/log.md" ]; then
    test_pass "init_session_folder creates session structure"
else
    test_fail "init_session_folder failed"
fi

# Cleanup
cd - > /dev/null
rm -rf "$TEST_DIR"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "=== Test Summary ==="
echo "Passed: $TESTS_PASSED"
echo "Failed: $TESTS_FAILED"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo "✅ All tests passed!"
    exit 0
else
    echo "❌ Some tests failed"
    exit 1
fi
```

**Step 2: Make executable**

Run: `chmod +x quoth-plugin/tests/memory-v2-integration.sh`

**Step 3: Run tests**

Run: `bash quoth-plugin/tests/memory-v2-integration.sh`
Expected: All tests pass

**Step 4: Commit**

```bash
git add quoth-plugin/tests/memory-v2-integration.sh
git commit -m "test(memory-v2): add integration test script for v2 features"
```

---

## Task 16: Final Verification and PR

**Files:**
- All modified files in previous tasks

**Step 1: Run all tests**

```bash
bash quoth-plugin/tests/memory-v2-integration.sh
```

Expected: All tests pass

**Step 2: Verify git status**

```bash
git status
git log --oneline -10
```

**Step 3: Create PR**

```bash
gh pr create \
  --title "feat: Quoth Memory v2.0 - AI Memory Architecture" \
  --body "$(cat << 'EOF'
## Summary

Transforms Quoth from Agentic RAG into AI Memory with:
- Local-first `.quoth/` storage with persistent type files
- Session-scoped logging in `.quoth/sessions/`
- Configurable strictness (blocking/reminder/off)
- Documentation gates enforced via hooks
- `quoth-memory` subagent for context summarization
- User-controlled knowledge promotion at session end

## Changes

### New Libraries
- `lib/memory-schema.sh` - Local folder structure management
- `lib/config-schema.sh` - Config file operations

### Updated Hooks
- `session-start.sh` - Initializes session folder, injects context
- `pre-tool-gate.sh` - Enforces documentation gates (NEW)
- `post-tool-log.sh` - Logs tool actions to session (NEW)
- `subagent-start.sh` - Memory context injection (excludes quoth-memory)
- `subagent-stop.sh` - Documentation prompts (excludes quoth-memory)
- `stop.sh` - Knowledge promotion prompt

### New Agent
- `quoth-memory` - Sonnet-powered memory interface subagent

### New Skills
- `/quoth-init` - Initialize Memory v2 for a project
- `/quoth-genesis` - Updated with Phase 0 configuration

### Configuration
- `.quoth/config.json` schema with strictness, types, gates
- Hook exclusions for quoth-memory subagent

## Test Plan

- [x] Library syntax validation
- [x] Hook syntax validation
- [x] JSON validation
- [x] Local folder creation tests
- [x] Config operations tests
- [ ] Manual E2E testing with Claude Code

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"
```

**Step 4: Verify PR created**

```bash
gh pr view --web
```

---

## Appendix: File Structure After Implementation

```
quoth-plugin/
├── .claude-plugin/
│   ├── plugin.json              # v2.0.0
│   ├── hooks/
│   │   ├── hooks.json           # Updated with new hooks
│   │   ├── lib/
│   │   │   └── common.sh        # Updated to source new libs
│   │   ├── session-start.sh     # v2 with session folder init
│   │   ├── pre-tool-gate.sh     # NEW: Documentation gates
│   │   ├── post-tool-log.sh     # NEW: Session logging
│   │   ├── subagent-start.sh    # Updated: Memory context
│   │   ├── subagent-stop.sh     # Updated: Doc prompts
│   │   ├── stop.sh              # Updated: Promotion prompt
│   │   ├── user-prompt.sh       # Unchanged
│   │   └── post-quoth-tool.sh   # Unchanged
│   ├── lib/
│   │   ├── memory-schema.sh     # NEW: Folder operations
│   │   └── config-schema.sh     # NEW: Config operations
│   ├── agents/
│   │   └── quoth-memory.md      # NEW: Memory subagent
│   └── skills/
│       ├── quoth-init.md        # NEW: Project init
│       └── quoth-genesis.md     # Updated: Phase 0 config
├── tests/
│   └── memory-v2-integration.sh # NEW: Integration tests
└── README.md
```

---

## Execution Handoff

Plan complete and saved to `docs/memory-v2/implementation/00-implementation-plan.md`.

Since you requested immediate execution, I will use **Subagent-Driven Development** to implement this plan task-by-task in the current session.
