#!/usr/bin/env bash
# Quoth Plugin - SubagentStart Hook
# Ensures subagents follow documented patterns

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

main() {
    # Check if MCP is available
    if ! quoth_mcp_installed; then
        output_empty
        exit 0
    fi

    # Subagents often write code autonomously - strong hint
    local context="SUBAGENT: Before writing code, use \`quoth_guidelines('code')\` and \`quoth_search_index\` to follow documented patterns."

    output_context "$context"
}

main "$@"
