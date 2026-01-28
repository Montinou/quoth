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
            # Capitalize first letter (compatible with bash 3.x on macOS)
            local capitalized
            capitalized="$(echo "$type" | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')"
            cat > "$file" << EOF
# $capitalized

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

_Source: Session ${source_session}_

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
