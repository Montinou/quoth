# Intelligence Graph

<!-- version: 1.0.4 | last updated: 2026-04-10 -->

The intelligence graph is Quoth's in-session knowledge retrieval system. It builds a weighted, directed graph from memory files and pattern entries, computes PageRank over the graph, and uses trigram-based text matching to surface relevant context at query time. All state is persisted as JSON files in `~/.quoth/intelligence/`.

Source files:
- `quoth-plugin/mcp/handlers/intelligence.js` -- orchestration, state management, MCP tool dispatch
- `quoth-plugin/mcp/lib/graph.js` -- text processing, edge construction, PageRank computation

## Graph Construction

The graph is built by `initGraph(db)`, called at session start via the `session-restore` hook or the `quoth_intelligence_init` MCP tool.

### Data Sources

The graph is populated from two independent sources:

**1. Memory files** (`bootstrapFromMemoryFiles`)

Scans two directory trees:
- `~/.claude/projects/*/memory/` -- Claude Code project memory (all projects)
- `~/.quoth/memory/` -- Quoth-specific memory

For each `.md` file found, the content is split on `##` and `#` headings (`/^##?\s+/m`). Each section with a body of at least 10 characters becomes an entry:

| Field | Value |
|-------|-------|
| `id` | `mem-{filename}-{title-slug}` (slug truncated to 30 chars) |
| `key` | title, lowercased, non-alphanumeric replaced with hyphens, max 50 chars |
| `content` | section body, truncated to 500 characters |
| `summary` | section title (raw heading text) |
| `namespace` | `core` if source is `MEMORY.md`, otherwise the filename without `.md` |
| `type` | `semantic` |
| `metadata.sourceFile` | absolute path to the source `.md` file |
| `metadata.bootstrapped` | `true` |
| `createdAt` | `Date.now()` |

**2. Pattern database** (`bootstrapFromPatterns`)

Fetches the top 50 patterns from SQLite via `db.getTopPatterns(50, [])` (ordered by confidence descending, active status only). Each pattern becomes an entry:

| Field | Value |
|-------|-------|
| `id` | `pat-{pattern.id}` (prefixed for identification in feedback loops) |
| `key` | `pattern.name` or `pattern.id` |
| `content` | `{condition}\n{action}` concatenated |
| `summary` | `pattern.name` or `pattern.id` |
| `namespace` | `pattern.namespace` or `'patterns'` |
| `type` | `pattern` |
| `metadata.confidence` | pattern's SQLite confidence value |
| `metadata.source` | pattern's source tag (e.g., `distilled`, `exolar-seeded`) |
| `createdAt` | `pattern.created_at` or `Date.now()` |

### Store Initialization Logic

1. Read `store.json` from disk.
2. If the store is empty, null, or not an array, bootstrap from both sources and write `store.json`.
3. If the store already exists and is non-empty, reuse it (no re-bootstrap).

This means the store persists across sessions and only re-bootstraps when cleared or on first run.

### Graph Cache

After loading the store, `initGraph` checks `graph-state.json` for a valid cache before rebuilding:

- If `graphState.nodeCount === store.length` (same number of entries) **and** the state was updated within the last 60 seconds, the graph is not rebuilt.
- Returns `{ nodes, edges, message: 'Graph cache hit' }` immediately.

This prevents redundant rebuilds during the same session when the hook fires multiple times.

### Node Structure

Each entry in the store is converted to a graph node:

```javascript
{
  id: entry.id,                     // unique identifier
  category: entry.namespace || entry.type || 'default',
  confidence: entry.metadata.confidence || 0.5,
  accessCount: entry.metadata.accessCount || 0,
  createdAt: entry.createdAt || Date.now()
}
```

The `category` field is used by edge building to group related entries for similarity computation.

### Edge Building

Implemented in `graph.js: buildEdges(entries)`. Produces two types of directed edges:

**Temporal edges** (weight: 0.5)

Entries that originated from the same source file (`metadata.sourceFile`) are linked sequentially in the order they appear. If a file has sections A, B, C, the edges are A->B and B->C. These capture document-level proximity.

```javascript
{ sourceId: group[i].id, targetId: group[i+1].id, type: 'temporal', weight: 0.5 }
```

**Similarity edges** (weight: Jaccard score)

Within each category (`entry.category || entry.namespace || 'default'`), all pairs of entries are compared using trigram Jaccard similarity on their content/summary text. Pairs with similarity above 0.3 are linked:

```javascript
{ sourceId: group[i].id, targetId: group[j].id, type: 'similar', weight: sim }
```

The similarity computation:
1. Tokenize the entry's content (or summary as fallback)
2. Generate character-level trigrams from each token
3. Compute Jaccard similarity between the two trigram sets

Note: similarity edges are undirected in semantics but stored as a single directed edge from the lower-indexed entry to the higher-indexed entry within the group.

## Text Processing

All text processing functions are in `graph.js`.

### Tokenization (`tokenize`)

1. Convert to lowercase
2. Replace all non-alphanumeric characters (except hyphens) with spaces: `/[^a-z0-9\s-]/g`
3. Split on whitespace
4. Filter out words shorter than 3 characters
5. Filter out stop words (79 common English words)

The stop word list includes articles, prepositions, conjunctions, pronouns, auxiliaries, and common determiners. Notable inclusions: `just`, `because`, `very`, `only`, `same`, `other`.

### Trigram Generation (`trigrams`)

For each word, generates all contiguous 3-character substrings:
- `"hello"` produces `{hel, ell, llo}`
- `"go"` produces `{}` (word too short)
- `"code"` produces `{cod, ode}`

Returns a `Set` for efficient intersection/union operations.

### Jaccard Similarity (`jaccardSimilarity`)

Standard set-based Jaccard coefficient:

```
J(A, B) = |A intersection B| / |A union B|
```

Returns 0 when both sets are empty. Range: [0, 1].

## PageRank

Implemented in `graph.js: computePageRank(nodes, edges, damping, maxIter)`.

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `damping` | 0.85 | Probability of following a link vs. random jump |
| `maxIter` | 30 | Maximum iteration count |
| Convergence | 1e-6 | Sum of absolute rank changes across all nodes |

### Algorithm

1. Initialize all node ranks to `1/N` (uniform distribution).
2. On each iteration:
   a. Compute `danglingSum` -- sum of ranks for nodes with no outgoing edges (dangling nodes).
   b. For each node `i`, compute the incoming contribution: `sum = SUM(rank[j] / outlinks[j])` for all nodes `j` linking to `i`.
   c. Apply the PageRank formula: `rank[i] = (1 - d) / N + d * (sum + danglingSum / N)`
   d. Track total absolute difference from previous iteration.
3. Stop when total difference < 1e-6 or `maxIter` reached.

The dangling node handling ensures rank is not "lost" -- nodes with no outlinks distribute their rank evenly across all nodes, which is the standard treatment in PageRank.

### Output

Returns a dictionary mapping node IDs to their PageRank values. All values sum to approximately 1.0.

## State Files

All files are stored in `~/.quoth/intelligence/` as JSON:

| File | Contents | Updated By |
|------|----------|------------|
| `store.json` | Full array of entries (memory + patterns) | `initGraph`, `consolidateGraph` |
| `graph-state.json` | `{ version, updatedAt, nodeCount, nodes, edges, pageRanks }` | `initGraph`, `consolidateGraph`, `applyFeedback` |
| `ranked-context.json` | `{ version, computedAt, entries }` -- pre-sorted by ranking formula | `initGraph`, `consolidateGraph`, `applyFeedback` |
| `last-matched.json` | Array of entry IDs from last `getContext` call | `getContext` |
| `pending-insights.jsonl` | JSONL of edit events (`{ type, file, timestamp }`) | `post-edit` hook |
| `snapshots.json` | Array of historical graph snapshots (max 50) | `consolidateGraph` |

### Snapshot Structure

Each snapshot records:
- `timestamp` -- when the snapshot was taken
- `nodes` -- total node count
- `edges` -- total edge count
- `pageRankSum` -- sum of all PageRank values (should be ~1.0)
- `confidences` -- array of all node confidence values
- `accessCounts` -- array of all node access counts
- `topPatterns` -- top 10 entries by ranking (id, summary, confidence, pageRank, accessCount)

Snapshots enable trend analysis (the `getStats` function computes deltas between the last two snapshots).

## Context Retrieval

`getContext(prompt, topK)` is the primary query interface. Called by the `route` hook and the `quoth_intelligence_context` MCP tool. Also called internally by `quoth_route_task` to enrich routing results with `relevantPatterns`.

### Algorithm

1. Load `ranked-context.json` from disk.
2. Tokenize the prompt into words, then compute the prompt's trigram set.
3. If prompt produces no trigrams (too short or all stop words), return empty.
4. For each ranked entry:
   a. Compute `contentMatch` = Jaccard similarity between prompt trigrams and entry trigrams (entry trigrams are pre-computed from `entry.words` during ranking).
   b. Compute composite score: `score = 0.6 * contentMatch + 0.4 * pageRank`
5. Filter entries where `score >= 0.05`.
6. Sort by score descending.
7. Return top `topK` results (default 5).
8. Write matched IDs to `last-matched.json` for the feedback loop.

### Return Format

```javascript
{
  count: N,
  entries: [
    { id, summary, score, confidence, pageRank, accessCount },
    ...
  ]
}
```

Summary is truncated to 80 characters. Score, confidence, and pageRank are rounded to 3-4 decimal places.

## Feedback

`applyFeedback(success)` updates both the ranked-context and graph-state files for entries that were last matched.

### Process

1. Read `last-matched.json` to get the list of entry IDs.
2. Determine adjustment amount: `+0.05` on success, `-0.02` on failure.
3. Update `ranked-context.json`: for each matched entry, adjust `confidence` (clamped to [0, 1]) and increment `accessCount`.
4. Update `graph-state.json`: same adjustments applied to the corresponding nodes.
5. Return `{ boosted: [matched IDs], amount }`.

Note: this updates the intelligence graph's own confidence values (in JSON), which is a separate system from the SQLite Bayesian scores. However, the `post-task` hook bridges both systems -- see the Confidence Scoring documentation for details.

## Graph Consolidation

`consolidateGraph(db)` is called at session end and pre-compact events. It performs maintenance on the entire graph.

### Steps

1. **Process pending edits**: Read `pending-insights.jsonl`, count edits per file. Any file edited 3 or more times in the session gets a new "frequently edited" insight entry added to the store (unless one already exists for that file with `autoGenerated: true`). The JSONL file is then cleared.

2. **Refresh patterns from DB**: If a database handle is available, fetch top 50 patterns and add any new ones not already in the store (matched by ID).

3. **Apply confidence decay**: For nodes with `accessCount === 0` and age > 24 hours, reduce confidence by `0.005 * floor(age_in_hours / 24)`. Floor at 0.05 to prevent negative values.

4. **Rebuild edges**: Re-run `buildEdges` on the full store (temporal + similarity).

5. **Recompute PageRank**: Fresh PageRank computation with the updated edge set.

6. **Rebuild ranked entries**: Re-sort all entries by `0.6 * pageRank + 0.4 * confidence`.

7. **Save snapshot**: Append a new snapshot to `snapshots.json` (max 50 retained).

8. **Persist**: Write updated `graph-state.json`, `ranked-context.json`, and (if new entries were added) `store.json`.

## Ranking Formula

Entries are ranked by:

```
rank = 0.6 * pageRank + 0.4 * confidence
```

This weighting prioritizes graph centrality (how well-connected and referenced a node is) while still giving significant weight to empirical confidence (how often the pattern has succeeded in practice).

The same formula is used in three places:
1. Sorting `ranked-context.json` entries during `initGraph` and `consolidateGraph`
2. Scoring results in `getContext` (with `contentMatch` replacing `confidence` for the 0.6 weight)
3. Implicit in how high-ranked entries appear first in hook output

## Cache Behavior

`initGraph` implements a simple time-based cache:

1. Read existing `graph-state.json`.
2. If it exists and `nodeCount` matches the current store size:
   a. Compute age: `Date.now() - graphState.updatedAt`
   b. If age < 60 seconds (60,000 ms), return immediately with "Graph cache hit"
3. Otherwise, rebuild the entire graph from scratch.

The cache key is the node count -- if entries are added or removed, the cache is invalidated regardless of age. This is a coarse check; it will not detect modifications to existing entries.

## Diagnostics

`getStats(db)` returns comprehensive intelligence diagnostics. The optional `db` parameter (SQLite database handle) enables two additional sections populated from live pattern data.

| Section | Fields |
|---------|--------|
| `graph` | `nodes`, `edges`, `density` (graph density = 2E / N(N-1)) |
| `confidence` | `min`, `max`, `mean` across all nodes |
| `access` | `total` accesses, count of nodes with `accessCount > 0` |
| `pageRank` | `topNode` (highest-ranked node ID), `topNodeRank` (its PageRank value) |
| `edgeTypes` | Count of edges by type (`temporal`, `similar`, `unknown`) |
| `pendingInsights` | Number of unprocessed lines in `pending-insights.jsonl` |
| `snapshots` | Number of historical snapshots |
| `topPatterns` | Top 10 entries with rank, summary, confidence, pageRank, accessCount |
| `delta` | If 2+ snapshots exist: elapsed time, node delta, edge delta vs. previous |
| `exposure` | *(requires db)* `total` active patterns, `exposed` (exposure_count > 0), `used` (success_count > 0), `avg_conversion_rate` |
| `v2` | *(requires db)* V2 subsystem stats — `clusters` (count, avg/min/max confidence, total_attempts), `injections_7d` (total, explorations, avg_propensity, with_outcome, avg_reward), `judge_30d` (total, judged, cost_cents), `retired_total` |

When `db` is not provided (e.g., called without a database handle), `exposure` and `v2` are `null`.

## MCP Tools

| Tool | Handler | Description |
|------|---------|-------------|
| `quoth_intelligence_init` | `initGraph(db)` | Build/refresh graph from memory + patterns |
| `quoth_intelligence_context` | `getContext(prompt, topK)` | Query for relevant entries |
| `quoth_intelligence_consolidate` | `consolidateGraph(db)` | Session-end maintenance cycle |
| `quoth_intelligence_stats` | `getStats()` | Full diagnostics dump |
| `quoth_intelligence_feedback` | `applyFeedback(success)` | Apply +0.05/-0.02 to last-matched entries |
| `quoth_route_task` | `routeTask(task)` + enrichment | Route task with intelligence context overlay |

## Hook Integration

| Hook Event | Function Called | Purpose |
|------------|----------------|---------|
| `SessionStart` / `session-restore` | `initGraph(db)` | Load graph, inject high-confidence patterns |
| `UserPromptSubmit` / `route` | `getContext(prompt, 5)` + `routeTask(prompt)` | Show relevant patterns, recommend agent |
| `SessionEnd` / `session-end` | `consolidateGraph(db)` | Decay, rebuild edges, recompute PageRank |
| `PreCompact` / `session-end` | `consolidateGraph(db)` | Same as SessionEnd |
| `PostToolUse(Write/Edit)` / `post-edit` | Append to `pending-insights.jsonl` | Track file edits for consolidation |
| `SubagentStop` / `post-task` | `applyFeedback(true)` | Implicit positive feedback on subagent completion |
