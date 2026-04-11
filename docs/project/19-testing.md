# Testing

Complete reference for the test suites, testing infrastructure, mock strategy, and conventions used across the Quoth system.

**Version:** 1.0.4 | **Last updated:** 2026-04-11

---

## Overview

Quoth has two independent test suites:

| Suite | Location | Framework | Language | Tests | Runner |
|-------|----------|-----------|----------|-------|--------|
| Plugin | `quoth-plugin/tests/` | Vitest | JavaScript (CommonJS) | 31 test files + 2 shell integration tests | `npm test` from `quoth-plugin/` |
| SaaS | `tests/` | Vitest | TypeScript | 14 files, 181 tests | `npm test` from root |

Both suites use **Vitest** but with different configurations. The SaaS suite uses TypeScript with path aliases (`@/` -> `src/`), global test APIs, and a setup file. The plugin suite uses plain JavaScript with no globals.

---

## Plugin Tests (`quoth-plugin/tests/`)

### Configuration

**File:** `quoth-plugin/vitest.config.js`

```javascript
{
  test: {
    globals: false,        // Must import describe/it/expect explicitly
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 10000,    // 10 second timeout per test
  },
}
```

### Test Files

#### db.test.js

Tests the SQLite database layer (`daemon/db.js`).

**Coverage areas:**
- Pattern CRUD operations (`upsertPattern`, `getPattern`, `getTopPatterns`)
- Confidence updates via `success_count`/`failure_count` tracking (`applyBayesianUpdate` with success/failure)
- Confidence decay over time
- Pattern archival (low-confidence patterns)
- HNSW vector index operations (`searchBySimilarity`)
- Namespace scoping (`getProjectPatterns`, `promoteToGlobal`)
- `last_matched_at` tracking
- Pattern status transitions (`active` -> `archived`)
- Agent registry operations (`registerAgent`, `listAgents`, `heartbeat`)
- Event emission (`emitEvent`)

**Key details:**
- Uses an in-memory SQLite database (`:memory:`) for test isolation.
- Tests the full schema creation including all tables:
  - `patterns` — includes `pattern_type` (default `code-pattern`), `description`, `success_count`, `failure_count`, `decay_rate`, `embedding` (MiniLM-L6-v2), `version`, `tags`, `source`, `status`, `last_matched_at`; v2 columns: `alpha`, `beta`, `namespace`, `exposure_count`, `last_exposed_at`, `ignored_count`, `embedding_text`, `pattern_trigrams`, `quality_history`, `cluster_id`, `cluster_rank_score`, `effective_exposures`, `distinctiveness`, `retired_at`, `retired_reason`; promotion columns: `promoted_at`, `cloud_document_id`, `promoted_confidence`, `applicability`
  - `trajectories` — includes `context`, `total_steps`, `total_reward`, `ended_at`, `extracted_pattern_id` (FK to `patterns`)
  - `trajectory_steps` — includes auto-increment `id`, `reward`, `metadata`
  - `memory_entries` — includes `id`, `metadata`, `access_count`, `status`, `last_accessed_at`; unique on `(namespace, key)`
  - `agent_registry` — includes `capabilities`, `last_heartbeat`, `metadata`
  - `events` — with indexes on `event_type`, `agent_id`, `created_at`
  - `cluster_stats` — compound PK `(cluster_id, namespace)`; Thompson sampling state per cluster: `alpha`, `beta`, `attempts`, `centroid_embedding`, `member_count`
  - `injection_log` — per-injection record: `session_id`, `namespace`, `pattern_id`, `cluster_id`, `rank`, `propensity`, `is_exploration`, `query_text`, `injected_at`, `outcome_at`, `reward`; indexes on `session_id`, `pattern_id`, pending outcomes
  - `judge_queue` — pairwise pattern comparison jobs: `session_id`, `pattern_a_id`, `pattern_b_id`, `trajectory_summary`, `priority`, `status`, `verdict`, `judged_at`, `cost_cents`
  - `doc_chunks` — project documentation chunks for semantic search: `doc_file`, `section_header`, `content`, `embedding`, `content_hash`
- Validates WAL mode and foreign key constraints are enabled.

---

#### judge.test.js

Tests the JUDGE pipeline stage -- the first step in daemon trajectory processing.

**Coverage areas:**
- Effectiveness evaluation of tool use trajectories
- Classification into verdicts: `effective`, `ineffective`, `mixed`
- Handling of empty or malformed trajectory data
- Session-level aggregation of individual step evaluations

**Context:** The JUDGE stage receives raw trajectory JSONL and determines whether the agent's actions were effective. This verdict feeds into the DISTILL stage.

---

#### distill.test.js

Tests the DISTILL pipeline stage -- pattern extraction from judged trajectories.

**Coverage areas:**
- Extraction of reusable patterns from effective trajectories
- Pattern naming and description generation
- Condition/action pair formation
- Tag extraction from trajectory context
- Handling of trajectories with no extractable patterns
- Source tagging (`distilled`)

**Context:** The DISTILL stage takes trajectories marked as `effective` by JUDGE and produces candidate patterns for the database.

---

#### consolidate.test.js

Tests the CONSOLIDATE pipeline stage -- merge-or-new decision for extracted patterns.

**Coverage areas:**
- Detection of near-duplicate patterns for merging
- Confidence aggregation when merging patterns
- Creation of new patterns when no similar pattern exists
- Tag merging across consolidated patterns
- Version incrementing on merge

**Context:** CONSOLIDATE compares newly distilled patterns against existing patterns in the database and decides whether to merge with an existing pattern or create a new entry.

---

#### attribute.test.js

Tests the decision attribution system.

**Coverage areas:**
- Success attribution: boosting patterns that contributed to successful outcomes
- Failure attribution: penalizing patterns that contributed to failures
- Multi-pattern attribution (when multiple patterns were active)
- Attribution with missing or partial context
- Source tagging (`attributed`)

**Context:** Attribution tracks which patterns were active when an outcome occurred, enabling the system to learn which patterns actually help vs. which are noise.

---

#### mutate.test.js

Tests mutation generation for test verification.

**Coverage areas:**
- Generation of mutated test cases from passing tests
- Mutation operators (value changes, condition inversions, etc.)
- Verification that mutations produce different outcomes
- Edge cases in mutation application

---

#### promote.test.js

Tests the cloud promotion pipeline (`daemon/lib/promote.js`).

**Coverage areas:**
- API call construction for `POST /api/v1/patterns/promote`
- Content building (pattern -> promotion payload)
- Project creation/resolution from `pattern.namespace` (via `ensureProject` helper)
- Project existence check before promotion (GET `/api/v1/projects?limit=100`, then POST create if missing)
- Authentication via `QUOTH_API_KEY` header
- Error handling for network failures and API errors
- Skip behavior when `QUOTH_API_KEY` is not set
- Correct embedding format for MiniLM-L6 (see [12 — Embeddings & Search](./12-embeddings-search.md))

**Mocking:** HTTP calls are mocked -- no real API requests are made.

---

#### skill-extract.test.js

Tests skill extraction from test files (`daemon/lib/skill-extract.js`).

**Coverage areas:**
- Parsing of test file structure (describe blocks, it blocks, assertions)
- Extraction of page objects and assertion patterns
- Template generation from test logic with `{{variable}}` placeholders
- Feature name inference from file paths
- Handling of malformed or empty test files

**Context:** Uses `claude-sonnet-4-6` via the `claude` CLI (`-p` flag, `--output-format text`) to extract parameterized Playwright test skills. The model call is mocked in tests -- no real subprocess is spawned.

---

#### integration.test.js

End-to-end pipeline tests covering the full trajectory processing flow.

**Coverage areas:**
- Full pipeline: trajectory ingestion -> JUDGE -> DISTILL -> CONSOLIDATE
- Pattern creation from realistic trajectory data
- Confidence scoring after full pipeline execution
- Database state verification at each pipeline stage
- Edge cases: empty trajectories, single-step trajectories, mixed outcomes

---

## SaaS Tests (`tests/`)

### Configuration

**File:** `vitest.config.ts` (project root)

```typescript
{
  test: {
    globals: true,          // describe/it/expect available globally
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'src/lib/quoth/__tests__/**'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'src/db/migrations/**'],
      reporter: ['text', 'text-summary'],
    },
    testTimeout: 10000,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
}
```
