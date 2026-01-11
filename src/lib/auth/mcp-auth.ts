/**
 * MCP Authentication Middleware
 * Wraps MCP handlers with JWT-based authentication
 */

import { createMcpHandler } from 'mcp-handler';
import { jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Authentication context passed to MCP tools
 * Contains user and project information extracted from JWT
 */
export interface AuthContext {
  project_id: string;
  user_id: string;
  role: 'admin' | 'editor' | 'viewer';
  label?: string; // Optional token label for logging
}

/**
 * Creates an authenticated MCP handler
 * Extracts and verifies JWT token before allowing access to MCP tools
 *
 * @param setupFn - Function that registers MCP tools/prompts with auth context
 * @param options - Additional options for mcp-handler
 * @returns Next.js route handler with authentication
 */
export function createAuthenticatedMcpHandler(
  setupFn: (server: McpServer, authContext: AuthContext) => void,
  options?: any
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

      // 2. Verify JWT token
      if (!process.env.JWT_SECRET) {
        console.error('JWT_SECRET is not configured');
        return new Response(
          JSON.stringify({
            error: 'Server configuration error',
            message: 'JWT secret not configured',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      const secret = new TextEncoder().encode(process.env.JWT_SECRET);
      let authContext: AuthContext;

      try {
        const { payload } = await jwtVerify(token, secret, {
          issuer: process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site',
          audience: 'mcp-server',
        });

        // 3. Extract auth context from JWT payload
        authContext = {
          project_id: payload.sub as string,
          user_id: payload.user_id as string,
          role: payload.role as 'admin' | 'editor' | 'viewer',
          label: payload.label as string | undefined,
        };

        // Validate required fields
        if (!authContext.project_id || !authContext.user_id || !authContext.role) {
          throw new Error('Invalid token payload: missing required fields');
        }

        // Validate role
        if (!['admin', 'editor', 'viewer'].includes(authContext.role)) {
          throw new Error('Invalid token payload: invalid role');
        }
      } catch (error: any) {
        console.error('JWT verification failed:', error.message);

        // Determine error type for better user feedback
        let message = 'Invalid or expired token';
        if (error.code === 'ERR_JWT_EXPIRED') {
          message = 'Token has expired. Please generate a new token from the dashboard.';
        } else if (error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
          message = 'Token signature verification failed. Token may be corrupted.';
        }

        return new Response(
          JSON.stringify({
            error: 'Authentication failed',
            message,
          }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      // 4. Create MCP handler with authenticated context
      const handler = createMcpHandler(
        (server) => setupFn(server, authContext),
        {},
        options
      );

      // 5. Call the handler with the request
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
