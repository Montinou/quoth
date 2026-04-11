// tests/integration/cleanup-verification.test.js
//
// Task 23 / spec §6.5. Runs `scripts/verify-cleanup.sh` and asserts
// exit 0 — i.e. no references to the pre-v3.6 retired subsystems remain
// in the tree. See `scripts/verify-cleanup.sh` for the authoritative
// list of stale terms the grep gate checks for.

import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.resolve(__dirname, '..', '..')

describe('verify-cleanup.sh', () => {
  it('exits 0 after legacy cleanup (Task 24)', () => {
    let err = null
    try {
      execSync('bash scripts/verify-cleanup.sh', { cwd: pluginRoot, stdio: 'pipe' })
    } catch (e) {
      err = e
    }
    expect(err, err?.stdout?.toString?.() ?? err?.message).toBeNull()
  })
})
