/**
 * Agent Memory MCP Tools — MEM-04
 *
 * 4 tools:
 *   - quoth_memory_store   — store a memory for the calling agent
 *   - quoth_memory_search  — semantic search agent memory
 *   - quoth_memory_list    — list agent memories
 *   - quoth_memory_forget  — delete a memory or namespace
 *
 * All operations are scoped to the authenticated agent.
 * Requires agent auth (isAgent must be true).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '@/lib/auth/types';
import {
  storeMemory,
  searchMemory,
  listMemory,
  forgetMemory,
  forgetNamespace,
} from '@/lib/memory/service';

// ─── Zod schemas ────────────────────────────────────────────────────────────

const MemoryStoreInput = z.object({
  key: z
    .string()
    .min(1)
    .max(256)
    .describe('Unique key for this memory within the namespace'),
  value: z
    .unknown()
    .describe('The memory content (string, object, or any JSON-serializable value)'),
  namespace: z
    .string()
    .max(128)
    .optional()
    .describe('Namespace to group related memories (default: "default")'),
  tags: z
    .array(z.string().max(64))
    .max(20)
    .optional()
    .describe('Tags for filtering and categorization'),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe('Additional metadata to store with the memory'),
  ttlSeconds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Time-to-live in seconds (memory auto-expires after this duration)'),
  projectId: z
    .string()
    .uuid()
    .optional()
    .describe('Project ID to scope the memory to (defaults to auth context project)'),
});

const MemorySearchInput = z.object({
  query: z
    .string()
    .min(1)
    .max(1024)
    .describe('Natural language search query'),
  namespace: z
    .string()
    .max(128)
    .optional()
    .describe('Namespace to search within'),
  tier: z
    .enum(['working', 'persistent'])
    .optional()
    .describe('Memory tier to search (working = ephemeral, persistent = consolidated)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('Maximum number of results to return'),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Minimum similarity threshold (0-1)'),
});

const MemoryListInput = z.object({
  namespace: z
    .string()
    .max(128)
    .optional()
    .describe('Filter by namespace'),
  tier: z
    .enum(['working', 'persistent'])
    .optional()
    .describe('Filter by memory tier (working = ephemeral, persistent = consolidated)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Maximum number of memories to return'),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Offset for pagination'),
});

const MemoryForgetInput = z.union([
  z.object({
    key: z
      .string()
      .min(1)
      .max(256)
      .describe('Key of the memory to delete'),
    namespace: z
      .string()
      .max(128)
      .optional()
      .describe('Namespace of the memory (default: "default")'),
  }),
  z.object({
    namespace: z
      .string()
      .min(1)
      .max(128)
      .describe('Namespace to delete entirely'),
    all: z
      .literal(true)
      .describe('Must be true to confirm deletion of all memories in the namespace'),
  }),
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.includes('relation') || err.message.includes('column')) {
      return 'A database error occurred. Please try again later.';
    }
    return err.message;
  }
  return 'An unexpected error occurred.';
}

function requireAgent(authContext: AuthContext): { agentId: string; orgId: string } {
  if (!authContext.isAgent || !authContext.agentId) {
    throw new Error('This tool requires agent authentication (qth_ API key).');
  }
  return { agentId: authContext.agentId, orgId: authContext.orgId };
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerMemoryTools(server: McpServer, authContext: AuthContext) {
  // ── quoth_memory_store ──────────────────────────────────────────────────
  server.registerTool(
    'quoth_memory_store',
    {
      description:
        'Store a memory for the calling agent. ' +
        'Memories are scoped to the agent and optionally to a namespace. ' +
        'Requires agent authentication (qth_ API key).',
      inputSchema: MemoryStoreInput,
    },
    async (args) => {
      try {
        const { agentId, orgId } = requireAgent(authContext);
        const input = MemoryStoreInput.parse(args);

        // Ensure value is serialized to string for the TEXT column
        const valueStr = typeof input.value === 'string'
          ? input.value
          : JSON.stringify(input.value);

        const result = await storeMemory(agentId, orgId, {
          key: input.key,
          value: valueStr,
          namespace: input.namespace,
          tags: input.tags,
          metadata: input.metadata,
          ttlSeconds: input.ttlSeconds,
          projectId: input.projectId ?? (authContext.projectId || undefined),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  stored: true,
                  ...result,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Memory store failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── quoth_memory_search ─────────────────────────────────────────────────
  server.registerTool(
    'quoth_memory_search',
    {
      description:
        'Semantic search across the calling agent\'s memories. ' +
        'Returns top results with similarity scores. ' +
        'Requires agent authentication (qth_ API key).',
      inputSchema: MemorySearchInput,
    },
    async (args) => {
      try {
        const { agentId } = requireAgent(authContext);
        const input = MemorySearchInput.parse(args);

        const results = await searchMemory(agentId, {
          query: input.query,
          namespace: input.namespace,
          tier: input.tier,
          limit: input.limit,
          threshold: input.threshold,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  count: results.length,
                  query: input.query,
                  results,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Memory search failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── quoth_memory_list ───────────────────────────────────────────────────
  server.registerTool(
    'quoth_memory_list',
    {
      description:
        'List the calling agent\'s memories with optional filtering by namespace and tier. ' +
        'Supports pagination via limit and offset. ' +
        'Requires agent authentication (qth_ API key).',
      inputSchema: MemoryListInput,
    },
    async (args) => {
      try {
        const { agentId } = requireAgent(authContext);
        const input = MemoryListInput.parse(args);

        const results = await listMemory(agentId, {
          namespace: input.namespace,
          tier: input.tier,
          limit: input.limit,
          offset: input.offset,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  count: results.length,
                  limit: input.limit,
                  offset: input.offset,
                  memories: results,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Memory list failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── quoth_memory_forget ─────────────────────────────────────────────────
  server.registerTool(
    'quoth_memory_forget',
    {
      description:
        'Delete a specific memory by key, or delete all memories in a namespace. ' +
        'To delete a single memory: provide { key, namespace? }. ' +
        'To delete an entire namespace: provide { namespace, all: true }. ' +
        'Requires agent authentication (qth_ API key).',
      inputSchema: MemoryForgetInput,
    },
    async (args) => {
      try {
        const { agentId } = requireAgent(authContext);
        const input = MemoryForgetInput.parse(args);

        if ('all' in input && input.all === true) {
          const deletedCount = await forgetNamespace(agentId, input.namespace);

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    forgotten: true,
                    scope: 'namespace',
                    namespace: input.namespace,
                    deletedCount,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Narrowed: input has { key, namespace? }
        const keyInput = input as { key: string; namespace?: string };
        const namespace = keyInput.namespace ?? 'default';
        const deleted = await forgetMemory(agentId, namespace, keyInput.key);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  forgotten: deleted,
                  scope: 'key',
                  key: keyInput.key,
                  namespace,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Memory forget failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );
}
