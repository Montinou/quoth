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
