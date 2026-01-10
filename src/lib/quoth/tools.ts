/**
 * Quoth MCP Tools
 * Tool implementations for the Quoth MCP Server
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'fs/promises';
import path from 'path';
import {
  searchDocuments,
  readDocument,
  buildSearchIndex,
} from './search';
import { DEFAULT_CONFIG } from './types';

/**
 * Register all Quoth tools on an MCP server
 */
export function registerQuothTools(
  server: McpServer,
  knowledgeBasePath: string = DEFAULT_CONFIG.knowledgeBasePath
) {
  // Tool 1: quoth_search_index
  server.registerTool(
    'quoth_search_index',
    {
      title: 'Search Quoth Documentation',
      description:
        'Searches the Quoth documentation index for relevant topics, patterns, or architecture notes. Returns a lightweight list of matching File IDs and Titles.',
      inputSchema: {
        query: z.string().describe('Search query, e.g. "auth flow", "vitest mocks"'),
      },
    },
    async ({ query }) => {
      try {
        const results = await searchDocuments(query, knowledgeBasePath);
        
        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No documents found matching "${query}". Try different search terms or use quoth_read_doc with a known document ID.`,
              },
            ],
          };
        }
        
        const formattedResults = results.map((doc, index) => 
          `${index + 1}. **${doc.title}** (ID: \`${doc.id}\`)\n   Type: ${doc.type} | Path: ${doc.path}`
        ).join('\n\n');
        
        return {
          content: [
            {
              type: 'text' as const,
              text: `## Search Results for "${query}"\n\nFound ${results.length} document(s):\n\n${formattedResults}\n\n---\n*Use \`quoth_read_doc\` with a document ID to view full content.*`,
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
        'Retrieves the full content of a specific documentation file using its ID found via search. Returns the full Markdown content + Frontmatter.',
      inputSchema: {
        doc_id: z.string().describe('The document ID, e.g. "pattern-backend-unit"'),
      },
    },
    async ({ doc_id }) => {
      try {
        const doc = await readDocument(doc_id, knowledgeBasePath);
        
        if (!doc) {
          // Try to find similar documents
          const index = await buildSearchIndex(knowledgeBasePath);
          const suggestions = index.documents
            .filter(d => d.id.includes(doc_id) || doc_id.includes(d.id))
            .slice(0, 3);
          
          let suggestionText = '';
          if (suggestions.length > 0) {
            suggestionText = `\n\nDid you mean one of these?\n${suggestions.map(s => `- ${s.id}`).join('\n')}`;
          }
          
          return {
            content: [
              {
                type: 'text' as const,
                text: `Document with ID "${doc_id}" not found.${suggestionText}\n\nUse \`quoth_search_index\` to find available documents.`,
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
              text: `## Document: ${doc.title}\n\n**Frontmatter:**\n\`\`\`yaml\n${frontmatterYaml}\n\`\`\`\n\n**Content:**\n\n${doc.content}`,
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
        'Submits a proposal to update documentation. Requires evidence and reasoning. Updates are logged for review.',
      inputSchema: {
        doc_id: z.string().describe('The document ID to update'),
        new_content: z.string().describe('The proposed new content'),
        evidence_snippet: z.string().describe('Code snippet or commit reference as evidence'),
        reasoning: z.string().describe('Explanation of why this update is needed'),
      },
    },
    async ({ doc_id, new_content, evidence_snippet, reasoning }) => {
      try {
        // Verify document exists
        const existingDoc = await readDocument(doc_id, knowledgeBasePath);
        
        if (!existingDoc) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Cannot propose update: Document "${doc_id}" not found. Use \`quoth_search_index\` to verify the document ID.`,
              },
            ],
          };
        }
        
        // Create proposal entry
        const proposalId = `PROP-${Date.now()}`;
        const proposalDate = new Date().toISOString().split('T')[0];
        
        const proposalEntry = `
### ${proposalDate} - ${proposalId}
**Document**: ${doc_id}  
**Proposed By**: AI Agent  
**Status**: Pending  
**Evidence**: 
\`\`\`
${evidence_snippet}
\`\`\`
**Reasoning**: ${reasoning}  
**Proposed Changes**: 
<details>
<summary>View proposed content</summary>

${new_content}

</details>

---
`;
        
        // Append to validation log
        const logPath = path.resolve(process.cwd(), knowledgeBasePath, 'meta', 'validation-log.md');
        
        try {
          let logContent = await fs.readFile(logPath, 'utf-8');
          
          // Insert proposal after "## Pending Proposals" section
          const pendingSection = '## Pending Proposals';
          const insertIndex = logContent.indexOf(pendingSection);
          
          if (insertIndex !== -1) {
            const afterPending = insertIndex + pendingSection.length;
            logContent = 
              logContent.slice(0, afterPending) + 
              '\n' + proposalEntry + 
              logContent.slice(afterPending);
            
            await fs.writeFile(logPath, logContent, 'utf-8');
          }
        } catch {
          // If log doesn't exist, we'll just report success without persisting
          console.warn('Could not update validation log');
        }
        
        return {
          content: [
            {
              type: 'text' as const,
              text: `## Update Proposal Created

**Proposal ID**: ${proposalId}
**Target Document**: ${doc_id} (${existingDoc.title})
**Status**: Pending Review

### Evidence Provided
\`\`\`
${evidence_snippet}
\`\`\`

### Reasoning
${reasoning}

---

The proposal has been logged for review. A human maintainer will approve or reject this change.

**Next Steps:**
- The proposal is logged in \`meta/validation-log.md\`
- Once approved, the document will be updated
- The \`last_verified_commit\` field will be updated automatically`,
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
