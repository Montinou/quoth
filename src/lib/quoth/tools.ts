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
  readChunks,
} from './search';
import { supabase } from '../supabase';
import { registerGenesisTools } from './genesis';
import { syncDocument } from '../sync';
import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';

// Templates directory path (relative to project root)
const TEMPLATES_DIR = path.join(process.cwd(), 'quoth-knowledge-template', 'templates');

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
<chunk index="${index + 1}" trust="${trustLevel}" relevance="${similarity}%">
  <chunk_id>${doc.chunk_id}</chunk_id>
  <document>
    <title>${doc.title}</title>
    <path>${doc.path}</path>
    <type>${doc.type}</type>
  </document>
  <position>${(doc.chunk_index ?? 0) + 1} of document</position>
  <content>
    ${doc.snippet || '(No content snippet)'}
  </content>
</chunk>`;
        }).join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `<search_results query="${query}" count="${results.length}">
${formattedResults}
</search_results>

Instructions:
- HIGH trust chunks are primary sources
- MEDIUM trust chunks provide context
- LOW trust chunks should be cross-referenced

**Access Options:**
- \`quoth_read_chunks\` with chunk_id(s) → fetch specific chunks (token-efficient)
- \`quoth_read_doc\` with document path → fetch full document`,
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

  // Tool 4: quoth_list_templates
  // Reads templates from filesystem (not indexed in database)
  server.registerTool(
    'quoth_list_templates',
    {
      title: 'List Document Templates',
      description:
        'Lists available document templates by category. Templates are chunk-optimized structures for creating well-indexed documentation. Templates are stored in the filesystem, not the database.',
      inputSchema: {
        category: z.enum(['all', 'architecture', 'patterns', 'contracts']).optional()
          .describe('Filter by category. Use "all" or omit to list all templates.'),
      },
    },
    async ({ category }) => {
      try {
        // Read templates from filesystem
        const categories = category && category !== 'all'
          ? [category]
          : ['architecture', 'patterns', 'contracts'];

        interface TemplateInfo {
          title: string;
          filePath: string;
          category: string;
          purpose: string;
          targetType: string;
        }

        const templates: TemplateInfo[] = [];

        for (const cat of categories) {
          const catDir = path.join(TEMPLATES_DIR, cat);

          if (!fs.existsSync(catDir)) continue;

          const files = fs.readdirSync(catDir).filter(f => f.endsWith('.md'));

          for (const file of files) {
            const filePath = path.join(catDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const { data: frontmatter, content: body } = matter(content);

            // Extract purpose from first paragraph after ## Purpose
            const purposeMatch = body.match(/## Purpose[^#]*?\n\n([^\n]+)/);
            const purpose = purposeMatch ? purposeMatch[1].slice(0, 150) : 'No purpose defined';

            templates.push({
              title: frontmatter.id || file.replace('.md', ''),
              filePath: `templates/${cat}/${file}`,
              category: cat,
              purpose,
              targetType: frontmatter.target_type || 'unknown',
            });
          }
        }

        if (templates.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No templates found${category && category !== 'all' ? ` in category "${category}"` : ''}.

Templates are stored in \`quoth-knowledge-template/templates/\`.
Available categories: architecture, patterns, contracts`,
            }],
          };
        }

        const formattedTemplates = templates.map((t, index) => `
<template index="${index + 1}">
  <id>${t.title}</id>
  <path>${t.filePath}</path>
  <category>${t.category}</category>
  <target_type>${t.targetType}</target_type>
  <purpose>${t.purpose}</purpose>
</template>`).join('\n');

        return {
          content: [{
            type: 'text' as const,
            text: `<templates count="${templates.length}"${category && category !== 'all' ? ` category="${category}"` : ''}>
${formattedTemplates}
</templates>

**Usage:**
- Use \`quoth_get_template\` with the template path to fetch full content
- Templates are chunk-optimized for embedding (each H2 = one chunk)
- Follow template structure exactly for best search results
- Optimal section size: 75-300 tokens (~58-231 words)`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error listing templates: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
        };
      }
    }
  );

  // Tool 5: quoth_get_template
  // Reads templates from filesystem (not indexed in database)
  server.registerTool(
    'quoth_get_template',
    {
      title: 'Get Document Template',
      description:
        'Retrieves a specific document template with full structure, examples, and embedding hints. Use templates to create well-indexed documentation. Templates are stored in the filesystem.',
      inputSchema: {
        template_id: z.string()
          .describe('Template path or ID, e.g. "templates/architecture/project-overview.md" or "project-overview"'),
      },
    },
    async ({ template_id }) => {
      try {
        // Helper to find all template files
        const findAllTemplates = (): Array<{ filePath: string; fullPath: string }> => {
          const templates: Array<{ filePath: string; fullPath: string }> = [];
          const categories = ['architecture', 'patterns', 'contracts'];

          for (const cat of categories) {
            const catDir = path.join(TEMPLATES_DIR, cat);
            if (!fs.existsSync(catDir)) continue;

            const files = fs.readdirSync(catDir).filter(f => f.endsWith('.md'));
            for (const file of files) {
              templates.push({
                filePath: `templates/${cat}/${file}`,
                fullPath: path.join(catDir, file),
              });
            }
          }
          return templates;
        };

        const allTemplates = findAllTemplates();
        let foundTemplate: { filePath: string; fullPath: string } | undefined;

        // Try to find by exact path
        if (template_id.startsWith('templates/')) {
          foundTemplate = allTemplates.find(t => t.filePath === template_id);
        }

        // Try to find by filename or partial match
        if (!foundTemplate) {
          const searchTerm = template_id.toLowerCase().replace('.md', '');
          foundTemplate = allTemplates.find(t =>
            t.filePath.toLowerCase().includes(searchTerm) ||
            path.basename(t.filePath, '.md').toLowerCase() === searchTerm
          );
        }

        if (!foundTemplate) {
          const suggestions = allTemplates.slice(0, 5).map(t => `- ${t.filePath}`).join('\n');

          return {
            content: [{
              type: 'text' as const,
              text: `Template "${template_id}" not found.

**Available templates:**
${suggestions}

Use \`quoth_list_templates\` to see all available templates.`,
            }],
          };
        }

        // Read and parse the template
        const content = fs.readFileSync(foundTemplate.fullPath, 'utf-8');
        const { data: frontmatter } = matter(content);

        const title = frontmatter.id || path.basename(foundTemplate.filePath, '.md');

        return {
          content: [{
            type: 'text' as const,
            text: `## Template: ${title}

**Path:** \`${foundTemplate.filePath}\`
**Category:** ${frontmatter.category || 'unknown'}
**Target Type:** ${frontmatter.target_type || 'unknown'}

---

${content}

---

**Chunk Optimization Notes:**
- Each \`## \` section becomes a separate embedding chunk
- Optimal section size: 75-300 tokens (~58-231 words)
- Frontmatter keywords are injected into all chunks as prefix
- Use aliases in headers: \`## Topic (Alias1, Alias2)\`
- End each section with \`**Summary:**\` for chunk closure
- Include 4-6 FAQ items per document for searchability`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error getting template: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
        };
      }
    }
  );

  // Tool 6: quoth_read_chunks (Fetch Chunks by ID)
  server.registerTool(
    'quoth_read_chunks',
    {
      title: 'Read Chunks by ID',
      description:
        'Fetches full content of specific chunks by their IDs. Use chunk IDs from quoth_search_chunks results. Supports batch retrieval (1-20 chunks per call).',
      inputSchema: {
        chunk_ids: z.array(z.string())
          .min(1).max(20)
          .describe('Array of chunk IDs from search results (1-20 chunks)'),
      },
    },
    async ({ chunk_ids }) => {
      try {
        const chunks = await readChunks(chunk_ids, authContext.project_id);

        if (chunks.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No chunks found with the provided IDs.\n\nVerify the IDs are from your project's search results.`,
            }],
          };
        }

        // Group chunks by document for readability
        const byDocument = new Map<string, typeof chunks>();
        for (const chunk of chunks) {
          const key = chunk.document_path;
          if (!byDocument.has(key)) {
            byDocument.set(key, []);
          }
          byDocument.get(key)!.push(chunk);
        }

        let output = `<chunks count="${chunks.length}" documents="${byDocument.size}">\n`;

        for (const [docPath, docChunks] of byDocument) {
          const firstChunk = docChunks[0];
          output += `
<document path="${docPath}" title="${firstChunk.document_title}" total_chunks="${firstChunk.total_chunks}">`;

          for (const chunk of docChunks.sort((a, b) => a.chunk_index - b.chunk_index)) {
            output += `
  <chunk id="${chunk.chunk_id}" position="${chunk.chunk_index + 1} of ${chunk.total_chunks}">
    ${chunk.metadata.language ? `<language>${chunk.metadata.language}</language>` : ''}
    ${chunk.metadata.parentContext ? `<context>${chunk.metadata.parentContext}</context>` : ''}
    <content>
${chunk.content}
    </content>
  </chunk>`;
          }

          output += `
</document>`;
        }

        output += `
</chunks>`;

        return {
          content: [{
            type: 'text' as const,
            text: output,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error reading chunks: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
        };
      }
    }
  );

  // Tool 7: quoth_list_accounts (Multi-Account Support)
  server.registerTool(
    'quoth_list_accounts',
    {
      title: 'List Available Accounts',
      description:
        'Lists all project accounts available to the authenticated user. Shows which account is currently active and allows viewing all accessible projects with their roles.',
      inputSchema: {},
    },
    async () => {
      try {
        const connectionId = authContext.connection_id;
        if (!connectionId) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: Multi-account support not available. No connection ID found.',
            }],
          };
        }

        const availableProjects = authContext.available_projects || [];
        
        if (availableProjects.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `You are connected to project: ${authContext.project_id}\n\nNo additional projects found. This is your only accessible project.`,
            }],
          };
        }

        const accountList = availableProjects.map(acc => {
          const isActive = acc.project_id === authContext.project_id;
          const marker = isActive ? '✓ **ACTIVE**' : ' ';
          return `${marker} ${acc.project_name} (\`${acc.project_slug}\`) - Role: ${acc.role}\n   Project ID: \`${acc.project_id}\``;
        }).join('\n\n');

        return {
          content: [{
            type: 'text' as const,
            text: `# Available Project Accounts\n\n${accountList}\n\n---\n\n**Total Projects:** ${availableProjects.length}\n**Active Project:** ${authContext.project_id}\n\nUse \`quoth_switch_account\` with a project ID to switch your active context.`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error listing accounts: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
        };
      }
    }
  );

  // Tool 8: quoth_switch_account (Multi-Account Support)
  server.registerTool(
    'quoth_switch_account',
    {
      title: 'Switch Active Account',
      description:
        'Switches the active project account. All subsequent Quoth operations (search, read, propose) will use the selected project context until switched again.',
      inputSchema: {
        project_id: z.string().describe('The project ID to switch to (from quoth_list_accounts)'),
      },
    },
    async ({ project_id }) => {
      try {
        const connectionId = authContext.connection_id;
        if (!connectionId) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: Multi-account support not available. No connection ID found.',
            }],
          };
        }

        // Import session manager
        const { sessionManager } = await import('../auth/session-manager');
        
        const success = sessionManager.switchAccount(connectionId, project_id);

        if (!success) {
          const availableProjects = authContext.available_projects || [];
          const projectList = availableProjects.map(p => `- ${p.project_name} (\`${p.project_id}\`)`).join('\n');
          
          return {
            content: [{
              type: 'text' as const,
              text: `Error: Could not switch to project \`${project_id}\`.\n\nThis project either doesn't exist or you don't have access to it.\n\n**Available projects:**\n${projectList || '(none)'}`,
            }],
          };
        }

        // Get updated context
        const newContext = sessionManager.getActiveContext(connectionId);
        const matchingProject = authContext.available_projects?.find(p => p.project_id === project_id);

        return {
          content: [{
            type: 'text' as const,
            text: `✅ **Account Switched Successfully**\n\n` +
                  `**Now Active:** ${matchingProject?.project_name || project_id}\n` +
                  `**Project ID:** \`${project_id}\`\n` +
                  `**Your Role:** ${newContext?.role}\n\n` +
                  `---\n\n` +
                  `All subsequent Quoth operations will use this project context:\n` +
                  `- \`quoth_search_index\` will search this project's documents\n` +
                  `- \`quoth_read_doc\` will read from this project\n` +
                  `- \`quoth_propose_update\` will create proposals for this project\n\n` +
                  `Use \`quoth_list_accounts\` to view all available projects.`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error switching account: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
        };
      }
    }
  );

  // Register Genesis tools
  registerGenesisTools(server, authContext);
}
