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
        output_context "Quoth plugin active. Run \`/quoth-init\` to initialize memory for this project."
    fi
}

main
