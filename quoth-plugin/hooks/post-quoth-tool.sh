#!/usr/bin/env bash
# Quoth Plugin - PostToolUse Hook (quoth_*)
# Tracks Quoth tool usage for conditional badge in Stop hook

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

main() {
    # Check if session exists
    if ! session_exists; then
        output_empty
        exit 0
    fi

    # Parse input JSON from stdin
    local input=$(cat)

    # Extract tool_name from input
    local tool_name=$(echo "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')

    if [ -z "$tool_name" ]; then
        output_empty
        exit 0
    fi

    # Map tool_name to counter key
    local counter_key=""
    case "$tool_name" in
        quoth_guidelines)
            counter_key="guidelines"
            ;;
        quoth_search_index)
            counter_key="search_index"
            ;;
        quoth_read_doc)
            counter_key="read_doc"
            ;;
        quoth_read_chunks)
            counter_key="read_chunks"
            ;;
        quoth_propose_update)
            counter_key="propose_update"
            ;;
        *)
            # Unknown quoth tool, skip
            output_empty
            exit 0
            ;;
    esac

    # Increment counter
    increment_tool_counter "$counter_key"

    # Write to pending.md for relevant tools
    local session_id="${CLAUDE_SESSION_ID:-}"
    if [ -n "$session_id" ] && session_folder_exists "$session_id"; then
        case "$counter_key" in
            search_index)
                local query=$(echo "$input" | grep -o '"query"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")
                if [ -n "$query" ]; then
                    add_pending_learning "$session_id" "Search: $counter_key" "Query: $query"
                fi
                ;;
            read_doc|read_chunks)
                local doc_id=$(echo "$input" | grep -o '"doc_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")
                if [ -n "$doc_id" ]; then
                    add_pending_learning "$session_id" "Read: $counter_key" "Document: $doc_id"
                fi
                ;;
            propose_update)
                local doc_id=$(echo "$input" | grep -o '"doc_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")
                if [ -n "$doc_id" ]; then
                    add_pending_learning "$session_id" "Proposal: $counter_key" "Document: $doc_id"
                fi
                ;;
        esac
    fi

    # Output empty - tracking only, no hint
    output_empty
}

main "$@"
