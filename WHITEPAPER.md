Quoth: AI-Driven Technical Documentation MCP Strategy

> **Note:** This is the original Quoth v1 whitepaper. For v2.0 "AI Memory" architecture with local-first storage, quoth-memory subagent, and session logging, see [docs/memory-v2/2026-01-28-quoth-v2-ai-memory-design.md](docs/memory-v2/2026-01-28-quoth-v2-ai-memory-design.md).

For Multi-Repo Codebase & Automated Testing (Vitest + Playwright Stack)

1. Executive SummaryThis document outlines the technical implementation of Quoth, a Model Context Protocol (MCP) server designed to act as a Living Source of Truth for AI agents (specifically Claude).The Problem: AI agents suffer from context exhaustion and hallucinations when navigating large codebases, often inventing code patterns that violate internal standards.The Quoth Solution: A "Read-Contrast-Update" loop where the AI never blindly overwrites documentation but acts as an auditor comparing the current code state against the documented standard managed by Quoth.2. The Data Structure (The "Quoth Knowledge Graph")To support a multi-repo environment, we will use a Centralized Knowledge Repo (or a unified submodule) structured specifically for AI consumption.2.1 Directory StructureThe structure must be predictable. Do not nest deeper than 3 levels to save token search depth./ai-knowledge-base
│
├── /contracts            # Critical Interfaces & DTOs
│   ├── api-schemas.md
│   ├── database-models.md
│   └── shared-types.md
│
├── /patterns             # The "Recipes" (CRITICAL for Tests)
│   ├── backend-unit-vitest.md      # Vitest specific patterns
│   ├── frontend-e2e-playwright.md  # Playwright specific patterns
│   └── backend-integration.md
│
├── /architecture         # Folder structure & boundaries
│   ├── backend-repo-structure.md
│   ├── frontend-repo-structure.md
│   └── decision-records.md (ADRs)
│
└── /meta                 # System health
    └── validation-log.md
2.2 The "AI-Native" File FormatEvery documentation file MUST include YAML frontmatter to track drift. The content should be concise and use pseudo-code or simplified TypeScript.Core Principles for Content:High Signal-to-Noise Ratio: Do not explain standard language features (e.g., "How Array.map works"). Focus ONLY on project-specific constraints.DRY (Don't Repeat Yourself): If a pattern is shared, link to a shared file. Do not copy-paste.Example: patterns/backend-unit-vitest.md---
id: pattern-backend-unit
type: testing-pattern
related_stack: [vitest, node]
last_verified_commit: "a1b2c3d"
last_updated_date: "2024-05-20"
status: active
---

# Pattern: Backend Unit & Integration Testing (Vitest)

## Context
Used for testing backend services and controllers. We use Vitest for its speed and native ESM support.

## The Golden Rule
1. Always import `vi`, `describe`, `it`, `expect` from `vitest` (Do NOT rely on globals).
2. Use `vi.mock()` for external dependencies, never manual mocks in `__mocks__` unless specified.
3. For Integration tests, use a real database instance (via Docker) if possible, or strictly typed repositories.

## Code Example (Canonical)
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from './UserService';
import { db } from './db';

// Mocking the database module
vi.mock('./db');

describe('UserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a user successfully', async () => {
    // Setup mock
    vi.mocked(db.insert).mockResolvedValue({ id: 1, name: 'Alice' });

    const user = await UserService.create('Alice');
    
    expect(user.id).toBe(1);
    expect(db.insert).toHaveBeenCalledWith({ name: 'Alice' });
  });
});
Anti-Patterns (Do NOT do this)Using jest.fn() or jest.mock() (Common hallucination).Using module.exports syntax in test files.Leaving generic any types in mock returns.
**Example: `patterns/frontend-e2e-playwright.md`**

```markdown
---
id: pattern-frontend-e2e
type: testing-pattern
related_stack: [playwright, typescript]
status: active
---

# Pattern: Frontend E2E Flows (Playwright)

## The Golden Rule
1. Locate by **user-visible roles** (`getByRole`, `getByLabel`) whenever possible.
2. Use `await expect(...)` assertions to leverage auto-retrying.
3. Place Page Object Models in `tests/e2e/pages/`.

## Code Example (Canonical)
```ts
test('user can login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('user@example.com');
  await page.getByRole('button', { name: 'Sign in' }).click();
  
  await expect(page.getByText('Welcome back')).toBeVisible();
});

---

### 3. Quoth MCP Server Definition (Tools & Prompts)

The Quoth Server will be implemented using the **Next.js MCP SDK** and deployed on **Vercel**.

#### 3.1 Tools (Capabilities)
To maximize context efficiency, we adopt a **"Search + Read" (Lazy Loading)** strategy.

* **Tool 1: `quoth_search_index`**
    * **Description:** Searches the Quoth documentation index for relevant topics, patterns, or architecture notes. 
    * **Input:** `query` (string) - E.g. "auth flow", "vitest mocks".
    * **Output:** Returns a lightweight list of matching File IDs and Titles.
    * **Implementation Note:** Use **Vercel Data Cache** to cache the index from GitHub to avoid rate limits. Future enhancement: Use vector embeddings (Vercel AI SDK) for semantic search.

* **Tool 2: `quoth_read_doc`**
    * **Description:** Retrieves the full content of a specific documentation file using its ID found via search.
    * **Input:** `doc_id` (string).
    * **Output:** The full Markdown content + Frontmatter of the file.

* **Tool 3: `quoth_propose_update`**
    * **Description:** Submits a diff to update documentation.
    * **Input:** `doc_id`, `new_content`, `evidence_snippet`, `reasoning`.

#### 3.2 Prompts (Personas)
The MCP Protocol supports serving Prompts directly to the client. This ensures the System Prompts (defined in Section 4) are version-controlled alongside the code.

* **Prompt 1: `quoth_architect`**
    * **Description:** "Initialize the session for writing code or tests. Loads the 'Single Source of Truth' enforcement rules."
    * **Content:** Injects the XML from Section 4.1 into the conversation context.

* **Prompt 2: `quoth_auditor`**
    * **Description:** "Initialize the session for reviewing code and updating documentation. Activates strict contrast rules."
    * **Content:** Injects the XML from Section 4.2 into the conversation context.

---

### 4. The "Anti-Hallucination" System Prompts

These XML contents will be served dynamically by the `quoth_architect` and `quoth_auditor` MCP Prompts.

#### 4.1. The "Architect" Persona (For Generating Code/Tests)

```xml
<system_prompt>
    <role>
        You are the Lead Architect and QA Specialist. You possess the Quoth toolset, the "Single Source of Truth" for this project.
    </role>

    <prime_directive>
        NEVER guess implementation details. NEVER assume standard library usage. ALWAYS verify against the Quoth Knowledge Base patterns (specifically Vitest for Backend, Playwright for Frontend) before generating code.
    </prime_directive>

    <workflow>
        <step index="1">
            Analyze the user request (e.g., "Create a test for Feature X").
        </step>
        <step index="2">
            Use `quoth_search_index` to find relevant patterns.
        </step>
        <step index="3">
            Call `quoth_read_doc` with the ID returned by the search to get the exact syntax.
        </step>
        <step index="4">
            If the code you see in the actual repo contradicts the documentation, prioritize the DOCUMENTATION as the intended design, but flag the discrepancy to the user.
        </step>
        <step index="5">
            Generate the code following the "Canonical Examples" found in the docs strictly.
        </step>
    </workflow>
</system_prompt>
4.2. The "Auditor" Persona (For Updating Docs)<system_prompt>
    <role>
        You are the Quoth Documentation Auditor. Your job is to ensure the Knowledge Base reflects reality, but you must distinguish between "New Features" and "Bad Code".
    </role>

    <task>
        Contrast the provided codebase files against the retrieved Documentation files.
    </task>

    <strict_rules>
        <rule>
            Do NOT update the documentation just because the code is different. The code might be wrong (technical debt).
        </rule>
        <rule>
            ENFORCE BREVITY AND EFFICIENCY: When proposing updates, strictly avoid verbosity. 
            - Use pseudo-code for boilerplate. 
            - Do not explain standard language features. 
            - Focus ONLY on project-specific constraints and deviations.
            - If a pattern is redundant with an existing one, link to it instead of duplicating.
        </rule>
        <rule>
            IF code uses a pattern (e.g., `jest.mock` instead of `vi.mock`) that is listed under "Anti-Patterns" in the docs:
            THEN report a CODE VIOLATION. Do NOT update the docs to allow the anti-pattern.
        </rule>
        <rule>
            IF code introduces a completely new architectural element (e.g., a new folder `src/services/graphql`) not present in `architecture/`:
            THEN call `quoth_propose_update` with evidence.
        </rule>
        <rule>
            When updating, you must preserve the YAML Frontmatter and update the `last_verified_commit` field.
        </rule>
    </strict_rules>

    <output_format>
        Return a structured analysis:
        1. CONSISTENT: [List of patterns matched]
        2. VIOLATIONS: [Code that breaks documented rules]
        3. UPDATES_NEEDED: [New patterns found that need documentation (Keep concise)]
    </output_format>
</system_prompt>
5. Implementation RoadmapBootstrap (Manual Phase):Create the /quoth-knowledge-base repo.Manually write the first 3 critical patterns for Vitest and Playwright.Quoth Server Setup (Next.js + Vercel):Transport: Use ListToolsRequestSchema and CallToolRequestSchema.Prompts: Implement ListPromptsRequestSchema and GetPromptRequestSchema.Data Access: Use GitHub API (Octokit) to fetch the Markdown files.Optimization: Implement next/cache (revalidate: 3600) for the quoth_search_index tool.Deploy: Deploy to Vercel.The First Audit:Run Claude, select the Quoth Auditor persona.Feed it one feature folder.Review inconsistencies.Automation:Create a CI/CD script that uses the Quoth Auditor logic to flag "Documentation Drift" on Pull Requests.6. Future Scalability: Quoth SaaS ArchitectureThe architecture is designed to support a multi-tenant SaaS model where different clients can have their own isolated documentation contexts.6.1 Multi-Tenant Repo StrategyInstead of hardcoding a single GitHub repo, Quoth Server will resolve the target repository dynamically.Database: A simple mapping table: API_KEY -> GITHUB_REPO_URL + GITHUB_TOKEN.Auth: The Quoth Client passes an API Key in the headers.Isolation: The Next.js API Route middleware intercepts the request, looks up the repo configuration, and instantiates the GitHub Octokit client specifically for that tenant.6.2 Context InjectionThe Tool definitions (quoth_search_index) remain the same, but the execution changes.Current: search(query) -> searches default repo.SaaS Future: search(query) -> middleware determines tenant -> searches tenant-repo.Benefit: The AI Agent doesn't need to know about "Project IDs". It just asks for "docs", and Quoth serves the docs relevant to the authorized user.6.3 Stack AgnosticismIn a SaaS model, one project might use Vitest and another Jest.The Prompt (quoth_architect) can be dynamically hydrated based on the repo's configuration.We can inject a <tech_stack> block into the XML System Prompt dynamically before serving it to Claude, ensuring the "Architect" persona adapts to the specific client's technology choices.