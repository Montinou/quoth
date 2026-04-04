---
description: "Trigger manual pattern consolidation from recent trajectories"
---

Use the quoth_daemon_status MCP tool to check if the daemon is running.

If running, send SIGUSR1 to trigger immediate processing by running:
`kill -USR1 $(cat ~/.quoth/daemon.pid)`

Then use quoth_top_patterns to show the latest patterns after a 3-second wait.

If not running, tell the user to start the daemon. The daemon path is relative to the plugin root:
`node "${CLAUDE_PLUGIN_ROOT}/../daemon/daemon.js" &`
