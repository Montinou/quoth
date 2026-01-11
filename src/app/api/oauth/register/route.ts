/**
 * OAuth Dynamic Client Registration (RFC 7591)
 * 
 * Allows Claude Code to register itself as an OAuth client.
 * We use a simple in-memory store since clients are short-lived.
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc7591
 */

import { NextResponse } from 'next/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site';

// Simple in-memory client store (in production, use Redis or database)
// Clients expire after 24 hours
const registeredClients = new Map<string, {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  created_at: number;
}>();

// Cleanup old clients periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  for (const [id, client] of registeredClients) {
    if (now - client.created_at > maxAge) {
      registeredClients.delete(id);
    }
  }
}, 60 * 60 * 1000); // Check every hour

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // Generate a unique client ID
    const clientId = `claude-${crypto.randomUUID()}`;
    
    // Extract redirect URIs (required for authorization code flow)
    const redirectUris = body.redirect_uris || [];
    
    // Store the client
    registeredClients.set(clientId, {
      client_id: clientId,
      client_name: body.client_name,
      redirect_uris: redirectUris,
      created_at: Date.now(),
    });

    // Return client credentials per RFC 7591
    const response = {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      
      // Echo back provided metadata
      client_name: body.client_name,
      redirect_uris: redirectUris,
      
      // Supported grant types
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // Public client
    };

    return NextResponse.json(response, {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Client registration error:', error);
    return NextResponse.json(
      { error: 'invalid_client_metadata' },
      { status: 400 }
    );
  }
}

// Export the client store for use by other endpoints
export function getRegisteredClient(clientId: string) {
  return registeredClients.get(clientId);
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
