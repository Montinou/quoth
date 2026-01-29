#!/usr/bin/env bash
# Quoth Memory v2.0 - Pre-Tool Gate Hook
# Enforces documentation gates before Edit/Write operations based on strictness config
#
# Gate Checks (blocking mode):
#   - Gate 1: require_reasoning_before_edit -> reasoning_documented()
#   - Gate 2: require_quoth_search -> quoth_search_performed()
#
# Modes:
#   - BLOCKING: Exit 2 if gates fail (blocks tool execution)
#   - REMINDER: Output reminder once per category per session
#   - OFF: Do nothing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

# ============================================================================
# GATE CHECK FUNCTIONS
# ============================================================================

# Check if quoth-memory subagent (exempt from gates)
# Usage: is_quoth_memory_subagent "$INPUT"
is_quoth_memory_subagent() {
    local input="$1"
    # Extract subagent_name from input if present
    local subagent_name=$(echo "$input" | grep -o '"subagent_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")

    if [ "$subagent_name" = "quoth-memory" ]; then
        return 0
    fi
    return 1
}

# Check if session log has reasoning entries (### headers)
# Usage: reasoning_documented
reasoning_documented() {
    local session_id="${CLAUDE_SESSION_ID:-}"
    if [ -z "$session_id" ]; then
        return 1
    fi

    local session_folder=$(get_session_folder "$session_id")
    local log_file="$session_folder/log.md"

    if [ -f "$log_file" ]; then
        # Check for ### entries (reasoning entries have ### timestamp format)
        if grep -q '^### ' "$log_file" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Check if quoth_search_index was performed (counter > 0)
# Usage: quoth_search_performed
quoth_search_performed() {
    local count=$(get_session_counter "search_index")
    if [ "$count" -gt 0 ] 2>/dev/null; then
        return 0
    fi
    return 1
}

# ============================================================================
# BLOCKING MODE - GATE ENFORCEMENT
# ============================================================================

# Check all enabled gates and return failure message if any fail
# Usage: check_gates "$FILE_PATH"
# Returns: Empty string if all pass, error message if any fail
check_gates() {
    local file_path="$1"
    local failures=""

    # Gate 1: require_reasoning_before_edit
    if gate_enabled "require_reasoning_before_edit"; then
        if ! reasoning_documented; then
            failures="${failures}Gate 1 FAILED: No reasoning documented in session log. Add reasoning before editing files.\n"
        fi
    fi

    # Gate 2: require_quoth_search
    if gate_enabled "require_quoth_search"; then
        if ! quoth_search_performed; then
            local category=$(detect_file_category "$file_path")
            local query=$(build_search_query "$category")
            failures="${failures}Gate 2 FAILED: No Quoth search performed. Run: quoth_search_index({ query: \"$query\" })\n"
        fi
    fi

    echo -e "$failures"
}

# ============================================================================
# REMINDER MODE - GENTLE HINTS
# ============================================================================

# Get reminder message for a category
# Usage: get_reminder_message "$CATEGORY" "$FILE_PATH"
get_reminder_message() {
    local category="$1"
    local file_path="$2"
    local query=$(build_search_query "$category")

    local msg="[Quoth Gate] Before editing $category files:\n"

    if gate_enabled "require_quoth_search" && ! quoth_search_performed; then
        msg="${msg}- Search: quoth_search_index({ query: \"$query\" })\n"
    fi

    if gate_enabled "require_reasoning_before_edit" && ! reasoning_documented; then
        msg="${msg}- Document reasoning in session log\n"
    fi

    echo -e "$msg"
}

# ============================================================================
# MAIN LOGIC
# ============================================================================

main() {
    # Read input from stdin
    local input=$(cat)

    # Get session ID
    local session_id="${CLAUDE_SESSION_ID:-}"

    # Check if config exists - if not, skip gates entirely
    if ! config_exists; then
        output_empty
        exit 0
    fi

    # Check if quoth-memory subagent (exempt from gates)
    if is_quoth_memory_subagent "$input"; then
        output_empty
        exit 0
    fi

    # Extract file path from tool input
    local file_path=$(extract_file_path "$input")

    if [ -z "$file_path" ]; then
        output_empty
        exit 0
    fi

    # Skip non-code files (docs, config, etc.)
    if is_non_code_file "$file_path"; then
        output_empty
        exit 0
    fi

    # Skip lock files and generated files
    if should_skip_file "$file_path"; then
        output_empty
        exit 0
    fi

    # Get strictness level
    local strictness=$(get_strictness)

    # Handle based on strictness mode
    case "$strictness" in
        blocking)
            # BLOCKING MODE: Check gates and exit 2 if failed
            local failures=$(check_gates "$file_path")
            if [ -n "$failures" ]; then
                # Output failure message and block
                output_context "[Quoth BLOCKED] Documentation gates not satisfied:\n$failures"
                exit 2
            fi
            # All gates passed
            output_empty
            ;;

        reminder)
            # REMINDER MODE: Output reminder once per category per session
            local file_category=$(detect_file_category "$file_path")
            local hint_key="gate_${file_category}"

            # Check if reminder already delivered for this category
            if hint_delivered_for "$hint_key"; then
                output_empty
                exit 0
            fi

            # Check if any gates would fail
            local needs_reminder=false
            if gate_enabled "require_quoth_search" && ! quoth_search_performed; then
                needs_reminder=true
            fi
            if gate_enabled "require_reasoning_before_edit" && ! reasoning_documented; then
                needs_reminder=true
            fi

            if [ "$needs_reminder" = true ]; then
                # Mark reminder as delivered
                mark_hint_delivered "$hint_key"

                # Output reminder
                local reminder=$(get_reminder_message "$file_category" "$file_path")
                output_context "$reminder"
            else
                output_empty
            fi
            ;;

        off|*)
            # OFF MODE: Do nothing
            output_empty
            ;;
    esac
}

main "$@"
