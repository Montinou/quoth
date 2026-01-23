#!/usr/bin/env bash
# Quoth Plugin - SessionStart Hook
# Detects Quoth configuration and injects context into Claude Code sessions

set -e

# Initialize context parts
HAS_CONFIG=false
HAS_MCP=false
PROJECT_ID=""
CONTEXT_PARTS=()

# Check for Quoth configuration files
if [ -f ".quoth/config.json" ]; then
    HAS_CONFIG=true
    # Try to extract project_id from config
    PROJECT_ID=$(cat .quoth/config.json 2>/dev/null | grep -o '"project_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")
elif [ -f "quoth.config.json" ]; then
    HAS_CONFIG=true
    PROJECT_ID=$(cat quoth.config.json 2>/dev/null | grep -o '"project_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")
fi

# Check if Quoth MCP server is available
if command -v claude &> /dev/null; then
    if claude mcp list 2>/dev/null | grep -q "quoth"; then
        HAS_MCP=true
    fi
fi

# Build context message based on what's found
if [ "$HAS_CONFIG" = true ] || [ "$HAS_MCP" = true ]; then
    CONTEXT_PARTS+=("## Quoth Documentation System Detected")
    CONTEXT_PARTS+=("")
    CONTEXT_PARTS+=("This project uses Quoth as its Single Source of Truth for documentation.")
    CONTEXT_PARTS+=("")

    if [ "$HAS_CONFIG" = true ]; then
        CONTEXT_PARTS+=("**Configuration:** Found Quoth config file")
        if [ -n "$PROJECT_ID" ]; then
            CONTEXT_PARTS+=("**Project ID:** $PROJECT_ID")
        fi
    fi

    if [ "$HAS_MCP" = true ]; then
        CONTEXT_PARTS+=("**MCP Server:** Quoth MCP is available")
    fi

    CONTEXT_PARTS+=("")
    CONTEXT_PARTS+=("### Before Writing Code")
    CONTEXT_PARTS+=("")
    CONTEXT_PARTS+=("1. **Search Quoth first** - Use \`quoth_search_index\` to find existing patterns")
    CONTEXT_PARTS+=("2. **Follow documented patterns** - Use \`quoth_read_doc\` to read full documentation")
    CONTEXT_PARTS+=("3. **Propose updates** - If you find outdated docs, use \`quoth_propose_update\`")
    CONTEXT_PARTS+=("")
    CONTEXT_PARTS+=("### Available Quoth Tools")
    CONTEXT_PARTS+=("")
    CONTEXT_PARTS+=("- \`quoth_search_index\` - Semantic search across documentation")
    CONTEXT_PARTS+=("- \`quoth_read_doc\` - Read full document content")
    CONTEXT_PARTS+=("- \`quoth_propose_update\` - Submit documentation updates")
    CONTEXT_PARTS+=("- \`quoth_genesis\` - Bootstrap documentation for new projects")
    CONTEXT_PARTS+=("")
    CONTEXT_PARTS+=("**Remember:** Documentation is the intended design. When code conflicts with docs, docs are correct.")

    # Join context parts with newlines
    CONTEXT=""
    for part in "${CONTEXT_PARTS[@]}"; do
        CONTEXT="${CONTEXT}${part}\n"
    done

    # Escape the context for JSON
    ESCAPED_CONTEXT=$(printf '%s' "$CONTEXT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed 's/\t/\\t/g' | tr '\n' ' ' | sed 's/\\n /\\n/g')

    # Output JSON with additionalContext
    cat << EOF
{
  "hookSpecificOutput": {
    "additionalContext": "$ESCAPED_CONTEXT"
  }
}
EOF
else
    # No Quoth detected, output empty response
    echo '{}'
fi
