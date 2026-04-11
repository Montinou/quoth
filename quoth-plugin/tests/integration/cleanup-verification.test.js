// tests/integration/cleanup-verification.test.js
//
// Task 23 / spec §6.5. Runs `scripts/verify-cleanup.sh` and asserts
// exit 0 — i.e. no references to retired subsystems (JUDGE, DISTILL,
// CONSOLIDATE, voyage-4-lite, bandit-v2, SNIPS, judge_queue,
// cluster_posterior) remain in the tree.
//
// This test is `describe.skip`'d intentionally until Task 24 lands the
// full legacy-code cleanup. At that point Task 24 Step 6 un-skips it
// and the suite must pass green. Running it earlier would always fail
// — by design.

import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.resolve(__dirname, '..', '..')

describe.skip('verify-cleanup.sh', () => {
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
