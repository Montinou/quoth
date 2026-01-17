/**
 * Quoth MCP Server - SSE Transport Route with OAuth
 * Authenticated SSE endpoint for EventSource clients
 *
 * Endpoint: /api/mcp/sse (Server-Sent Events)
 *
 * Authentication:
 * - Query param: /api/mcp/sse?token=YOUR_TOKEN (for EventSource)
 * - OR Header: Authorization: Bearer YOUR_TOKEN
 * - Returns 401 with WWW-Authenticate for OAuth discovery
 *
 * Features:
 * - 3 Tools: quoth_search_index, quoth_read_doc, quoth_propose_update
 * - 3 Prompts: quoth_architect, quoth_auditor, quoth_documenter
 */

import { createMcpHandler } from 'mcp-handler';
import { verifySseToken, createSseAuthErrorResponse } from '@/lib/auth/sse-auth';
import { registerQuothTools } from '@/lib/quoth/tools';
import { getArchitectPrompt, getAuditorPrompt, getDocumenterPrompt } from '@/lib/quoth/prompts';
import type { NextRequest } from 'next/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '@/lib/auth/mcp-auth';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site';

/**
 * Setup MCP server with tools and prompts
 */
function setupServer(server: McpServer, authContext: AuthContext) {
  registerQuothTools(server, authContext);

  // Register Prompts (Personas)
  // IMPORTANT: Prompts are activated with /prompt command in Claude Code, NOT by calling them like tools
  server.registerPrompt(
    'quoth_architect',
    {
      description:
        "🏗️ Code Generation Persona - Activate with '/prompt quoth_architect' in Claude Code. " +
        "Enforces 'Single Source of Truth' rules by searching Quoth before generating any code. " +
        "Use BEFORE writing code/tests to ensure patterns follow documented standards.",
    },
    async () => getArchitectPrompt()
  );

  server.registerPrompt(
    'quoth_auditor',
    {
      description:
        "🔍 Code Review Persona - Activate with '/prompt quoth_auditor' in Claude Code. " +
        "Reviews existing code against documented standards. Distinguishes VIOLATIONS (code breaking rules) " +
        "from UPDATES_NEEDED (new patterns to document). Use DURING code review.",
    },
    async () => getAuditorPrompt()
  );

  server.registerPrompt(
    'quoth_documenter',
    {
      description:
        "📝 Incremental Documentation Persona - Activate with '/prompt quoth_documenter' in Claude Code. " +
        "Documents new code immediately after implementation. Fetches templates, follows structure, " +
        "and submits proposals. Use WHILE building features. Say 'document this [code]' after activation.",
    },
    async () => getDocumenterPrompt()
  );
}

/**
 * Create handler with auth context
 */
function createAuthenticatedHandler(authContext: AuthContext) {
  return createMcpHandler(
    (server: McpServer) => setupServer(server, authContext),
    {},
    {
      basePath: '/api/mcp',
      maxDuration: 60,
      verboseLogs: process.env.NODE_ENV === 'development',
    }
  );
}

/**
 * Create OAuth-compliant 401 response with WWW-Authenticate header
 */
function createOAuthAuthErrorResponse(): Response {
  const resourceMetadataUrl = `${APP_URL}/.well-known/oauth-protected-resource`;
  return new Response(
    JSON.stringify({
      error: 'invalid_token',
      error_description: 'Missing or invalid token',
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"`,
      },
    }
  );
}

/**
 * GET handler for SSE connections
 */
export async function GET(req: NextRequest) {
  const authContext = await verifySseToken(req);
  
  if (!authContext) {
    return createOAuthAuthErrorResponse();
  }

  const handler = createAuthenticatedHandler(authContext);
  return handler(req);
}

/**
 * POST handler for SSE message endpoint
 */
export async function POST(req: NextRequest) {
  const authContext = await verifySseToken(req);
  
  if (!authContext) {
    return createOAuthAuthErrorResponse();
  }

  const handler = createAuthenticatedHandler(authContext);
  return handler(req);
}
