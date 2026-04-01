#!/usr/bin/env bash
# Quoth Plugin - SubagentStart Hook
# Injects top relevant patterns into the agent's starting context

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

main() {
  read_hook_input || true

  # Extract agent name from hook input
  local agent_name=""
  if command -v jq >/dev/null 2>&1; then
    agent_name=$(echo "${_HOOK_INPUT}" | jq -r '.agent_name // .agentName // ""' 2>/dev/null || echo "")
  fi

  # Get top patterns — fire off silently, inject if available
  local patterns=""
  patterns=$(claude mcp call quoth-learning quoth_top_patterns '{"limit":3}' 2>/dev/null) || true

  if [ -n "${patterns}" ] && [ "${patterns}" != "null" ]; then
    output_system_message "[Quoth] Learned patterns for this task:
${patterns}

Apply these patterns where relevant."
  else
    output_empty
  fi
}

main "$@"
exit 0  # ALWAYS exit 0
