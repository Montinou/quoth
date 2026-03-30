/**
 * MCP Authentication Middleware
 * Supports custom JWT API keys for MCP tool access.
 * All user auth is via Clerk.
 */

import { createMcpHandler } from 'mcp-handler';
import { jwtVerify, decodeJwt } from 'jose';
import type { NextRequest } from 'next/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Debug flag - only enable with explicit env var
const DEBUG_MCP_AUTH = process.env.NODE_ENV === 'development' && process.env.DEBUG_MCP_AUTH === 'true';

function debugLog(...args: unknown[]) {
  if (DEBUG_MCP_AUTH) {
    console.log(...args);
  }
}

/**
 * Authentication context passed to MCP tools (legacy shape, kept for compat)
 * Contains user and project information extracted from JWT
 */
export interface AuthContext {
  project_id: string;
  user_id: string;
  role: 'admin' | 'editor' | 'viewer';
  label?: string; // Optional token label for logging
  // Multi-account support
  connection_id?: string; // Unique per MCP connection
  available_projects?: Array<{
    project_id: string;
    role: 'admin' | 'editor' | 'viewer';
    project_name: string;
    project_slug: string;
  }>;
}

/**
 * Verify a custom JWT token (manual API keys)
 */
async function verifyCustomJwt(token: string): Promise<AuthContext | null> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return null;
  }

  try {
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret, {
      issuer: process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.triqual.dev',
      audience: 'mcp-server',
    });

    const authContext: AuthContext = {
      project_id: payload.sub as string,
      user_id: payload.user_id as string,
      role: (payload.role as 'admin' | 'editor' | 'viewer') || 'viewer',
      label: (payload.label as string) || (payload.email as string),
    };

    if (!authContext.project_id || !authContext.user_id) {
      return null;
    }

    if (!['admin', 'editor', 'viewer'].includes(authContext.role)) {
      return null;
    }

    return authContext;
  } catch {
    return null;
  }
}

/**
 * Verify an MCP token (custom JWT).
 * Returns AuthContext if valid, null otherwise.
 */
export async function verifyMcpApiKey(token: string): Promise<AuthContext | null> {
  // Try to determine token type by decoding without verification
  try {
    const decoded = decodeJwt(token);

    // Check if it's a custom JWT (has our specific issuer/audience)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.triqual.dev';
    if (decoded.iss === appUrl && decoded.aud === 'mcp-server') {
      return verifyCustomJwt(token);
    }
  } catch {
    // Token couldn't be decoded, try direct verification
  }

  // Try custom JWT verification
  return verifyCustomJwt(token);
}

/**
 * Creates an authenticated MCP handler
 * Extracts and verifies JWT token before allowing access to MCP tools
 */
export function createAuthenticatedMcpHandler(
  setupFn: (server: McpServer, authContext: AuthContext) => void,
  options?: Record<string, unknown>
) {
  return async (req: NextRequest) => {
    try {
      // 1. Extract Authorization header
      const authHeader = req.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({
            error: 'Missing or invalid Authorization header',
            message: 'Please provide a valid Bearer token',
          }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      // 2. Verify token (custom JWT)
      const authContext = await verifyMcpApiKey(token);

      if (!authContext) {
        return new Response(
          JSON.stringify({
            error: 'Authentication failed',
            message: 'Invalid or expired token. Please re-authenticate.',
          }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      // 3. Create MCP handler with authenticated context
      const handler = createMcpHandler(
        (server) => setupFn(server, authContext),
        {},
        options
      );

      // 4. Call the handler with the request
      return handler(req);
    } catch (error) {
      console.error('MCP auth middleware error:', error);
      return new Response(
        JSON.stringify({
          error: 'Internal server error',
          message: 'An unexpected error occurred',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  };
}
