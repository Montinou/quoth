#!/usr/bin/env bash
# Quoth Plugin - SessionStart Hook
# Lightweight hint for Quoth availability

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

main() {
    # Check if Quoth MCP is installed
    if ! quoth_mcp_installed; then
        output_empty
        exit 0
    fi

    # Find project config
    local config_path=$(find_quoth_config)
    local project_id=""

    if [ -n "$config_path" ]; then
        project_id=$(get_config_value "project_id" "$config_path")
    fi

    # Initialize session state
    init_session "$project_id"

    # Lightweight hint - strongly suggest, not force
    local context="Quoth MCP active. Strongly recommend \`quoth_guidelines('code')\` and \`quoth_search_index\` before writing code."

    output_context "$context"
}

main "$@"
