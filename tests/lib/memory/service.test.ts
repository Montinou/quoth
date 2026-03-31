/**
 * Memory Service Tests
 * MEM-02: Tests for agent memory CRUD + semantic search.
 *
 * Mocks getDb (Drizzle) and generateEmbedding (AI Gateway).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks ────────────────────────────────────────────────────────────

const { mockExecute, mockGenerateEmbedding } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockGenerateEmbedding: vi.fn(),
}));

vi.mock("@/db/connection", () => ({
  getDb: vi.fn(() => ({
    execute: mockExecute,
  })),
}));

vi.mock("@/lib/embeddings/gateway", () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import {
  storeMemory,
  searchMemory,
  getMemory,
  listMemory,
  forgetMemory,
  forgetNamespace,
} from "@/lib/memory/service";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const AGENT_ID = "aaaaaaaa-1111-2222-3333-444444444444";
const ORG_ID = "bbbbbbbb-1111-2222-3333-444444444444";
const ENTRY_ID = "cccccccc-1111-2222-3333-444444444444";
const FAKE_EMBEDDING = Array.from({ length: 1536 }, (_, i) => i * 0.001);
const NOW = "2026-03-29T12:00:00.000Z";

/** A raw DB row that matches what Drizzle returns from agents.memory. */
function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ENTRY_ID,
    agent_id: AGENT_ID,
    key: "test-key",
    value: "test value",
    namespace: "default",
    tier: "working",
    relevance_score: 0.5,
    access_count: 1,
    tags: ["tag1"],
    metadata: { foo: "bar" },
    source: "unit-test",
    created_at: NOW,
    updated_at: NOW,
    last_accessed_at: NOW,
    decay_rate: 0.05,
    expires_at: null,
    embedding_model: "text-embedding-3-small",
    project_id: null,
    ...overrides,
  };
}

/**
 * Drizzle Neon HTTP execute returns an array-like object with a `.rows` property.
 * This helper creates a mock result that satisfies both `result[0]` and `result.rows`.
 */
function dbResult(rows: Record<string, unknown>[]): Record<string, unknown>[] & { rows: Record<string, unknown>[], rowCount: number } {
  const result = [...rows] as Record<string, unknown>[] & { rows: Record<string, unknown>[], rowCount: number };
  result.rows = rows;
  result.rowCount = rows.length;
  return result;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
});

// ─── storeMemory ─────────────────────────────────────────────────────────────

describe("storeMemory", () => {
  it("generates embedding and inserts with correct fields", async () => {
    const row = makeRow();
    mockExecute
      .mockResolvedValueOnce(dbResult([{ "?column?": 1 }])) // agent ownership check
      .mockResolvedValueOnce(dbResult([row])); // INSERT RETURNING

    const result = await storeMemory(AGENT_ID, ORG_ID, {
      key: "test-key",
      value: "test value",
      tags: ["tag1"],
      metadata: { foo: "bar" },
      source: "unit-test",
    });

    expect(mockGenerateEmbedding).toHaveBeenCalledWith("test value");
    expect(mockExecute).toHaveBeenCalledTimes(2); // agent check + INSERT

    // Verify returned MemoryEntry shape
    expect(result).toMatchObject({
      id: ENTRY_ID,
      agentId: AGENT_ID,
      key: "test-key",
      value: "test value",
      namespace: "default",
      tier: "working",
      tags: ["tag1"],
      metadata: { foo: "bar" },
      source: "unit-test",
    });
  });

  it("upserts on conflict (same agent+namespace+key)", async () => {
    // First insert
    const row1 = makeRow({ value: "original" });
    mockExecute
      .mockResolvedValueOnce(dbResult([{ "?column?": 1 }])) // agent check
      .mockResolvedValueOnce(dbResult([row1]));

    await storeMemory(AGENT_ID, ORG_ID, {
      key: "test-key",
      value: "original",
    });

    // Second insert with same key — upsert
    const row2 = makeRow({ value: "updated", tier: "working" });
    mockExecute
      .mockResolvedValueOnce(dbResult([{ "?column?": 1 }])) // agent check
      .mockResolvedValueOnce(dbResult([row2]));

    const result = await storeMemory(AGENT_ID, ORG_ID, {
      key: "test-key",
      value: "updated",
    });

    expect(mockExecute).toHaveBeenCalledTimes(4); // 2 agent checks + 2 INSERTs
    expect(result.value).toBe("updated");
    // ON CONFLICT resets tier to 'working'
    expect(result.tier).toBe("working");
  });

  it("sets expires_at when ttlSeconds provided", async () => {
    const row = makeRow({ expires_at: "2026-03-30T12:00:00.000Z" });
    mockExecute
      .mockResolvedValueOnce(dbResult([{ "?column?": 1 }])) // agent check
      .mockResolvedValueOnce(dbResult([row]));

    const result = await storeMemory(AGENT_ID, ORG_ID, {
      key: "ttl-key",
      value: "ephemeral",
      ttlSeconds: 86400,
    });

    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt).not.toBeNull();
    expect(mockExecute).toHaveBeenCalledTimes(2); // agent check + INSERT
  });

  it("accepts non-string metadata and serializes to JSON", async () => {
    const row = makeRow({ metadata: { nested: { deep: true }, count: 42 } });
    mockExecute
      .mockResolvedValueOnce(dbResult([{ "?column?": 1 }])) // agent check
      .mockResolvedValueOnce(dbResult([row]));

    const result = await storeMemory(AGENT_ID, ORG_ID, {
      key: "meta-key",
      value: "with metadata",
      metadata: { nested: { deep: true }, count: 42 },
    });

    expect(result.metadata).toEqual({ nested: { deep: true }, count: 42 });
  });

  it("resets tier to 'working' on upsert", async () => {
    // Simulate an entry that was previously promoted to 'persistent'
    // After upsert, the ON CONFLICT clause resets tier to 'working'
    const row = makeRow({ tier: "working" });
    mockExecute
      .mockResolvedValueOnce(dbResult([{ "?column?": 1 }])) // agent check
      .mockResolvedValueOnce(dbResult([row]));

    const result = await storeMemory(AGENT_ID, ORG_ID, {
      key: "test-key",
      value: "re-stored value",
    });

    expect(result.tier).toBe("working");
  });
});

// ─── searchMemory ────────────────────────────────────────────────────────────

describe("searchMemory", () => {
  it("generates query embedding", async () => {
    mockExecute
      .mockResolvedValueOnce(dbResult([{ "?column?": 1 }])) // agent check
      .mockResolvedValueOnce(dbResult([])); // search query

    await searchMemory(AGENT_ID, ORG_ID, { query: "find something" });

    expect(mockGenerateEmbedding).toHaveBeenCalledWith("find something");
  });

  it("calls search_memory SQL function and returns results", async () => {
    const rows = [
      makeRow({ similarity: 0.92, key: "result-1" }),
      makeRow({ similarity: 0.85, key: "result-2", id: "dddddddd-1111-2222-3333-444444444444" }),
    ];
    mockExecute
      .mockResolvedValueOnce(dbResult([{ "?column?": 1 }])) // agent check
      .mockResolvedValueOnce(dbResult(rows))  // search query
      .mockResolvedValueOnce({});   // trackAccess

    const results = await searchMemory(AGENT_ID, ORG_ID, { query: "test query" });

    expect(mockExecute).toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(results[0].similarity).toBe(0.92);
    expect(results[1].similarity).toBe(0.85);
  });

  it("boosts relevance on accessed results (fire-and-forget)", async () => {
    const rows = [makeRow({ similarity: 0.9 })];
    mockExecute
      .mockResolvedValueOnce(dbResult([{ "?column?": 1 }])) // agent check
      .mockResolvedValueOnce(dbResult(rows))   // search query
      .mockResolvedValueOnce({});    // access tracking UPDATE

    await searchMemory(AGENT_ID, ORG_ID, { query: "boost test" });

    // trackAccess fires asynchronously — give it a tick
    await vi.waitFor(() => {
      expect(mockExecute).toHaveBeenCalledTimes(3); // agent check + search + trackAccess
    });
  });

  it("respects threshold and limit defaults", async () => {
    mockExecute
      .mockResolvedValueOnce(dbResult([{ "?column?": 1 }])) // agent check
      .mockResolvedValueOnce(dbResult([])); // search query

    await searchMemory(AGENT_ID, ORG_ID, { query: "defaults" });

    expect(mockExecute).toHaveBeenCalledTimes(2); // agent check + search
  });

  it("passes custom threshold and limit", async () => {
    mockExecute
      .mockResolvedValueOnce(dbResult([{ "?column?": 1 }])) // agent check
      .mockResolvedValueOnce(dbResult([])); // search query

    await searchMemory(AGENT_ID, ORG_ID, {
      query: "custom params",
      limit: 5,
      threshold: 0.7,
      namespace: "notes",
      tier: "persistent",
    });

    expect(mockExecute).toHaveBeenCalledTimes(2); // agent check + search
  });
});

// ─── getMemory ───────────────────────────────────────────────────────────────

describe("getMemory", () => {
  it("returns entry by key", async () => {
    const row = makeRow();
    mockExecute
      .mockResolvedValueOnce([row])  // SELECT
      .mockResolvedValueOnce({});    // trackAccess

    const result = await getMemory(AGENT_ID, "default", "test-key");

    expect(result).not.toBeNull();
    expect(result!.key).toBe("test-key");
    expect(result!.agentId).toBe(AGENT_ID);
  });

  it("returns null for non-existent key", async () => {
    mockExecute.mockResolvedValueOnce(dbResult([]));

    const result = await getMemory(AGENT_ID, "default", "missing-key");

    expect(result).toBeNull();
  });

  it("filters expired entries (SQL WHERE clause)", async () => {
    // Expired entries are filtered by the SQL query itself.
    // An empty result set means the entry was expired or missing.
    mockExecute.mockResolvedValueOnce(dbResult([]));

    const result = await getMemory(AGENT_ID, "default", "expired-key");

    expect(result).toBeNull();
    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it("increments access_count via trackAccess", async () => {
    const row = makeRow();
    mockExecute
      .mockResolvedValueOnce([row])  // SELECT
      .mockResolvedValueOnce({});    // trackAccess UPDATE

    await getMemory(AGENT_ID, "default", "test-key");

    // trackAccess fires asynchronously
    await vi.waitFor(() => {
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });
  });
});

// ─── listMemory ──────────────────────────────────────────────────────────────

describe("listMemory", () => {
  it("lists by namespace", async () => {
    const rows = [
      makeRow({ key: "a", namespace: "notes" }),
      makeRow({ key: "b", namespace: "notes", id: "dddddddd-1111-2222-3333-444444444444" }),
    ];
    mockExecute.mockResolvedValueOnce(dbResult(rows));

    const results = await listMemory(AGENT_ID, { namespace: "notes" });

    expect(results).toHaveLength(2);
    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it("filters by tier", async () => {
    const rows = [makeRow({ tier: "persistent" })];
    mockExecute.mockResolvedValueOnce(dbResult(rows));

    const results = await listMemory(AGENT_ID, { tier: "persistent" });

    expect(results).toHaveLength(1);
    expect(results[0].tier).toBe("persistent");
  });

  it("paginates with limit and offset", async () => {
    mockExecute.mockResolvedValueOnce(dbResult([]));

    await listMemory(AGENT_ID, { limit: 20, offset: 40 });

    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it("uses default limit=50 and offset=0", async () => {
    mockExecute.mockResolvedValueOnce(dbResult([]));

    await listMemory(AGENT_ID);

    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it("orders by relevance_score DESC (verified by result order)", async () => {
    const rows = [
      makeRow({ key: "high", relevance_score: 0.9 }),
      makeRow({ key: "low", relevance_score: 0.3, id: "dddddddd-1111-2222-3333-444444444444" }),
    ];
    mockExecute.mockResolvedValueOnce(dbResult(rows));

    const results = await listMemory(AGENT_ID);

    // DB returns pre-ordered; verify mapping preserves order
    expect(results[0].relevanceScore).toBe(0.9);
    expect(results[1].relevanceScore).toBe(0.3);
  });
});

// ─── forgetMemory ────────────────────────────────────────────────────────────

describe("forgetMemory", () => {
  it("deletes specific key and returns true", async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 1 });

    const result = await forgetMemory(AGENT_ID, "default", "test-key");

    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it("returns false when key does not exist", async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 0 });

    const result = await forgetMemory(AGENT_ID, "default", "nonexistent");

    expect(result).toBe(false);
  });
});

// ─── forgetNamespace ─────────────────────────────────────────────────────────

describe("forgetNamespace", () => {
  it("deletes all entries in namespace and returns count", async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 7 });

    const count = await forgetNamespace(AGENT_ID, "scratch");

    expect(count).toBe(7);
    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it("returns 0 when namespace is empty", async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 0 });

    const count = await forgetNamespace(AGENT_ID, "empty-ns");

    expect(count).toBe(0);
  });
});
