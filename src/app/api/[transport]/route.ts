/**
 * Quoth MCP Server API Route
 * Main entry point for the Model Context Protocol server
 * 
 * Endpoint: /api/mcp (Streamable HTTP)
 * 
 * Features:
 * - 3 Tools: quoth_search_index, quoth_read_doc, quoth_propose_update
 * - 2 Prompts: quoth_architect, quoth_auditor
 */

import { createMcpHandler } from 'mcp-handler';
import { registerQuothTools } from '@/lib/quoth/tools';
import { getArchitectPrompt, getAuditorPrompt } from '@/lib/quoth/prompts';

const KNOWLEDGE_BASE_PATH = './quoth-knowledge-base';

const handler = createMcpHandler(
  (server) => {
    // Register all Quoth tools
    registerQuothTools(server, KNOWLEDGE_BASE_PATH);

    // Register Prompts (Personas)
    server.registerPrompt(
      'quoth_architect',
      {
        description:
          "Initialize the session for writing code or tests. Loads the 'Single Source of Truth' enforcement rules. Use this persona when generating new code.",
      },
      async () => getArchitectPrompt()
    );

    server.registerPrompt(
      'quoth_auditor',
      {
        description:
          'Initialize the session for reviewing code and updating documentation. Activates strict contrast rules between code and docs.',
      },
      async () => getAuditorPrompt()
    );
  },
  {},
  {
    // Handler options
    basePath: '/api',
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV === 'development',
  }
);

// Export handlers for Next.js App Router
export { handler as GET, handler as POST };
