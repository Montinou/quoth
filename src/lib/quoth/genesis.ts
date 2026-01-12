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

    <embedding_optimization>
        <context>
            Each H2 section becomes a SEPARATE embedding chunk for vector search.
            Chunks are searched independently - they MUST be self-contained.
        </context>

        <chunk_rules>
            1. START each H2 with context (e.g., "In this project, we use...")
            2. INCLUDE 2-3 searchable keywords naturally in first sentence
            3. KEEP sections 100-250 words (optimal for embeddings)
            4. CODE BLOCKS must have 1-line context above them
            5. END patterns with specific "Do NOT" anti-patterns
        </chunk_rules>

        <keyword_strategy>
            Every section should naturally include:
            - Technology name (Vitest, Playwright, Supabase, Next.js, etc.)
            - Action verb (mock, test, validate, configure, implement)
            - Domain term (authentication, API, database, component)
            Example first line: "Vitest unit tests for database services use vi.mock() for dependency isolation."
        </keyword_strategy>
    </embedding_optimization>

    <checkpoint_protocol>
        After EACH document:
        1. Call quoth_propose_update immediately (doc_id, new_content, evidence_snippet, reasoning)
        2. Report: "Uploaded: [path] (X/Y in Phase N: [Name])"
        3. Then proceed to next document
        DO NOT batch multiple documents. Upload one at a time.
    </checkpoint_protocol>

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
            <checkpoint>Follow checkpoint_protocol. Report "Phase 1 Complete" after both docs.</checkpoint>
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
            <checkpoint>Follow checkpoint_protocol. Report "Phase 2 Complete" after doc.</checkpoint>
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
            <checkpoint>Follow checkpoint_protocol. Report "Phase 3 Complete" after both docs.</checkpoint>
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
            <checkpoint>Follow checkpoint_protocol. Report "Phase 4 Complete" after all 3 docs.</checkpoint>
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
            <checkpoint>Follow checkpoint_protocol. Report "Phase 5 Complete" after all 3 docs.</checkpoint>
        </phase>
    </phases>

    <output_template version="2.1">
        For every document, use this EMBEDDING-OPTIMIZED format:

        ---
        id: [unique-slug]
        type: [pattern|architecture|contract|meta]
        status: active
        last_updated_date: [YYYY-MM-DD]
        keywords: [tech1, action1, domain1]
        related_stack: [technology1, technology2]
        ---
        # [Title]: [Brief Context Phrase]

        ## What This Covers
        [Technology] [action] for [use case]. This pattern applies when [condition].
        Key terms: [keyword1], [keyword2], [keyword3].
        (Keep under 75 words. Include searchable terms.)

        ## The Pattern
        [Clear explanation of the rule or structure.]
        [Keep under 150 words. Use inline \`code\` for key terms.]

        ## Canonical Example
        [One-line context: "This shows X for Y situation."]
        \`\`\`[language]
        [Code - max 25 lines with inline comments on key parts]
        \`\`\`

        ## Common Questions
        - How do I [specific question]?
        - What is the [pattern] for [technology]?
        - When should I use [approach]?

        ## Anti-Patterns (Never Do This)
        - [Anti-pattern 1]: [Why it's wrong - brief explanation]
        - [Anti-pattern 2]: [Why it's wrong - brief explanation]
    </output_template>

    <upload_protocol>
        For each quoth_propose_update call, provide:
        - doc_id: Document path (e.g., "architecture/project-overview.md")
        - new_content: Full markdown with frontmatter
        - evidence_snippet: Key code snippet supporting documentation
        - reasoning: Why this is accurate based on code
    </upload_protocol>

    <error_handling>
        On upload failure: Report error, ask "Retry? (yes/no/skip)", handle accordingly.
        On file read failure: Report and continue with available files. Note gaps in docs.
    </error_handling>

    <completion_summary>
        After all phases, report:
        "Genesis Complete! Created [count] docs in [phases] phases.
        Documents: [list paths]
        [If failures: note them]
        Knowledge base ready. Use quoth_search_index, quoth_read_doc, quoth_propose_update."
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
