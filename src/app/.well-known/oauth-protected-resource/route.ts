/**
 * RFC 9728 Protected Resource Metadata Endpoint
 * 
 * Points MCP clients to OUR OAuth server (not Supabase directly).
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc9728
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
    // The protected resource (MCP endpoint)
    resource: `${APP_URL}/api/mcp`,
    
    // Point to OUR OAuth server (which proxies to Supabase)
    authorization_servers: [APP_URL],
    
    // Scopes required for this resource
    scopes_supported: ['mcp:read', 'mcp:write', 'mcp:admin'],
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
