#!/usr/bin/env bash
# Quoth Plugin - Stop Hook
# Enforces badge display when Quoth tools were used

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

main() {
    # Check if session was active
    if ! session_exists; then
        output_empty
        exit 0
    fi

    # Clean up session file
    cleanup_session

    # Badge enforcement instruction
    local context='If you used any `quoth_*` tools in this response, end with a Quoth Badge:

┌─────────────────────────────────────────────────┐
│ 🪶 Quoth                                        │
│   ✓ [doc path]: [what was applied]              │
└─────────────────────────────────────────────────┘'

    output_context "$context"
}

main "$@"
