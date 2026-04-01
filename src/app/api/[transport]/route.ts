/**
 * Quoth MCP Server API Route
 * Handles /api/mcp (Streamable HTTP) and /api/sse (SSE) transports.
 *
 * Authentication:
 * - qth_ prefixed tokens: agent API keys verified via DB
 * - Clerk JWTs: verified via @clerk/backend
 * - Returns 401 with WWW-Authenticate for OAuth discovery
 */

import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { verifyToken as clerkVerifyToken } from '@clerk/backend';
import { registerAllTools } from '@/lib/mcp/register';
import { verifyAgentApiKey } from '@/lib/auth/agent-keys';
import { getArchitectPrompt, getAuditorPrompt, getDocumenterPrompt } from '@/lib/quoth/prompts';
import type { AuthContext } from '@/lib/auth/types';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.triqual.dev';

/**
 * Verify a bearer token — handles both qth_ agent keys and Clerk JWTs.
 */
async function verifyToken(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;

  // Agent API keys
  if (bearerToken.startsWith('qth_')) {
    const payload = await verifyAgentApiKey(bearerToken);
    if (!payload) return undefined;

    const projectId = payload.project_ids?.[0] ?? '';
    return {
      token: bearerToken,
      clientId: payload.agent_id,
      scopes: payload.scopes,
      extra: {
        userId: payload.agent_id,
        clerkUserId: null,
        orgId: payload.org_id,
        projectId,
        role: 'editor',
        tier: 'team',
        isAgent: true,
        agentId: payload.agent_id,
      } satisfies AuthContext,
    };
  }

  // Clerk JWTs
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return undefined;

  try {
    const clerkPayload = await clerkVerifyToken(bearerToken, { secretKey });
    if (!clerkPayload?.sub) return undefined;

    const claims = clerkPayload as Record<string, unknown>;
    const metadata = (claims.metadata ?? {}) as Record<string, unknown>;
    const projectId = (claims.project_id ?? metadata.project_id ?? '') as string;

    if (!projectId) return undefined;

    const roleMap: Record<string, AuthContext['role']> = {
      'org:admin': 'admin',
      'org:member': 'editor',
      admin: 'admin',
      member: 'editor',
      owner: 'owner',
    };
    const rawRole = (claims.org_role as string) ?? '';
    const role: AuthContext['role'] = roleMap[rawRole] ?? 'viewer';
    const tier = (['free', 'pro', 'team', 'enterprise'].includes((claims.tier as string) ?? '')
      ? claims.tier
      : 'free') as AuthContext['tier'];

    const authContext: AuthContext = {
      userId: clerkPayload.sub,
      clerkUserId: clerkPayload.sub,
      orgId: (claims.org_id as string) ?? '',
      projectId,
      role,
      tier,
      isAgent: false,
    };

    return {
      token: bearerToken,
      clientId: clerkPayload.sub,
      scopes: ['mcp:read', 'mcp:write'],
      extra: authContext,
    };
  } catch {
    return undefined;
  }
}

/**
 * Extract AuthContext from the withMcpAuth-enriched request.
 */
function getAuthContext(req: Request): AuthContext {
  const authInfo = (req as Request & { auth?: AuthInfo }).auth;
  if (authInfo?.extra) {
    return authInfo.extra as AuthContext;
  }
  throw new Error('[MCP] Missing auth context on authenticated route — withMcpAuth misconfigured');
}

function setupServer(server: McpServer, authContext: AuthContext) {
  registerAllTools(server, authContext);

  server.registerPrompt(
    'quoth_architect',
    {
      description:
        "Code Generation Persona - Activate with '/prompt quoth_architect' in Claude Code. " +
        "Enforces 'Single Source of Truth' rules by searching Quoth before generating any code.",
    },
    async () => getArchitectPrompt()
  );

  server.registerPrompt(
    'quoth_auditor',
    {
      description:
        "Code Review Persona - Activate with '/prompt quoth_auditor' in Claude Code. " +
        "Reviews existing code against documented standards.",
    },
    async () => getAuditorPrompt()
  );

  server.registerPrompt(
    'quoth_documenter',
    {
      description:
        "Incremental Documentation Persona - Activate with '/prompt quoth_documenter' in Claude Code. " +
        "Documents new code immediately after implementation.",
    },
    async () => getDocumenterPrompt()
  );
}

const oauthHandler = withMcpAuth(
  async (req: Request) => {
    const authContext = getAuthContext(req);
    const handler = createMcpHandler(
      (server: McpServer) => setupServer(server, authContext),
      {},
      {
        basePath: '/api',
        maxDuration: 60,
        verboseLogs: process.env.NODE_ENV === 'development',
      }
    );
    return handler(req);
  },
  verifyToken,
  {
    required: true,
    resourceMetadataPath: '/.well-known/oauth-protected-resource',
    resourceUrl: APP_URL,
  }
);

export { oauthHandler as GET, oauthHandler as POST };
