/**
 * RFC 8414 OAuth 2.0 Authorization Server Metadata
 * 
 * Tells MCP clients (like Claude Code) where to authenticate.
 * This is the discovery endpoint that enables `claude mcp add`.
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 */

import { NextResponse } from 'next/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'max-age=3600',
};

export async function GET() {
  const metadata = {
    // Required: Must match the issuer in tokens
    issuer: APP_URL,
    
    // OAuth endpoints
    authorization_endpoint: `${APP_URL}/api/oauth/authorize`,
    token_endpoint: `${APP_URL}/api/oauth/token`,
    
    // Dynamic Client Registration (RFC 7591)
    registration_endpoint: `${APP_URL}/api/oauth/register`,
    
    // Supported features
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'], // Public clients
    code_challenge_methods_supported: ['S256'], // PKCE required
    
    // Scopes
    scopes_supported: ['mcp:read', 'mcp:write', 'mcp:admin'],
    
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
