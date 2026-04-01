#!/usr/bin/env bash
# Quoth Plugin - Shared hook utilities

QUOTH_HOME="${HOME}/.quoth"
QUOTH_TRAJECTORIES="${QUOTH_HOME}/trajectories"
QUOTH_DAEMON_PID="${QUOTH_HOME}/daemon.pid"
QUOTH_DAEMON_LOG="${QUOTH_HOME}/daemon.log"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# Ensure quoth home exists
mkdir -p "${QUOTH_HOME}" "${QUOTH_TRAJECTORIES}" || true

log_debug() {
  if [ "${QUOTH_DEBUG:-}" = "true" ]; then
    echo "[quoth-debug] $1" >&2
  fi
}

# Read stdin (Claude Code sends hook input via stdin)
_HOOK_INPUT=""
read_hook_input() {
  _HOOK_INPUT=$(cat)
  return 0
}

output_system_message() {
  local msg="$1"
  printf '%s' "$msg"
}

output_empty() {
  return 0
}

# Append one JSON line to the current session's trajectory file
# Usage: append_trajectory '{"event":"agent_stop","agent":"test-healer",...}'
append_trajectory() {
  local entry="$1"
  local session_id="${QUOTH_SESSION_ID:-unknown}"
  local traj_file="${QUOTH_TRAJECTORIES}/${session_id}.jsonl"
  echo "${entry}" >> "${traj_file}" 2>/dev/null || true
}

# Get or create session ID (persisted for the session)
get_or_create_session_id() {
  local id_file="${QUOTH_HOME}/current_session"
  if [ -f "${id_file}" ]; then
    cat "${id_file}"
  else
    local new_id
    new_id="session-$(date +%s)-$$"
    echo "${new_id}" > "${id_file}"
    echo "${new_id}"
  fi
}

clear_session_id() {
  rm -f "${QUOTH_HOME}/current_session"
}

# Check if daemon is running
daemon_is_running() {
  if [ ! -f "${QUOTH_DAEMON_PID}" ]; then
    return 1
  fi
  local pid
  pid=$(cat "${QUOTH_DAEMON_PID}" 2>/dev/null)
  [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null
}

# Start daemon as detached background process
start_daemon() {
  local daemon_js="${PLUGIN_ROOT}/daemon/daemon.js"
  if [ ! -f "${daemon_js}" ]; then
    log_debug "daemon.js not found at ${daemon_js}"
    return 0
  fi
  QUOTH_HOME="${QUOTH_HOME}" nohup node "${daemon_js}" \
    >> "${QUOTH_DAEMON_LOG}" 2>&1 &
  local daemon_pid=$!
  echo "${daemon_pid}" > "${QUOTH_DAEMON_PID}"
  log_debug "Daemon started with PID ${daemon_pid}"
}

# Call quoth-learning MCP tool (fire-and-forget)
call_learning_tool() {
  local tool_name="$1"
  local args_json="$2"
  # Fire and forget — never wait, never fail Claude
  (claude mcp call quoth-learning "${tool_name}" "${args_json}" \
    >> "${QUOTH_HOME}/mcp-calls.log" 2>&1) &
}

# Send SIGUSR1 to daemon for immediate processing
signal_daemon_flush() {
  if daemon_is_running; then
    local pid
    pid=$(cat "${QUOTH_DAEMON_PID}")
    kill -USR1 "${pid}" 2>/dev/null || true
    log_debug "Sent SIGUSR1 to daemon PID ${pid}"
  fi
}

# Get top patterns as context string (for injection)
get_top_patterns_context() {
  local limit="${1:-5}"
  local result
  result=$(claude mcp call quoth-learning quoth_top_patterns \
    "{\"limit\":${limit}}" 2>/dev/null) || true
  echo "${result}"
}
