---
id: template-patterns-testing
type: template
status: active
last_updated_date: "2026-01-13"
category: patterns
target_type: testing-pattern
keywords: [template, testing, test, vitest, jest, mock, unit-test, integration-test]
related_stack: []
common_queries: ["How do I test?", "Testing pattern template", "How to mock?", "Test structure?"]
---

# Testing Pattern Template

## Purpose (What This Template Is For)

**Testing pattern documents** define how tests should be written for specific scenarios. Use this template when documenting test frameworks, mocking strategies, and test structures. Ensures consistent test quality across the codebase.

- Use for: Unit tests, integration tests, mocking patterns
- Creates: `patterns/[test-type]-[framework].md`

**Summary:** Testing pattern template for test documentation.

## Test Framework (Vitest, Jest, Setup)

**Test framework** configuration for this pattern:

- **Framework**: [Vitest / Jest / Mocha]
- **Environment**: [jsdom / node / happy-dom]
- **Coverage**: [v8 / istanbul]

```typescript
// vitest.config.ts or jest.config.js reference
export default defineConfig({
  test: {
    environment: '[environment]',
  },
});
```

**Summary:** Test framework and configuration.

## Test Structure (Describe, It, Arrange-Act-Assert)

**Standard test structure** for this pattern:

```typescript
describe('[ComponentName]', () => {
  beforeEach(() => {
    // Setup - reset mocks, create fixtures
  });

  it('should [expected behavior]', () => {
    // Arrange
    const input = createTestInput();

    // Act
    const result = functionUnderTest(input);

    // Assert
    expect(result).toBe(expected);
  });
});
```

**Summary:** Test structure using Arrange-Act-Assert pattern.

## Mocking Strategy (Mock, Spy, Stub)

**Mocking approach** for dependencies:

```typescript
// Module mock
vi.mock('@/lib/database', () => ({
  getConnection: vi.fn().mockResolvedValue(mockConnection),
}));

// Inline mock
const mockFn = vi.fn().mockReturnValue('mocked');

// Spy on existing method
vi.spyOn(service, 'method').mockImplementation(() => 'spied');
```

Reset mocks in `beforeEach`: `vi.clearAllMocks()`

**Summary:** Mocking patterns for dependency isolation.

## Assertions (Expect, Matchers)

**Common assertions** for this pattern:

```typescript
// Value assertions
expect(result).toBe(expected);
expect(result).toEqual({ key: 'value' });

// Async assertions
await expect(asyncFn()).resolves.toBe(value);
await expect(asyncFn()).rejects.toThrow('error');

// Mock assertions
expect(mockFn).toHaveBeenCalledWith(args);
expect(mockFn).toHaveBeenCalledTimes(1);
```

**Summary:** Assertion patterns and matchers.

## Common Questions (FAQ)

- **How do I run tests?** Use `npm test` or `vitest` for watch mode
- **How do I mock a module?** Use `vi.mock('module')` at top of test file
- **Where do tests go?** Co-located as `[name].test.ts` or in `tests/` directory
- **How do I test async code?** Use `async/await` with `resolves`/`rejects` matchers
- **How do I reset mocks?** Call `vi.clearAllMocks()` in `beforeEach`

**Summary:** FAQ for testing patterns.

## Anti-Patterns (Never Do This)

- **Using `jest.mock` with Vitest**: Use `vi.mock` instead - wrong framework API
- **Not resetting mocks**: Always `vi.clearAllMocks()` to prevent test pollution
- **Testing implementation**: Test behavior and outputs, not internal details
- **Skipping error cases**: Always test both success and failure paths

**Summary:** Testing anti-patterns to avoid.
