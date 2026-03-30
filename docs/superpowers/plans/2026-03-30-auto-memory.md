# Auto-Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Quoth memory seamless — users install the plugin and their agent's memory is automatically captured, consolidated, synced, and injected without any manual intervention.

**Architecture:** Replace the current "ask the user at session end" flow with a fully automatic pipeline: session activity is captured → learnings auto-extracted on session end → local .quoth/*.md files auto-updated → changes synced to remote Quoth server in the background → next session auto-injects relevant context from both local and remote. Zero user friction.

**Tech Stack:** Bash hooks (plugin lifecycle), Quoth MCP tools (remote sync), quoth-memory subagent (extraction + injection)

---

## Current State & Problems

### What exists:
- **Server**: Full memory CRUD + HNSW semantic search + hourly cron consolidation (decay, promote, cleanup, drift)
- **Plugin hooks**: SessionStart (init + context hint), PostToolUse (action logging), Stop (asks user to review)
- **Local storage**: `.quoth/{decisions,patterns,errors,knowledge}.md` + `sessions/{id}/log.md`
- **quoth-memory subagent**: Can search, read, log, and promote — but only when explicitly invoked

### What's broken:
1. **Stop hook asks 4-choice question** → most users skip → learnings lost
2. **No auto-extraction** → session logs pile up but never become memories
3. **No auto-sync** → local .quoth/ files diverge from remote, remote stays empty
4. **No auto-inject from remote** → SessionStart only reads local files, ignores server memory
5. **Sessions never compacted** → old sessions cleaned after 7 days, learnings gone

### Design principles:
- **Zero friction** — memory works without user thinking about it
- **Local-first** — .quoth/ files are the source of truth, remote is backup + cross-project
- **Fail-safe** — if MCP server is down, everything still works locally
- **No new dependencies** — uses existing quoth-memory subagent + MCP tools
- **Respect strictness** — `off` mode disables everything, `reminder` auto-saves silently, `blocking` auto-saves + validates

---

## File Structure

### Modified files:
| File | Change |
|------|--------|
| `quoth-plugin/hooks/stop.sh` | Replace user prompt with auto-extract + auto-sync trigger |
| `quoth-plugin/hooks/session-start.sh` | Add remote memory retrieval + richer context injection |
| `quoth-plugin/hooks/post-tool-log.sh` | Add significance detection (tag important events) |
| `quoth-plugin/agents/quoth-memory.md` | Add auto-extract and auto-sync responsibilities |
| `quoth-plugin/lib/config-schema.sh` | Add `auto_memory` config field |
| `quoth-plugin/lib/memory-schema.sh` | Add session consolidation functions |

### New files:
| File | Purpose |
|------|---------|
| `quoth-plugin/hooks/lib/auto-memory.sh` | Auto-memory helper functions (extract, consolidate, sync) |

---

## Task 1: Add auto_memory config support

**Files:**
- Modify: `quoth-plugin/lib/config-schema.sh`

- [ ] **Step 1: Read the current config-schema.sh**

Already read above. The config has `strictness`, `types`, and `gates`. We need to add `auto_memory` as a top-level boolean.

- [ ] **Step 2: Add auto_memory config helpers**

Add to `config-schema.sh`:

```bash
# Check if auto_memory is enabled (default: true for non-off modes)
is_auto_memory_enabled() {
    if is_off_mode; then
        return 1
    fi
    # Check explicit config value
    if [ -f "$QUOTH_CONFIG_FILE" ]; then
        if grep -q '"auto_memory"[[:space:]]*:[[:space:]]*false' "$QUOTH_CONFIG_FILE" 2>/dev/null; then
            return 1
        fi
    fi
    # Default: enabled
    return 0
}
```

- [ ] **Step 3: Update create_default_config to include auto_memory**

Add `"auto_memory": true` to the default config JSON template after the `gates` block.

- [ ] **Step 4: Test config detection**

Run manually:
```bash
cd /home/lord_montino/projects/agents-tools/quoth
source quoth-plugin/lib/config-schema.sh
is_auto_memory_enabled && echo "enabled" || echo "disabled"
```
Expected: `enabled` (since .quoth/config.json exists and strictness is blocking)

- [ ] **Step 5: Commit**

```bash
git add quoth-plugin/lib/config-schema.sh
git commit -m "feat(plugin): add auto_memory config support"
```

---

## Task 2: Add significance detection to post-tool-log

**Files:**
- Modify: `quoth-plugin/hooks/post-tool-log.sh`

The current hook logs every tool use to `log.md`. For auto-memory, we need to **tag significant events** so the extraction step knows what matters. Significant = errors, file writes to non-trivial paths, architectural decisions.

- [ ] **Step 1: Add significance tagging to post-tool-log.sh**

After the existing `case "$tool_name"` logging, add a significance detector that appends to `pending.md` when events are noteworthy:

```bash
# After the existing case block, before output_empty:

# Tag significant events for auto-extraction
if [ "$result" = "Error" ]; then
    add_pending_learning "$SESSION_ID" "errors" "Error during $tool_name: $(echo "$INPUT" | head -c 200)"
fi

# Tag file edits to important paths
case "$tool_name" in
    Edit|Write)
        local file_path=$(extract_file_path "$INPUT")
        if [ -n "$file_path" ]; then
            case "$file_path" in
                */api/*|*/lib/*|*/db/*|*.config.*|*/middleware*)
                    add_pending_learning "$SESSION_ID" "patterns" "$tool_name: $file_path"
                    ;;
            esac
        fi
        ;;
esac
```

- [ ] **Step 2: Test with a mock tool event**

```bash
cd /home/lord_montino/projects/agents-tools/quoth
export CLAUDE_SESSION_ID="test-automem-$(date +%s)"
source quoth-plugin/lib/memory-schema.sh
init_quoth_local_folder
init_session_folder "$CLAUDE_SESSION_ID"
echo '{"tool_name":"Edit","file_path":"src/lib/auth/middleware.ts"}' | bash quoth-plugin/hooks/post-tool-log.sh
cat ".quoth/sessions/$CLAUDE_SESSION_ID/pending.md"
```
Expected: pending.md has an entry for "Edit: src/lib/auth/middleware.ts"

- [ ] **Step 3: Commit**

```bash
git add quoth-plugin/hooks/post-tool-log.sh
git commit -m "feat(plugin): tag significant events for auto-extraction"
```

---

## Task 3: Create auto-memory helper library

**Files:**
- Create: `quoth-plugin/hooks/lib/auto-memory.sh`

This is the core of the feature. Three functions:
1. `extract_session_learnings` — reads session log + pending, produces structured learnings
2. `consolidate_to_local` — merges learnings into .quoth/*.md type files
3. `trigger_remote_sync` — fires a background MCP call to sync local → remote

- [ ] **Step 1: Write auto-memory.sh**

```bash
#!/usr/bin/env bash
# Quoth Auto-Memory v1.0
# Automatic extraction, consolidation, and sync of session learnings
#
# Usage: source this file from hooks that need auto-memory functions

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
```

- [ ] **Step 2: Test extraction function**

```bash
cd /home/lord_montino/projects/agents-tools/quoth
source quoth-plugin/lib/memory-schema.sh
source quoth-plugin/hooks/lib/auto-memory.sh
SESSION_ID="test-extract-$(date +%s)"
init_quoth_local_folder
init_session_folder "$SESSION_ID"
# Simulate a session log with edits
cat >> ".quoth/sessions/$SESSION_ID/log.md" << 'EOF'

### 10:00:00 - Edit: src/lib/auth/middleware.ts
- **Result:** OK

### 10:01:00 - Bash: npm test (Error)
- **Result:** Error

### 10:02:00 - Edit: src/lib/auth/types.ts
- **Result:** OK
EOF
extract_session_learnings "$SESSION_ID"
echo "=== pending.md ==="
cat ".quoth/sessions/$SESSION_ID/pending.md"
```
Expected: pending.md has a Session Summary with 2 edits, 1 error, file list

- [ ] **Step 3: Test consolidation function**

```bash
# Add typed pending entries
cat >> ".quoth/sessions/$SESSION_ID/pending.md" << 'EOF'

## errors

Bash npm test failed with missing module error

## patterns

Auth middleware uses JWT verification at boundary
EOF
consolidate_to_local "$SESSION_ID"
echo "=== errors.md ==="
tail -5 .quoth/errors.md
echo "=== patterns.md ==="
tail -5 .quoth/patterns.md
```
Expected: entries appended to errors.md and patterns.md with session source

- [ ] **Step 4: Clean up test artifacts**

```bash
rm -rf ".quoth/sessions/test-extract-*"
```

- [ ] **Step 5: Commit**

```bash
git add quoth-plugin/hooks/lib/auto-memory.sh
git commit -m "feat(plugin): add auto-memory helper library"
```

---

## Task 4: Rewrite stop hook for automatic extraction + consolidation

**Files:**
- Modify: `quoth-plugin/hooks/stop.sh`

Replace the 4-choice user prompt with automatic extraction → consolidation → sync trigger. Silent, fast, reliable.

- [ ] **Step 1: Read current stop.sh**

Already read. Key change: remove the `promotion_msg` user prompt and replace with auto-pipeline.

- [ ] **Step 2: Rewrite stop.sh**

```bash
#!/usr/bin/env bash
# Quoth Memory v2.0 - Stop Hook
# Auto-extracts, consolidates, and syncs session learnings

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# Source auto-memory helpers
if [ -f "$SCRIPT_DIR/lib/auto-memory.sh" ]; then
    source "$SCRIPT_DIR/lib/auto-memory.sh"
fi

# Read input from stdin
INPUT=$(cat)

SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"

main() {
    # Skip if no config
    if ! config_exists; then
        cleanup_session
        output_empty
        exit 0
    fi

    # Skip in off mode
    if is_off_mode; then
        cleanup_session
        output_empty
        exit 0
    fi

    # Skip if auto_memory is disabled
    if ! is_auto_memory_enabled; then
        cleanup_session
        output_empty
        exit 0
    fi

    # Check if session had meaningful activity
    local has_activity=false
    local session_dir=$(get_session_folder "$SESSION_ID")
    local log_file="$session_dir/log.md"
    local pending_file="$session_dir/pending.md"

    if [ -f "$log_file" ]; then
        local line_count=$(wc -l < "$log_file" | tr -d ' ')
        if [ "$line_count" -gt 7 ]; then
            has_activity=true
        fi
    fi

    if [ -f "$pending_file" ] && [ -s "$pending_file" ]; then
        has_activity=true
    fi

    local total_ops=$(get_total_operations)
    if [ "$total_ops" -gt 5 ] 2>/dev/null; then
        has_activity=true
    fi

    if [ "$has_activity" = true ]; then
        # 1. Extract learnings from session log
        extract_session_learnings "$SESSION_ID" 2>/dev/null || true

        # 2. Consolidate into .quoth/*.md type files
        consolidate_to_local "$SESSION_ID" 2>/dev/null || true

        # 3. Check if remote sync is needed
        if sync_needed 2>/dev/null; then
            trigger_remote_sync 2>/dev/null || true
            # Tell Claude to sync via quoth-memory subagent
            output_context "**[Auto-Memory]** Session learnings saved to .quoth/ files. Use \`quoth-memory\` to sync to remote if MCP is connected."
        else
            output_context "**[Auto-Memory]** Session learnings saved to local .quoth/ files."
        fi
    else
        output_empty
    fi

    cleanup_session
}

main
```

- [ ] **Step 3: Test the new stop hook**

```bash
cd /home/lord_montino/projects/agents-tools/quoth
export CLAUDE_SESSION_ID="test-stop-$(date +%s)"
source quoth-plugin/lib/memory-schema.sh
init_quoth_local_folder
init_session_folder "$CLAUDE_SESSION_ID"
# Simulate activity
for i in $(seq 1 8); do
    echo "### 10:0${i}:00 - Edit: src/file${i}.ts" >> ".quoth/sessions/$CLAUDE_SESSION_ID/log.md"
done
echo '{"tool_name":"stop"}' | bash quoth-plugin/hooks/stop.sh
echo "=== knowledge.md tail ==="
tail -10 .quoth/knowledge.md
rm -rf ".quoth/sessions/test-stop-*"
```
Expected: knowledge.md gets a Session Summary entry, output is the auto-memory context message

- [ ] **Step 4: Commit**

```bash
git add quoth-plugin/hooks/stop.sh
git commit -m "feat(plugin): auto-extract and consolidate on session end"
```

---

## Task 5: Enhance session-start with remote memory injection

**Files:**
- Modify: `quoth-plugin/hooks/session-start.sh`

Currently loads local .quoth/*.md files (first 10 lines each). Enhance to also suggest quoth-memory for remote context retrieval based on the working directory.

- [ ] **Step 1: Enhance the context injection in session-start.sh**

After the existing local file snapshot block (line ~63), add a remote context hint:

```bash
        # 5. Suggest remote context retrieval (non-blocking, async via subagent)
        local remote_hint=""
        if [ -n "$project_id" ]; then
            remote_hint=" Remote memory available — \`quoth-memory\` will auto-search for relevant context."
        fi
```

Then update the `context_msg` to include `remote_hint`:

```bash
        local context_msg="**Quoth Memory v2 Active** - Strictness: $strictness - Session: $SESSION_ID - Local: .quoth/ ($(wc -l .quoth/*.md 2>/dev/null | tail -1 | awk '{print $1}') lines)${remote_hint}"
```

- [ ] **Step 2: Add auto_memory status to context**

After the memory_instruction block, add:

```bash
        if is_auto_memory_enabled; then
            context_msg="$context_msg **Auto-memory ON** — learnings saved automatically at session end."
        fi
```

- [ ] **Step 3: Test session-start**

```bash
cd /home/lord_montino/projects/agents-tools/quoth
export CLAUDE_SESSION_ID="test-start-$(date +%s)"
echo '{}' | bash quoth-plugin/hooks/session-start.sh
rm -rf ".quoth/sessions/test-start-*" /tmp/quoth/session_test-start-*
```
Expected: Output includes "Auto-memory ON" and line count of local files

- [ ] **Step 4: Commit**

```bash
git add quoth-plugin/hooks/session-start.sh
git commit -m "feat(plugin): enhanced session-start with auto-memory status"
```

---

## Task 6: Update quoth-memory subagent for auto-sync

**Files:**
- Modify: `quoth-plugin/agents/quoth-memory.md`

Add a new responsibility: when invoked with sync instructions, push local .quoth/*.md content to remote via `quoth_memory_store`.

- [ ] **Step 1: Add AUTO-SYNC section to quoth-memory.md**

After the existing "### 4. PROMOTION PROPOSALS" section, add:

```markdown
### 5. AUTO-SYNC (Background, triggered by stop hook)

When invoked with a sync instruction (e.g., "sync local memory to remote"):
- Read each `.quoth/*.md` file (decisions, patterns, errors, knowledge)
- For each file with content beyond the header:
  - Use `quoth_memory_store` with:
    - key: `local/{filename}` (e.g., `local/decisions`)
    - namespace: `auto-memory`
    - value: file content (first 2000 chars)
    - tags: `["auto-sync", "{type}"]`
    - metadata: `{ "source": "auto-memory", "synced_at": "ISO timestamp" }`
- This is fire-and-forget — if MCP server is unreachable, skip silently
- Never prompt the user about sync operations
```

- [ ] **Step 2: Update IMPORTANT Rules section**

Add rule:
```markdown
6. **Auto-sync is silent** - Never ask user permission for auto-memory sync operations
```

- [ ] **Step 3: Commit**

```bash
git add quoth-plugin/agents/quoth-memory.md
git commit -m "feat(plugin): add auto-sync responsibility to quoth-memory agent"
```

---

## Task 7: Source auto-memory.sh from common.sh

**Files:**
- Modify: `quoth-plugin/hooks/lib/common.sh`

The auto-memory functions need to be available to hooks that source common.sh.

- [ ] **Step 1: Add auto-memory.sh source**

After the existing memory-schema.sh and config-schema.sh source lines (around line 12), add:

```bash
if [ -f "$COMMON_SCRIPT_DIR/auto-memory.sh" ]; then
    source "$COMMON_SCRIPT_DIR/auto-memory.sh"
fi
```

Note: `auto-memory.sh` lives in `hooks/lib/`, same as `common.sh`. The `COMMON_SCRIPT_DIR` variable already points there.

- [ ] **Step 2: Verify source chain works**

```bash
cd /home/lord_montino/projects/agents-tools/quoth
source quoth-plugin/hooks/lib/common.sh
type extract_session_learnings 2>/dev/null && echo "OK" || echo "FAIL"
type consolidate_to_local 2>/dev/null && echo "OK" || echo "FAIL"
type sync_needed 2>/dev/null && echo "OK" || echo "FAIL"
```
Expected: All three print "OK"

- [ ] **Step 3: Commit**

```bash
git add quoth-plugin/hooks/lib/common.sh
git commit -m "feat(plugin): wire auto-memory helpers into common.sh"
```

---

## Task 8: Integration test — full session lifecycle

**Files:**
- Create: `quoth-plugin/tests/auto-memory-lifecycle.sh`

End-to-end test: simulate a full session lifecycle and verify memory flows correctly.

- [ ] **Step 1: Write the integration test**

```bash
#!/usr/bin/env bash
# Integration test: auto-memory full lifecycle
# Simulates: session-start → tool activity → stop → verify

set -e

cd "$(dirname "$0")/.."
cd ..  # project root

TEST_SESSION="test-lifecycle-$(date +%s)"
export CLAUDE_SESSION_ID="$TEST_SESSION"

PASS=0
FAIL=0

assert() {
    local desc="$1" result="$2"
    if [ "$result" = "0" ]; then
        echo "  ✓ $desc"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $desc"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== Auto-Memory Lifecycle Test ==="
echo ""

# 1. Session Start
echo "Phase 1: Session Start"
START_OUT=$(echo '{}' | bash quoth-plugin/hooks/session-start.sh 2>/dev/null)
assert "session-start runs without error" "$?"
echo "$START_OUT" | grep -q "Auto-memory ON" 2>/dev/null
assert "context includes auto-memory status" "$?"
test -d ".quoth/sessions/$TEST_SESSION"
assert "session folder created" "$?"

# 2. Simulate tool activity
echo ""
echo "Phase 2: Tool Activity"
for i in 1 2 3 4 5 6; do
    echo '{"tool_name":"Edit","file_path":"src/lib/service'$i'.ts"}' | \
        bash quoth-plugin/hooks/post-tool-log.sh 2>/dev/null
done
echo '{"tool_name":"Bash","command":"npm test"}' | \
    bash quoth-plugin/hooks/post-tool-log.sh 2>/dev/null

LOG=".quoth/sessions/$TEST_SESSION/log.md"
test -f "$LOG"
assert "session log exists" "$?"
LINE_COUNT=$(wc -l < "$LOG" | tr -d ' ')
test "$LINE_COUNT" -gt 7
assert "session log has entries ($LINE_COUNT lines)" "$?"

# 3. Stop — auto-extract + consolidate
echo ""
echo "Phase 3: Stop (auto-extract)"
STOP_OUT=$(echo '{}' | bash quoth-plugin/hooks/stop.sh 2>/dev/null)
assert "stop hook runs without error" "$?"
echo "$STOP_OUT" | grep -q "Auto-Memory" 2>/dev/null
assert "stop output confirms auto-memory" "$?"

# Check that pending.md was processed (extraction ran)
PENDING=".quoth/sessions/$TEST_SESSION/pending.md"
test -f "$PENDING" && test -s "$PENDING"
assert "pending.md has extracted content" "$?"

# 4. Cleanup
rm -rf ".quoth/sessions/$TEST_SESSION" "/tmp/quoth/session_$TEST_SESSION.json" 2>/dev/null

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
exit $FAIL
```

- [ ] **Step 2: Run the test**

```bash
bash quoth-plugin/tests/auto-memory-lifecycle.sh
```
Expected: All assertions pass (0 failures)

- [ ] **Step 3: Commit**

```bash
git add quoth-plugin/tests/auto-memory-lifecycle.sh
git commit -m "test(plugin): add auto-memory lifecycle integration test"
```

---

## Task 9: Update .quoth/config.json with auto_memory field

**Files:**
- Modify: `/home/lord_montino/projects/agents-tools/quoth/.quoth/config.json`

- [ ] **Step 1: Add auto_memory to existing config**

Add `"auto_memory": true` after the `gates` block.

- [ ] **Step 2: Commit**

```bash
git add .quoth/config.json
git commit -m "feat: enable auto_memory in project config"
```

---

## Summary

After all 9 tasks, the auto-memory pipeline is:

```
SessionStart → context injected (local .quoth/*.md + auto-memory status)
    ↓
PostToolUse → significant events tagged to pending.md (errors, edits to key paths)
    ↓
Stop → auto-extract session log → consolidate to .quoth/*.md → sync check
    ↓
Next SessionStart → richer context from accumulated local memory
```

**What users see:** Nothing. Memory just works. Their `.quoth/` files grow smarter over time. No prompts, no choices, no friction.

**What users can configure:** `"auto_memory": false` in `.quoth/config.json` to disable. Or `"strictness": "off"` to disable everything.

**Future iterations (not in this plan):**
- Remote sync via cron (push .quoth/ to server periodically, not just on stop)
- Cross-project memory sharing (org-level namespace)
- Smart deduplication (don't append if entry already exists in type file)
- LLM-powered extraction (use quoth-memory subagent to generate better summaries instead of raw log parsing)
