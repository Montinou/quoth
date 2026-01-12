---
id: pattern-frontend-e2e
type: testing-pattern
status: active
last_updated_date: "2026-01-12"
keywords: [playwright, e2e, end-to-end, testing, page-object-model, getByRole, locator]
related_stack: [playwright, typescript]
---
# Frontend E2E Testing: Playwright Locator Pattern

## What This Covers
Playwright end-to-end testing for frontend applications using accessible locators and Page Object Model.
This pattern applies when testing user flows across pages, forms, and interactions.
Key terms: getByRole, getByLabel, test.step, Page Object Model.

## The Pattern
Locate elements by user-visible roles (`getByRole`, `getByLabel`) instead of CSS selectors.
Use `await expect(...)` assertions for auto-retrying behavior.
Organize reusable locators in Page Object classes under `tests/e2e/pages/`.
Structure complex tests with `test.step()` for clear reporting.

## Canonical Example
Testing a login flow with accessible locators:
```typescript
import { test, expect } from '@playwright/test';

test('user can login', async ({ page }) => {
  await test.step('Navigate to login page', async () => {
    await page.goto('/login');
  });

  await test.step('Fill credentials', async () => {
    // Use accessible locators - getByLabel, getByRole
    await page.getByLabel('Email').fill('user@example.com');
    await page.getByLabel('Password').fill('securePassword123');
  });

  await test.step('Submit and verify', async () => {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Welcome back')).toBeVisible();
  });
});
```

## Common Questions
- How do I locate elements in Playwright?
- What is the Page Object Model pattern for Playwright?
- When should I use getByRole vs getByLabel?
- How do I structure complex E2E test flows?

## Anti-Patterns (Never Do This)
- Using page.waitForTimeout(): Use proper expect() assertions with auto-retry
- Using CSS selectors: Prefer getByRole, getByLabel, getByText for resilience
- Hard-coding test data in tests: Use fixtures and test data files
- Skipping test.step(): Complex flows become unreadable without structure
