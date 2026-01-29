# Patterns

Code patterns and conventions used in this project.

## MCP Tool Registration

**When to use:** Adding new tools to the MCP server

**Example:**
```typescript
server.tool("tool_name", "Description", { input: z.object({...}) }, async ({ input }, extra) => {
  const authContext = extra.authContext;
  // Zod validates input automatically
  // Return { content: [{ type: "text", text: xmlResponse }] }
});
```

**Anti-pattern:** Returning plain JSON. Always return XML-structured text responses for AI client consumption.

## Supabase Mock Pattern (Vitest)

**When to use:** Unit testing any code that calls Supabase

**Example:**
```typescript
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({ data: mockData, error: null })),
    })),
  })),
}));
```

**Anti-pattern:** Using real Supabase connections in unit tests. Always mock the client chain.

## RAG Search Pipeline

**When to use:** Querying the knowledge base

**Pattern:** Query → Jina embed (512d) → Supabase pgvector (fetch 50) → Cohere rerank (return top 15, min score 0.5)

**Anti-pattern:** Skipping reranking. Vector similarity alone returns lower quality results. Always use the full pipeline when Cohere is available.

## Auth Context Propagation

**When to use:** Any MCP tool that accesses project data

**Pattern:** `createAuthenticatedMcpHandler()` verifies JWT → extracts `authContext` → passes to `registerQuothTools(server, authContext)` → each tool uses `authContext.project_id` for RLS-scoped queries.

**Anti-pattern:** Querying without project_id filter. Even with RLS, always explicitly filter by project_id in application code.
