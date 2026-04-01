/**
 * OAuth 2.0 Dynamic Client Registration (RFC 7591)
 *
 * Claude Code and other MCP clients call this to register before the auth flow.
 * We accept any registration and return a static client_id — no DB storage needed.
 */

import { NextRequest, NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // Accept any registration — return a deterministic client_id based on redirect_uri
    const redirectUri = body.redirect_uri || body.redirect_uris?.[0] || 'unknown';
    const clientId = `quoth-mcp-${Buffer.from(redirectUri).toString('base64url').slice(0, 16)}`;

    return NextResponse.json(
      {
        client_id: clientId,
        client_name: body.client_name || 'MCP Client',
        redirect_uris: body.redirect_uris || (body.redirect_uri ? [body.redirect_uri] : []),
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      { status: 201, headers: corsHeaders }
    );
  } catch (error) {
    console.error('[OAuth Register] Error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Registration failed' },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
