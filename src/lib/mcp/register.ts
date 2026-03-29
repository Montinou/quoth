/**
 * MCP Tool Registration Orchestrator — QUOTH-08
 *
 * Replaces the monolithic tools.ts with modular tool registration.
 * Registers all tools from 4 modules, wraps each handler with:
 *   - 30s timeout via AbortController
 *   - Error sanitization
 *   - Activity logging to analytics.activity
 *
 * Usage:
 *   import { registerAllTools } from '@/lib/mcp/register';
 *   registerAllTools(server, authContext);
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '@/db/connection';
import { activity } from '@/db/schema';
import type { AuthContext } from '@/lib/auth/types';

import { registerSearchTools } from './tools/search-tools';
import { registerAgentTools } from './tools/agent-tools';
import { registerProjectTools } from './tools/project-tools';
import { registerGenesisTools } from './tools/genesis-tools';
import { registerMemoryTools } from './tools/memory-tools';

/**
 * Log a tool invocation to the analytics.activity table.
 * Fire-and-forget — never blocks tool execution.
 */
function logToolUsage(
  authContext: AuthContext,
  toolName: string,
  startTime: number,
  resultCount?: number,
) {
  const responseTimeMs = Date.now() - startTime;

  void (async () => {
    try {
      // Skip activity logging if projectId or orgId are missing (FK constraint would fail)
      if (!authContext.projectId || !authContext.orgId) {
        return;
      }

      const db = getDb();
      await db.insert(activity).values({
        projectId: authContext.projectId,
        orgId: authContext.orgId,
        userId: authContext.isAgent ? null : authContext.userId,
        agentId: authContext.isAgent ? authContext.agentId : null,
        eventType: mapToolToEventType(toolName),
        toolName,
        resultCount: resultCount ?? null,
        responseTimeMs,
        context: {},
      });
    } catch (err) {
      // Never let analytics logging crash tool execution
      console.error('[MCP Register] Failed to log activity:', err);
    }
  })();
}

/**
 * Map tool names to analytics event types.
 */
function mapToolToEventType(toolName: string): string {
  const mapping: Record<string, string> = {
    quoth_search_index: 'search',
    quoth_read_doc: 'read',
    quoth_read_chunks: 'read_chunks',
    quoth_agent_register: 'agent_register',
    quoth_agent_list: 'agent_register',
    quoth_agent_assign: 'agent_assign_project',
    quoth_agent_send_message: 'agent_message_sent',
    quoth_agent_inbox: 'agent_inbox_read',
    quoth_agent_tasks: 'agent_task_updated',
    quoth_project_create: 'project_create',
    quoth_project_invite: 'project_update',
    quoth_token_generate: 'token_generate',
    quoth_genesis: 'genesis',
    quoth_memory_store: 'memory_store',
    quoth_memory_search: 'memory_search',
    quoth_memory_list: 'memory_list',
    quoth_memory_forget: 'memory_forget',
  };
  return mapping[toolName] ?? 'search';
}

/**
 * Create a proxy McpServer that wraps registerTool calls with
 * timeout + activity logging.
 */
function createInstrumentedServer(
  server: McpServer,
  authContext: AuthContext,
): McpServer {
  const TOOL_TIMEOUT_MS = 30_000;

  // Store original registerTool
  const originalRegisterTool = server.registerTool.bind(server);

  // Override registerTool to wrap handlers
  server.registerTool = function wrappedRegisterTool(
    name: string,
    config: any,
    handler: (...args: any[]) => Promise<any>,
  ) {
    const wrappedHandler = async (...handlerArgs: any[]) => {
      const startTime = Date.now();

      // Create abort controller for 30s timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

      try {
        // Race the handler against timeout
        const result = await Promise.race([
          handler(...handlerArgs),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => {
              reject(new Error(`Tool ${name} timed out after ${TOOL_TIMEOUT_MS / 1000}s`));
            });
          }),
        ]);

        // Log successful invocation
        logToolUsage(authContext, name, startTime);

        return result;
      } catch (err) {
        // Log failed invocation
        logToolUsage(authContext, name, startTime);

        // Return sanitized error
        const message =
          err instanceof Error && err.message.includes('timed out')
            ? `Tool timed out after ${TOOL_TIMEOUT_MS / 1000} seconds. Try a simpler query.`
            : 'An unexpected error occurred. Please try again.';

        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    };

    return originalRegisterTool(name, config, wrappedHandler);
  } as typeof server.registerTool;

  return server;
}

/**
 * Register all MCP tools from the 4 tool modules.
 *
 * Each tool handler receives the authenticated context and is wrapped with:
 *   - 30s execution timeout
 *   - Activity logging to analytics.activity
 *   - Sanitized error responses
 */
export function registerAllTools(server: McpServer, authContext: AuthContext) {
  const instrumented = createInstrumentedServer(server, authContext);

  registerSearchTools(instrumented, authContext);
  registerAgentTools(instrumented, authContext);
  registerProjectTools(instrumented, authContext);
  registerGenesisTools(instrumented, authContext);
  registerMemoryTools(instrumented, authContext);
}
