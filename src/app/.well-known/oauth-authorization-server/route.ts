/**
 * RFC 8414 OAuth 2.0 Authorization Server Metadata
 *
 * Tells MCP clients (like Claude Code) where to authenticate.
 * Points to Supabase OAuth Server with our custom consent screen.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 */

import { NextResponse } from 'next/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'max-age=3600',
};

export async function GET() {
  // Use Supabase as the OAuth server if configured
  const useSupabaseOAuth = SUPABASE_URL && process.env.USE_SUPABASE_OAUTH === 'true';

  // When using Supabase OAuth, we use proxy endpoints that add the apikey header
  // This is required because Supabase endpoints need the apikey for project identification
  const metadata = {
    issuer: APP_URL,
    authorization_endpoint: `${APP_URL}/api/oauth/authorize`,
    token_endpoint: `${APP_URL}/api/oauth/token`,
    registration_endpoint: `${APP_URL}/api/oauth/register`,

    // Supported features
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],

    // Scopes - use OpenID for Supabase OAuth, MCP scopes for legacy
    scopes_supported: useSupabaseOAuth
      ? ['openid', 'email', 'profile']
      : ['mcp:read', 'mcp:write', 'mcp:admin'],

    // Service documentation
    service_documentation: `${APP_URL}/guide`,
  };

  return NextResponse.json(metadata, {
    headers: corsHeaders,
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders,
  });
}
