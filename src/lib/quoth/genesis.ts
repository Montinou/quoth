/**
 * Quoth Genesis Tool v3.0
 * Split-tool architecture: Separate focused prompts per depth level
 *
 * Key improvements in v3.0:
 * - Separate tools per depth level (smaller, more effective prompts)
 * - Selector tool asks user first, then invokes specific depth tool
 * - Each depth tool has tailored templates and instructions
 * - ~60% reduction in prompt size per invocation
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../auth/mcp-auth';
import { FRONTMATTER_TEMPLATE } from './prompt-constants';

/**
 * Shared embedding optimization rules (compact version)
 * Used across all depth levels for consistent document quality
 */
const EMBEDDING_RULES = `<embedding_rules>
  <principle>Each H2 section = separate embedding chunk. Must be self-contained.</principle>
  <rules>
    1. START with bold tech + action: "**Vitest testing** uses mocks for..."
    2. INCLUDE 2-3 keywords naturally in first sentence
    3. KEEP sections 100-150 words (optimal for embeddings)
    4. ADD aliases in headers: "## Topic (Alias1, Alias2)"
    5. DISTRIBUTE context: bold opening → mid-section anchor → bold closing summary
    6. END with: "**Summary:** [tech] for [use case]"
    7. CODE: 2-3 small snippets (3-5 lines) with text between, not one large block
    8. REFERENCE files: \`src/file.ts:45-60\` instead of embedding full code
  </rules>
  <faq_format>
    - **How do I [action]?** [1-2 sentence answer with code]
    - **What is [term]?** [One-line definition]
    Include 4-6 Q&A pairs. Answers REQUIRED.
  </faq_format>
</embedding_rules>`;

// FRONTMATTER_TEMPLATE imported from './prompt-constants'

/**
 * Upload protocol (shared)
 */
const UPLOAD_PROTOCOL = `<upload_protocol>
  After EACH document:
  1. Call quoth_propose_update(doc_id, new_content, evidence_snippet, reasoning)
  2. Report: "Uploaded: [path] (X/Y)"
  3. Proceed to next document
  DO NOT batch. Upload one at a time.
</upload_protocol>`;

/**
 * Onboarding phase - configures AI tools to use Quoth after Genesis completes
 * Detects existing AI config files and appends Quoth integration instructions
 */
const ONBOARDING_PHASE = `<phase name="Onboarding">
  <purpose>Configure AI tools to use Quoth knowledge base</purpose>

  <detection>
    Check for existing AI config files in project root (in priority order):
    1. CLAUDE.md (Claude Code)
    2. .cursorrules (Cursor)
    3. .cursor/rules/*.mdc (Cursor rules directory)
    4. .github/copilot-instructions.md (GitHub Copilot)
    5. .windsurfrules (Windsurf)
    6. AGENTS.md (Cross-platform)
    7. .junie/guidelines.md (JetBrains Junie)

    Report each file found: "[tool]: [path]"
  </detection>

  <action_if_found>
    1. Read the first detected config file
    2. Check if "## Quoth Knowledge Base" section already exists
    3. If exists: skip with message "Already configured: [path]"
    4. If not exists:
       a. Append two blank lines
       b. Append the QUOTH_SECTION below
       c. Write updated file locally (NOT quoth_propose_update)
    5. Report: "Updated: [path] with Quoth configuration"
  </action_if_found>

  <action_if_not_found>
    1. Create QUOTH_DOCS.md in project root
    2. Use the QUOTH_DOCS template below
    3. Write file locally
    4. Report: "Created: QUOTH_DOCS.md (universal AI config)"
  </action_if_not_found>

  <quoth_section_template>
## Quoth Knowledge Base

This project uses **Quoth** as the single source of truth for documentation.

**MCP Server:** \\\`{QUOTH_URL}\\\`

### Documented Areas
{AREAS_LIST}

### Workflow
1. **BEFORE changes**: \\\`quoth_search_index\\\` to find existing patterns
2. **AFTER new features**: \\\`quoth_propose_update\\\` to document them

### Tools
- \\\`quoth_search_index\\\` - Semantic search across documentation
- \\\`quoth_read_doc\\\` - Read full document content
- \\\`quoth_propose_update\\\` - Submit documentation updates
  </quoth_section_template>

  <quoth_docs_template>
# Quoth Documentation

> AI-driven documentation for this project

**MCP Server:** \\\`{QUOTH_URL}\\\`

## Documented Areas
{AREAS_LIST}

## Workflow
1. **BEFORE changes**: \\\`quoth_search_index\\\` to find existing patterns
2. **AFTER new features**: \\\`quoth_propose_update\\\` to document them

## Available Tools
| Tool | Purpose |
|------|---------|
| \\\`quoth_search_index\\\` | Semantic search across documentation |
| \\\`quoth_read_doc\\\` | Read full document content |
| \\\`quoth_propose_update\\\` | Submit documentation updates |
| \\\`quoth_list_templates\\\` | List available document templates |
| \\\`quoth_get_template\\\` | Get template structure for new docs |

---
*Genesis Depth: {DEPTH_LEVEL} | Docs: {DOC_COUNT} | Date: {CURRENT_DATE}*
  </quoth_docs_template>

  <variables>
    Replace in templates:
    - {QUOTH_URL} = MCP server URL (use project's Quoth endpoint)
    - {AREAS_LIST} = Bullet list of documents created in previous phases
    - {DEPTH_LEVEL} = Genesis depth used (minimal/standard/comprehensive)
    - {DOC_COUNT} = Number of documents created
    - {CURRENT_DATE} = Today's date (YYYY-MM-DD)
  </variables>
</phase>`;

// ============================================
// MINIMAL DEPTH PROMPT (~1.2KB)
// 3 documents: project-overview, tech-stack, repo-structure
// ============================================
const GENESIS_MINIMAL_PROMPT = `<genesis_protocol version="3.0" depth="minimal">
  <role>Quoth Genesis Architect - Minimal Depth (3 documents)</role>
  <prime_directive>Document ONLY what exists in code. No invention.</prime_directive>

  ${EMBEDDING_RULES}

  <documents>
    <doc path="architecture/project-overview.md">
      ${FRONTMATTER_TEMPLATE}
      # Project Overview (What Is This, Introduction)

      ## What Is This Project (Overview, About)
      [From README.md/package.json - 75 words max]
      **Summary:** [Project name] for [primary use case].

      ## Key Capabilities (Features, What It Does)
      - [Capability 1]
      - [Capability 2]
      - [Capability 3]
      **Summary:** Core features of [project].

      ## Entry Points (Starting Points, Key Files)
      | Purpose | Path |
      |---------|------|
      | Main entry | [path] |
      **Summary:** Entry points for [project].

      ## Quick Start (Installation, Getting Started)
      \`\`\`bash
      [install + run commands]
      \`\`\`
      **Summary:** Quick start commands.

      ## Common Questions (FAQ)
      - **What is this project?** [answer]
      - **How do I get started?** [answer]
      - **Where is the main code?** [answer]
    </doc>

    <doc path="architecture/tech-stack.md">
      ${FRONTMATTER_TEMPLATE}
      # Technology Stack (Dependencies, Libraries)

      ## Runtime (Platform, Environment)
      - **Platform**: [Node.js version]
      - **Framework**: [Next.js/Express/etc]
      **Summary:** Runtime environment.

      ## Language (TypeScript, JavaScript)
      - **Primary**: [language + version]
      - **Strict Mode**: [Yes/No]
      **Summary:** Primary language configuration.

      ## Database (Storage, Persistence)
      - **Provider**: [Neon/PostgreSQL/etc]
      - **ORM**: [Drizzle/Prisma/none]
      **Summary:** Database layer.

      ## Key Dependencies (Packages, Libraries)
      | Package | Purpose | Version |
      |---------|---------|---------|
      | [name] | [purpose] | [ver] |
      **Summary:** Core dependencies.

      ## Common Questions (FAQ)
      - **What database does this use?** [answer]
      - **What's the primary language?** [answer]
    </doc>

    <doc path="architecture/repo-structure.md">
      ${FRONTMATTER_TEMPLATE}
      # Repository Structure (Folder Layout, Directory Organization)

      ## Directory Layout (Folders, Structure)
      \`\`\`
      /
      ├── src/
      │   ├── [folder]/ # [purpose]
      └── ...
      \`\`\`
      **Summary:** Folder organization.

      ## Key Directories (Important Folders)
      | Directory | Purpose |
      |-----------|---------|
      | [path] | [purpose] |
      **Summary:** Key directories.

      ## Naming Conventions (File Names, Patterns)
      - Files: [convention]
      - Components: [convention]
      **Summary:** Naming patterns.

      ## Common Questions (FAQ)
      - **Where is the main source code?** [answer]
      - **What's the naming convention?** [answer]
    </doc>
  </documents>

  ${UPLOAD_PROTOCOL}

  <workflow>
    <phase name="Setup">
      1. Read package.json, README.md, list src/ directory
    </phase>

    <phase name="Foundation">
      <doc output="architecture/project-overview.md">
        <step>FETCH: quoth_get_template("project-overview")</step>
        <step>ANALYZE: package.json, README.md, entry points</step>
        <step>CREATE: Follow template structure exactly (each H2 = one chunk)</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded: project-overview.md (1/3)"</step>
      </doc>

      <doc output="architecture/tech-stack.md">
        <step>FETCH: quoth_get_template("tech-stack")</step>
        <step>ANALYZE: dependencies, config files, runtime versions</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded: tech-stack.md (2/3)"</step>
      </doc>

      <doc output="architecture/repo-structure.md">
        <step>FETCH: quoth_get_template("repo-structure")</step>
        <step>ANALYZE: directory tree, naming patterns</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded: repo-structure.md (3/3)"</step>
      </doc>
    </phase>

  ${ONBOARDING_PHASE}

    <phase name="Complete">
      Report: "Genesis complete. 3 documents created. AI tools configured."
    </phase>
  </workflow>
</genesis_protocol>`;

// ============================================
// STANDARD DEPTH PROMPT (~1.8KB)
// 5 documents: minimal + coding-conventions, testing-patterns
// ============================================
const GENESIS_STANDARD_PROMPT = `<genesis_protocol version="3.0" depth="standard">
  <role>Quoth Genesis Architect - Standard Depth (5 documents)</role>
  <prime_directive>Document ONLY what exists in code. No invention.</prime_directive>

  ${EMBEDDING_RULES}

  <documents>
    <doc path="architecture/project-overview.md">
      Create project overview with: What Is This, Key Capabilities, Entry Points, Quick Start, FAQ.
      Follow embedding rules. Use aliases in headers.
    </doc>

    <doc path="architecture/tech-stack.md">
      Create tech stack with: Runtime, Language, Database, Authentication, Key Dependencies, FAQ.
      Follow embedding rules. Include version numbers.
    </doc>

    <doc path="architecture/repo-structure.md">
      Create repo structure with: Directory Layout, Key Directories, Naming Conventions, FAQ.
      Follow embedding rules. Show actual folder tree.
    </doc>

    <doc path="patterns/coding-conventions.md">
      ${FRONTMATTER_TEMPLATE}
      # Coding Conventions (Code Style, Patterns)

      ## TypeScript Patterns (Types, Interfaces)
      **[Project] uses** [pattern]. Show interface example (3-5 lines).
      Reference: \`src/types.ts:LINE\`
      **Summary:** TypeScript patterns for [project].

      ## Async Patterns (Promises, Error Handling)
      **Async operations** use [pattern]. Show example.
      **Summary:** Async/await patterns.

      ## Error Handling (Try-Catch, Responses)
      **Errors are handled** with [pattern]. Show example.
      **Summary:** Error handling approach.

      ## Common Questions (FAQ)
      - **How do I handle errors?** [answer]
      - **What's the import pattern?** [answer]

      ## Anti-Patterns (Never Do This)
      - **[Bad pattern]**: [why + alternative]
    </doc>

    <doc path="patterns/testing-patterns.md">
      ${FRONTMATTER_TEMPLATE}
      # Testing Patterns (Tests, Verification)

      ## Test Framework (Vitest, Jest, etc)
      **[Project] uses** [framework] for testing. Show test structure.
      **Summary:** Test framework configuration.

      ## Running Tests (Commands, Scripts)
      \`\`\`bash
      npm run test
      \`\`\`
      **Summary:** Test execution commands.

      ## Common Questions (FAQ)
      - **How do I run tests?** [answer]
      - **Where are tests located?** [answer]

      ## Anti-Patterns (Never Do This)
      - **[Bad pattern]**: [why + alternative]
    </doc>
  </documents>

  ${UPLOAD_PROTOCOL}

  <workflow>
    <phase name="Setup">
      1. Read package.json, README.md, src/ structure
      2. Read 2-3 representative source files for patterns
      3. Read test files for testing patterns
    </phase>

    <phase name="Foundation">
      <doc output="architecture/project-overview.md">
        <step>FETCH: quoth_get_template("project-overview")</step>
        <step>ANALYZE: package.json, README.md, entry points</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (1/5)"</step>
      </doc>

      <doc output="architecture/tech-stack.md">
        <step>FETCH: quoth_get_template("tech-stack")</step>
        <step>ANALYZE: dependencies, config files, runtime</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (2/5)"</step>
      </doc>

      <doc output="architecture/repo-structure.md">
        <step>FETCH: quoth_get_template("repo-structure")</step>
        <step>ANALYZE: directory tree, naming patterns</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (3/5)"</step>
      </doc>
    </phase>

    <phase name="Patterns">
      <doc output="patterns/coding-conventions.md">
        <step>FETCH: quoth_get_template("coding-conventions")</step>
        <step>ANALYZE: TypeScript config, ESLint rules, code samples</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (4/5)"</step>
      </doc>

      <doc output="patterns/testing-patterns.md">
        <step>FETCH: quoth_get_template("testing-pattern")</step>
        <step>ANALYZE: test files, test config, test framework</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (5/5)"</step>
      </doc>
    </phase>

  ${ONBOARDING_PHASE}

    <phase name="Complete">
      Report: "Genesis complete. 5 documents created. AI tools configured."
    </phase>
  </workflow>
</genesis_protocol>`;

// ============================================
// COMPREHENSIVE DEPTH PROMPT (~2.5KB)
// 11 documents: standard + contracts + advanced
// ============================================
const GENESIS_COMPREHENSIVE_PROMPT = `<genesis_protocol version="3.0" depth="comprehensive">
  <role>Quoth Genesis Architect - Comprehensive Depth (11 documents)</role>
  <prime_directive>Document ONLY what exists in code. No invention.</prime_directive>

  ${EMBEDDING_RULES}

  <phase name="Foundation" docs="3">
    Create: project-overview.md, tech-stack.md, repo-structure.md
    Follow standard templates with aliases, FAQ, summaries.
  </phase>

  <phase name="Patterns" docs="2">
    Create: coding-conventions.md, testing-patterns.md
    Extract actual patterns from source files. Include code references.
  </phase>

  <phase name="Contracts" docs="3">
    <doc path="contracts/api-schemas.md">
      # API Schemas (Endpoints, Routes)
      Document: endpoint patterns, request/response shapes, validation.
      Read: src/app/api/ routes
    </doc>

    <doc path="contracts/database-models.md">
      # Database Models (Tables, Schema)
      Document: table structures, relationships, constraints.
      Read: migrations, schema files
    </doc>

    <doc path="contracts/shared-types.md">
      # Shared Types (Interfaces, Enums)
      Document: key interfaces, enums, type aliases.
      Read: types.ts, interfaces.ts files
    </doc>
  </phase>

  <phase name="Advanced" docs="3">
    <doc path="patterns/error-handling.md">
      # Error Handling (Errors, Exceptions)
      Document: error types, boundaries, API error responses.
    </doc>

    <doc path="patterns/security-patterns.md">
      # Security Patterns (Auth, Validation)
      Document: authentication flows, input validation, security headers.
    </doc>

    <doc path="meta/tech-debt.md">
      # Technical Debt (TODOs, Issues)
      Document: known issues, inconsistencies, improvement opportunities.
      Search for: TODO, FIXME, HACK comments
    </doc>
  </phase>

  ${UPLOAD_PROTOCOL}

  <workflow>
    <phase name="Setup">
      Read package.json, README.md, src/ structure, test files, API routes, schema files.
    </phase>

    <phase name="Foundation" docs="3">
      <doc output="architecture/project-overview.md">
        <step>FETCH: quoth_get_template("project-overview")</step>
        <step>ANALYZE: package.json, README.md, entry points</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (1/11)"</step>
      </doc>
      <doc output="architecture/tech-stack.md">
        <step>FETCH: quoth_get_template("tech-stack")</step>
        <step>ANALYZE: dependencies, config files, runtime</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (2/11)"</step>
      </doc>
      <doc output="architecture/repo-structure.md">
        <step>FETCH: quoth_get_template("repo-structure")</step>
        <step>ANALYZE: directory tree, naming patterns</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (3/11)"</step>
      </doc>
    </phase>

    <phase name="Patterns" docs="2">
      <doc output="patterns/coding-conventions.md">
        <step>FETCH: quoth_get_template("coding-conventions")</step>
        <step>ANALYZE: TypeScript config, ESLint rules, code samples</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (4/11)"</step>
      </doc>
      <doc output="patterns/testing-patterns.md">
        <step>FETCH: quoth_get_template("testing-pattern")</step>
        <step>ANALYZE: test files, test config, test framework</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (5/11)"</step>
      </doc>
    </phase>

    <phase name="Contracts" docs="3">
      <doc output="contracts/api-schemas.md">
        <step>FETCH: quoth_get_template("api-schemas")</step>
        <step>ANALYZE: API routes, request/response types, validation</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (6/11)"</step>
      </doc>
      <doc output="contracts/database-models.md">
        <step>FETCH: quoth_get_template("database-models")</step>
        <step>ANALYZE: migrations, schema files, ORM models</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (7/11)"</step>
      </doc>
      <doc output="contracts/shared-types.md">
        <step>FETCH: quoth_get_template("shared-types")</step>
        <step>ANALYZE: type definitions, interfaces, enums</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (8/11)"</step>
      </doc>
    </phase>

    <phase name="Advanced" docs="3">
      <doc output="patterns/error-handling.md">
        <step>FETCH: quoth_get_template("error-handling")</step>
        <step>ANALYZE: error classes, catch patterns, API error responses</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (9/11)"</step>
      </doc>
      <doc output="patterns/security-patterns.md">
        <step>FETCH: quoth_get_template("security-patterns")</step>
        <step>ANALYZE: auth flows, input validation, security headers</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (10/11)"</step>
      </doc>
      <doc output="meta/tech-debt.md">
        <step>FETCH: quoth_get_template("tech-debt")</step>
        <step>ANALYZE: TODO/FIXME/HACK comments, known issues</step>
        <step>CREATE: Follow template structure exactly</step>
        <step>UPLOAD: quoth_propose_update → Report "Uploaded (11/11)"</step>
      </doc>
    </phase>

  ${ONBOARDING_PHASE}

    <phase name="Complete">
      Report: "Genesis complete. 11 documents created. AI tools configured."
    </phase>
  </workflow>
</genesis_protocol>`;

// ============================================
// TOOL REGISTRATION
// ============================================

/**
 * Register all Genesis tools on an MCP server
 */
export function registerGenesisTools(
  server: McpServer,
  authContext: AuthContext
) {
  // Tool 1: Genesis Selector (asks user which depth)
  server.registerTool(
    'quoth_genesis',
    {
      title: 'Start Quoth Genesis Documentation',
      description:
        'Starts the Genesis documentation process. First presents depth options for user selection, ' +
        'then provides the appropriate focused prompt for that depth level. ' +
        'Depth levels: minimal (3 docs), standard (5 docs), comprehensive (11 docs).',
      inputSchema: {
        depth_level: z.enum(['minimal', 'standard', 'comprehensive']).default('standard')
          .describe('Documentation depth: minimal (3 docs, ~3min), standard (5 docs, ~7min), comprehensive (11 docs, ~20min)'),
        focus: z.enum(['full_scan', 'update_only']).default('full_scan')
          .describe('full_scan: Analyze entire codebase. update_only: Focus on recent changes.'),
        language_hint: z.string().optional()
          .describe('Optional hint about primary language (e.g., "typescript", "python")'),
      },
    },
    async ({ depth_level, focus, language_hint }) => {
      // Select the appropriate prompt based on depth
      let prompt: string;
      let docCount: number;
      let estimatedTime: string;

      switch (depth_level) {
        case 'minimal':
          prompt = GENESIS_MINIMAL_PROMPT;
          docCount = 3;
          estimatedTime = '2-3 minutes';
          break;
        case 'standard':
          prompt = GENESIS_STANDARD_PROMPT;
          docCount = 5;
          estimatedTime = '5-7 minutes';
          break;
        case 'comprehensive':
          prompt = GENESIS_COMPREHENSIVE_PROMPT;
          docCount = 11;
          estimatedTime = '15-20 minutes';
          break;
        default:
          prompt = GENESIS_STANDARD_PROMPT;
          docCount = 5;
          estimatedTime = '5-7 minutes';
      }

      // Add focus mode context if update_only
      if (focus === 'update_only') {
        prompt = `<focus_mode>UPDATE ONLY: Focus on recently modified files. Skip unchanged areas.</focus_mode>\n\n${prompt}`;
      }

      // Add language hint if provided
      if (language_hint) {
        prompt = `<language_hint>Primary: ${language_hint}. Prioritize ${language_hint}-specific patterns.</language_hint>\n\n${prompt}`;
      }

      return {
        content: [{
          type: 'text' as const,
          text: `## Quoth Genesis v3.0 - ${depth_level.charAt(0).toUpperCase() + depth_level.slice(1)} Depth

**Configuration:**
- Depth: \`${depth_level}\`
- Documents: ${docCount}
- Estimated Time: ${estimatedTime}
- Focus: \`${focus}\`
${language_hint ? `- Language: \`${language_hint}\`` : ''}

**Project Context:**
- Project ID: \`${authContext.project_id}\`
- Role: \`${authContext.role}\`

---

${prompt}

---

**Ready to start.** Analyze the codebase and create ${docCount} documents.
Upload each document immediately after creation using \`quoth_propose_update\`.`,
        }],
      };
    }
  );
}

// Export prompts for testing
export { GENESIS_MINIMAL_PROMPT, GENESIS_STANDARD_PROMPT, GENESIS_COMPREHENSIVE_PROMPT };
