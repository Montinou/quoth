# Patterns

Code patterns and conventions used in this project.

## MCP Tool Registration (Cloud)

**When to use:** Adding new tools to the cloud MCP server

**Example:**
```typescript
// In src/lib/mcp/tools/<module>-tools.ts
export function registerModuleTools(server: McpServer, authContext: AuthContext) {
  server.tool("tool_name", "Description", { input: z.object({...}) }, async ({ input }, extra) => {
    // Zod validates input automatically
    // Return { content: [{ type: "text", text: xmlResponse }] }
  });
}
```

Registered in `src/lib/mcp/register.ts` with 30s timeout wrapper and activity logging.

**Anti-pattern:** Returning plain JSON. Always return XML-structured text responses for AI client consumption.

## Drizzle ORM + Neon Queries

**When to use:** Any database access in the cloud platform

**Pattern:** Multi-schema design (public, agents, docs, search, analytics, comms). Use typed schema from `src/db/schema.ts`. Connection via `src/db/connection.ts` with Neon serverless driver.

**Anti-pattern:** Raw SQL queries outside of migrations. Always use Drizzle query builder for type safety.

## RAG Search Pipeline

**When to use:** Querying the knowledge base

**Pattern:** Query → text-embedding-3-large (2000d) via Vercel AI Gateway → Neon pgvector HNSW → Cohere rerank (return top results, min score threshold)

**Anti-pattern:** Skipping reranking. Vector similarity alone returns lower quality results. Always use the full pipeline when Cohere is available.

## Auth Context Propagation

**When to use:** Any MCP tool or API route that accesses project data

**Pattern:** Clerk middleware verifies session → extracts `authContext` (userId, orgId, projectId) → passes to tool handlers and API routes → each query scopes by projectId/orgId.

**Anti-pattern:** Querying without project_id filter. Always explicitly filter by project scope in application code.

## Plugin Pattern Learning

**When to use:** Understanding the self-learning loop

**Pattern:** Tool use → trajectory capture (JSONL) → daemon processes via Haiku subagents (JUDGE → DISTILL → CONSOLIDATE) → patterns stored in SQLite + HNSW with Bayesian confidence → high-confidence patterns injected at session start.

**Anti-pattern:** Manually editing ~/.quoth/memory.db. Let the daemon manage pattern lifecycle through its pipeline.
