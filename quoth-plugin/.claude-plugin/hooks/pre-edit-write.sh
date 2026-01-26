#!/usr/bin/env bash
# Quoth Plugin - PreToolUse Hook (Edit|Write)
# Lightweight reminder for Quoth patterns

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

main() {
    # Check if MCP is available and session exists
    if ! quoth_mcp_installed || ! session_exists; then
        output_empty
        exit 0
    fi

    # Parse input JSON from stdin
    local input=$(cat)

    # Extract file_path from tool_input
    local file_path=$(extract_file_path "$input")

    if [ -z "$file_path" ]; then
        output_empty
        exit 0
    fi

    # Skip non-code files
    if is_non_code_file "$file_path"; then
        output_empty
        exit 0
    fi

    # Lightweight hint - strongly suggest, not force
    local context="Quoth patterns available via \`quoth_guidelines()\` and \`quoth_search_index\`"

    output_context "$context"
}

main "$@"
