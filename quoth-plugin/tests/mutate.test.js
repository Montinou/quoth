import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { generateMutations } = require('../daemon/lib/mutate.js')

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('generateMutations', () => {
  it('returns array of mutation objects', async () => {
    vi.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      status: 0,
      stdout: JSON.stringify([
        { description: 'Comment out button render', file: 'src/Login.tsx', line: 42, original: '<Button>Login</Button>', mutated: '{/* <Button>Login</Button> */}' },
        { description: 'Change API response', file: 'src/api/auth.ts', line: 10, original: 'return { token }', mutated: 'return { token: null }' }
      ])
    })
    const result = await generateMutations({
      testFile: 'tests/login.spec.ts',
      feature: 'login'
    })
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveProperty('description')
    expect(result[0]).toHaveProperty('file')
    expect(result[0]).toHaveProperty('original')
    expect(result[0]).toHaveProperty('mutated')
  })

  it('returns empty array on failure', async () => {
    vi.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      status: 1, stdout: ''
    })
    const result = await generateMutations({ testFile: 'x.spec.ts', feature: 'x' })
    expect(result).toEqual([])
  })

  it('returns empty array when no JSON array in output', async () => {
    vi.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      status: 0, stdout: 'Sorry, I cannot help with that.'
    })
    const result = await generateMutations({ testFile: 'x.spec.ts', feature: 'x' })
    expect(result).toEqual([])
  })
})
