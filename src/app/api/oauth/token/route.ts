/**
 * OAuth Token Endpoint
 * 
 * Exchanges authorization code for access token.
 * Verifies PKCE code_verifier before issuing token.
 * 
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-13
 */

import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { getAuthCode, deleteAuthCode } from '@/lib/auth/oauth-state';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site';
const JWT_SECRET = process.env.JWT_SECRET!;

export async function POST(req: Request) {
  try {
    // Parse form data (OAuth spec requires application/x-www-form-urlencoded)
    let body: Record<string, string>;
    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.text();
      body = Object.fromEntries(new URLSearchParams(formData));
    } else if (contentType.includes('application/json')) {
      body = await req.json();
    } else {
      return errorResponse('invalid_request', 'Unsupported content type');
    }

    const { grant_type, code, redirect_uri, client_id, code_verifier } = body;

    // Validate grant type
    if (grant_type !== 'authorization_code') {
      return errorResponse('unsupported_grant_type', 'Only authorization_code is supported');
    }

    // Validate required parameters
    if (!code) {
      return errorResponse('invalid_request', 'code is required');
    }
    if (!code_verifier) {
      return errorResponse('invalid_request', 'code_verifier is required (PKCE)');
    }

    // Get the stored auth code
    const authCode = getAuthCode(code);
    if (!authCode) {
      return errorResponse('invalid_grant', 'Invalid or expired authorization code');
    }

    // Verify client_id matches
    if (client_id && authCode.client_id !== client_id) {
      return errorResponse('invalid_grant', 'client_id mismatch');
    }

    // Verify redirect_uri matches
    if (redirect_uri && authCode.redirect_uri !== redirect_uri) {
      return errorResponse('invalid_grant', 'redirect_uri mismatch');
    }

    // Verify PKCE code_verifier
    const expectedChallenge = await generateCodeChallenge(code_verifier);
    if (expectedChallenge !== authCode.code_challenge) {
      return errorResponse('invalid_grant', 'Invalid code_verifier');
    }

    // Delete the used auth code (one-time use)
    deleteAuthCode(code);

    // Generate access token
    const secret = new TextEncoder().encode(JWT_SECRET);
    const accessToken = await new SignJWT({
      user_id: authCode.user_id,
      role: authCode.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(authCode.project_id)
      .setIssuer(APP_URL)
      .setAudience('mcp-server')
      .setIssuedAt()
      .setExpirationTime('90d')
      .sign(secret);

    // Return token response per OAuth spec
    return NextResponse.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 90 * 24 * 60 * 60, // 90 days in seconds
      scope: 'mcp:read mcp:write',
    }, {
      headers: {
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache',
      },
    });

  } catch (error) {
    console.error('Token endpoint error:', error);
    return errorResponse('server_error', 'Internal server error');
  }
}

/**
 * Generate S256 code challenge from verifier
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  
  // Base64URL encode
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function errorResponse(error: string, description: string) {
  return NextResponse.json(
    { error, error_description: description },
    { 
      status: 400,
      headers: {
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache',
      },
    }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
