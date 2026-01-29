#!/usr/bin/env bash
# Quoth Plugin - UserPromptSubmit Hook
# Detects user intent and provides context-aware hints

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

# Detect intent from user prompt text
detect_intent() {
    local prompt_lower="$1"

    # Testing intent
    if echo "$prompt_lower" | grep -qE '(test|spec|vitest|playwright|e2e|unit test|integration test)'; then
        echo "testing"
        return
    fi

    # Review intent
    if echo "$prompt_lower" | grep -qE '(review|audit|check|verify|validate)'; then
        echo "review"
        return
    fi

    # Document intent
    if echo "$prompt_lower" | grep -qE '(document|docs|explain|describe)'; then
        echo "document"
        return
    fi

    # Debug intent
    if echo "$prompt_lower" | grep -qE '(fix|bug|error|debug|issue|broken)'; then
        echo "debug"
        return
    fi

    # No specific intent detected
    echo ""
}

# Get hint text for detected intent
get_intent_hint() {
    local intent="$1"

    case "$intent" in
        testing)
            echo "[Quoth] Test task. Call: quoth_guidelines({ mode: \"code\" })"
            ;;
        review)
            echo "[Quoth] Review task. Call: quoth_guidelines({ mode: \"review\" })"
            ;;
        document)
            echo "[Quoth] Doc task. Call: quoth_guidelines({ mode: \"document\" })"
            ;;
        debug)
            echo "[Quoth] Debug. Search: quoth_search_index({ query: \"error handling\" })"
            ;;
        *)
            echo ""
            ;;
    esac
}

main() {
    # Check if session exists
    if ! session_exists; then
        output_empty
        exit 0
    fi

    # Parse input JSON from stdin
    local input=$(cat)

    # Extract prompt text from input
    local prompt=$(echo "$input" | grep -o '"prompt"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')

    if [ -z "$prompt" ]; then
        output_empty
        exit 0
    fi

    # Convert to lowercase for matching
    local prompt_lower=$(echo "$prompt" | tr '[:upper:]' '[:lower:]')

    # Detect intent
    local intent=$(detect_intent "$prompt_lower")

    # Update session with detected intent (if any)
    if [ -n "$intent" ]; then
        update_session_intent "$intent"
    fi

    # Get intent-specific hint
    local hint=""
    if [ -n "$intent" ]; then
        hint=$(get_intent_hint "$intent")
    fi

    # Check if we should nudge about quoth-memory (only if config exists)
    local memory_nudge=""
    if config_exists && ! memory_agent_was_invoked; then
        local nudge_count=$(get_memory_nudge_count)
        if [ "$nudge_count" -lt 2 ] 2>/dev/null; then
            # Check strictness for nudge style
            local strictness=$(get_strictness)
            case "$strictness" in
                blocking)
                    memory_nudge=" [Quoth REQUIRED] Invoke quoth-memory agent before proceeding with code edits."
                    increment_memory_nudge
                    ;;
                reminder)
                    memory_nudge=" [Quoth] Consider invoking quoth-memory agent for project context."
                    increment_memory_nudge
                    ;;
                off)
                    # No nudge in off mode
                    ;;
            esac
        fi
    fi

    # Combine hint + memory nudge
    local full_msg="${hint}${memory_nudge}"

    if [ -n "$full_msg" ]; then
        output_context "$full_msg"
    else
        output_empty
    fi
}

main "$@"
