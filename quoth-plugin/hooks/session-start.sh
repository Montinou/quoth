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
        local session_dir=$(init_session_folder "$SESSION_ID")

        # Clean up old sessions (7 days)
        cleanup_old_sessions 7

        # 3. Populate context.md with session metadata and knowledge snapshots
        local strictness=$(get_strictness)
        local context_file="$session_dir/context.md"
        cat > "$context_file" << CTXEOF
# Session Context: $SESSION_ID

- **Strictness:** $strictness
- **Started:** $(date -u +%Y-%m-%dT%H:%M:%SZ)
- **Local storage:** .quoth/

CTXEOF

        # Append snapshot of each .quoth/*.md type file (first 10 lines)
        for type_file in .quoth/*.md; do
            if [ -f "$type_file" ]; then
                local basename=$(basename "$type_file")
                echo "## $basename" >> "$context_file"
                echo "" >> "$context_file"
                head -10 "$type_file" >> "$context_file" 2>/dev/null || true
                echo "" >> "$context_file"
                echo "---" >> "$context_file"
                echo "" >> "$context_file"
            fi
        done

        # 4. Build context injection message
        local memory_instruction=""
        case "$strictness" in
            blocking)
                memory_instruction="**[REQUIRED]** Invoke \`quoth-memory\` subagent before making code edits. Gates will block Edit/Write if memory context is not loaded after 3+ operations."
                ;;
            reminder)
                memory_instruction="Consider using \`quoth-memory\` subagent for context queries before editing code."
                ;;
            off)
                memory_instruction=""
                ;;
        esac

        local context_msg="**Quoth Memory v2 Active** - Strictness: $strictness - Session: $SESSION_ID - Local storage: .quoth/  Use \`quoth-memory\` subagent for context queries. Session logs: .quoth/sessions/$SESSION_ID/"

        if [ -n "$memory_instruction" ]; then
            context_msg="$context_msg $memory_instruction"
        fi

        output_context "$context_msg"
    else
        # No config - output standard hint
        output_context "Quoth plugin active. Run \`/quoth-init\` to initialize memory for this project."
    fi
}

main
