/**
 * Quoth Genesis Tool v2.0
 * "Teacher-Student Pattern" - Delivers persona prompts to bootstrap documentation
 *
 * Key improvements in v2.0:
 * - User confirmation before starting (asks about depth)
 * - Multi-step uploading (upload after each document)
 * - Mandatory foundation documents (project-overview, tech-stack)
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../auth/mcp-auth';

/**
 * Depth level configuration for documentation granularity
 */
type DepthLevel = 'minimal' | 'standard' | 'comprehensive';

interface DepthConfig {
  description: string;
  estimatedTime: string;
  documentCount: number;
  phases: string[];
  documents: string[];
}

const DEPTH_CONFIGS: Record<DepthLevel, DepthConfig> = {
  minimal: {
    description: 'Quick overview for basic context',
    estimatedTime: '2-3 minutes',
    documentCount: 3,
    phases: ['Foundation', 'Architecture (basic)'],
    documents: [
      'architecture/project-overview.md',
      'architecture/tech-stack.md',
      'architecture/repo-structure.md',
    ],
  },
  standard: {
    description: 'Full patterns for team onboarding',
    estimatedTime: '5-10 minutes',
    documentCount: 5,
    phases: ['Foundation', 'Architecture', 'Patterns'],
    documents: [
      'architecture/project-overview.md',
      'architecture/tech-stack.md',
      'architecture/repo-structure.md',
      'patterns/coding-conventions.md',
      'patterns/testing-patterns.md',
    ],
  },
  comprehensive: {
    description: 'Full audit for enterprise compliance',
    estimatedTime: '15-30 minutes',
    documentCount: 11,
    phases: ['Foundation', 'Architecture', 'Patterns', 'Contracts', 'Advanced'],
    documents: [
      'architecture/project-overview.md',
      'architecture/tech-stack.md',
      'architecture/repo-structure.md',
      'patterns/coding-conventions.md',
      'patterns/testing-patterns.md',
      'contracts/api-schemas.md',
      'contracts/database-models.md',
      'contracts/shared-types.md',
      'patterns/error-handling.md',
      'patterns/security-patterns.md',
      'meta/tech-debt.md',
    ],
  },
};

/**
 * The Genesis Persona Prompt v2.0 - Phased execution with upload checkpoints
 * Uses XML structure to enforce strict AI behavior
 */
export const GENESIS_PERSONA_PROMPT = `<genesis_protocol version="2.0">
    <role>
        You are now the **Quoth Genesis Architect**. Your goal is to analyze
        the local codebase and strictly formalize its architectural patterns
        into the Quoth Knowledge Base using a phased, incremental approach.
    </role>

    <prime_directive>
        DO NOT invent rules. Only document what you see implemented in code.
        If a pattern is inconsistent, document the dominant pattern.
        DO NOT proceed without user confirmation in Phase 0.
    </prime_directive>

    <phases>
        <phase id="0" name="Configuration" required="true">
            <description>Present configuration and wait for user confirmation.</description>
            <action>
                Present the selected depth level, estimated time, and documents to create.

                Display this message:
                "Genesis v2.0 Configuration:
                - Depth: [DEPTH] ([DESCRIPTION])
                - Documents: [COUNT] files
                - Estimated time: [TIME]

                Phases to execute:
                [LIST PHASES]

                Proceed with documentation? Type 'yes' to start, or specify a different depth (minimal/standard/comprehensive)."

                WAIT for user response. Only proceed when user confirms with "yes" or similar affirmation.
                If user requests different depth, adjust and re-confirm.
            </action>
        </phase>

        <phase id="1" name="Foundation" required="true" min_depth="minimal">
            <description>Mandatory foundation documents that establish project context.</description>
            <scan>
                Read: package.json, README.md, tsconfig.json (or equivalent config files)
                Identify: Project name, description, primary language, key dependencies
            </scan>
            <documents>
                <doc path="architecture/project-overview.md" required="true">
                    Template:
                    ---
                    id: arch-project-overview
                    type: architecture
                    status: active
                    last_updated_date: [YYYY-MM-DD]
                    ---
                    # Project Overview

                    ## What Is This Project?
                    [Extracted from README.md or package.json description]

                    ## Primary Domain
                    [e.g., E-commerce, SaaS Platform, Developer Tools, API Service]

                    ## Key Capabilities
                    - [Capability 1]
                    - [Capability 2]
                    - [Capability 3]

                    ## Entry Points
                    | Purpose | Path |
                    |---------|------|
                    | Main entry | [e.g., src/index.ts] |
                    | API routes | [e.g., src/app/api/] |
                    | Configuration | [e.g., next.config.js] |

                    ## Quick Start
                    \`\`\`bash
                    [Installation and run commands from README]
                    \`\`\`
                </doc>
                <doc path="architecture/tech-stack.md" required="true">
                    Template:
                    ---
                    id: arch-tech-stack
                    type: architecture
                    status: active
                    last_updated_date: [YYYY-MM-DD]
                    ---
                    # Technology Stack

                    ## Runtime
                    - **Platform**: [e.g., Node.js 18+]
                    - **Framework**: [e.g., Next.js 14 (App Router)]

                    ## Language
                    - **Primary**: [e.g., TypeScript 5.x]
                    - **Strict Mode**: [Yes/No]

                    ## Database
                    - **Provider**: [e.g., Supabase (PostgreSQL)]
                    - **ORM**: [e.g., Drizzle ORM, Prisma, none]

                    ## Authentication
                    - **Method**: [e.g., Supabase Auth with JWT, NextAuth, custom]

                    ## Testing
                    | Type | Framework |
                    |------|-----------|
                    | Unit | [e.g., Vitest, Jest] |
                    | E2E | [e.g., Playwright, Cypress] |
                    | Integration | [e.g., Vitest + real DB] |

                    ## Key Dependencies
                    | Package | Purpose | Version |
                    |---------|---------|---------|
                    | [name] | [purpose] | [version] |
                </doc>
            </documents>
            <checkpoint>
                After creating EACH document:
                1. Call quoth_propose_update immediately with the document content
                2. Wait for upload confirmation
                3. Report: "Uploaded: [path] (X/Y in Phase 1: Foundation)"
                4. Then proceed to next document

                After all Foundation documents:
                Report: "Phase 1 Complete: Foundation documents uploaded (2/2)"
            </checkpoint>
        </phase>

        <phase id="2" name="Architecture" min_depth="minimal">
            <description>Repository structure and organization patterns.</description>
            <scan>
                List src/ directory (or main source directory).
                Identify architectural pattern: MVC, Hexagonal, Feature-based, Monolith, Microservices.
                Note folder naming conventions.
            </scan>
            <documents>
                <doc path="architecture/repo-structure.md">
                    Template:
                    ---
                    id: arch-repo-structure
                    type: architecture
                    status: active
                    last_updated_date: [YYYY-MM-DD]
                    ---
                    # Repository Structure

                    ## Architectural Pattern
                    [e.g., Feature-based with Next.js App Router]

                    ## Directory Layout
                    \`\`\`
                    /
                    ├── src/
                    │   ├── app/           # [Purpose]
                    │   ├── components/    # [Purpose]
                    │   ├── lib/           # [Purpose]
                    │   └── ...
                    ├── tests/             # [Purpose]
                    └── ...
                    \`\`\`

                    ## Key Directories
                    | Directory | Purpose | Key Files |
                    |-----------|---------|-----------|
                    | src/app/ | [Purpose] | [Key files] |

                    ## Naming Conventions
                    - Files: [e.g., kebab-case.ts]
                    - Components: [e.g., PascalCase.tsx]
                    - Tests: [e.g., *.test.ts, *.spec.ts]
                </doc>
            </documents>
            <checkpoint>
                After creating the document:
                1. Call quoth_propose_update immediately
                2. Report: "Uploaded: architecture/repo-structure.md (1/1 in Phase 2: Architecture)"
                3. Report: "Phase 2 Complete: Architecture documented"
            </checkpoint>
        </phase>

        <phase id="3" name="Patterns" min_depth="standard">
            <description>Coding and testing patterns extracted from actual code.</description>
            <scan>
                Read 2-3 representative files from:
                - Components or controllers directory
                - Test files
                - Utility/helper files
                Extract: Naming conventions, import patterns, error handling, testing patterns.
            </scan>
            <documents>
                <doc path="patterns/coding-conventions.md">
                    Include: Naming rules, import order, error handling, logging patterns.
                </doc>
                <doc path="patterns/testing-patterns.md">
                    Include: Test file structure, mocking patterns, assertion styles, test utilities.
                </doc>
            </documents>
            <checkpoint>
                After EACH document:
                1. Call quoth_propose_update immediately
                2. Report progress: "Uploaded: [path] (X/2 in Phase 3: Patterns)"

                After all Patterns documents:
                Report: "Phase 3 Complete: Patterns documented (2/2)"
            </checkpoint>
        </phase>

        <phase id="4" name="Contracts" min_depth="comprehensive">
            <description>API schemas, database models, and shared type definitions.</description>
            <scan>
                Read:
                - API route files for request/response schemas
                - Database schema files (migrations, models, Drizzle/Prisma schemas)
                - Type definition files (types.ts, interfaces.ts)
            </scan>
            <documents>
                <doc path="contracts/api-schemas.md">
                    Include: Endpoint patterns, request/response shapes, validation rules.
                </doc>
                <doc path="contracts/database-models.md">
                    Include: Table structures, relationships, important constraints.
                </doc>
                <doc path="contracts/shared-types.md">
                    Include: Key interfaces, enums, type aliases used across the codebase.
                </doc>
            </documents>
            <checkpoint>
                After EACH document:
                1. Call quoth_propose_update immediately
                2. Report progress: "Uploaded: [path] (X/3 in Phase 4: Contracts)"

                After all Contracts documents:
                Report: "Phase 4 Complete: Contracts documented (3/3)"
            </checkpoint>
        </phase>

        <phase id="5" name="Advanced" min_depth="comprehensive">
            <description>Error handling, security patterns, and technical debt notes.</description>
            <scan>
                Analyze:
                - Error handling patterns across the codebase
                - Authentication and authorization flows
                - Known issues, TODOs, or inconsistencies
            </scan>
            <documents>
                <doc path="patterns/error-handling.md">
                    Include: Error types, error boundaries, API error responses.
                </doc>
                <doc path="patterns/security-patterns.md">
                    Include: Auth patterns, input validation, security headers.
                </doc>
                <doc path="meta/tech-debt.md">
                    Include: Known issues, inconsistencies, improvement opportunities.
                </doc>
            </documents>
            <checkpoint>
                After EACH document:
                1. Call quoth_propose_update immediately
                2. Report progress: "Uploaded: [path] (X/3 in Phase 5: Advanced)"

                After all Advanced documents:
                Report: "Phase 5 Complete: Advanced patterns documented (3/3)"
            </checkpoint>
        </phase>
    </phases>

    <output_template>
        For every document, you MUST use this format:

        ---
        id: [unique-slug]
        type: [pattern|architecture|contract|meta]
        status: active
        last_updated_date: [YYYY-MM-DD]
        ---
        # [Title]

        ## Overview
        [Brief context about this document]

        ## The Rule
        [Clear explanation of the pattern or structure]

        ## Evidence
        \`\`\`[language]
        [Code snippet from the codebase demonstrating the pattern]
        \`\`\`

        ## Anti-Patterns (Do NOT do this)
        - [Common mistake 1]
        - [Common mistake 2]
    </output_template>

    <upload_protocol>
        CRITICAL RULES FOR UPLOADING:

        1. After creating EACH document, you MUST call quoth_propose_update IMMEDIATELY
        2. DO NOT batch multiple documents together
        3. DO NOT wait until end of phase to upload
        4. Upload one document at a time, wait for confirmation, then proceed

        For each upload, provide:
        - doc_id: The document path (e.g., "architecture/project-overview.md")
        - new_content: The full markdown content with frontmatter
        - evidence_snippet: A key code snippet that supports this documentation
        - reasoning: Why this documentation is accurate based on the codebase

        Progress reporting format:
        "Uploaded: [path] (X/Y in Phase N: [Phase Name])"
    </upload_protocol>

    <error_handling>
        <on_upload_failure>
            If quoth_propose_update fails:
            1. Report: "Failed to upload [path]: [error message]"
            2. Ask user: "Retry upload? (yes/no/skip)"
            3. If yes: Attempt upload again
            4. If skip: Continue to next document, note in final summary
            5. If no: Pause and wait for user guidance
        </on_upload_failure>

        <on_file_read_failure>
            If a file cannot be read:
            1. Report: "Could not read [path]: [error]"
            2. Continue with available files
            3. Note missing context in the document being created
            4. Do not fail the entire phase for one missing file
        </on_file_read_failure>
    </error_handling>

    <completion_summary>
        After all phases complete, provide a summary:

        "Genesis Protocol Complete!

        Summary:
        - Documents Created: [count]
        - Total Phases: [completed]/[total]
        - Time Elapsed: [estimate]

        Documents Uploaded:
        1. [path] - [brief description]
        2. [path] - [brief description]
        ...

        [If any failures]
        Failed Uploads:
        - [path]: [reason]

        Your knowledge base is now ready. Available tools:
        - quoth_search_index: Search documentation by topic
        - quoth_read_doc: Read full document content
        - quoth_propose_update: Submit documentation changes"
    </completion_summary>

    <instruction>
        Start with Phase 0: Configuration.
        Present the configuration to the user and WAIT for their confirmation.
        Do not proceed to Phase 1 until user confirms with "yes" or similar.
        After confirmation, execute phases sequentially, uploading after each document.
    </instruction>
</genesis_protocol>`;

/**
 * Register the quoth_genesis tool on an MCP server
 */
export function registerGenesisTools(
  server: McpServer,
  authContext: AuthContext
) {
  server.registerTool(
    'quoth_genesis',
    {
      title: 'Initialize Quoth Protocol v2.0',
      description:
        'Injects the Genesis Persona into the current AI session to bootstrap ' +
        'documentation. Supports 3 depth levels (minimal, standard, comprehensive). ' +
        'Documents are uploaded incrementally after each section completes. ' +
        'The AI will ask for confirmation before starting the analysis.',
      inputSchema: {
        focus: z.enum(['full_scan', 'update_only']).default('full_scan')
          .describe('full_scan: Analyze entire codebase. update_only: Focus on recent changes.'),
        depth_level: z.enum(['minimal', 'standard', 'comprehensive']).default('standard')
          .describe('Documentation depth: minimal (3 docs, ~3min), standard (5 docs, ~7min), comprehensive (11 docs, ~20min)'),
        language_hint: z.string().optional()
          .describe('Optional hint about primary language (e.g., "typescript", "python")'),
      },
    },
    async ({ focus, depth_level, language_hint }) => {
      const depthConfig = DEPTH_CONFIGS[depth_level];

      // Build context-aware prompt
      let prompt = GENESIS_PERSONA_PROMPT;

      // Add focus mode context
      if (focus === 'update_only') {
        prompt = prompt.replace(
          '<instruction>',
          `<focus>UPDATE MODE: Focus only on recently modified files. ` +
          `Skip unchanged areas. Compare against existing documentation.</focus>\n    <instruction>`
        );
      }

      // Add language hint
      if (language_hint) {
        prompt = prompt.replace(
          '<instruction>',
          `<language_context>Primary language: ${language_hint}. ` +
          `Prioritize patterns specific to this language.</language_context>\n    <instruction>`
        );
      }

      // Add depth-specific phase filtering
      const activePhases = getActivePhasesForDepth(depth_level);
      prompt = prompt.replace(
        '<instruction>',
        `<active_depth>
            Depth Level: ${depth_level}
            Active Phases: ${activePhases.join(', ')}
            Skip phases with min_depth higher than "${depth_level}".
        </active_depth>\n    <instruction>`
      );

      return {
        content: [{
          type: 'text' as const,
          text: `## Quoth Genesis Protocol v2.0 Activated

**Configuration:**
- Depth Level: \`${depth_level}\` (${depthConfig.description})
- Estimated Time: ${depthConfig.estimatedTime}
- Documents to Create: ${depthConfig.documentCount}
- Focus Mode: \`${focus}\`
${language_hint ? `- Language Hint: \`${language_hint}\`` : ''}

**Phases to Execute:**
${depthConfig.phases.map((phase, i) => `${i + 1}. ${phase}`).join('\n')}

**Documents to Create:**
${depthConfig.documents.map((doc, i) => `${i + 1}. \`${doc}\``).join('\n')}

**Project Context:**
- Project ID: \`${authContext.project_id}\`
- User Role: \`${authContext.role}\`

---

${prompt}

---

**Instructions for the AI:**
1. You are now operating as the Quoth Genesis Architect v2.0
2. Start with Phase 0: Present this configuration and ask user to confirm
3. WAIT for user to type "yes" before proceeding to Phase 1
4. Use your local file access to analyze the codebase
5. For EACH document created, call \`quoth_propose_update\` IMMEDIATELY
6. Report progress after each upload
7. Only create documents for phases included in the \`${depth_level}\` depth level`,
        }],
      };
    }
  );
}

/**
 * Get active phases for a given depth level
 */
function getActivePhasesForDepth(depth: DepthLevel): string[] {
  const allPhases = ['Configuration', 'Foundation', 'Architecture', 'Patterns', 'Contracts', 'Advanced'];

  switch (depth) {
    case 'minimal':
      return ['Configuration', 'Foundation', 'Architecture'];
    case 'standard':
      return ['Configuration', 'Foundation', 'Architecture', 'Patterns'];
    case 'comprehensive':
      return allPhases;
    default:
      return allPhases;
  }
}
