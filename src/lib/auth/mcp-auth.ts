/**
 * MCP Authentication Middleware
 * Supports both Supabase OAuth tokens and manual API keys
 */

import { createMcpHandler } from 'mcp-handler';
import { jwtVerify, decodeJwt } from 'jose';
import { createClient } from '@supabase/supabase-js';
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
 * Authentication context passed to MCP tools
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
 * Verify a Supabase OAuth token
 * Claims are in the JWT payload's app_metadata (injected by Custom Access Token Hook)
 *
 * IMPORTANT: The hook injects claims into the JWT itself, NOT into the user record.
 * So we must decode the JWT to read project_id and mcp_role, not rely on getUser().
 */
async function verifySupabaseToken(token: string): Promise<AuthContext | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  debugLog('[MCP Auth] Verifying Supabase token...');

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[MCP Auth] Supabase configuration missing');
    return null;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify token with Supabase (this validates the token is legitimate)
    debugLog('[MCP Auth] Calling supabase.auth.getUser...');
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    debugLog('[MCP Auth] getUser result:', { user: user?.id, error: error?.message });

    if (error || !user) {
      console.error('[MCP Auth] Token verification failed:', error?.message || 'No user');
      return null;
    }

    // CRITICAL: Decode the JWT to read claims injected by Custom Access Token Hook
    // The hook adds project_id and mcp_role to the JWT's app_metadata claims,
    // NOT to the user record's app_metadata (which is what getUser returns)
    const decoded = decodeJwt(token);
    const jwtAppMetadata = decoded.app_metadata as Record<string, unknown> | undefined;

    debugLog('[MCP Auth] JWT app_metadata (from hook):', JSON.stringify(jwtAppMetadata, null, 2));
    debugLog('[MCP Auth] User record app_metadata (from DB):', JSON.stringify(user.app_metadata, null, 2));

    // Extract claims from JWT (injected by Custom Access Token Hook)
    const projectId = jwtAppMetadata?.project_id as string | undefined;
    const role = jwtAppMetadata?.mcp_role as string | undefined;

    debugLog('[MCP Auth] Extracted JWT claims:', { projectId, role });

    if (!projectId) {
      console.warn('[MCP Auth] JWT missing project_id in app_metadata');
      console.warn('[MCP Auth] This usually means:');
      console.warn('[MCP Auth]   1. Custom Access Token Hook is not enabled in Supabase Dashboard');
      console.warn('[MCP Auth]   2. User has no default_project_id in their profile');
      console.warn('[MCP Auth]   3. The hook function failed silently');
      console.warn('[MCP Auth] Full JWT payload:', JSON.stringify(decoded, null, 2));
      return null;
    }

    // Fetch all projects user has access to (for multi-account support)
    debugLog('[MCP Auth] Fetching available projects for user:', user.id);
    const { data: projectMembers, error: projectsError } = await supabase
      .from('project_members')
      .select(`
        project_id,
        role,
        project:projects(id, name, slug)
      `)
      .eq('user_id', user.id);

    debugLog('[MCP Auth] Available projects:', projectMembers?.length || 0);

    const availableProjects = projectMembers?.map((pm: any) => ({
      project_id: pm.project_id,
      role: pm.role as 'admin' | 'editor' | 'viewer',
      project_name: pm.project?.name || 'Unknown',
      project_slug: pm.project?.slug || pm.project_id,
    })) || [];

    return {
      project_id: projectId,
      user_id: user.id,
      role: (role as 'admin' | 'editor' | 'viewer') || 'viewer',
      label: user.email,
      available_projects: availableProjects,
    };
  } catch (error) {
    console.error('[MCP Auth] Supabase token verification failed:', error);
    return null;
  }
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
      issuer: process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site',
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

    // Fetch available projects for multi-account support (same as Supabase OAuth)
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        });

        const { data: projectMembers } = await supabase
          .from('project_members')
          .select(`
            project_id,
            role,
            project:projects(id, name, slug)
          `)
          .eq('user_id', authContext.user_id);

        authContext.available_projects = projectMembers?.map((pm: any) => ({
          project_id: pm.project_id,
          role: pm.role as 'admin' | 'editor' | 'viewer',
          project_name: pm.project?.name || 'Unknown',
          project_slug: pm.project?.slug || pm.project_id,
        })) || [];
      }
    } catch (error) {
      console.warn('[MCP Auth] Could not fetch available projects for API key:', error);
      // Continue without available_projects - single account mode
    }

    return authContext;
  } catch {
    return null;
  }
}

/**
 * Verify an MCP token (supports both Supabase OAuth and custom JWT)
 * Returns AuthContext if valid, null otherwise
 */
export async function verifyMcpApiKey(token: string): Promise<AuthContext | null> {
  console.log('[MCP Auth] verifyMcpApiKey called, token length:', token?.length);
  console.log('[MCP Auth] Token preview:', token?.substring(0, 50) + '...');

  // Try to determine token type by decoding without verification
  try {
    const decoded = decodeJwt(token);
    console.log('[MCP Auth] Decoded JWT:', { iss: decoded.iss, aud: decoded.aud, sub: decoded.sub });

    // Check if it's a custom JWT (has our specific issuer/audience)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site';
    if (decoded.iss === appUrl && decoded.aud === 'mcp-server') {
      console.log('[MCP Auth] Detected custom JWT, verifying...');
      return verifyCustomJwt(token);
    }

    // Check if it's a Supabase token (issuer matches Supabase URL pattern)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabaseUrl && decoded.iss?.includes('supabase')) {
      console.log('[MCP Auth] Detected Supabase token, verifying...');
      return verifySupabaseToken(token);
    }

    console.log('[MCP Auth] Token type not determined from issuer, trying both methods');
  } catch (err) {
    console.log('[MCP Auth] Could not decode token as JWT:', err);
    // Token couldn't be decoded, try both methods
  }

  // Try custom JWT first (faster, no network call)
  console.log('[MCP Auth] Trying custom JWT verification...');
  const customAuth = await verifyCustomJwt(token);
  if (customAuth) {
    console.log('[MCP Auth] Custom JWT verified successfully');
    return customAuth;
  }

  // Fall back to Supabase verification
  console.log('[MCP Auth] Custom JWT failed, trying Supabase verification...');
  return verifySupabaseToken(token);
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

      // 2. Verify token (supports both Supabase OAuth and custom JWT)
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
