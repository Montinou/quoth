# V2 Rollback Procedure

## Symptoms to watch (first 2 weeks)

| Signal | Threshold | Severity |
|---|---|---|
| Avg cluster confidence | < 40% after 2 weeks | high |
| Judge cost | > $5/day | high |
| Injection latency p95 | > 50ms | medium |
| Net pattern count | +100/day (curation broken) | medium |
| SNIPS ESS | < 10 per cluster after 100 injections | low (variance issue) |

## Emergency rollback (disable V2 entirely)

```bash
# Unset all v2 flags
unset QUOTH_LEARNING_V2
unset QUOTH_V2_INJECTION
unset QUOTH_V2_EXPLORATION
unset QUOTH_V2_JUDGE
unset QUOTH_V2_CURATION

# Restart daemon
kill $(cat ~/.quoth/daemon.pid) 2>/dev/null
sleep 1
nohup node quoth-plugin/daemon/daemon.js > /dev/null 2>&1 &
```

V1 code paths remain intact — nothing else to undo for injection/feedback.

## Restore from pre-v2 backup

If SNIPS posterior updates corrupted cluster stats or quality-gate migration archived too aggressively:

```bash
# List backups
ls -la ~/.quoth/memory.db.pre-v2-*.bak

# Restore most recent
cp ~/.quoth/memory.db.pre-v2-<timestamp>.bak ~/.quoth/memory.db

# Restart daemon
kill $(cat ~/.quoth/daemon.pid) 2>/dev/null
sleep 1
nohup node quoth-plugin/daemon/daemon.js > /dev/null 2>&1 &
```

## Partial rollback

**Keep injection v2, disable judge only:**
```bash
unset QUOTH_V2_JUDGE
# Keep QUOTH_V2_INJECTION, QUOTH_V2_EXPLORATION
```

**Keep everything except curation:**
```bash
unset QUOTH_V2_CURATION
```
This stops retirement/dedup but keeps bandit learning active.

**Drop cluster stats (force full re-cluster on next nightly):**
```bash
sqlite3 ~/.quoth/memory.db "DELETE FROM cluster_stats"
```
Next Phase D (Sun ≥ 03:00 UTC) will rebuild from scratch.

## Diagnostic queries

```bash
# How many v2 injections logged this week?
sqlite3 ~/.quoth/memory.db "
  SELECT COUNT(*) total,
         SUM(CASE WHEN outcome_at IS NOT NULL THEN 1 ELSE 0 END) with_outcome,
         AVG(propensity) avg_prop,
         AVG(reward) avg_reward
  FROM injection_log
  WHERE injected_at > (strftime('%s','now') - 86400*7)*1000
"

# Cluster health
sqlite3 ~/.quoth/memory.db "
  SELECT namespace, COUNT(*) clusters,
         ROUND(AVG(alpha/(alpha+beta)), 3) avg_conf,
         SUM(attempts) total_attempts
  FROM cluster_stats GROUP BY namespace
"

# Judge cost + throughput
sqlite3 ~/.quoth/memory.db "
  SELECT status, COUNT(*) n, SUM(cost_cents) cost
  FROM judge_queue
  WHERE created_at > (strftime('%s','now') - 86400*30)*1000
  GROUP BY status
"

# Retirement audit
sqlite3 ~/.quoth/memory.db "
  SELECT retired_reason, COUNT(*) n
  FROM patterns WHERE retired_at IS NOT NULL
  GROUP BY retired_reason
"
```

## Feature flag reference

| Flag | Enables | Reversible? |
|---|---|---|
| `QUOTH_LEARNING_V2` | All v2 features | Yes (unset) |
| `QUOTH_V2_INJECTION` | Hierarchical TS, injection_log | Yes |
| `QUOTH_V2_EXPLORATION` | 10% random slot | Yes |
| `QUOTH_V2_JUDGE` | LLM-as-judge nightly batch | Yes |
| `QUOTH_V2_CURATION` | Distinctiveness, dedup, retirement | Yes (archival reversible) |
| `QUOTH_JUDGE_DAILY_LIMIT` | Max judge calls/night (default 50) | Yes |

## Support

If rollback doesn't resolve the issue, investigate the daemon log:
```bash
tail -100 ~/.quoth/daemon.log | grep -iE "error|warn|Phase [DEFG]"
```
