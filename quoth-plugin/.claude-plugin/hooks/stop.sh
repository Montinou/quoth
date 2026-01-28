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
