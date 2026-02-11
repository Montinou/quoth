import { NextResponse } from 'next/server';

const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Quoth MCP API',
    version: '1.0.0',
    description: 'Model Context Protocol server for documentation-driven development. Enforces consistency between codebases and documentation.',
    contact: {
      name: 'Quoth Labs',
      url: 'https://quoth.triqual.dev',
      email: 'hello@quoth.triqual.dev',
    },
    license: { name: 'MIT' },
  },
  servers: [{ url: 'https://quoth.triqual.dev', description: 'Production' }],
  paths: {
    '/api/mcp': {
      post: {
        summary: 'MCP Protocol Endpoint (Authenticated)',
        description: 'Authenticated MCP endpoint for tool calls. Requires Bearer token from OAuth or API key.',
        tags: ['MCP'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/McpRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'MCP response with tool results',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/McpResponse' },
              },
            },
          },
          401: { description: 'Authentication required' },
          429: { description: 'Rate limit exceeded' },
        },
      },
    },
    '/api/mcp/public': {
      post: {
        summary: 'MCP Protocol Endpoint (Public)',
        description: 'Read-only public access to demo knowledge base. No authentication required. Rate limited to 10 requests per minute.',
        tags: ['MCP'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/McpRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'MCP response',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/McpResponse' },
              },
            },
          },
          429: { description: 'Rate limit exceeded' },
        },
      },
    },
    '/api/mcp/sse': {
      get: {
        summary: 'MCP SSE Transport',
        description: 'Server-Sent Events transport for MCP protocol. Token passed via query parameter.',
        tags: ['MCP'],
        parameters: [
          {
            name: 'token',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'JWT API token',
          },
        ],
        responses: {
          200: {
            description: 'SSE stream established',
            content: { 'text/event-stream': {} },
          },
        },
      },
    },
    '/.well-known/oauth-authorization-server': {
      get: {
        summary: 'OAuth Discovery',
        description: 'OAuth 2.1 authorization server metadata (RFC 8414)',
        tags: ['OAuth'],
        responses: {
          200: {
            description: 'OAuth server metadata',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OAuthMetadata' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token from OAuth flow or API key generation',
      },
    },
    schemas: {
      McpRequest: {
        type: 'object',
        required: ['method'],
        properties: {
          jsonrpc: { type: 'string', default: '2.0' },
          id: { type: ['string', 'number'] },
          method: {
            type: 'string',
            enum: ['tools/list', 'tools/call', 'prompts/list', 'prompts/get'],
          },
          params: { type: 'object' },
        },
      },
      McpResponse: {
        type: 'object',
        properties: {
          jsonrpc: { type: 'string' },
          id: { type: ['string', 'number'] },
          result: { type: 'object' },
          error: {
            type: 'object',
            properties: {
              code: { type: 'number' },
              message: { type: 'string' },
            },
          },
        },
      },
      OAuthMetadata: {
        type: 'object',
        properties: {
          issuer: { type: 'string' },
          authorization_endpoint: { type: 'string' },
          token_endpoint: { type: 'string' },
          registration_endpoint: { type: 'string' },
          response_types_supported: { type: 'array', items: { type: 'string' } },
          grant_types_supported: { type: 'array', items: { type: 'string' } },
        },
      },
      Tool: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          inputSchema: { type: 'object' },
        },
      },
    },
  },
  tags: [
    { name: 'MCP', description: 'Model Context Protocol endpoints' },
    { name: 'OAuth', description: 'OAuth 2.1 authentication' },
  ],
};

export async function GET() {
  return NextResponse.json(openApiSpec, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
