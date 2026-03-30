/**
 * Quoth MCP Server - Public Demo Endpoint
 * Read-only MCP endpoint that serves Quoth's own documentation.
 * No authentication required. No database queries. No user data.
 *
 * Endpoint: /api/mcp/public
 *
 * Tools exposed:
 * - quoth_search_index  — simple text search across MDX content
 * - quoth_read_doc      — return full content of a specific doc by path
 */

import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import type { NextRequest } from 'next/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ---------------------------------------------------------------------------
// Rate limiting — 100 requests per day per IP (public endpoint, no auth)
// ---------------------------------------------------------------------------

let _publicLimiter: Ratelimit | null = null;

function getPublicLimiter(): Ratelimit | null {
  if (_publicLimiter) return _publicLimiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  _publicLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(100, '1 d'),
    prefix: 'rl:public-mcp',
  });
  return _publicLimiter;
}

async function checkPublicRateLimit(req: NextRequest): Promise<Response | null> {
  const limiter = getPublicLimiter();
  if (!limiter) return null; // No Redis = no limit (dev mode)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  const { success, remaining, reset } = await limiter.limit(ip);
  if (!success) {
    return Response.json(
      { error: 'Rate limit exceeded. 100 requests per day allowed.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(reset),
          'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)),
        },
      },
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Doc index — built once at module load time (cached in memory)
// ---------------------------------------------------------------------------

interface DocEntry {
  /** Relative path from content/docs/, e.g. "getting-started/quick-start.mdx" */
  filePath: string;
  title: string;
  description: string;
  content: string;
}

const DOCS_DIR = path.join(process.cwd(), 'content', 'docs');

/**
 * Recursively collect all .mdx files under a directory.
 */
function collectMdxFiles(dir: string, base: string = dir): string[] {
  let results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(collectMdxFiles(full, base));
    } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      results.push(path.relative(base, full));
    }
  }
  return results;
}

/**
 * Parse the frontmatter title/description from MDX content.
 * Handles simple YAML frontmatter between --- delimiters.
 */
function parseFrontmatter(raw: string): { title: string; description: string; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    return { title: '', description: '', body: raw };
  }
  const yaml = match[1];
  const body = match[2];

  const titleMatch = yaml.match(/^title\s*:\s*["']?(.+?)["']?\s*$/m);
  const descMatch = yaml.match(/^description\s*:\s*["']?(.+?)["']?\s*$/m);

  return {
    title: titleMatch ? titleMatch[1].trim() : '',
    description: descMatch ? descMatch[1].trim() : '',
    body,
  };
}

/**
 * Build the in-memory doc index by reading all MDX files from disk.
 */
function buildDocIndex(): DocEntry[] {
  const files = collectMdxFiles(DOCS_DIR);
  const docs: DocEntry[] = [];

  for (const relPath of files) {
    const absPath = path.join(DOCS_DIR, relPath);
    let raw: string;
    try {
      raw = fs.readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }
    const { title, description, body } = parseFrontmatter(raw);
    docs.push({
      filePath: relPath,
      title: title || relPath,
      description: description || '',
      content: raw,
      // body is included in content (full raw); kept separately for search
    });
    void body; // suppress unused warning — body is part of raw/content
  }

  return docs;
}

// Build the index once at module load.
const DOC_INDEX: DocEntry[] = buildDocIndex();

// ---------------------------------------------------------------------------
// Tool helpers
// ---------------------------------------------------------------------------

/**
 * Simple case-insensitive text search across docs.
 * Returns docs that contain the query string in title, description, or body.
 */
function searchDocs(query: string): Array<{ filePath: string; title: string; description: string; snippet: string }> {
  const q = query.toLowerCase();
  const results: Array<{ filePath: string; title: string; description: string; snippet: string; score: number }> = [];

  for (const doc of DOC_INDEX) {
    const haystack = `${doc.title} ${doc.description} ${doc.content}`.toLowerCase();
    if (!haystack.includes(q)) continue;

    // Build a small snippet around the first match in content
    const idx = doc.content.toLowerCase().indexOf(q);
    let snippet = '';
    if (idx !== -1) {
      const start = Math.max(0, idx - 100);
      const end = Math.min(doc.content.length, idx + 300);
      snippet = doc.content.slice(start, end).replace(/\n+/g, ' ').trim();
      if (start > 0) snippet = '...' + snippet;
      if (end < doc.content.length) snippet = snippet + '...';
    }

    // Rudimentary score: title/description hits weight more
    let score = 0;
    if (doc.title.toLowerCase().includes(q)) score += 3;
    if (doc.description.toLowerCase().includes(q)) score += 2;
    if (doc.content.toLowerCase().includes(q)) score += 1;

    results.push({ filePath: doc.filePath, title: doc.title, description: doc.description, snippet, score });
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ filePath, title, description, snippet }) => ({ filePath, title, description, snippet }));
}

/**
 * Sanitize a doc path to prevent directory traversal.
 */
function sanitizeDocPath(input: string): string {
  // Normalise and strip any leading slashes/dots
  const normalised = path.normalize(input).replace(/^(\.\.[/\\])+/, '');
  return normalised;
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------

function registerPublicTools(server: McpServer) {
  // Tool 1: quoth_search_index
  server.registerTool(
    'quoth_search_index',
    {
      title: 'Search Quoth Documentation',
      description:
        'Performs a simple text search across the Quoth documentation. ' +
        'Returns up to 10 relevant documents with a content snippet. ' +
        'No authentication required — this endpoint serves Quoth\'s own docs as a public demo.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(500)
          .describe('Search query (plain text, max 500 chars)'),
      },
    },
    async ({ query }) => {
      const results = searchDocs(query);

      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No documentation found matching "${query}".`,
            },
          ],
        };
      }

      const formatted = results
        .map((doc, i) =>
          `<result index="${i + 1}">
  <path>${doc.filePath}</path>
  <title>${doc.title}</title>
  <description>${doc.description}</description>
  <snippet>${doc.snippet}</snippet>
</result>`
        )
        .join('\n\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `<search_results query="${query}" count="${results.length}">\n${formatted}\n</search_results>`,
          },
        ],
      };
    }
  );

  // Tool 2: quoth_read_doc
  server.registerTool(
    'quoth_read_doc',
    {
      title: 'Read Quoth Documentation File',
      description:
        'Returns the full MDX content of a specific documentation file. ' +
        'Use the filePath value returned by quoth_search_index, e.g. "getting-started/quick-start.mdx".',
      inputSchema: {
        filePath: z
          .string()
          .min(1)
          .max(200)
          .describe('Relative path to the doc file, e.g. "getting-started/quick-start.mdx"'),
      },
    },
    async ({ filePath }) => {
      const safe = sanitizeDocPath(filePath);
      const doc = DOC_INDEX.find((d) => d.filePath === safe);

      if (!doc) {
        // List available paths to help the caller
        const available = DOC_INDEX.map((d) => d.filePath).join('\n');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Document not found: "${safe}".\n\nAvailable documents:\n${available}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `# ${doc.title}\n\n**Path:** ${doc.filePath}\n\n---\n\n${doc.content}`,
          },
        ],
      };
    }
  );
}

// ---------------------------------------------------------------------------
// Handler & route exports
// ---------------------------------------------------------------------------

const publicHandler = createMcpHandler(
  (server: McpServer) => registerPublicTools(server),
  {},
  {
    basePath: '/api/mcp',
    maxDuration: 30,
    verboseLogs: false,
  }
);

export async function GET(req: NextRequest) {
  const limited = await checkPublicRateLimit(req);
  if (limited) return limited;
  return publicHandler(req);
}

export async function POST(req: NextRequest) {
  const limited = await checkPublicRateLimit(req);
  if (limited) return limited;
  return publicHandler(req);
}
