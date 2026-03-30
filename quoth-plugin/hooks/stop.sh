#!/usr/bin/env bash
# Quoth Memory v2.0 - Stop Hook
# Auto-extracts, consolidates, and syncs session learnings

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# Source auto-memory helpers
if [ -f "$SCRIPT_DIR/lib/auto-memory.sh" ]; then
    source "$SCRIPT_DIR/lib/auto-memory.sh"
fi

# Read input from stdin
INPUT=$(cat)

SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"

main() {
    # Skip if no config
    if ! config_exists; then
        cleanup_session
        output_empty
        exit 0
    fi

    # Skip in off mode
    if is_off_mode; then
        cleanup_session
        output_empty
        exit 0
    fi

    # Skip if auto_memory is disabled
    if ! is_auto_memory_enabled; then
        cleanup_session
        output_empty
        exit 0
    fi

    # Check if session had meaningful activity
    local has_activity=false
    local session_dir=$(get_session_folder "$SESSION_ID")
    local log_file="$session_dir/log.md"
    local pending_file="$session_dir/pending.md"

    if [ -f "$log_file" ]; then
        local line_count=$(wc -l < "$log_file" | tr -d ' ')
        if [ "$line_count" -gt 7 ]; then
            has_activity=true
        fi
    fi

    if [ -f "$pending_file" ] && [ -s "$pending_file" ]; then
        has_activity=true
    fi

    local total_ops=$(get_total_operations)
    if [ "$total_ops" -gt 5 ] 2>/dev/null; then
        has_activity=true
    fi

    if [ "$has_activity" = true ]; then
        # 1. Extract learnings from session log
        extract_session_learnings "$SESSION_ID" 2>/dev/null || true

        # 2. Consolidate into .quoth/*.md type files
        consolidate_to_local "$SESSION_ID" 2>/dev/null || true

        # 3. Check if remote sync is needed
        if sync_needed 2>/dev/null; then
            trigger_remote_sync 2>/dev/null || true
            # Tell Claude to sync via quoth-memory subagent
            output_context "**[Auto-Memory]** Session learnings saved to .quoth/ files. Use \`quoth-memory\` to sync to remote if MCP is connected."
        else
            output_context "**[Auto-Memory]** Session learnings saved to local .quoth/ files."
        fi
    else
        output_empty
    fi

    cleanup_session
}

main
