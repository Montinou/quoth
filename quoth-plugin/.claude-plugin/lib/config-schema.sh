#!/usr/bin/env bash
# Quoth Memory v2.0 - Config Schema
# Manages .quoth/config.json

# ============================================================================
# CONFIG FILE OPERATIONS
# ============================================================================

QUOTH_CONFIG_FILE=".quoth/config.json"

# Create default config
# Usage: create_default_config "$PROJECT_ID" "$PROJECT_SLUG" "$STRICTNESS"
create_default_config() {
    local project_id="${1:-}"
    local project_slug="${2:-local}"
    local strictness="${3:-reminder}"

    mkdir -p ".quoth"

    cat > "$QUOTH_CONFIG_FILE" << EOF
{
  "version": "2.0",
  "project_id": "$project_id",
  "project_slug": "$project_slug",
  "strictness": "$strictness",
  "types": [
    "decisions",
    "patterns",
    "errors",
    "knowledge"
  ],
  "gates": {
    "require_reasoning_before_edit": true,
    "require_quoth_search": true,
    "require_error_documentation": false
  },
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
}

# Read config value
# Usage: read_config_value "strictness"
read_config_value() {
    local key="$1"
    if [ -f "$QUOTH_CONFIG_FILE" ]; then
        grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$QUOTH_CONFIG_FILE" 2>/dev/null | \
            head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo ""
    fi
}

# Read config boolean
# Usage: read_config_bool "require_reasoning_before_edit"
read_config_bool() {
    local key="$1"
    if [ -f "$QUOTH_CONFIG_FILE" ]; then
        if grep -q "\"$key\"[[:space:]]*:[[:space:]]*true" "$QUOTH_CONFIG_FILE" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Get strictness level
# Returns: blocking, reminder, or off
get_strictness() {
    local strictness
    strictness=$(read_config_value "strictness")
    echo "${strictness:-reminder}"
}

# Check if config exists
config_exists() {
    [ -f "$QUOTH_CONFIG_FILE" ]
}

# Update config value
# Usage: update_config_value "strictness" "blocking"
update_config_value() {
    local key="$1"
    local value="$2"
    if [ -f "$QUOTH_CONFIG_FILE" ]; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"$key\": \"$value\"/" "$QUOTH_CONFIG_FILE"
        else
            sed -i "s/\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"$key\": \"$value\"/" "$QUOTH_CONFIG_FILE"
        fi
    fi
}

# ============================================================================
# GATE CHECKS
# ============================================================================

# Check if a gate is enabled
# Usage: gate_enabled "require_reasoning_before_edit"
gate_enabled() {
    local gate="$1"
    if [ -f "$QUOTH_CONFIG_FILE" ]; then
        if grep -q "\"$gate\"[[:space:]]*:[[:space:]]*true" "$QUOTH_CONFIG_FILE" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Check if strictness is blocking
is_blocking_mode() {
    [ "$(get_strictness)" = "blocking" ]
}

# Check if strictness is reminder
is_reminder_mode() {
    [ "$(get_strictness)" = "reminder" ]
}

# Check if strictness is off
is_off_mode() {
    [ "$(get_strictness)" = "off" ]
}
