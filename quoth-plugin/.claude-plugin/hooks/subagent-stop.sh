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
