# Testing

Complete reference for the test suites, testing infrastructure, mock strategy, and conventions used across the Quoth system.

---

## Overview

Quoth has two independent test suites:

| Suite | Location | Framework | Language | Tests | Runner |
|-------|----------|-----------|----------|-------|--------|
| Plugin | `quoth-plugin/tests/` | Vitest | JavaScript (CommonJS) | 9 files | `npm test` from `quoth-plugin/` |
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
- Bayesian confidence updates (`applyBayesianUpdate` with success/failure)
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
- Tests the full schema creation including `patterns`, `trajectories`, `trajectory_steps`, `memory_entries`, `agent_registry`, and `events` tables.
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
- Project creation/resolution from pattern tags
- Authentication via `QUOTH_API_KEY` header
- Error handling for network failures and API errors
- Skip behavior when `QUOTH_API_KEY` is not set
- Correct embedding format for `voyage-4-lite` (1024 dimensions)

**Mocking:** HTTP calls are mocked -- no real API requests are made.

---

#### skill-extract.test.js

Tests skill extraction from test files (`daemon/lib/skill-extract.js`).

**Coverage areas:**
- Parsing of test file structure (describe blocks, it blocks, assertions)
- Extraction of page objects and assertion patterns
- Template generation from test logic
- Feature name inference from file paths
- Handling of malformed or empty test files

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
    alias: { '@': './src' },
  },
}
```

**Key configuration points:**
- `globals: true` -- no need to import `describe`, `it`, `expect`, `vi`.
- Path alias `@/` resolves to `src/` matching the Next.js `tsconfig.json`.
- Excludes `src/lib/quoth/__tests__/**` (legacy test directory).
- Coverage only tracks `src/lib/**/*.ts` (not API routes or components).

---

### Global Setup (`tests/setup.ts`)

The setup file establishes mocks that apply to all test files. This follows the **London School (mock-first) TDD** approach per the project's CLAUDE.md rules.

**Mocked modules:**

| Module | Mock Strategy |
|--------|--------------|
| `@clerk/nextjs/server` | `auth()` returns `{ userId: null, orgId: null, sessionClaims: null }` |
| `next/headers` | `headers()` returns empty `Map` |
| `@/db/connection` | `getDb()` returns `vi.fn()` -- tests override per-case |
| `@/db/schema` | Column reference stubs for all tables (`agentApiKeys`, `messages`, `channels`, etc.) |
| `drizzle-orm` | Operator stubs (`eq`, `and`, `or`, `isNull`, `desc`, `asc`, `inArray`, `sql`) |
| `ai` | `embed()` and `embedMany()` as `vi.fn()` |
| `@ai-sdk/openai` | `openai.embedding()` and `createOpenAI()` return model stubs |
| `@upstash/redis` | `Redis` constructor mock |
| `@upstash/ratelimit` | `Ratelimit` with `slidingWindow` mock |

**Design rationale:** All external dependencies (database, auth, AI SDK, Redis) are mocked at module level. Individual tests can override these mocks using `vi.mocked(getDb).mockReturnValue(...)` for specific scenarios.

---

### Test Files

#### tests/lib/embeddings/gateway.test.ts

Tests the embedding generation gateway (`src/lib/embeddings/gateway.ts`).

**Coverage areas:**
- Model constants verification (`voyage-4-lite`, 1024 dimensions)
- Single embedding generation via `embed()`
- Batch embedding generation via `embedMany()`
- Zero vector generation for fallback scenarios
- Dimension validation (1024-d vectors)
- Error handling when AI Gateway is unavailable

**Historical note:** Updated from `text-embedding-3-large` (2000 dimensions) to `voyage-4-lite` (1024 dimensions) in v3.2.0.

---

#### tests/lib/embeddings/reranker.test.ts

Tests the Jina-based reranking pipeline.

**Coverage areas:**
- Reranking of search results by relevance
- Score normalization
- Behavior when `JINA_API_KEY` is not set (passthrough)
- Error handling for Jina API failures

---

#### tests/lib/generations/tracker.test.ts

Tests the generation tracking system (`src/lib/generations/tracker.ts`).

**Coverage areas:**
- Generation creation with unique IDs
- Status transitions: `pending` -> `streaming` -> `complete` / `failed`
- Cost estimation from token counts
- Concurrent generation tracking
- Cleanup of stale generations

---

#### tests/lib/generations/cache.test.ts

Tests the generation cache (`src/lib/generations/cache.ts`).

**Coverage areas:**
- Prompt hashing for cache key generation
- Cache hits on identical prompts
- Cache misses on different prompts
- TTL-based cache expiration
- Cache invalidation

---

#### tests/lib/api/validate.test.ts

Tests the API input validation layer (`src/lib/api/validate.ts`).

**Coverage areas:**
- Zod schema validation for request bodies
- Zod schema validation for query parameters
- Error message formatting for validation failures
- Edge cases: empty bodies, missing fields, type mismatches

---

#### tests/lib/api/errors.test.ts

Tests the API error handling module (`src/lib/api/errors.ts`).

**Coverage areas:**
- RFC 7807 problem detail response formatting
- `AppError` class behavior (status codes, messages, types)
- Helper functions: `unauthorized()`, `forbidden()`, `notFound()`, `rateLimited()`
- Error serialization to JSON

---

#### tests/lib/auth/agent-keys.test.ts

Tests the agent API key system (`src/lib/auth/agent-keys.ts`).

**Coverage areas:**
- Key generation (`qth_*` prefix format)
- Key hashing (SHA-256)
- Key validation and lookup
- Scope checking (project-level vs org-level)
- Key revocation
- Rate limit enforcement per key
- Expiration handling

---

#### tests/lib/comms/messages.test.ts

Tests the messaging system (`src/lib/comms/messages.ts`).

**Coverage areas:**
- Direct message sending between agents
- Channel-based message broadcasting
- Message threading (reply chains)
- Message status transitions
- Priority handling

---

#### tests/lib/comms/tasks.test.ts

Tests the task management system (`src/lib/comms/tasks.ts`).

**Coverage areas:**
- Task creation and assignment
- Status transitions: `pending` -> `in_progress` -> `completed` / `failed`
- Priority ordering
- Project-scoped task queries

---

#### tests/lib/search/pipeline.test.ts

Tests the hybrid search pipeline (`src/lib/search/pipeline.ts`).

**Coverage areas:**
- Vector search (embedding similarity)
- Full-text search (FTS)
- Hybrid scoring (configurable weight between vector and FTS)
- Reranking integration
- Scope filtering (`project`, `shared`, `all`)
- Threshold filtering

---

#### tests/lib/search/cache.test.ts

Tests the search result cache.

**Coverage areas:**
- Cache key generation from query + parameters
- Cache hit/miss behavior
- TTL-based invalidation
- Cache population on miss

---

#### tests/lib/memory/service.test.ts

Tests the memory service (`src/lib/memory/service.ts`).

**Coverage areas:**
- Memory entry CRUD operations
- Key-based lookup within namespaces
- Semantic memory search
- Access count tracking
- Entry deletion (forget)

---

#### tests/lib/worker/trigger.test.ts

Tests the background worker trigger system.

**Coverage areas:**
- Job scheduling via QStash
- Retry logic for failed jobs
- Payload serialization

---

#### tests/lib/worker/verify.test.ts

Tests the worker verification module.

**Coverage areas:**
- Signature verification for incoming webhook/worker requests
- Replay attack prevention
- Invalid signature rejection

---

## Running Tests

### Plugin Tests

```bash
cd quoth-plugin
npm test                    # Run all plugin tests
npm test -- --watch         # Watch mode
npm test -- db.test.js      # Run specific test file
```

### SaaS Tests

```bash
npm test                    # Run all SaaS tests (from project root)
npm test -- --watch         # Watch mode
npm test -- --coverage      # Run with V8 coverage report
npm test -- tests/lib/embeddings/gateway.test.ts  # Specific file
```

### Running Both Suites

```bash
# From project root
npm test && cd quoth-plugin && npm test
```

---

## Test Conventions

### Mock Strategy: London School (Mock-First)

Per the project's CLAUDE.md rules, all new code follows London School TDD:

1. **Mock all external dependencies** -- database, API clients, auth, Redis, AI SDK.
2. **Test behavior, not implementation** -- verify outputs and side effects.
3. **Override mocks per test** -- global mocks provide defaults; individual tests customize.

**Example pattern:**
```typescript
// Global mock in tests/setup.ts
vi.mock('@/db/connection', () => ({
  getDb: vi.fn(),
}));

// Per-test override
it('should return project patterns', async () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ id: '1', name: 'test' }]),
  };
  vi.mocked(getDb).mockReturnValue(mockDb as any);
  // ... test logic
});
```

### Database Isolation

- **Plugin tests:** Use in-memory SQLite (`:memory:`) -- each test gets a fresh database.
- **SaaS tests:** Mock the Drizzle ORM query builder -- no real database connections.

### Embedding Model Consistency

All tests that involve embeddings use `voyage-4-lite` with 1024 dimensions. This was updated from `text-embedding-3-large` (2000 dimensions) in v3.2.0. Test vectors must be exactly 1024-dimensional arrays.

### No Network Calls

All HTTP requests (AI Gateway, Jina, Quoth cloud API, Clerk) are mocked. Tests must never make real network calls. The `promote.test.js` plugin test explicitly mocks `fetch` for the promotion API.

---

## Coverage

### SaaS Coverage Configuration

```typescript
coverage: {
  provider: 'v8',
  include: ['src/lib/**/*.ts'],
  exclude: ['**/*.test.ts', '**/*.d.ts', 'src/db/migrations/**'],
  reporter: ['text', 'text-summary'],
}
```

Coverage tracks only `src/lib/**/*.ts` -- the core library code. API routes, components, and database migrations are excluded. Run with `npm test -- --coverage` to generate a report.

### Current Test Status

- **SaaS:** 14 test files, 181 tests -- all passing
- **Plugin:** 9 test files -- all passing

---

## CI/CD Integration

Testing is enforced by project conventions (CLAUDE.md rules):

1. **After code changes:** Tests must be run and pass before considering work complete.
2. **Before commits:** Build verification (`npm run build`) must succeed.
3. **Vercel deployments:** Automatic deployments triggered on push to main. Build includes `next build` which performs TypeScript type checking.

There is no dedicated CI pipeline configuration (e.g., GitHub Actions). Testing discipline is enforced through the CLAUDE.md rules and the development workflow rather than automated gates.

---

## Adding New Tests

### Plugin Test Template

```javascript
// quoth-plugin/tests/my-feature.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../daemon/db.js'

describe('MyFeature', () => {
  let db

  beforeEach(() => {
    db = createDb(':memory:')
  })

  it('should do something', () => {
    // Arrange
    db.upsertPattern({ id: 'test-1', name: 'Test', ... })

    // Act
    const result = db.getPattern('test-1')

    // Assert
    expect(result).toBeDefined()
    expect(result.name).toBe('Test')
  })
})
```

### SaaS Test Template

```typescript
// tests/lib/my-module/my-feature.test.ts
import { vi } from 'vitest';
import { getDb } from '@/db/connection';

// Override global mock for this file
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([]),
};

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue(mockDb as any);
  vi.clearAllMocks();
});

describe('myFeature', () => {
  it('should handle the happy path', async () => {
    mockDb.where.mockResolvedValueOnce([{ id: '1' }]);

    const result = await myFunction('input');

    expect(result).toEqual({ id: '1' });
    expect(mockDb.select).toHaveBeenCalled();
  });
});
```

---

## Build and Lint

```bash
# Build (Next.js -- includes TypeScript type checking)
npm run build

# Lint (ESLint)
npm run lint

# Full verification chain
npm run lint && npm test && npm run build
```

The build step (`next build`) serves as an additional type-checking gate. TypeScript errors that tests might not catch (e.g., unused imports, type mismatches in non-tested code) are caught during build.
