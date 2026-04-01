/**
 * OAuth Token Endpoint
 *
 * Exchanges the auth code (issued by /api/oauth/authorize) for an MCP access token.
 * Verifies PKCE (S256) and issues a JWT compatible with verifyMcpApiKey().
 */

import { NextRequest, NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';
import { createHash } from 'crypto';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.triqual.dev';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return new TextEncoder().encode(secret);
}

/**
 * Verify PKCE S256: sha256(code_verifier) base64url == code_challenge
 */
function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const hash = createHash('sha256').update(codeVerifier).digest();
  const computed = hash.toString('base64url');
  return computed === codeChallenge;
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let params: Record<string, string> = {};

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await request.text();
      params = Object.fromEntries(new URLSearchParams(text));
    } else {
      params = await request.json().catch(() => ({}));
    }

    const { grant_type, code, code_verifier, redirect_uri } = params;

    if (grant_type !== 'authorization_code') {
      return NextResponse.json(
        { error: 'unsupported_grant_type' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!code || !code_verifier || !redirect_uri) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Missing code, code_verifier, or redirect_uri' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Verify and decode the auth code JWT
    const secret = getJwtSecret();
    let payload: Record<string, unknown>;
    try {
      const { payload: p } = await jwtVerify(code, secret, {
        issuer: APP_URL,
        audience: 'mcp-oauth',
      });
      payload = p as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Invalid or expired authorization code' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate type
    if (payload.type !== 'auth_code') {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Not an authorization code' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate redirect_uri matches what was used in authorize
    if (payload.redirect_uri !== redirect_uri) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'redirect_uri mismatch' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Verify PKCE
    const codeChallenge = payload.code_challenge as string;
    if (!verifyPkce(code_verifier, codeChallenge)) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'PKCE verification failed' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Issue MCP access token — must match shape expected by verifyCustomJwt()
    const projectId = payload.sub as string;
    const userId = payload.user_id as string;
    const role = payload.role as string;

    const accessToken = await new SignJWT({
      sub: projectId,
      user_id: userId,
      role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('90d')
      .setIssuer(APP_URL)
      .setAudience('mcp-server')
      .sign(secret);

    return NextResponse.json(
      {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 90 * 24 * 60 * 60, // 90 days in seconds
        scope: role === 'admin' ? 'mcp:read mcp:write mcp:admin'
              : role === 'editor' ? 'mcp:read mcp:write'
              : 'mcp:read',
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('[OAuth Token] Error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Token exchange failed' },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
