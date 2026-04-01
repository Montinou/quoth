import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { extractSkill } = require('../daemon/lib/skill-extract.js')

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('extractSkill', () => {
  it('dispatches Sonnet 4.6 for extraction', async () => {
    const spawnSpy = vi.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        name: 'verify-login-redirect',
        description: 'Verify login redirects to dashboard',
        template: 'await page.goto("{{url}}")',
        params: ['url'],
        selectors: ['[data-testid="login"]'],
        assertions: ['toHaveURL']
      })
    })
    const result = await extractSkill({
      testFile: 'tests/login.spec.ts',
      testCode: 'test("login", async ({ page }) => { await page.goto("/login") })',
      feature: 'login'
    })
    expect(result).toHaveProperty('name')
    expect(result).toHaveProperty('template')
    expect(result).toHaveProperty('params')
    const args = spawnSpy.mock.calls[0][1]
    expect(args).toContain('claude-sonnet-4-6')
  })

  it('returns null on failure', async () => {
    vi.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      status: 1, stdout: ''
    })
    const result = await extractSkill({ testFile: 'x.spec.ts', feature: 'x' })
    expect(result).toBeNull()
  })

  it('returns null when no test code available', async () => {
    const result = await extractSkill({ testFile: '/nonexistent/path.spec.ts', feature: 'x' })
    expect(result).toBeNull()
  })
})
