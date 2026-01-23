/**
 * Quoth Guidelines
 * Adaptive guidelines for code, review, and document modes
 * Replaces the 3 separate personas (architect, auditor, documenter)
 */

export type GuidelinesMode = 'code' | 'review' | 'document';

export interface GuidelinesOutput {
  mode: GuidelinesMode;
  rules: string[];
  searchReminder: string;
  suggestedQuery: string;
  templateReminder: string;
  expandable: boolean;
}

/**
 * Context-aware suggested queries based on mode
 */
const SUGGESTED_QUERIES: Record<GuidelinesMode, string> = {
  code: 'patterns conventions best practices',
  review: 'anti-patterns violations common mistakes',
  document: 'template structure documentation',
};

/**
 * Core rules shared across all modes
 */
const CORE_RULES = [
  'Search first - `quoth_search_index` before proceeding',
  'Trust levels: >80% follow exactly, 60-80% verify, <60% cross-ref',
  'Docs = intended design - when code conflicts with docs, docs win',
  'Never invent patterns - only use what\'s documented',
  'Templates required - `quoth_get_template` before any Quoth updates',
];

/**
 * Mode-specific additional rules
 */
const MODE_RULES: Record<GuidelinesMode, string[]> = {
  code: [
    'Follow canonical examples exactly from HIGH trust results',
    'Check anti-patterns section before implementing',
  ],
  review: [
    'Distinguish "new feature" from "bad code" - don\'t update docs to match violations',
    'Flag violations with doc path reference, propose updates only for genuinely new patterns',
  ],
  document: [
    'Each H2 section = one embedding chunk (75-300 tokens)',
    'Include FAQ section with 4-6 searchable Q&A pairs',
  ],
};

/**
 * Anti-patterns by mode
 */
const ANTI_PATTERNS: Record<GuidelinesMode, string[]> = {
  code: [
    'Assuming patterns without searching Quoth',
    'Inventing patterns not in documentation',
    'Ignoring LOW trust warnings',
  ],
  review: [
    'Updating docs to match bad code',
    'Treating all code differences as "new features"',
    'Proposing updates without evidence snippets',
  ],
  document: [
    'Skipping template fetch before writing',
    'Creating sections outside 75-300 token range',
    'Missing frontmatter keywords',
  ],
};

/**
 * Full mode guidelines (detailed workflow)
 */
const FULL_WORKFLOW: Record<GuidelinesMode, string[]> = {
  code: [
    '1. Analyze request - identify what code/feature is needed',
    '2. Search Quoth - `quoth_search_index` with specific tech terms',
    '3. Evaluate results by trust level (HIGH/MEDIUM/LOW)',
    '4. Read full docs - `quoth_read_doc` for HIGH trust matches',
    '5. Compare code vs docs - if conflict, docs are correct',
    '6. Generate code following documented patterns exactly',
  ],
  review: [
    '1. Read the code being reviewed',
    '2. Search Quoth for relevant patterns and anti-patterns',
    '3. Compare code against documented conventions',
    '4. Classify differences: VIOLATION (breaks rules) vs NEW_PATTERN (genuinely novel)',
    '5. For violations: cite doc path, explain the rule broken',
    '6. For new patterns: propose update with evidence snippet',
  ],
  document: [
    '1. Identify document type (architecture/patterns/contracts)',
    '2. Fetch template - `quoth_get_template` for structure',
    '3. Search existing docs - avoid duplicates',
    '4. Follow template H2 sections exactly',
    '5. Ensure 75-300 tokens per section',
    '6. Submit via `quoth_propose_update` with evidence',
  ],
};

/**
 * Template mappings for document mode
 */
const TEMPLATE_MAPPINGS = `
| Category | Templates |
|----------|-----------|
| architecture | project-overview, tech-stack, repo-structure |
| patterns | coding-conventions, testing-pattern, error-handling, security-patterns |
| contracts | api-schemas, database-models, shared-types |
| meta | tech-debt |
`;

/**
 * Get compact guidelines (~150 tokens)
 */
export function getCompactGuidelines(mode: GuidelinesMode): GuidelinesOutput {
  return {
    mode,
    rules: [...CORE_RULES, ...MODE_RULES[mode]],
    searchReminder: 'STRONGLY RECOMMENDED: quoth_search_index before proceeding',
    suggestedQuery: SUGGESTED_QUERIES[mode],
    templateReminder: 'Call quoth_get_template before any Quoth document updates',
    expandable: true,
  };
}

/**
 * Format compact guidelines as markdown string
 */
export function formatCompactGuidelines(mode: GuidelinesMode): string {
  const guidelines = getCompactGuidelines(mode);
  const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);

  return `## Quoth Guidelines: ${modeLabel}

**${guidelines.searchReminder}**

### Core Rules
${guidelines.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

### Anti-Patterns
${ANTI_PATTERNS[mode].map(ap => `- ${ap}`).join('\n')}

### Suggested Search
\`quoth_search_index({ query: "${guidelines.suggestedQuery}" })\`

---
Full guidelines: \`quoth_guidelines({ mode: "${mode}", full: true })\``;
}

/**
 * Format full guidelines as markdown string (~500 tokens)
 */
export function formatFullGuidelines(mode: GuidelinesMode): string {
  const guidelines = getCompactGuidelines(mode);
  const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);

  let output = `## Quoth Guidelines: ${modeLabel} (Full)

**${guidelines.searchReminder}**

### Core Rules
${guidelines.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

### Workflow
${FULL_WORKFLOW[mode].join('\n')}

### Anti-Patterns
${ANTI_PATTERNS[mode].map(ap => `- ${ap}`).join('\n')}

### Trust Levels
| Level | Threshold | Action |
|-------|-----------|--------|
| HIGH | >80% | Primary source - follow exactly |
| MEDIUM | 60-80% | Supporting context - verify with HIGH sources |
| LOW | <60% | Cross-reference required |

### Common Search Queries
- For tests: "testing patterns vitest mock"
- For APIs: "api endpoint response format"
- For components: "component patterns conventions"
- For errors: "error handling try-catch"
`;

  if (mode === 'document') {
    output += `
### Template Mappings
${TEMPLATE_MAPPINGS}

### Embedding Rules
- Each H2 = separate embedding chunk
- Optimal size: 75-300 tokens per section
- Start bold: "**[Tech] feature** uses..."
- End with: "**Summary:** [tech] for [use case]"
- Include 4-6 FAQ pairs per document
`;
  }

  output += `
### Badge Requirement
If you used any \`quoth_*\` tools, end your response with:

\`\`\`
┌─────────────────────────────────────────────────┐
│ 🪶 Quoth                                        │
│   ✓ [doc path]: [what was applied]              │
└─────────────────────────────────────────────────┘
\`\`\`
`;

  return output;
}
