/**
 * Quoth MCP Tools
 * Tool implementations for the Quoth MCP Server
 * Uses Supabase + Gemini for semantic vector search
 * Enforces multi-tenant isolation via authContext
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../auth/mcp-auth';
import {
  searchDocuments,
  readDocument,
  buildSearchIndex,
} from './search';
import { supabase } from '../supabase';

/**
 * Register all Quoth tools on an MCP server with authentication context
 * Tools are filtered by authContext.project_id for multi-tenant isolation
 *
 * @param server - MCP server instance
 * @param authContext - Authentication context containing project_id, user_id, and role
 */
export function registerQuothTools(
  server: McpServer,
  authContext: AuthContext
) {
  // Tool 1: quoth_search_index (Semantic Vector Search)
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
        // Use authContext.project_id for multi-tenant isolation
        const results = await searchDocuments(query, authContext.project_id);

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No documents found matching "${query}".\n\nTry:\n- Using different phrasing\n- More general terms\n- Checking if the knowledge base is indexed`,
              },
            ],
          };
        }

        const formattedResults = results.map((doc, index) => {
          const similarity = Math.round((doc.relevance || 0) * 100);
          let result = `${index + 1}. **${doc.title}** (${similarity}% match)\n`;
          result += `   Path: \`${doc.path}\` | Type: ${doc.type}`;

          // Include snippet if available
          if (doc.snippet) {
            result += `\n   > ${doc.snippet}`;
          }

          return result;
        }).join('\n\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `## Semantic Search Results for "${query}"\n\nFound ${results.length} relevant document(s):\n\n${formattedResults}\n\n---\n*Use \`quoth_read_doc\` with a document title to view full content.*`,
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

  // Tool 2: quoth_read_doc
  server.registerTool(
    'quoth_read_doc',
    {
      title: 'Read Quoth Document',
      description:
        'Retrieves the full content of a specific documentation file by its title or path. Returns the complete Markdown content with metadata.',
      inputSchema: {
        doc_id: z.string().describe('The document title or file path, e.g. "backend-unit-vitest" or "patterns/backend-unit-vitest.md"'),
      },
    },
    async ({ doc_id }) => {
      try {
        // Use authContext.project_id for multi-tenant isolation
        const doc = await readDocument(doc_id, authContext.project_id);

        if (!doc) {
          // Try to find similar documents within the user's project
          const index = await buildSearchIndex(authContext.project_id);
          const suggestions = index.documents
            .filter(d =>
              d.id.toLowerCase().includes(doc_id.toLowerCase()) ||
              doc_id.toLowerCase().includes(d.id.toLowerCase()) ||
              d.path.toLowerCase().includes(doc_id.toLowerCase())
            )
            .slice(0, 3);

          let suggestionText = '';
          if (suggestions.length > 0) {
            suggestionText = `\n\nDid you mean one of these?\n${suggestions.map(s => `- ${s.id} (${s.path})`).join('\n')}`;
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

        // Format frontmatter as YAML block
        const frontmatterYaml = Object.entries(doc.frontmatter)
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(', ')}]` : value}`)
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `## Document: ${doc.title}\n\n**Path:** \`${doc.path}\`\n\n**Metadata:**\n\`\`\`yaml\n${frontmatterYaml}\n\`\`\`\n\n**Content:**\n\n${doc.content}`,
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

  // Tool 3: quoth_propose_update
  server.registerTool(
    'quoth_propose_update',
    {
      title: 'Propose Documentation Update',
      description:
        'Submits a proposal to update documentation. Requires evidence and reasoning. Updates are logged for human review before being applied.',
      inputSchema: {
        doc_id: z.string().describe('The document title or path to update'),
        new_content: z.string().describe('The proposed new content (full Markdown)'),
        evidence_snippet: z.string().describe('Code snippet or commit reference as evidence for the change'),
        reasoning: z.string().describe('Explanation of why this update is needed'),
      },
    },
    async ({ doc_id, new_content, evidence_snippet, reasoning }) => {
      try {
        // 1. Check role-based access control
        if (authContext.role === 'viewer') {
          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ Permission Denied: Viewers cannot propose documentation updates.\n\nOnly users with 'editor' or 'admin' roles can submit proposals. Contact your project admin to upgrade your role.`,
              },
            ],
          };
        }

        // 2. Verify document exists in user's project
        const existingDoc = await readDocument(doc_id, authContext.project_id);

        if (!existingDoc) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Cannot propose update: Document "${doc_id}" not found in your project. Use \`quoth_search_index\` to verify the document exists.`,
              },
            ],
          };
        }

        // 3. Insert proposal into Supabase
        const { data: proposal, error } = await supabase
          .from('document_proposals')
          .insert({
            document_id: existingDoc.id,
            project_id: authContext.project_id, // Use authenticated project ID
            file_path: existingDoc.path,
            original_content: existingDoc.content,
            proposed_content: new_content,
            reasoning,
            evidence_snippet,
            status: 'pending'
          })
          .select()
          .single();

        if (error) {
          throw new Error(`Failed to create proposal: ${error.message}`);
        }

        // 4. Return success with dashboard link
        const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

        return {
          content: [
            {
              type: 'text' as const,
              text: `## Update Proposal Created

**Proposal ID**: ${proposal.id}
**Target Document**: ${existingDoc.title}
**Path**: \`${existingDoc.path}\`
**Status**: Pending Review

🔗 **Review in Dashboard**: ${dashboardUrl}/proposals/${proposal.id}

### Evidence Provided
\`\`\`
${evidence_snippet}
\`\`\`

### Reasoning
${reasoning}

---

The proposal has been logged for human review. A maintainer will review and approve/reject this change.

**What happens next:**
1. Human reviewer examines the proposal in the dashboard
2. If approved, changes are committed to GitHub
3. The knowledge base is re-indexed automatically
4. Email notification sent to tech leads

*All documentation changes require human approval before being applied.*`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error creating proposal: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );
}
