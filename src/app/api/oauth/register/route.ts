/**
 * OAuth Dynamic Client Registration Proxy
 *
 * Proxies registration requests to Supabase OAuth Server
 * adding the required apikey header that MCP clients don't know about.
 *
 * @see RFC 7591 - OAuth 2.0 Dynamic Client Registration
 */

import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json(
      { error: 'server_error', error_description: 'OAuth server not configured' },
      { status: 500, headers: corsHeaders }
    );
  }

  try {
    // Get the registration request body
    const body = await request.json();

    // Forward to Supabase OAuth registration endpoint with apikey
    // Correct endpoint: /auth/v1/oauth/clients/register
    const response = await fetch(`${SUPABASE_URL}/auth/v1/oauth/clients/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    return NextResponse.json(data, {
      status: response.status,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error('OAuth registration proxy error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to process registration' },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders,
  });
}
