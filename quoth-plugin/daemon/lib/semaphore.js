'use strict'

/**
 * Minimal FIFO semaphore for capping concurrent stage execution.
 *
 * Spec §2.2 "Stage Semaphores": each pipeline stage (triage, extract, embed,
 * persist) runs inside its own Semaphore so that worker concurrency and stage
 * concurrency are decoupled. A worker that finishes triage on session A can
 * start triage on session B even if session A is still waiting for the
 * extract semaphore.
 *
 * Contract:
 *   - `run(fn)` invokes `fn` after acquiring a slot (awaiting if the cap is
 *     saturated). Releases the slot when `fn` resolves OR throws, so a
 *     failing stage does not leak capacity.
 *   - Waiters are served in FIFO order via the `q` array. Exactly one waiter
 *     is woken per release, so the invariant `active <= max` holds without
 *     re-checking on resume.
 *   - No external state, no global. Purely in-process. No threads.
 */
class Semaphore {
  constructor(max) {
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError(`Semaphore(max): expected positive integer, got ${max}`)
    }
    this.max = max
    this.active = 0
    this.q = []
  }

  async run(fn) {
    if (this.active >= this.max) {
      await new Promise(resolve => this.q.push(resolve))
    }
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      const next = this.q.shift()
      if (next) next()
    }
  }
}

module.exports = { Semaphore }
