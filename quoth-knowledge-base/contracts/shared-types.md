---
id: contracts-shared-types
type: contract
last_verified_commit: "initial"
last_updated_date: "2026-01-10"
status: active
---

# Shared TypeScript Types

## Overview
Common types shared across the codebase for consistency.

## Utility Types
```ts
// Make specific properties required
type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };

// Make all properties nullable
type Nullable<T> = { [P in keyof T]: T[P] | null };

// Extract array element type
type ArrayElement<T> = T extends (infer U)[] ? U : never;

// Async function return type
type AsyncReturnType<T extends (...args: unknown[]) => Promise<unknown>> = 
  T extends (...args: unknown[]) => Promise<infer R> ? R : never;
```

## Result Type Pattern
```ts
type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

// Usage
function divide(a: number, b: number): Result<number, string> {
  if (b === 0) {
    return { ok: false, error: 'Division by zero' };
  }
  return { ok: true, value: a / b };
}
```

## Common DTOs
```ts
// User-related
interface UserDTO {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

interface CreateUserDTO {
  email: string;
  name: string;
  password: string;
}

// Pagination
interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
```

## Branding Pattern
```ts
// Branded types for type-safe IDs
type Brand<T, B> = T & { __brand: B };

type UserId = Brand<string, 'UserId'>;
type OrganizationId = Brand<string, 'OrganizationId'>;

// Factory functions
const createUserId = (id: string): UserId => id as UserId;
```

## Anti-Patterns
- Avoid `any` type (use `unknown` for truly unknown types)
- Avoid type assertions without validation
- Don't use `object` type (use `Record<string, unknown>`)
