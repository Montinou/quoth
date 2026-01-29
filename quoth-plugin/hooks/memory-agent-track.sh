#!/usr/bin/env bash
# Quoth Memory v2.0 - Memory Agent Tracker
# Fires when quoth-memory subagent starts. Marks session flag.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# Read input from stdin
INPUT=$(cat)

SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"

main() {
    # Mark that the memory agent was invoked
    if session_exists; then
        mark_memory_agent_invoked
    fi

    # Log to session folder if it exists
    if config_exists && session_folder_exists "$SESSION_ID"; then
        append_session_log "$SESSION_ID" "quoth-memory agent invoked"
    fi

    output_empty
}

main
