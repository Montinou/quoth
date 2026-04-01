#!/usr/bin/env bash
# Quoth Plugin - SessionStart Hook
# Ensures daemon is running; injects top patterns into context

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

main() {
  read_hook_input || true

  # Ensure daemon is running (start if dead/missing)
  if ! daemon_is_running; then
    log_debug "Daemon not running, starting..."
    start_daemon
    sleep 0.5  # brief wait for PID file to be written
  fi

  # Create/restore session ID
  local session_id
  session_id=$(get_or_create_session_id)
  log_debug "Session: ${session_id}"

  # Get top patterns for context injection (non-blocking — if it fails, we just skip)
  local patterns_context=""
  if daemon_is_running; then
    patterns_context=$(get_top_patterns_context 5 2>/dev/null) || true
  fi

  # Build context message
  local message="[Quoth] Learning daemon active."
  if [ -n "${patterns_context}" ]; then
    message="${message}

Top learned patterns available:
${patterns_context}"
  fi

  output_system_message "${message}"
}

main "$@"
exit 0  # ALWAYS exit 0
