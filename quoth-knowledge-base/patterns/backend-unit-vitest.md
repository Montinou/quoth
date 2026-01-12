---
id: pattern-backend-unit
type: testing-pattern
status: active
last_updated_date: "2026-01-12"
keywords: [vitest, unit-test, mock, vi.mock, backend, service, dependency-injection]
related_stack: [vitest, node, typescript]
---
# Backend Unit Testing: Vitest Mocking Pattern

## What This Covers
Vitest unit testing for backend services using vi.mock() for dependency isolation.
This pattern applies when testing services, controllers, or utilities with external dependencies like databases, APIs, or file systems.
Key terms: vi.mock, vi.mocked, vi.clearAllMocks, beforeEach.

## The Pattern
Import test utilities explicitly from `vitest` (never rely on globals).
Mock external dependencies with `vi.mock()` at the module level before imports.
Clear mocks in `beforeEach` to ensure test isolation between test cases.
Use `vi.mocked()` for type-safe mock assertions.

## Canonical Example
Mocking a database dependency in a UserService test:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from './UserService';
import { db } from './db';

// Module-level mock - MUST be before any imports that use it
vi.mock('./db');

describe('UserService', () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Reset mock state between tests
  });

  it('creates user with correct data', async () => {
    // Type-safe mock setup with vi.mocked()
    vi.mocked(db.insert).mockResolvedValue({ id: 1, name: 'Alice' });

    const user = await UserService.create('Alice');

    expect(user.id).toBe(1);
    expect(db.insert).toHaveBeenCalledWith({ name: 'Alice' });
  });
});
```

## Common Questions
- How do I mock a database in Vitest?
- What is the vi.mock pattern for backend services?
- How do I clear mocks between tests in Vitest?
- When should I use vi.mocked vs vi.fn?

## Anti-Patterns (Never Do This)
- Using jest.fn() or jest.mock(): Vitest uses vi.fn() and vi.mock(), not Jest syntax
- Global imports without explicit vitest import: Always `import { vi } from 'vitest'`
- Forgetting vi.clearAllMocks(): Causes test pollution and flaky tests
- Using any types in mock returns: Use proper TypeScript typing with vi.mocked()
- Placing vi.mock() after imports: Module mocks must be hoisted before imports
