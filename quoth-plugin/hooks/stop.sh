#!/usr/bin/env bash
# Quoth Plugin - Stop Hook
# Signals daemon to process queued trajectories; clears session ID

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

main() {
  read_hook_input || true

  # Signal daemon for immediate processing (non-blocking)
  signal_daemon_flush

  # Clear session ID so next session gets a fresh one
  clear_session_id

  log_debug "Session ended, daemon signaled"
  output_empty
}

main "$@"
exit 0  # ALWAYS exit 0
