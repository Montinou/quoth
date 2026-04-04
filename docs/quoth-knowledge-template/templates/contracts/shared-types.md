---
id: template-contracts-shared-types
type: template
status: active
last_updated_date: "2026-01-13"
category: contracts
target_type: contract
keywords: [template, shared-types, interfaces, enums, type-aliases, typescript, definitions]
related_stack: []
common_queries: ["Shared types?", "Type definitions?", "Interface patterns?", "Enums?"]
---

# Shared Types Template

## Purpose (What This Template Is For)

**Shared types documents** catalog TypeScript types used across the codebase. Use this template when documenting interfaces, enums, and type aliases that are shared between modules. Ensures type consistency and helps developers find the right types.

- Use for: Type definitions, interfaces, enums documentation
- Creates: `contracts/shared-types.md`

**Summary:** Shared types template for TypeScript definitions.

## Core Interfaces (Entity Types, DTOs)

**Primary entity interfaces**:

```typescript
// User entity
interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

// API Response DTO (without sensitive fields)
interface UserResponse {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}
```

Reference: `src/types/entities.ts`

**Summary:** Core entity interfaces and DTOs.

## Enum Definitions (Status, Roles, Categories)

**Shared enums** used across the application:

```typescript
// User roles
enum UserRole {
  Admin = 'admin',
  Editor = 'editor',
  Viewer = 'viewer',
}

// Resource status
enum Status {
  Draft = 'draft',
  Active = 'active',
  Archived = 'archived',
}

// Use const assertions for literal types
const PRIORITIES = ['low', 'medium', 'high'] as const;
type Priority = (typeof PRIORITIES)[number];
```

Reference: `src/types/enums.ts`

**Summary:** Enum definitions for shared constants.

## Type Aliases (Utilities, Helpers)

**Common type utilities**:

```typescript
// Nullable helper
type Nullable<T> = T | null;

// API response wrapper
type ApiResponse<T> = {
  data: T;
  meta: { timestamp: string };
};

// Pagination wrapper
type Paginated<T> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
};

// Pick/Omit patterns
type CreateUserInput = Omit<User, 'id' | 'createdAt' | 'updatedAt'>;
type UpdateUserInput = Partial<CreateUserInput>;
```

**Summary:** Type alias patterns and utilities.

## Zod Schema Types (Inferred Types)

**Deriving types from Zod schemas**:

```typescript
import { z } from 'zod';

// Define schema
const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(2),
  role: z.enum(['admin', 'editor', 'viewer']),
});

// Infer type from schema
type User = z.infer<typeof UserSchema>;

// Partial schema for updates
const UpdateUserSchema = UserSchema.partial().omit({ id: true });
type UpdateUser = z.infer<typeof UpdateUserSchema>;
```

Reference: `src/lib/schemas/`

**Summary:** Zod schema to TypeScript type patterns.

## Common Questions (FAQ)

- **Where are shared types?** In `src/types/` directory
- **Interface vs Type?** Use interface for objects, type for unions/utilities
- **How to create DTOs?** Use `Omit`/`Pick` to exclude/include specific fields
- **Zod or manual types?** Prefer Zod for runtime validation, infer TS types
- **How to extend interfaces?** Use `extends` keyword or intersection `&`

**Summary:** FAQ for shared types patterns.

## Anti-Patterns (Never Do This)

- **Duplicating types**: Don't redefine the same interface in multiple files
- **Using any**: Use `unknown` for truly unknown types, then narrow
- **Inconsistent naming**: Match interface names to entity names
- **No exports**: Always export shared types from barrel `index.ts`

**Summary:** Shared types anti-patterns to avoid.
