#!/usr/bin/env bash
# Quoth Plugin - SubagentStop Hook
# Logs agent outcome to trajectory JSONL (fire-and-forget)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

main() {
  read_hook_input || true

  local input="${_HOOK_INPUT}"
  local session_id
  session_id=$(get_or_create_session_id)

  # Extract fields from hook input
  local agent_name=""
  local outcome=""
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  if command -v jq >/dev/null 2>&1; then
    agent_name=$(echo "${input}" | jq -r '.agent_name // .agentName // "unknown"' 2>/dev/null || echo "unknown")
    outcome=$(echo "${input}" | jq -r '.outcome // "unknown"' 2>/dev/null || echo "unknown")
  fi

  # Build trajectory entry
  local project_dir="${PWD}"
  local entry
  entry=$(printf '{"ts":"%s","session":"%s","event":"agent_stop","agent":"%s","outcome":"%s","project":"%s"}' \
    "${ts}" "${session_id}" "${agent_name}" "${outcome}" "${project_dir}")

  # Append to trajectory file (non-blocking)
  append_trajectory "${entry}"
  log_debug "Logged trajectory: ${entry}"

  output_empty
}

main "$@"
exit 0  # ALWAYS exit 0
