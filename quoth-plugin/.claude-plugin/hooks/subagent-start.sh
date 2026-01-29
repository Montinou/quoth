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
