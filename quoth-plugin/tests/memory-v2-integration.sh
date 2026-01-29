#!/usr/bin/env bash
# Quoth Memory v2.0 - Integration Tests
# Run: bash quoth-plugin/tests/memory-v2-integration.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$SCRIPT_DIR/../.claude-plugin"

echo "=== Quoth Memory v2.0 Integration Tests ==="
echo ""

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Test helper
test_pass() {
    echo "  PASS: $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

test_fail() {
    echo "  FAIL: $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

# ============================================================================
# Test 1: Library syntax validation
# ============================================================================
echo "--- Test 1: Library Syntax Validation ---"

if bash -n "$PLUGIN_DIR/lib/memory-schema.sh" 2>/dev/null; then
    test_pass "memory-schema.sh syntax valid"
else
    test_fail "memory-schema.sh syntax invalid"
fi

if bash -n "$PLUGIN_DIR/lib/config-schema.sh" 2>/dev/null; then
    test_pass "config-schema.sh syntax valid"
else
    test_fail "config-schema.sh syntax invalid"
fi

if bash -n "$PLUGIN_DIR/hooks/lib/common.sh" 2>/dev/null; then
    test_pass "common.sh syntax valid"
else
    test_fail "common.sh syntax invalid"
fi

# ============================================================================
# Test 2: Hook syntax validation
# ============================================================================
echo ""
echo "--- Test 2: Hook Syntax Validation ---"

# Core v2 hooks
for hook in session-start pre-tool-gate post-tool-log subagent-start subagent-stop stop; do
    if [ -f "$PLUGIN_DIR/hooks/${hook}.sh" ]; then
        if bash -n "$PLUGIN_DIR/hooks/${hook}.sh" 2>/dev/null; then
            test_pass "${hook}.sh syntax valid"
        else
            test_fail "${hook}.sh syntax invalid"
        fi
    else
        test_fail "${hook}.sh not found"
    fi
done

# Additional hooks
for hook in user-prompt post-quoth-tool pre-edit-write; do
    if [ -f "$PLUGIN_DIR/hooks/${hook}.sh" ]; then
        if bash -n "$PLUGIN_DIR/hooks/${hook}.sh" 2>/dev/null; then
            test_pass "${hook}.sh syntax valid"
        else
            test_fail "${hook}.sh syntax invalid"
        fi
    else
        echo "  SKIP: ${hook}.sh not present (optional)"
    fi
done

# ============================================================================
# Test 3: JSON validation
# ============================================================================
echo ""
echo "--- Test 3: JSON Validation ---"

if python3 -m json.tool "$PLUGIN_DIR/hooks/hooks.json" > /dev/null 2>&1; then
    test_pass "hooks.json valid JSON"
else
    test_fail "hooks.json invalid JSON"
fi

if python3 -m json.tool "$PLUGIN_DIR/plugin.json" > /dev/null 2>&1; then
    test_pass "plugin.json valid JSON"
else
    test_fail "plugin.json invalid JSON"
fi

# ============================================================================
# Test 4: Local folder creation
# ============================================================================
echo ""
echo "--- Test 4: Local Folder Creation ---"

# Create temp test directory
TEST_DIR=$(mktemp -d)
pushd "$TEST_DIR" > /dev/null

# Source libraries
source "$PLUGIN_DIR/lib/memory-schema.sh"
source "$PLUGIN_DIR/lib/config-schema.sh"

# Test folder creation
init_quoth_local_folder
if [ -d ".quoth" ] && [ -f ".quoth/decisions.md" ]; then
    test_pass "init_quoth_local_folder creates structure"
else
    test_fail "init_quoth_local_folder failed"
fi

# Verify all type files created
for type in decisions patterns errors knowledge; do
    if [ -f ".quoth/${type}.md" ]; then
        test_pass "${type}.md created"
    else
        test_fail "${type}.md not created"
    fi
done

# ============================================================================
# Test 5: Config operations
# ============================================================================
echo ""
echo "--- Test 5: Config Operations ---"

# Test config creation
create_default_config "test-project-id" "test-project" "reminder"
if [ -f ".quoth/config.json" ]; then
    test_pass "create_default_config creates config.json"
else
    test_fail "create_default_config failed"
fi

# Test config reading
strictness=$(get_strictness)
if [ "$strictness" = "reminder" ]; then
    test_pass "get_strictness returns correct value"
else
    test_fail "get_strictness returned: $strictness (expected: reminder)"
fi

# Test read_config_value
project_id=$(read_config_value "project_id")
if [ "$project_id" = "test-project-id" ]; then
    test_pass "read_config_value reads project_id correctly"
else
    test_fail "read_config_value returned: $project_id (expected: test-project-id)"
fi

# Test config_exists
if config_exists; then
    test_pass "config_exists returns true when config exists"
else
    test_fail "config_exists returned false"
fi

# Test update_config_value
update_config_value "strictness" "blocking"
new_strictness=$(get_strictness)
if [ "$new_strictness" = "blocking" ]; then
    test_pass "update_config_value updates strictness correctly"
else
    test_fail "update_config_value failed: $new_strictness (expected: blocking)"
fi

# Test mode checks
if is_blocking_mode; then
    test_pass "is_blocking_mode returns true when strictness=blocking"
else
    test_fail "is_blocking_mode returned false"
fi

# ============================================================================
# Test 6: Session folder creation
# ============================================================================
echo ""
echo "--- Test 6: Session Folder Operations ---"

# Test session folder creation
session_dir=$(init_session_folder "test-session-123")
if [ -d "$session_dir" ] && [ -f "$session_dir/log.md" ]; then
    test_pass "init_session_folder creates session structure"
else
    test_fail "init_session_folder failed"
fi

# Verify session files
for file in context.md log.md pending.md; do
    if [ -f "$session_dir/$file" ]; then
        test_pass "session $file created"
    else
        test_fail "session $file not created"
    fi
done

# Test get_session_folder
retrieved_dir=$(get_session_folder "test-session-123")
if [ "$retrieved_dir" = "$session_dir" ]; then
    test_pass "get_session_folder returns correct path"
else
    test_fail "get_session_folder mismatch: $retrieved_dir vs $session_dir"
fi

# Test session_folder_exists
if session_folder_exists "test-session-123"; then
    test_pass "session_folder_exists returns true for existing session"
else
    test_fail "session_folder_exists returned false"
fi

if ! session_folder_exists "nonexistent-session"; then
    test_pass "session_folder_exists returns false for nonexistent session"
else
    test_fail "session_folder_exists returned true for nonexistent"
fi

# ============================================================================
# Test 7: Session log operations
# ============================================================================
echo ""
echo "--- Test 7: Session Log Operations ---"

# Test append_session_log
append_session_log "test-session-123" "Test log entry"
if grep -q "Test log entry" "$session_dir/log.md"; then
    test_pass "append_session_log writes to log"
else
    test_fail "append_session_log failed to write"
fi

# Test append_tool_log
append_tool_log "test-session-123" "Edit" "/path/to/file.ts" "success"
if grep -q "Edit: /path/to/file.ts" "$session_dir/log.md"; then
    test_pass "append_tool_log writes tool action"
else
    test_fail "append_tool_log failed to write"
fi

# Test add_pending_learning
add_pending_learning "test-session-123" "decision" "Use factory pattern for tests"
if grep -q "Use factory pattern for tests" "$session_dir/pending.md"; then
    test_pass "add_pending_learning writes pending entry"
else
    test_fail "add_pending_learning failed to write"
fi

# ============================================================================
# Test 8: Common.sh helper functions
# ============================================================================
echo ""
echo "--- Test 8: Common.sh Helper Functions ---"

# Source common.sh (which sources the other libs)
source "$PLUGIN_DIR/hooks/lib/common.sh"

# Test file category detection
if [ "$(detect_file_category 'src/components/Button.tsx')" = "component" ]; then
    test_pass "detect_file_category identifies component"
else
    test_fail "detect_file_category failed for component"
fi

if [ "$(detect_file_category 'src/api/users/route.ts')" = "api" ]; then
    test_pass "detect_file_category identifies api"
else
    test_fail "detect_file_category failed for api"
fi

if [ "$(detect_file_category 'src/lib/utils.ts')" = "service" ]; then
    test_pass "detect_file_category identifies service"
else
    test_fail "detect_file_category failed for service"
fi

if [ "$(detect_file_category 'src/components/Button.test.tsx')" = "test" ]; then
    test_pass "detect_file_category identifies test"
else
    test_fail "detect_file_category failed for test"
fi

# Test should_skip_file
if should_skip_file "package-lock.json"; then
    test_pass "should_skip_file skips lock files"
else
    test_fail "should_skip_file failed for lock file"
fi

if ! should_skip_file "src/index.ts"; then
    test_pass "should_skip_file allows regular files"
else
    test_fail "should_skip_file incorrectly skipped regular file"
fi

# Test build_search_query
query=$(build_search_query "test")
if [ -n "$query" ]; then
    test_pass "build_search_query returns query for test category"
else
    test_fail "build_search_query returned empty for test"
fi

# ============================================================================
# Test 9: JSON output helpers
# ============================================================================
echo ""
echo "--- Test 9: JSON Output Helpers ---"

# Test json_escape
escaped=$(json_escape 'Hello "World"')
if [[ "$escaped" == *'\"'* ]]; then
    test_pass "json_escape escapes quotes"
else
    test_fail "json_escape failed to escape quotes"
fi

# Test output_context format
context_output=$(output_context "Test context message")
if echo "$context_output" | python3 -m json.tool > /dev/null 2>&1; then
    test_pass "output_context produces valid JSON"
else
    test_fail "output_context produces invalid JSON"
fi

# Test output_empty format
empty_output=$(output_empty)
if [ "$empty_output" = "{}" ]; then
    test_pass "output_empty returns empty JSON object"
else
    test_fail "output_empty returned: $empty_output"
fi

# ============================================================================
# Cleanup
# ============================================================================
popd > /dev/null
rm -rf "$TEST_DIR"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "=== Test Summary ==="
echo "Passed: $TESTS_PASSED"
echo "Failed: $TESTS_FAILED"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo "All tests passed!"
    exit 0
else
    echo "Some tests failed"
    exit 1
fi
