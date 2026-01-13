---
id: template-architecture-repo-structure
type: template
status: active
last_updated_date: "2026-01-13"
category: architecture
target_type: architecture
keywords: [template, repo-structure, folders, directories, organization, naming, layout]
related_stack: []
common_queries: ["Where is the code?", "Folder structure?", "Directory layout?", "Naming conventions?"]
---

# Repository Structure Template

## Purpose (What This Template Is For)

**Repository structure documents** map the folder organization of a codebase. Use this template when documenting how files and directories are organized. Helps developers navigate unfamiliar codebases quickly.

- Use for: Directory layout and file organization documentation
- Creates: `architecture/repo-structure.md`

**Summary:** Repo structure template for directory documentation.

## Directory Layout (Folders, Structure, Tree)

**Root directory** organization:

```
/
├── src/                    # Source code
│   ├── app/                # Application routes/pages
│   ├── components/         # Reusable UI components
│   ├── lib/                # Shared libraries and utilities
│   └── types/              # TypeScript type definitions
├── tests/                  # Test files
├── config/                 # Configuration files
├── public/                 # Static assets
└── docs/                   # Documentation
```

**Summary:** Root-level folder structure overview.

## Key Directories (Important Folders, Core Paths)

**Critical directories** for development:

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `src/app/` | Routes and pages | `page.tsx`, `layout.tsx` |
| `src/lib/` | Business logic | Core services |
| `src/components/` | UI components | Reusable elements |
| `tests/` | Test suites | `*.test.ts`, `*.spec.ts` |

Reference specific files: `src/lib/[service].ts:LINE`

**Summary:** Key directories and their purposes.

## Naming Conventions (File Names, Patterns)

**File naming** patterns in this project:

- **Components**: PascalCase (`UserProfile.tsx`)
- **Utilities**: camelCase (`formatDate.ts`)
- **Tests**: `[name].test.ts` or `[name].spec.ts`
- **Types**: `[name].types.ts` or in `types/` directory
- **Config**: lowercase with dots (`eslint.config.js`)

**Summary:** File naming conventions used.

## Module Organization (Imports, Exports)

**Import patterns** and module structure:

```typescript
// Absolute imports via path aliases
import { Component } from '@/components/Component';
import { util } from '@/lib/utils';

// Barrel exports from index files
export * from './ComponentA';
export * from './ComponentB';
```

Path aliases defined in: `tsconfig.json` paths section

**Summary:** Module import/export patterns.

## Common Questions (FAQ)

- **Where is the main source code?** All source code is in `src/` directory
- **What's the naming convention?** Components use PascalCase, utilities use camelCase
- **Where do tests go?** Tests are co-located or in `tests/` directory
- **How are imports organized?** Use `@/` path alias for absolute imports
- **Where is configuration?** Root-level config files and `config/` directory

**Summary:** FAQ for repository structure questions.

## Anti-Patterns (Never Do This)

- **Inconsistent naming**: Mixing camelCase and snake_case in same directory
- **Deep nesting**: Avoid `src/a/b/c/d/e/file.ts` - keep it flat
- **Missing index files**: Use barrel exports for cleaner imports

**Summary:** Anti-patterns to avoid in repo structure.
