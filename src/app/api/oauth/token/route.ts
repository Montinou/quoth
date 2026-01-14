/**
 * OAuth Token Endpoint Proxy
 *
 * Proxies token requests to Supabase OAuth Server
 * adding the required apikey header that MCP clients don't know about.
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
    // Get the token request - could be form-urlencoded or JSON
    const contentType = request.headers.get('content-type') || '';
    let body: string;
    let forwardContentType: string;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      body = await request.text();
      forwardContentType = 'application/x-www-form-urlencoded';
    } else {
      body = JSON.stringify(await request.json());
      forwardContentType = 'application/json';
    }

    // Forward to Supabase OAuth token endpoint with apikey
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=authorization_code`, {
      method: 'POST',
      headers: {
        'Content-Type': forwardContentType,
        'apikey': SUPABASE_ANON_KEY,
      },
      body,
    });

    const data = await response.json();

    return NextResponse.json(data, {
      status: response.status,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error('OAuth token proxy error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to process token request' },
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
