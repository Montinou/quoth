---
name: knowledge-base-curation
description: Anti-bloat curation for learned knowledge bases — quality gates at ingestion, cosine-based dedup with LLM verification, credible-interval retirement, temporal staleness. Use when building self-updating RAG/pattern stores that must stay small and high-signal.
---

# Knowledge Base Curation

## Problem
Self-learning knowledge bases bloat over time. Patterns accumulate faster than they're refined. Generic patterns dominate retrieval. Signal-to-noise degrades.

## Quality gates (at ingestion)

1. **Min name length** ≥ 25 chars
2. **Generic name patterns rejected** via regex (e.g., `/^When \w+ing a file/i`)
3. **Distinctiveness ≥ 0.3** = fraction of tokens outside corpus top-1000
4. **Max cosine similarity < 0.85** with existing patterns (else strengthen existing)

## Distinctiveness (corpus-aware)
```
common = top_1000_tokens(all_patterns)
distinctiveness(pattern) = |unique_tokens(pattern) - common| / |unique_tokens(pattern)|
```
Rare tokens = distinctive = retain. Common tokens = generic = reject.

## Dedup (weekly batch)
1. Compute cosine similarity over all-pairs (O(N²) fine at <10k; HNSW-approximate above)
2. Pairs with sim ≥ 0.92 → enqueue LLM judge
3. Judge verdict: MERGE (archive loser, transfer stats to winner) or KEEP_BOTH
4. Higher-confidence pattern wins by default

## Retirement criteria (weekly)
- **Poor performance:** attempts ≥ 20 AND Beta CI upper bound < 0.4
- **Stale:** no match in 90 days
- **Merged:** archived via dedup
- **Always archive, never delete** — keep rollback path

## Empirical thresholds (from Netflix/Glean 2024 talks)
| Parameter | Value | Rationale |
|---|---|---|
| cosine merge threshold | 0.92 | balances recall vs false-merge |
| CI upper retirement | 0.4 | below global median on a well-calibrated system |
| min attempts | 20 | avoid retiring during cold-start |
| staleness | 90d | preserve rare but important patterns |

## Critical pitfalls
- **Don't delete, archive** — always allow rollback
- **Don't retire during cold-start** — require min attempts
- **Re-compute distinctiveness on corpus change** — new patterns shift common-token set
- **Cosine 0.92 may miss paraphrases** — supplement with LLM review for borderline (0.85-0.92)
- **Beta CI at small α+β unreliable** — require attempts ≥ 20

## Production references
- **Cursor .cursorrules**: manual curation, <1KB typical size
- **Glean (enterprise RAG)**: cosine > 0.92 → merge candidate → LLM/human review
- **MemGPT / Letta**: hierarchical summarization with LLM compression of similar memories
- **Netflix RecSys 2024 talks**: "freshness" scores with exponential decay

## Pseudocode
```
def curate_weekly(db):
  backfill_distinctiveness(db)           # recompute on latest corpus
  retire_poor(db, ci_upper_threshold=0.4)
  retire_stale(db, staleness_days=90)
  pairs = find_duplicates(db, cosine_threshold=0.92)
  for pair in pairs:
    verdict = llm_judge_dedup(pair)       # pairwise "same rule or distinct?"
    if verdict == 'merge': merge(pair, keep=higher_confidence)
```

## Reference SQL
```sql
-- Retire with reason
UPDATE patterns
SET status='archived', retired_at=:now, retired_reason='low-ci-upper'
WHERE id=:id;

-- Find dedup candidates (requires embedding column)
SELECT a.id, b.id, cosine(a.embedding, b.embedding) sim
FROM patterns a, patterns b
WHERE a.id < b.id AND a.status='active' AND b.status='active'
ORDER BY sim DESC LIMIT 100;
```
