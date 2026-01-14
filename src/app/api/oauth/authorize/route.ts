/**
 * OAuth Authorization Endpoint Proxy
 *
 * Redirects authorization requests to Supabase OAuth Server.
 * For browser redirects, adds apikey as query param.
 */

import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function GET(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json(
      { error: 'server_error', error_description: 'OAuth server not configured' },
      { status: 500 }
    );
  }

  // Get all query parameters from the request
  const searchParams = request.nextUrl.searchParams;
  
  // Build Supabase authorize URL with all params
  const supabaseUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  
  // Copy all query parameters
  searchParams.forEach((value, key) => {
    supabaseUrl.searchParams.set(key, value);
  });
  
  // Add apikey for Supabase
  supabaseUrl.searchParams.set('apikey', SUPABASE_ANON_KEY);

  // Redirect to Supabase authorization endpoint
  return NextResponse.redirect(supabaseUrl.toString());
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}
