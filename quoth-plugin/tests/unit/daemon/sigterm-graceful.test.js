import { describe, it, expect } from 'vitest'
import { gracefulShutdown } from '../../../daemon/daemon-core.js'

describe('gracefulShutdown', () => {
  it('rolls back in-flight claim on grace timeout', async () => {
    const rolled = []
    const state = {
      inFlight: [
        { claimedPath: '/tmp/x.pid.w1.jsonl', originalPath: '/tmp/x.jsonl', stage: 'extract' },
      ],
      rollback: claim => rolled.push(claim.originalPath),
    }
    await gracefulShutdown(state, { graceMs: 50 })
    expect(rolled).toContain('/tmp/x.jsonl')
  })
})
