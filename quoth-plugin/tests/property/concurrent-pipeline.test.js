// tests/property/concurrent-pipeline.test.js
//
// Task 22 / spec §7.4: concurrency exactly-once invariant.
//
// Drops N fixtures into processing/ and drives them through
// `runWorkerPool` at random concurrency. After the pool drains, every
// fixture MUST land in exactly one terminal bucket (done/routine/empty).
// No fixtures may be lost (still in processing/), no fixture may land in
// two buckets, and the total count in terminal buckets must equal N.
//
// This is the property Task 12 (worker pool + stage semaphores) and Task
// 13 (polling fallback + orphan recovery) were supposed to guarantee —
// this test pins it against randomness.
//
// No fast-check dep in quoth-plugin; hand-rolled 30 iterations using
// seeded-ish Math.random() (fixed per-iteration for reproducibility of
// failing cases via the iteration index printed on failure).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const H = require_('../integration/_helpers.js')

const ITERATIONS = 30
const MAX_N = 50
const MAX_CONCURRENCY = 8

function randInt(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

// Three fixture flavors drive the three productive terminal buckets.
// We intentionally avoid the "error" bucket here — forcing throws inside
// processSessionWithPipeline would require per-session LLM injection,
// which is out of scope for the worker-pool invariant we're testing.
const FLAVORS = ['productive', 'routine', 'empty']

function seedFlavor(home, sid, flavor) {
  const dir = path.join(home, 'trajectories', 'processing')
  fs.mkdirSync(dir, { recursive: true })
  const jsonl = path.join(dir, `${sid}.jsonl`)
  const meta = path.join(dir, `${sid}.meta.json`)

  let lines
  if (flavor === 'empty') {
    lines = [
      // no tool_use entries — drives the empty/ branch
      { event: 'session_summary', session: sid, project: 'proj-prop' },
    ]
  } else {
    lines = [
      { event: 'tool_use', session: sid, tool: 'Write', tool_input: { file_path: `${sid}.js` }, outcome: 'success', task: `wrote ${sid}` },
      { event: 'tool_use', session: sid, tool: 'Edit', tool_input: { file_path: `${sid}.js` }, outcome: 'success', task: `edited ${sid}` },
    ]
  }
  fs.writeFileSync(jsonl, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
  fs.writeFileSync(meta, JSON.stringify({
    session_id: sid,
    project: 'proj-prop',
    status: 'terminated',
    first_seen_ts: Date.now() - 1000,
    last_seen_ts: Date.now(),
    tool_count: lines.filter(l => l.event === 'tool_use').length,
    closed_marker: true,
  }))
  return { jsonl, flavor }
}

function countFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return 0
  let n = 0
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.isDirectory()) stack.push(path.join(d, ent.name))
      else if (ent.name.endsWith('.jsonl')) n++
    }
  }
  return n
}

function listSidsInBucket(home, bucket) {
  const root = path.join(home, 'trajectories', bucket)
  if (!fs.existsSync(root)) return []
  const sids = []
  const stack = [root]
  while (stack.length) {
    const d = stack.pop()
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.isDirectory()) stack.push(path.join(d, ent.name))
      else if (ent.name.endsWith('.jsonl')) {
        sids.push(path.basename(ent.name, '.jsonl'))
      }
    }
  }
  return sids
}

describe('concurrent pipeline exactly-once invariant', () => {
  let home
  beforeEach(() => {
    home = H.mkHome('quoth-prop-')
    process.env.QUOTH_HOME = home
    process.env.QUOTH_DAILY_LLM_BUDGET_USD = '100.00'
  })
  afterEach(() => {
    H.rmHome(home)
    delete process.env.QUOTH_HOME
    delete process.env.QUOTH_DAILY_LLM_BUDGET_USD
  })

  for (let iter = 0; iter < ITERATIONS; iter++) {
    it(`iteration ${iter}: N sessions × concurrency ∈ [1,8] → exactly one terminal bucket each`, async () => {
      const { core } = H.freshRequire(require_)
      const hnsw = H.inMemoryHnsw()

      const N = randInt(1, MAX_N)
      const concurrency = randInt(1, MAX_CONCURRENCY)

      const fixtures = []
      for (let i = 0; i < N; i++) {
        const sid = `iter${iter}-s${i}`
        const flavor = FLAVORS[randInt(0, FLAVORS.length - 1)]
        fixtures.push({ sid, ...seedFlavor(home, sid, flavor) })
      }

      // Fake LLMs rotate based on the fixture flavor — but worker pool
      // hands out files, not flavors, so we parse the flavor from the
      // sidecar at call time. Simpler: always answer productive+entities
      // from gemini and let the empty/ branch short-circuit before triage
      // via the zero-tool_use guard in daemon-core. Routine fixtures get
      // productive=false from gemini.
      const llm = {
        gemini: async ({ prompt } = {}) => {
          // Extract the sid from the prompt body if possible — otherwise
          // read the sidecar flavor by probing the first fixture. A
          // simpler and equally valid strategy: have gemini always return
          // productive=true for fixtures whose sid is in the "productive"
          // set, and productive=false otherwise.
          const p = String(prompt ?? '')
          const match = p.match(/iter\d+-s\d+/)
          const sid = match ? match[0] : null
          const fx = fixtures.find(f => f.sid === sid)
          const productive = fx?.flavor === 'productive'
          return {
            text: JSON.stringify({ productive, urgency: 'medium', suspected_kinds: ['pattern'] }),
            cost_usd: 0.0001,
          }
        },
        kimi: async ({ prompt } = {}) => {
          const p = String(prompt ?? '')
          const match = p.match(/iter\d+-s\d+/)
          const sid = match ? match[0] : `iter${iter}-s?`
          return {
            text: JSON.stringify({
              entities: [
                {
                  kind: 'pattern',
                  summary: `pattern-${sid}`,
                  condition: `cond-${sid}`,
                  action: `act-${sid}`,
                },
              ],
            }),
            cost_usd: 0.001,
          }
        },
      }

      const items = fixtures.map(f => f.jsonl)
      await core.runWorkerPool({
        items,
        concurrency,
        pipeline: (file) => core.processSessionWithPipeline(file, { hnsw, llm }),
      })

      // --- invariant checks ---

      // 1. processing/ must be empty.
      const leftoverProcessing = countFilesRecursive(path.join(home, 'trajectories', 'processing'))
      expect(leftoverProcessing, `iter=${iter} N=${N} conc=${concurrency}: leftover processing`).toBe(0)

      // 2. Every sid lands in exactly one bucket.
      const buckets = ['done', 'routine', 'empty', 'error']
      const landing = new Map() // sid -> bucket
      for (const b of buckets) {
        for (const sid of listSidsInBucket(home, b)) {
          if (landing.has(sid)) {
            expect.fail(`iter=${iter}: sid ${sid} in both ${landing.get(sid)} and ${b}`)
          }
          landing.set(sid, b)
        }
      }

      // 3. Every fixture is accounted for.
      for (const fx of fixtures) {
        expect(landing.has(fx.sid), `iter=${iter} N=${N}: sid ${fx.sid} lost`).toBe(true)
      }

      // 4. Fixture count equals landed count — no double archiving.
      expect(landing.size).toBe(N)

      // 5. Per-flavor terminal bucket correctness.
      for (const fx of fixtures) {
        const actual = landing.get(fx.sid)
        const expected = {
          productive: 'done',
          routine: 'routine',
          empty: 'empty',
        }[fx.flavor]
        expect(actual, `iter=${iter} sid=${fx.sid} flavor=${fx.flavor}`).toBe(expected)
      }
    }, /* per-iteration timeout */ 15000)
  }
})
