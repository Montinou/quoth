/**
 * Quoth MCP Server API Route
 * Main entry point for the Model Context Protocol server
 *
 * Endpoint: /api/mcp (Streamable HTTP) or /api/sse (SSE)
 *
 * Features:
 * - OAuth 2.1 authentication via MCP API keys or OAuth tokens
 * - Proper WWW-Authenticate headers for OAuth discovery
 * - 3 Tools: quoth_search_index, quoth_read_doc, quoth_propose_update
 * - 3 Prompts: quoth_architect, quoth_auditor, quoth_documenter
 *
 * Authentication:
 * - Requires Bearer token in Authorization header
 * - Token can be MCP API key or OAuth-issued token
 * - Returns 401 with resource_metadata URL for OAuth discovery
 */

import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { registerQuothTools } from '@/lib/quoth/tools';
import { getArchitectPrompt, getAuditorPrompt, getDocumenterPrompt } from '@/lib/quoth/prompts';
import { verifyMcpApiKey, type AuthContext } from '@/lib/auth/mcp-auth';
import { sessionManager } from '@/lib/auth/session-manager';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'crypto';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site';

/**
 * Token verification: handles both MCP API keys and OAuth tokens
 */
async function verifyToken(req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) {
    return undefined;
  }

  // verifyMcpApiKey now handles both MCP API keys and OAuth tokens
  const mcpAuth = await verifyMcpApiKey(bearerToken);
  if (mcpAuth) {
    // Generate unique connection ID (or extract from request headers if available)
    const connectionId = req.headers.get('x-mcp-connection-id') || randomUUID();
    
    return {
      token: bearerToken,
      clientId: mcpAuth.user_id,
      scopes: mcpAuth.role === 'admin' ? ['mcp:read', 'mcp:write', 'mcp:admin'] :
              mcpAuth.role === 'editor' ? ['mcp:read', 'mcp:write'] :
              ['mcp:read'],
      extra: {
        project_id: mcpAuth.project_id,
        user_id: mcpAuth.user_id,
        role: mcpAuth.role,
        connection_id: connectionId,
        available_projects: mcpAuth.available_projects,
      },
    };
  }

  return undefined;
}

/**
 * Extract AuthContext from AuthInfo
 */
function getAuthContextFromRequest(req: Request): AuthContext {
  const authInfo = (req as Request & { auth?: AuthInfo }).auth;
  if (!authInfo?.extra) {
    // Default for public access (shouldn't happen with required auth)
    return {
      project_id: 'quoth-knowledge-base',
      user_id: 'anonymous',
      role: 'viewer',
    };
  }

  const extra = authInfo.extra as Record<string, unknown>;
  return {
    project_id: (extra.project_id as string) || 'quoth-knowledge-base',
    user_id: (extra.user_id as string) || 'anonymous',
    role: (extra.role as 'admin' | 'editor' | 'viewer') || 'viewer',
    connection_id: extra.connection_id as string | undefined,
    available_projects: extra.available_projects as AuthContext['available_projects'],
  };
}

/**
 * Register tools and prompts on the MCP server
 */
function setupServer(server: McpServer, authContext: AuthContext) {
  // Initialize or update session if connection ID is available
  if (authContext.connection_id && authContext.available_projects) {
    sessionManager.createOrUpdateSession(
      authContext.connection_id,
      authContext.user_id,
      authContext.project_id,
      authContext.role,
      authContext.available_projects
    );

    // Refresh auth context from session (in case account was switched)
    const activeContext = sessionManager.getActiveContext(authContext.connection_id);
    if (activeContext) {
      authContext.project_id = activeContext.project_id;
      authContext.role = activeContext.role;
    }
  }

  // Register all Quoth tools with authentication context
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
 * Create MCP handler for a specific auth context
 */
function createHandlerWithContext(authContext: AuthContext) {
  return createMcpHandler(
    (server) => setupServer(server, authContext),
    {},
    {
      basePath: '/api',
      maxDuration: 60,
      verboseLogs: process.env.NODE_ENV === 'development',
    }
  );
}

/**
 * OAuth-wrapped handler that extracts auth context and creates MCP handler
 */
const oauthHandler = withMcpAuth(
  async (req: Request) => {
    // Extract auth context from the authenticated request
    const authContext = getAuthContextFromRequest(req);
    
    // Create handler with auth context and process request
    const handler = createHandlerWithContext(authContext);
    return handler(req);
  },
  verifyToken,
  {
    required: true,
    resourceMetadataPath: '/.well-known/oauth-protected-resource',
    resourceUrl: APP_URL,
  }
);

// Export handlers for Next.js App Router
export { oauthHandler as GET, oauthHandler as POST };
