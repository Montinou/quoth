#!/usr/bin/env bash
# Quoth Memory v2.0 - Post-Tool Log Hook
# Logs all tool actions to session folder (file tools + non-file tools)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# Read input from stdin
INPUT=$(cat)

SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"

# ============================================================================
# HELPERS
# ============================================================================

# Extract a JSON string value by key from INPUT
extract_json_value() {
    local key="$1"
    echo "$INPUT" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo ""
}

# ============================================================================
# MAIN LOGIC
# ============================================================================

main() {
    # Skip if no config
    if ! config_exists; then
        output_empty
        exit 0
    fi

    # Skip if off mode — no logging at all
    local strictness=$(get_strictness)
    if [ "$strictness" = "off" ]; then
        output_empty
        exit 0
    fi

    # Skip if session folder doesn't exist
    if ! session_folder_exists "$SESSION_ID"; then
        output_empty
        exit 0
    fi

    # Increment total operations counter
    increment_session_counter "total_operations"

    # Extract tool info from input
    local tool_name=$(extract_json_value "tool_name")
    if [ -z "$tool_name" ]; then
        tool_name="unknown"
    fi

    # Extract result status
    local result="OK"
    if echo "$INPUT" | grep -qi "error\|failed\|exception"; then
        result="Error"
    fi

    # Route logging based on tool type
    case "$tool_name" in
        Edit|Write)
            local file_path=$(extract_file_path "$INPUT")
            if [ -n "$file_path" ]; then
                append_tool_log "$SESSION_ID" "$tool_name" "$file_path" "$result"
            else
                append_session_log "$SESSION_ID" "$tool_name ($result)"
            fi
            ;;
        Read)
            local file_path=$(extract_file_path "$INPUT")
            if [ -n "$file_path" ]; then
                append_session_log "$SESSION_ID" "Read: $file_path"
            fi
            ;;
        Bash)
            local command=$(extract_json_value "command")
            # Truncate long commands
            if [ ${#command} -gt 80 ]; then
                command="${command:0:80}..."
            fi
            if [ -n "$command" ]; then
                append_session_log "$SESSION_ID" "Bash: $command ($result)"
            else
                append_session_log "$SESSION_ID" "Bash ($result)"
            fi
            ;;
        Glob)
            local pattern=$(extract_json_value "pattern")
            if [ -n "$pattern" ]; then
                append_session_log "$SESSION_ID" "Glob: $pattern"
            else
                append_session_log "$SESSION_ID" "Glob"
            fi
            ;;
        Grep)
            local pattern=$(extract_json_value "pattern")
            if [ -n "$pattern" ]; then
                append_session_log "$SESSION_ID" "Grep: $pattern"
            else
                append_session_log "$SESSION_ID" "Grep"
            fi
            ;;
        Task)
            local description=$(extract_json_value "description")
            if [ -n "$description" ]; then
                append_session_log "$SESSION_ID" "Task: $description"
            else
                append_session_log "$SESSION_ID" "Task agent"
            fi
            ;;
        *)
            # Catch-all for any other matched tools
            append_session_log "$SESSION_ID" "$tool_name ($result)"
            ;;
    esac

    output_empty
}

main
