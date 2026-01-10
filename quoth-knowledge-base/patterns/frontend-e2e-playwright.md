---
id: pattern-frontend-e2e
type: testing-pattern
related_stack: [playwright, typescript]
last_verified_commit: "initial"
last_updated_date: "2026-01-10"
status: active
---

# Pattern: Frontend E2E Flows (Playwright)

## Context
Used for end-to-end testing of frontend applications. Playwright provides reliable cross-browser testing.

## The Golden Rule
1. Locate by **user-visible roles** (`getByRole`, `getByLabel`) whenever possible.
2. Use `await expect(...)` assertions to leverage auto-retrying.
3. Place Page Object Models in `tests/e2e/pages/`.
4. Use `test.step()` for clear test reporting.

## Code Example (Canonical)
```ts
import { test, expect } from '@playwright/test';

test('user can login', async ({ page }) => {
  await test.step('Navigate to login page', async () => {
    await page.goto('/login');
  });

  await test.step('Fill credentials', async () => {
    await page.getByLabel('Email').fill('user@example.com');
    await page.getByLabel('Password').fill('securePassword123');
  });

  await test.step('Submit form', async () => {
    await page.getByRole('button', { name: 'Sign in' }).click();
  });

  await test.step('Verify successful login', async () => {
    await expect(page.getByText('Welcome back')).toBeVisible();
  });
});
```

## Page Object Model Pattern
```ts
// tests/e2e/pages/LoginPage.ts
import { Page, Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.submitButton = page.getByRole('button', { name: 'Sign in' });
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
```

## Anti-Patterns (Do NOT do this)
- Using `page.waitForTimeout()` for waiting (use proper assertions instead).
- Using CSS selectors when accessible locators are available.
- Hard-coding test data in test files (use fixtures).
- Not using `test.step()` for complex test flows.
