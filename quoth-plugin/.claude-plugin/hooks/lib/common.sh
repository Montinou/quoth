#!/usr/bin/env bash
# Quoth Plugin - Shared Functions
# Source this file from other hooks: source "${SCRIPT_DIR}/lib/common.sh"

set -e

# Source memory v2 libraries
COMMON_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$(dirname "$(dirname "$COMMON_SCRIPT_DIR")")/lib"
if [ -f "$LIB_DIR/memory-schema.sh" ]; then
    source "$LIB_DIR/memory-schema.sh"
fi
if [ -f "$LIB_DIR/config-schema.sh" ]; then
    source "$LIB_DIR/config-schema.sh"
fi

# ============================================================================
# CONSTANTS
# ============================================================================

QUOTH_SESSION_DIR="/tmp/quoth"
QUOTH_MCP_NAME="quoth"

# ============================================================================
# MCP DETECTION
# ============================================================================

# Check if Quoth MCP is likely available
# Returns: 0 (always) - if this hook is running, the plugin is installed
# Note: We skip the slow `claude mcp list` check (~3.6s) for instant execution
quoth_mcp_installed() {
    return 0
}

# ============================================================================
# PROJECT CONFIG
# ============================================================================

# Find Quoth config file in current directory
# Returns: path to config file, or empty string
find_quoth_config() {
    if [ -f ".quoth/config.json" ]; then
        echo ".quoth/config.json"
    elif [ -f "quoth.config.json" ]; then
        echo "quoth.config.json"
    else
        echo ""
    fi
}

# Extract value from JSON config (simple grep-based, no jq dependency)
# Usage: get_config_value "project_id" "$CONFIG_PATH"
get_config_value() {
    local key="$1"
    local config_path="$2"
    if [ -f "$config_path" ]; then
        grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$config_path" 2>/dev/null | \
            head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo ""
    fi
}

# ============================================================================
# SESSION STATE
# ============================================================================

# Get session marker file path
# Uses CLAUDE_SESSION_ID if available, falls back to process-based ID
get_session_file() {
    mkdir -p "$QUOTH_SESSION_DIR"
    local session_id="${CLAUDE_SESSION_ID:-$$}"
    echo "$QUOTH_SESSION_DIR/session_$session_id.json"
}

# Initialize session state with new schema
# Usage: init_session "$PROJECT_ID"
init_session() {
    local project_id="$1"
    local session_file=$(get_session_file)
    cat > "$session_file" << EOF
{
  "project_id": "$project_id",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "hints_delivered": {
    "session_start": true,
    "pre_edit_test": false,
    "pre_edit_api": false,
    "pre_edit_component": false,
    "pre_edit_service": false,
    "pre_edit_generic": false
  },
  "quoth_tools_used": {
    "guidelines": 0,
    "search_index": 0,
    "read_doc": 0,
    "read_chunks": 0,
    "propose_update": 0
  },
  "detected_intent": null
}
EOF
}

# Check if session exists
session_exists() {
    local session_file=$(get_session_file)
    [ -f "$session_file" ]
}

# Update session state (increment counter)
# Usage: increment_session_counter "patterns_applied"
increment_session_counter() {
    local counter="$1"
    local session_file=$(get_session_file)
    if [ -f "$session_file" ]; then
        local current=$(grep -o "\"$counter\"[[:space:]]*:[[:space:]]*[0-9]*" "$session_file" | grep -o '[0-9]*' || echo "0")
        local new=$((current + 1))
        # Use portable sed syntax (works on both macOS and Linux)
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/\"$counter\"[[:space:]]*:[[:space:]]*[0-9]*/\"$counter\": $new/" "$session_file"
        else
            sed -i "s/\"$counter\"[[:space:]]*:[[:space:]]*[0-9]*/\"$counter\": $new/" "$session_file"
        fi
    fi
}

# Read session state
# Returns: JSON content of session file
read_session() {
    local session_file=$(get_session_file)
    if [ -f "$session_file" ]; then
        cat "$session_file"
    else
        echo '{}'
    fi
}

# Get counter value from session
# Usage: get_session_counter "patterns_applied"
get_session_counter() {
    local counter="$1"
    local session=$(read_session)
    echo "$session" | grep -o "\"$counter\"[[:space:]]*:[[:space:]]*[0-9]*" | grep -o '[0-9]*' || echo "0"
}

# Clean up session state
cleanup_session() {
    local session_file=$(get_session_file)
    rm -f "$session_file"
}

# ============================================================================
# HINT TRACKING HELPERS
# ============================================================================

# Check if hint was already delivered for a category
# Usage: hint_delivered_for "pre_edit_test"
# Returns: 0 if delivered, 1 if not
hint_delivered_for() {
    local category="$1"
    local session_file=$(get_session_file)
    if [ -f "$session_file" ]; then
        # Check if hints_delivered.$category is true
        if grep -q "\"$category\"[[:space:]]*:[[:space:]]*true" "$session_file" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Mark hint as delivered for a category
# Usage: mark_hint_delivered "pre_edit_test"
mark_hint_delivered() {
    local category="$1"
    local session_file=$(get_session_file)
    if [ -f "$session_file" ]; then
        # Replace false with true for this category
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/\"$category\"[[:space:]]*:[[:space:]]*false/\"$category\": true/" "$session_file"
        else
            sed -i "s/\"$category\"[[:space:]]*:[[:space:]]*false/\"$category\": true/" "$session_file"
        fi
    fi
}

# Check if any Quoth tools were used in this session
# Returns: 0 if any tool counter > 0, 1 if all are 0
quoth_tools_were_used() {
    local session_file=$(get_session_file)
    if [ -f "$session_file" ]; then
        # Check if any quoth_tools_used counter is > 0
        local tools_section=$(grep -A 6 '"quoth_tools_used"' "$session_file" 2>/dev/null || echo "")
        if echo "$tools_section" | grep -qE ':[[:space:]]*[1-9]'; then
            return 0
        fi
    fi
    return 1
}

# Increment a Quoth tool usage counter
# Usage: increment_tool_counter "search_index"
increment_tool_counter() {
    local tool_name="$1"
    local session_file=$(get_session_file)
    if [ -f "$session_file" ]; then
        local current=$(grep -o "\"$tool_name\"[[:space:]]*:[[:space:]]*[0-9]*" "$session_file" | grep -o '[0-9]*' | head -1 || echo "0")
        local new=$((current + 1))
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/\"$tool_name\"[[:space:]]*:[[:space:]]*[0-9]*/\"$tool_name\": $new/" "$session_file"
        else
            sed -i "s/\"$tool_name\"[[:space:]]*:[[:space:]]*[0-9]*/\"$tool_name\": $new/" "$session_file"
        fi
    fi
}

# Update detected user intent
# Usage: update_session_intent "testing"
update_session_intent() {
    local intent="$1"
    local session_file=$(get_session_file)
    if [ -f "$session_file" ]; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/\"detected_intent\"[[:space:]]*:[[:space:]]*[^,}]*/\"detected_intent\": \"$intent\"/" "$session_file"
        else
            sed -i "s/\"detected_intent\"[[:space:]]*:[[:space:]]*[^,}]*/\"detected_intent\": \"$intent\"/" "$session_file"
        fi
    fi
}

# ============================================================================
# FILE CATEGORY DETECTION
# ============================================================================

# Determine the category of a file based on its path
# Returns: component, api, test, service, config, or unknown
detect_file_category() {
    local file_path="$1"

    case "$file_path" in
        *.test.* | *.spec.* | */__tests__/* | */tests/*)
            echo "test"
            ;;
        */api/* | */routes/* | *route.ts | *route.js)
            echo "api"
            ;;
        */components/* | *.tsx | *.jsx)
            echo "component"
            ;;
        */lib/* | */utils/* | */services/* | */helpers/*)
            echo "service"
            ;;
        *.config.* | */config/* | .env* | package.json | tsconfig.json)
            echo "config"
            ;;
        *)
            echo "unknown"
            ;;
    esac
}

# Build search query based on file category
build_search_query() {
    local category="$1"

    case "$category" in
        test)
            echo "testing patterns best practices"
            ;;
        api)
            echo "api endpoint patterns response format"
            ;;
        component)
            echo "component patterns react conventions"
            ;;
        service)
            echo "service patterns error handling"
            ;;
        config)
            echo "configuration conventions"
            ;;
        *)
            echo "coding conventions patterns"
            ;;
    esac
}

# Check if file should be skipped (config/generated files)
should_skip_file() {
    local file_path="$1"
    case "$file_path" in
        *.lock | *.generated.* | package-lock.json | yarn.lock | node_modules/*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Check if file is non-code (docs, config, etc.)
is_non_code_file() {
    local file_path="$1"
    case "$file_path" in
        *.md | *.txt | *.json | *.yaml | *.yml | *.lock)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# ============================================================================
# JSON PARSING HELPERS
# ============================================================================

# Extract file_path from hook input JSON
# Usage: extract_file_path "$INPUT"
extract_file_path() {
    local input="$1"
    echo "$input" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
}

# ============================================================================
# JSON OUTPUT HELPERS
# ============================================================================

# Escape string for JSON
# Usage: json_escape "string with \"quotes\""
json_escape() {
    local str="$1"
    printf '%s' "$str" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr '\n' ' '
}

# Output hook response with additional context
# Usage: output_context "Your context message here"
output_context() {
    local context="$1"
    local escaped=$(json_escape "$context")
    cat << EOF
{
  "hookSpecificOutput": {
    "additionalContext": "$escaped"
  }
}
EOF
}

# Output empty response (hook has nothing to add)
output_empty() {
    echo '{}'
}
