---
name: learn
description: Trigger immediate pattern consolidation from recent trajectories. Use when asked to run learning, consolidate patterns, or process recent agent logs.
---

# Quoth Manual Consolidation

Trigger immediate processing of any queued trajectory entries.

1. Check daemon status: `quoth_daemon_status({})`
   - If not running: inform user and suggest restarting Claude Code session
   - If running: proceed

2. Signal daemon by sending SIGUSR1:
   ```bash
   pid=$(cat ~/.quoth/daemon.pid)
   kill -USR1 $pid
   ```

3. Wait 5 seconds, then show updated pattern library via `quoth_top_patterns({ limit: 10 })`

4. Report: how many patterns were updated, any new patterns added, any patterns archived
