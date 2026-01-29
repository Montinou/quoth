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
