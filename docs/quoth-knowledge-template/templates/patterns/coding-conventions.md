---
id: template-patterns-coding-conventions
type: template
status: active
last_updated_date: "2026-01-13"
category: patterns
target_type: testing-pattern
keywords: [template, coding-conventions, style, typescript, patterns, async, imports, types]
related_stack: []
common_queries: ["Code style?", "Coding conventions?", "TypeScript patterns?", "Import style?"]
---

# Coding Conventions Template

## Purpose (What This Template Is For)

**Coding conventions documents** define the coding style and patterns used in a project. Use this template when documenting TypeScript patterns, async handling, and import conventions. Ensures code consistency across the team.

- Use for: Style guides, TypeScript patterns, conventions
- Creates: `patterns/coding-conventions.md`

**Summary:** Coding conventions template for style documentation.

## TypeScript Patterns (Types, Interfaces, Generics)

**TypeScript conventions** in this project:

```typescript
// Prefer interfaces for objects
interface UserData {
  id: string;
  name: string;
  email?: string; // Optional with ?
}

// Use type for unions/intersections
type Status = 'active' | 'inactive' | 'pending';

// Generic patterns
function processItem<T extends BaseItem>(item: T): T {
  return { ...item, processed: true };
}
```

Reference: `src/types/` directory for shared types

**Summary:** TypeScript type patterns and conventions.

## Async Patterns (Promises, Await, Error Handling)

**Async/await conventions** for this project:

```typescript
// Standard async function
async function fetchData(id: string): Promise<Data> {
  const response = await api.get(`/data/${id}`);
  return response.data;
}

// Error handling with try-catch
async function safeOperation(): Promise<Result | null> {
  try {
    return await riskyOperation();
  } catch (error) {
    console.error('Operation failed:', error);
    return null;
  }
}
```

**Summary:** Async/await patterns and error handling.

## Import Organization (Ordering, Aliases)

**Import ordering** convention:

```typescript
// 1. External packages
import { z } from 'zod';
import type { FC } from 'react';

// 2. Internal absolute imports (path aliases)
import { Component } from '@/components/Component';
import { utils } from '@/lib/utils';

// 3. Relative imports
import { LocalHelper } from './helpers';
import type { LocalType } from './types';
```

Path aliases: `@/` maps to `src/`

**Summary:** Import ordering and path alias conventions.

## Naming Conventions (Variables, Functions, Files)

**Naming patterns** used:

| Type | Convention | Example |
|------|------------|---------|
| Variables | camelCase | `userData`, `isLoading` |
| Functions | camelCase | `fetchUser()`, `handleClick()` |
| Components | PascalCase | `UserProfile`, `DataTable` |
| Constants | UPPER_SNAKE | `MAX_RETRIES`, `API_URL` |
| Files | kebab-case | `user-profile.tsx`, `api-client.ts` |

**Summary:** Naming conventions for code elements.

## Common Questions (FAQ)

- **What naming convention for files?** Use kebab-case for files, PascalCase for components
- **How to organize imports?** External first, then `@/` aliases, then relative
- **Interface vs Type?** Use interface for objects, type for unions
- **Async error handling?** Use try-catch with specific error logging
- **Where are shared types?** In `src/types/` or co-located `*.types.ts` files

**Summary:** FAQ for coding conventions.

## Anti-Patterns (Never Do This)

- **Any type**: Avoid `any` - use `unknown` or proper types
- **Mixing conventions**: Don't mix camelCase and snake_case in same file
- **Barrel import cycles**: Avoid circular dependencies in index.ts exports
- **Implicit returns**: Always explicit return types for public functions

**Summary:** Coding convention anti-patterns.
