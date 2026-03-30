/**
 * Quoth MCP Server API Route
 * Main entry point for the Model Context Protocol server
 *
 * Endpoint: /api/mcp (Streamable HTTP) or /api/sse (SSE)
 *
 * Features:
 * - OAuth 2.1 authentication via MCP API keys or OAuth tokens
 * - Proper WWW-Authenticate headers for OAuth discovery
 * - v2 modular tool registration via registerAllTools
 *
 * Authentication:
 * - Requires Bearer token in Authorization header
 * - Token can be MCP API key or OAuth-issued token
 * - Returns 401 with resource_metadata URL for OAuth discovery
 *
 * Note: Prompts have been removed in favor of plugin hooks (SessionStart, PreToolUse, Stop)
 */

import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { registerAllTools } from '@/lib/mcp/register';
import { verifyMcpApiKey, type AuthContext as LegacyAuthContext } from '@/lib/auth/mcp-auth';
import type { AuthContext } from '@/lib/auth/types';
import { sessionManager } from '@/lib/auth/session-manager';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'crypto';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.triqual.dev';

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
 * Extract legacy AuthContext from AuthInfo and map to v2 AuthContext
 */
function getAuthContextFromRequest(req: Request): { legacy: LegacyAuthContext; v2: AuthContext } {
  const authInfo = (req as Request & { auth?: AuthInfo }).auth;

  const defaultLegacy: LegacyAuthContext = {
    project_id: 'quoth-knowledge-base',
    user_id: 'anonymous',
    role: 'viewer',
  };

  if (!authInfo?.extra) {
    return {
      legacy: defaultLegacy,
      v2: {
        userId: 'anonymous',
        clerkUserId: null,
        orgId: '',
        projectId: 'quoth-knowledge-base',
        role: 'viewer',
        tier: 'free',
        isAgent: false,
      },
    };
  }

  const extra = authInfo.extra as Record<string, unknown>;
  const legacy: LegacyAuthContext = {
    project_id: (extra.project_id as string) || 'quoth-knowledge-base',
    user_id: (extra.user_id as string) || 'anonymous',
    role: (extra.role as 'admin' | 'editor' | 'viewer') || 'viewer',
    connection_id: extra.connection_id as string | undefined,
    available_projects: extra.available_projects as LegacyAuthContext['available_projects'],
  };

  // Map legacy role to v2 role
  const roleMap: Record<string, AuthContext['role']> = {
    admin: 'admin',
    editor: 'editor',
    viewer: 'viewer',
  };

  const v2: AuthContext = {
    userId: legacy.user_id,
    clerkUserId: null, // JWT-based auth, no Clerk user ID
    orgId: '',
    projectId: legacy.project_id,
    role: roleMap[legacy.role] || 'viewer',
    tier: 'free',
    isAgent: false,
  };

  return { legacy, v2 };
}

/**
 * Register tools on the MCP server
 */
function setupServer(server: McpServer, legacy: LegacyAuthContext, v2: AuthContext) {
  // Initialize or update session if connection ID is available
  if (legacy.connection_id && legacy.available_projects) {
    sessionManager.createOrUpdateSession(
      legacy.connection_id,
      legacy.user_id,
      legacy.project_id,
      legacy.role,
      legacy.available_projects
    );

    // Refresh auth context from session (in case account was switched)
    const activeContext = sessionManager.getActiveContext(legacy.connection_id);
    if (activeContext) {
      v2.projectId = activeContext.project_id;
      v2.role = activeContext.role as AuthContext['role'];
    }
  }

  // Register all v2 tools with authentication context
  registerAllTools(server, v2);
}

/**
 * Create MCP handler for a specific auth context
 */
function createHandlerWithContext(legacy: LegacyAuthContext, v2: AuthContext) {
  return createMcpHandler(
    (server) => setupServer(server, legacy, v2),
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
    const { legacy, v2 } = getAuthContextFromRequest(req);

    // Create handler with auth context and process request
    const handler = createHandlerWithContext(legacy, v2);
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
