#!/usr/bin/env bash
# Quoth Auto-Memory v1.0
# Automatic extraction, consolidation, and sync of session learnings
#
# Usage: source this file from hooks that need auto-memory functions
# Depends on: memory-schema.sh (get_session_folder, add_pending_learning, append_to_type_file)

# ============================================================================
# EXTRACTION — Parse session logs into structured learnings
# ============================================================================

# Extract significant learnings from session log + pending file
# Usage: extract_session_learnings "$SESSION_ID"
# Output: Writes categorized entries to pending.md (appends, deduplicates)
extract_session_learnings() {
    local session_id="$1"
    local session_dir=$(get_session_folder "$session_id")
    local log_file="$session_dir/log.md"
    local pending_file="$session_dir/pending.md"

    if [ ! -f "$log_file" ]; then
        return 0
    fi

    local line_count=$(wc -l < "$log_file" | tr -d ' ')
    # Skip trivial sessions (header only = 6 lines)
    if [ "$line_count" -le 7 ]; then
        return 0
    fi

    # Count significant events from the log
    local edit_count=$(grep -c "Edit:\|Write:" "$log_file" 2>/dev/null || echo "0")
    local error_count=$(grep -c "Error" "$log_file" 2>/dev/null || echo "0")
    local bash_count=$(grep -c "Bash:" "$log_file" 2>/dev/null || echo "0")

    # Extract edited file list (unique paths, no Perl regex for macOS compat)
    local edited_files=$(grep -o '\(Edit\|Write\): [^ ]*' "$log_file" 2>/dev/null | sed 's/^[^:]*: //' | sort -u || true)

    # Build extraction summary
    if [ -n "$edited_files" ] || [ "$error_count" -gt 0 ]; then
        # Only add summary if pending doesn't already have one for this session
        if ! grep -q "Session Summary" "$pending_file" 2>/dev/null; then
            cat >> "$pending_file" << EXTRACT_EOF

## Session Summary

- **Edits:** $edit_count files
- **Errors:** $error_count
- **Commands:** $bash_count

### Files modified:
$(echo "$edited_files" | head -20 | sed 's/^/- /')

EXTRACT_EOF
        fi
    fi

    return 0
}

# ============================================================================
# CONSOLIDATION — Merge learnings into .quoth/*.md type files
# ============================================================================

# Consolidate session learnings into permanent local files
# Usage: consolidate_to_local "$SESSION_ID"
consolidate_to_local() {
    local session_id="$1"
    local session_dir=$(get_session_folder "$session_id")
    local pending_file="$session_dir/pending.md"

    # Nothing to consolidate if no pending learnings
    if [ ! -f "$pending_file" ] || [ ! -s "$pending_file" ]; then
        return 0
    fi

    # Read pending entries and route to appropriate type files
    local current_type=""
    local current_content=""

    while IFS= read -r line; do
        # Detect type headers: ## errors, ## patterns, ## decisions, ## knowledge
        if echo "$line" | grep -qiE '^## (errors|patterns|decisions|knowledge|Session Summary)'; then
            # Flush previous type
            if [ -n "$current_type" ] && [ -n "$current_content" ]; then
                append_to_type_file "$current_type" "$current_content" "$session_id"
            fi

            # Detect new type
            local header=$(echo "$line" | sed 's/^## //' | tr '[:upper:]' '[:lower:]')
            case "$header" in
                errors) current_type="errors" ;;
                patterns) current_type="patterns" ;;
                decisions) current_type="decisions" ;;
                knowledge) current_type="knowledge" ;;
                session\ summary) current_type="" ;;  # Skip session summaries (metadata noise)
                *) current_type="knowledge" ;;
            esac
            current_content=""
        else
            # Accumulate content
            if [ -n "$current_type" ]; then
                current_content="${current_content}${line}
"
            fi
        fi
    done < "$pending_file"

    # Flush last type
    if [ -n "$current_type" ] && [ -n "$current_content" ]; then
        append_to_type_file "$current_type" "$current_content" "$session_id"
    fi

    return 0
}

# ============================================================================
# REMOTE SYNC — Background push of local memory to Quoth server
# ============================================================================

# Trigger background sync of .quoth/*.md to remote Quoth memory
# This is fire-and-forget: if MCP server is unreachable, we silently skip
# Usage: trigger_remote_sync
trigger_remote_sync() {
    # Build a combined snapshot of all type files
    local snapshot=""
    for type_file in .quoth/decisions.md .quoth/patterns.md .quoth/errors.md .quoth/knowledge.md; do
        if [ -f "$type_file" ] && [ -s "$type_file" ]; then
            local basename=$(basename "$type_file" .md)
            local content=$(cat "$type_file" | head -100)  # Cap at 100 lines
            snapshot="${snapshot}--- ${basename} ---\n${content}\n\n"
        fi
    done

    if [ -z "$snapshot" ]; then
        return 0
    fi

    # Write sync marker so we don't re-sync unchanged content
    local checksum=$(echo "$snapshot" | (md5sum 2>/dev/null || md5 -q) | cut -d' ' -f1)
    local marker_file=".quoth/.last-sync-checksum"

    if [ -f "$marker_file" ]; then
        local last_checksum=$(cat "$marker_file" 2>/dev/null)
        if [ "$checksum" = "$last_checksum" ]; then
            return 0  # No changes since last sync
        fi
    fi

    # Write new checksum
    echo "$checksum" > "$marker_file"

    # Note: Actual MCP sync happens via quoth-memory subagent invocation
    # The stop hook will add sync instruction to its output context
    return 0
}

# Check if sync is needed (content changed since last sync)
sync_needed() {
    local snapshot=""
    for type_file in .quoth/decisions.md .quoth/patterns.md .quoth/errors.md .quoth/knowledge.md; do
        if [ -f "$type_file" ] && [ -s "$type_file" ]; then
            snapshot="${snapshot}$(cat "$type_file")"
        fi
    done

    if [ -z "$snapshot" ]; then
        return 1
    fi

    local checksum=$(echo "$snapshot" | (md5sum 2>/dev/null || md5 -q) | cut -d' ' -f1)
    local marker_file=".quoth/.last-sync-checksum"

    if [ -f "$marker_file" ]; then
        local last_checksum=$(cat "$marker_file" 2>/dev/null)
        if [ "$checksum" = "$last_checksum" ]; then
            return 1  # No changes
        fi
    fi

    return 0  # Sync needed
}
