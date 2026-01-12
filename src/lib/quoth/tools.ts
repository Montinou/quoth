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
import { registerGenesisTools } from './genesis';
import { syncDocument } from '../sync';

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
          
          // Trust levels for Gemini 2.0 context weighting
          let trustLevel = 'LOW';
          if (doc.relevance! > 0.8) trustLevel = 'HIGH';
          else if (doc.relevance! > 0.6) trustLevel = 'MEDIUM';

          return `
<document index="${index + 1}" trust="${trustLevel}" relevance="${similarity}%">
  <title>${doc.title}</title>
  <path>${doc.path}</path>
  <type>${doc.type}</type>
  <content>
    ${doc.snippet || '(No content snippet)'}
  </content>
</document>`;
        }).join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `<search_results query="${query}" count="${results.length}">
${formattedResults}
</search_results>

Instructions:
- Use HIGH trust documents as primary sources.
- Use MEDIUM trust documents for context.
- Verify LOW trust documents against other sources.
- To read full content, use \`quoth_read_doc\` with the document path.`,
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
        'Creates or updates documentation. For new documents, creates directly. For existing documents, either applies directly or creates a proposal depending on project settings.',
      inputSchema: {
        doc_id: z.string().describe('The document title or path (e.g., "architecture/project-overview.md")'),
        new_content: z.string().describe('The proposed new content (full Markdown with frontmatter)'),
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

        // 2. Get project settings for approval mode FIRST
        const { data: project } = await supabase
          .from('projects')
          .select('require_approval')
          .eq('id', authContext.project_id)
          .single();

        // 3. Check if document exists in user's project
        const existingDoc = await readDocument(doc_id, authContext.project_id);

        // 4. Extract title from doc_id path (e.g., "architecture/project-overview.md" -> "project-overview")
        const extractTitle = (path: string) => {
          const filename = path.split('/').pop() || path;
          return filename.replace(/\.md$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        };

        // 5. DOCUMENT DOES NOT EXIST - Create new document
        if (!existingDoc) {
          const docPath = doc_id.endsWith('.md') ? doc_id : `${doc_id}.md`;
          const docTitle = extractTitle(docPath);

          // 5a. Direct create mode (no approval required OR new documents always direct)
          if (project && !project.require_approval) {
            const { document, chunksIndexed, chunksReused } = await syncDocument(
              authContext.project_id,
              docPath,
              docTitle,
              new_content
            );

            return {
              content: [{
                type: 'text' as const,
                text: `## ✅ New Document Created

**Document**: ${docTitle}
**Path**: \`${docPath}\`
**Version**: ${document.version || 1}

### Indexing Stats
- Chunks indexed: ${chunksIndexed}
- Chunks reused (cached): ${chunksReused}

### Evidence
\`\`\`
${evidence_snippet.slice(0, 200)}${evidence_snippet.length > 200 ? '...' : ''}
\`\`\`

---
*Document created and indexed successfully.*`,
              }],
            };
          }

          // 5b. Approval required for new documents - create proposal with null original
          const { data: proposal, error } = await supabase
            .from('document_proposals')
            .insert({
              document_id: null, // New document, no existing ID
              project_id: authContext.project_id,
              file_path: docPath,
              original_content: null, // Indicates new document
              proposed_content: new_content,
              reasoning: `[NEW DOCUMENT] ${reasoning}`,
              evidence_snippet,
              status: 'pending'
            })
            .select()
            .single();

          if (error) {
            throw new Error(`Failed to create proposal: ${error.message}`);
          }

          const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

          return {
            content: [{
              type: 'text' as const,
              text: `## 📝 New Document Proposal Created

**Proposal ID**: ${proposal.id}
**New Document**: ${docTitle}
**Path**: \`${docPath}\`
**Status**: Pending Review

🔗 **Review in Dashboard**: ${dashboardUrl}/proposals/${proposal.id}

### Reasoning
${reasoning}

---
*New document requires admin approval before being added to the knowledge base.*`,
            }],
          };
        }

        // 6. DOCUMENT EXISTS - Update existing document
        // 6a. DIRECT APPLY MODE (no approval required)
        if (project && !project.require_approval) {
          const { document, chunksIndexed, chunksReused } = await syncDocument(
            authContext.project_id,
            existingDoc.path,
            existingDoc.title,
            new_content
          );

          return {
            content: [{
              type: 'text' as const,
              text: `## ✅ Documentation Updated Directly

**Document**: ${existingDoc.title}
**Path**: \`${existingDoc.path}\`
**Version**: ${document.version || 'N/A'}

### Indexing Stats
- Chunks re-indexed: ${chunksIndexed}
- Chunks reused (cached): ${chunksReused}
- Token savings: ${chunksReused > 0 ? Math.round((chunksReused / (chunksIndexed + chunksReused)) * 100) : 0}%

---
*Changes applied immediately. Previous version preserved in history.*`,
            }],
          };
        }

        // 6b. APPROVAL REQUIRED MODE - Insert proposal into Supabase
        const { data: proposal, error } = await supabase
          .from('document_proposals')
          .insert({
            document_id: existingDoc.id,
            project_id: authContext.project_id,
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
2. If approved, changes are saved directly to the knowledge base
3. Previous version automatically preserved in history
4. Vector embeddings regenerated (incrementally)

*All documentation changes require human approval before being applied.*`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error creating/updating document: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Register Genesis tools
  registerGenesisTools(server, authContext);
}
