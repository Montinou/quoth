/**
 * Quoth MCP Server API Route
 * Main entry point for the Model Context Protocol server
 *
 * Endpoint: /api/mcp (Streamable HTTP)
 *
 * Features:
 * - JWT-based authentication with role-based access control
 * - 3 Tools: quoth_search_index, quoth_read_doc, quoth_propose_update
 * - 2 Prompts: quoth_architect, quoth_auditor
 *
 * Authentication:
 * - Requires Bearer token in Authorization header
 * - Token must be generated from /dashboard/api-keys
 * - Token contains project_id, user_id, and role
 */

import { createAuthenticatedMcpHandler } from '@/lib/auth/mcp-auth';
import { registerQuothTools } from '@/lib/quoth/tools';
import { getArchitectPrompt, getAuditorPrompt } from '@/lib/quoth/prompts';

const handler = createAuthenticatedMcpHandler(
  (server, authContext) => {
    // Register all Quoth tools with authentication context
    // Tools will use authContext.project_id to filter data
    registerQuothTools(server, authContext);

    // Register Prompts (Personas)
    // Prompts are public and don't require project isolation
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
  {
    // Handler options
    basePath: '/api',
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV === 'development',
  }
);

// Export handlers for Next.js App Router
export { handler as GET, handler as POST };
