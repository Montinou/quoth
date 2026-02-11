/**
 * Quoth MCP Server - Public Demo Endpoint
 * Read-only MCP endpoint without authentication for demo/trial purposes
 *
 * Endpoint: /api/mcp/public
 *
 * Features:
 * - No authentication required
 * - Read-only access (search and read only)
 * - Hardcoded to public demo project (quoth-knowledge-base)
 * - Stricter rate limits than authenticated endpoints
 */

import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { searchDocuments, readDocument, buildSearchIndex } from '@/lib/quoth/search';
import { checkRateLimit } from '@/lib/rate-limit';

// Public demo project ID
const PUBLIC_PROJECT_ID = 'quoth-knowledge-base';

/**
 * Register read-only tools for public access
 */
function registerPublicTools(server: McpServer) {
  // Tool 1: quoth_search_index (Read-only semantic search)
  server.registerTool(
    'quoth_search_index',
    {
      title: 'Search Quoth Documentation (Public)',
      description:
        'Performs semantic search across the public Quoth documentation. ' +
        'Returns relevant document chunks ranked by similarity. ' +
        'Note: This is a public demo - authenticate for full access.',
      inputSchema: {
        query: z
          .string()
          .max(500)
          .describe(
            'Natural language search query (max 500 chars)'
          ),
      },
    },
    async ({ query }) => {
      try {
        const results = await searchDocuments(query, PUBLIC_PROJECT_ID);

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No documents found matching "${query}".\n\nThis is the public demo. Sign up for full access to private knowledge bases.`,
              },
            ],
          };
        }

        const formattedResults = results
          .slice(0, 10) // Limit to 10 results for public
          .map((doc, index) => {
            const similarity = Math.round((doc.relevance || 0) * 100);
            let trustLevel = 'LOW';
            if (doc.relevance! > 0.8) trustLevel = 'HIGH';
            else if (doc.relevance! > 0.6) trustLevel = 'MEDIUM';

            return `
<chunk index="${index + 1}" trust="${trustLevel}" relevance="${similarity}%">
  <document>
    <title>${doc.title}</title>
    <path>${doc.path}</path>
    <type>${doc.type}</type>
  </document>
  <content>
    ${(doc.snippet || '(No content snippet)').slice(0, 500)}
  </content>
</chunk>`;
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `<search_results query="${query}" count="${Math.min(results.length, 10)}" mode="public">
${formattedResults}
</search_results>

**Public Demo Mode**
- Results limited to 10 matches
- Sign up at https://quoth.triqual.dev for full access`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error searching documents: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Tool 2: quoth_read_doc (Read-only document retrieval)
  server.registerTool(
    'quoth_read_doc',
    {
      title: 'Read Quoth Document (Public)',
      description:
        'Retrieves the content of a documentation file from the public knowledge base.',
      inputSchema: {
        doc_id: z
          .string()
          .max(200)
          .describe(
            'The document title or file path'
          ),
      },
    },
    async ({ doc_id }) => {
      try {
        const doc = await readDocument(doc_id, PUBLIC_PROJECT_ID);

        if (!doc) {
          const index = await buildSearchIndex(PUBLIC_PROJECT_ID);
          const suggestions = index.documents
            .filter(
              (d) =>
                d.id.toLowerCase().includes(doc_id.toLowerCase()) ||
                doc_id.toLowerCase().includes(d.id.toLowerCase()) ||
                d.path.toLowerCase().includes(doc_id.toLowerCase())
            )
            .slice(0, 3);

          let suggestionText = '';
          if (suggestions.length > 0) {
            suggestionText = `\n\nDid you mean one of these?\n${suggestions.map((s) => `- ${s.id} (${s.path})`).join('\n')}`;
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: `Document "${doc_id}" not found.${suggestionText}\n\nUse \`quoth_search_index\` to find available documents.`,
              },
            ],
          };
        }

        // Format frontmatter
        const frontmatterYaml = Object.entries(doc.frontmatter)
          .map(
            ([key, value]) =>
              `${key}: ${Array.isArray(value) ? `[${value.join(', ')}]` : value}`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `## Document: ${doc.title}\n\n**Path:** \`${doc.path}\`\n\n**Metadata:**\n\`\`\`yaml\n${frontmatterYaml}\n\`\`\`\n\n**Content:**\n\n${doc.content}\n\n---\n*Public demo - sign up for write access and private knowledge bases*`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error reading document: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );
}

/**
 * Create MCP handler for public access
 */
function createPublicHandler() {
  return createMcpHandler(
    (server: McpServer) => registerPublicTools(server),
    {},
    {
      basePath: '/api/mcp',
      maxDuration: 30, // Shorter timeout for public
      verboseLogs: false,
    }
  );
}

/**
 * Rate limit middleware for public endpoint
 */
async function withPublicRateLimit(
  req: NextRequest,
  handler: (req: NextRequest) => Promise<Response>
): Promise<Response> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ||
             req.headers.get('x-real-ip') ||
             'anonymous';

  const rateLimitResult = checkRateLimit(`public:${ip}`, {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10, // 10 requests per minute for public
  });

  if (!rateLimitResult.allowed) {
    return new Response(
      JSON.stringify({
        error: 'rate_limit_exceeded',
        error_description: 'Too many requests. Please wait before trying again.',
        retry_after: Math.ceil(rateLimitResult.resetIn / 1000),
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(rateLimitResult.resetIn / 1000)),
          'X-RateLimit-Limit': '10',
          'X-RateLimit-Remaining': String(rateLimitResult.remaining),
          'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000 + rateLimitResult.resetIn / 1000)),
        },
      }
    );
  }

  const response = await handler(req);

  // Add rate limit headers to response
  const headers = new Headers(response.headers);
  headers.set('X-RateLimit-Limit', '10');
  headers.set('X-RateLimit-Remaining', String(rateLimitResult.remaining));
  headers.set('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000 + rateLimitResult.resetIn / 1000)));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const publicHandler = createPublicHandler();

/**
 * GET handler for public MCP endpoint
 */
export async function GET(req: NextRequest) {
  return withPublicRateLimit(req, publicHandler);
}

/**
 * POST handler for public MCP endpoint
 */
export async function POST(req: NextRequest) {
  return withPublicRateLimit(req, publicHandler);
}
