---
id: pattern-backend-unit
type: testing-pattern
related_stack: [vitest, node]
last_verified_commit: "initial"
last_updated_date: "2026-01-10"
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
```

## Anti-Patterns (Do NOT do this)
- Using `jest.fn()` or `jest.mock()` (Common hallucination).
- Using `module.exports` syntax in test files.
- Leaving generic `any` types in mock returns.
- Not clearing mocks between tests.
