---
id: pattern-backend-integration
type: testing-pattern
related_stack: [vitest, node, database]
last_verified_commit: "initial"
last_updated_date: "2026-01-10"
status: active
---

# Pattern: Backend Integration Testing

## Context
Integration tests verify that multiple components work together correctly. These tests typically involve real database connections or API calls.

## The Golden Rule
1. Use a dedicated test database (Docker recommended).
2. Clean up test data after each test.
3. Use transactions for test isolation when possible.
4. Mock only external third-party services, not internal dependencies.

## Code Example (Canonical)
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDatabase, destroyTestDatabase } from './test-utils';
import { UserRepository } from '../src/repositories/UserRepository';
import { db } from '../src/db';

describe('UserRepository Integration', () => {
  beforeAll(async () => {
    await createTestDatabase();
  });

  afterAll(async () => {
    await destroyTestDatabase();
  });

  beforeEach(async () => {
    // Clean tables before each test
    await db.delete().from('users');
  });

  it('should persist user to database', async () => {
    const repo = new UserRepository(db);
    
    const user = await repo.create({
      name: 'Alice',
      email: 'alice@example.com'
    });

    expect(user.id).toBeDefined();
    
    // Verify by reading back
    const found = await repo.findById(user.id);
    expect(found?.name).toBe('Alice');
  });
});
```

## Database Testing Utilities
```ts
// test-utils.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

export async function createTestDatabase() {
  const testDb = drizzle(process.env.TEST_DATABASE_URL!);
  await migrate(testDb, { migrationsFolder: './drizzle' });
  return testDb;
}
```

## Anti-Patterns (Do NOT do this)
- Sharing state between tests without cleanup.
- Using production database for tests.
- Mocking database calls in integration tests (defeats the purpose).
- Skipping cleanup in `afterEach`/`afterAll` hooks.
