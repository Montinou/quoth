#!/usr/bin/env bash
# Quoth Plugin - SubagentStop Hook
# Reminds to document new patterns discovered by subagents

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

main() {
    # Check if MCP is available
    if ! quoth_mcp_installed; then
        output_empty
        exit 0
    fi

    # Prompt for documentation if subagent discovered new patterns
    local context="SUBAGENT COMPLETE: If new patterns were created, consider documenting with \`quoth_propose_update\`."

    output_context "$context"
}

main "$@"
