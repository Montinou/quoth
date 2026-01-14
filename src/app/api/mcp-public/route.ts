/**
 * Public Quoth MCP Server API Route
 * Unauthenticated demo access to quoth-knowledge-base project
 *
 * Endpoint: /api/mcp-public (Streamable HTTP/SSE)
 *
 * Features:
 * - No authentication required (public demo)
 * - Read-only access to quoth-knowledge-base project
 * - 2 Tools: quoth_search_index, quoth_read_doc (no propose_update)
 * - 3 Prompts: quoth_architect, quoth_auditor, quoth_documenter
 *
 * Usage:
 * claude add quoth  # Installs with public access
 * quoth login       # Upgrades to private projects
 */

import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { searchDocuments, readDocument } from '@/lib/quoth/search';
import { getArchitectPrompt, getAuditorPrompt, getDocumenterPrompt } from '@/lib/quoth/prompts';

// Public demo project ID
const PUBLIC_PROJECT_ID = 'quoth-knowledge-base';

const handler = createMcpHandler(
  (server) => {
    // Tool 1: Search (Read-only)
    server.registerTool(
      'quoth_search_index',
      {
        title: 'Semantic Search Quoth Documentation',
        description:
          'Performs semantic search across the Quoth documentation using AI embeddings. Returns relevant document chunks ranked by similarity. Much smarter than keyword matching - understands meaning and context.',
        inputSchema: {
          query: z.string().describe('Natural language search query, e.g. "how to mock dependencies in tests", "database connection patterns"'),
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
                  text: `No documents found matching "${query}".\n\nTry:\n- Using different phrasing\n- More general terms\n- Checking if the knowledge base is indexed\n\n💡 Tip: Sign up at https://quoth.ai-innovation.site to create your own private knowledge bases!`,
                },
              ],
            };
          }

          const formattedResults = results.map((doc, index) => {
            const similarity = Math.round((doc.relevance || 0) * 100);
            let result = `${index + 1}. **${doc.title}** (${similarity}% match)\n`;
            result += `   Path: \`${doc.path}\` | Type: ${doc.type}`;

            if (doc.snippet) {
              result += `\n   > ${doc.snippet}`;
            }

            return result;
          }).join('\n\n');

          return {
            content: [
              {
                type: 'text' as const,
                text: `## Semantic Search Results for "${query}"\n\nFound ${results.length} relevant document(s):\n\n${formattedResults}\n\n---\n*Use \`quoth_read_doc\` with a document title to view full content.*\n\n💡 **Using the public demo?** Sign up at https://quoth.ai-innovation.site to:\n- Create private knowledge bases\n- Propose documentation updates\n- Integrate with your team's workflow`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
              },
            ],
          };
        }
      }
    );

    // Tool 2: Read Document (Read-only)
    server.registerTool(
      'quoth_read_doc',
      {
        title: 'Read Full Quoth Document',
        description:
          'Retrieves the complete content of a specific document from the Quoth knowledge base. Use this after searching to get the full details.',
        inputSchema: {
          title: z.string().describe('Document title from search results'),
        },
      },
      async ({ title }) => {
        try {
          const doc = await readDocument(title, PUBLIC_PROJECT_ID);

          if (!doc) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `❌ Document "${title}" not found.\n\nTry:\n- Using exact title from search results\n- Searching first with \`quoth_search_index\``,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: `# ${doc.title}\n\n**Type:** ${doc.type}\n**Path:** \`${doc.path}\`\n**Last Updated:** ${doc.frontmatter.last_updated_date}\n\n---\n\n${doc.content}\n\n---\n\n💡 **Want to propose updates?** Sign up at https://quoth.ai-innovation.site for full access including:\n- Documentation update proposals\n- Private knowledge bases\n- Team collaboration`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ Failed to read document: ${error instanceof Error ? error.message : 'Unknown error'}`,
              },
            ],
          };
        }
      }
    );

    // Prompt 1: Architect (Public)
    server.registerPrompt(
      'quoth_architect',
      {
        description:
          "Initialize the session for writing code or tests. Loads the 'Single Source of Truth' enforcement rules. Use this persona when generating new code.",
      },
      async () => getArchitectPrompt()
    );

    // Prompt 2: Auditor (Public)
    server.registerPrompt(
      'quoth_auditor',
      {
        description:
          'Initialize the session for reviewing code and updating documentation. Activates strict contrast rules between code and docs.',
      },
      async () => getAuditorPrompt()
    );

    // Prompt 3: Documenter (Public - read-only demo)
    server.registerPrompt(
      'quoth_documenter',
      {
        description:
          'Initialize the session for proactive incremental documentation. Use when you want to document new code. (Public demo: proposals require account)',
      },
      async () => getDocumenterPrompt()
    );
  },
  {},
  {
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV === 'development',
  }
);

// Export handlers for Next.js App Router
export { handler as GET, handler as POST };
