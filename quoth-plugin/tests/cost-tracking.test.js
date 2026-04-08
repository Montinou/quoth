// tests/cost-tracking.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// ── DB: pipeline_costs table + methods ──

let tmpDir, db

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'quoth-cost-'))
  process.env.QUOTH_HOME = tmpDir
  const { createDb } = require('../daemon/db.js')
  db = createDb(join(tmpDir, 'memory.db'))
})

afterEach(() => {
  try { db.close() } catch {}
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('pipeline_costs table', () => {
  it('creates the pipeline_costs table on init', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all().map(r => r.name)
    expect(tables).toContain('pipeline_costs')
  })

  it('creates indexes on pipeline_costs', () => {
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='pipeline_costs'"
    ).all().map(r => r.name)
    expect(indexes).toContain('idx_costs_stage')
    expect(indexes).toContain('idx_costs_created')
  })
})

describe('db.recordPipelineCost', () => {
  it('inserts a cost row and returns the id', () => {
    const result = db.recordPipelineCost({
      stage: 'JUDGE',
      model: 'google/gemini-2.5-flash-lite',
      input_tokens: 500,
      output_tokens: 100,
      estimated_cost_usd: 0.00009,
      batch_size: 3,
      session_id: 'sess-1',
      project: 'quoth',
    })
    expect(result.lastInsertRowid).toBeGreaterThan(0)

    const row = db.prepare('SELECT * FROM pipeline_costs WHERE id = ?').get(result.lastInsertRowid)
    expect(row.stage).toBe('JUDGE')
    expect(row.model).toBe('google/gemini-2.5-flash-lite')
    expect(row.input_tokens).toBe(500)
    expect(row.output_tokens).toBe(100)
    expect(row.estimated_cost_usd).toBeCloseTo(0.00009)
    expect(row.batch_size).toBe(3)
    expect(row.session_id).toBe('sess-1')
    expect(row.project).toBe('quoth')
    expect(row.created_at).toBeGreaterThan(0)
  })

  it('uses defaults for optional fields', () => {
    db.recordPipelineCost({ stage: 'DISTILL', model: 'google/gemini-2.5-flash' })
    const row = db.prepare('SELECT * FROM pipeline_costs ORDER BY id DESC LIMIT 1').get()
    expect(row.input_tokens).toBe(0)
    expect(row.output_tokens).toBe(0)
    expect(row.estimated_cost_usd).toBe(0)
    expect(row.batch_size).toBe(1)
    expect(row.session_id).toBeNull()
    expect(row.project).toBeNull()
  })
})

describe('db.getCostSummary', () => {
  function insertCost(stage, model, cost, inputTokens, outputTokens, createdAt) {
    db.prepare(`
      INSERT INTO pipeline_costs (stage, model, estimated_cost_usd, input_tokens, output_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(stage, model, cost, inputTokens, outputTokens, createdAt)
  }

  it('returns all-time summary when no range given', () => {
    const now = Date.now()
    insertCost('JUDGE', 'google/gemini-2.5-flash-lite', 0.001, 1000, 200, now)
    insertCost('JUDGE', 'google/gemini-2.5-flash-lite', 0.002, 2000, 400, now - 86400000 * 10)
    insertCost('DISTILL', 'google/gemini-2.5-flash', 0.01, 5000, 1000, now - 86400000 * 3)

    const summary = db.getCostSummary()
    expect(summary.total_calls).toBe(3)
    expect(summary.total_cost_usd).toBeCloseTo(0.013)
    expect(summary.by_stage.JUDGE.calls).toBe(2)
    expect(summary.by_stage.JUDGE.cost).toBeCloseTo(0.003)
    expect(summary.by_stage.JUDGE.input_tokens).toBe(3000)
    expect(summary.by_stage.JUDGE.output_tokens).toBe(600)
    expect(summary.by_stage.DISTILL.calls).toBe(1)
  })

  it('filters by today', () => {
    const now = Date.now()
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    insertCost('JUDGE', 'google/gemini-2.5-flash-lite', 0.001, 1000, 200, now)
    insertCost('JUDGE', 'google/gemini-2.5-flash-lite', 0.005, 3000, 500, startOfDay.getTime() - 1) // yesterday

    const summary = db.getCostSummary('today')
    expect(summary.total_calls).toBe(1)
    expect(summary.total_cost_usd).toBeCloseTo(0.001)
  })

  it('filters by week', () => {
    const now = Date.now()
    insertCost('JUDGE', 'google/gemini-2.5-flash-lite', 0.001, 1000, 200, now)
    insertCost('DISTILL', 'google/gemini-2.5-flash', 0.01, 5000, 1000, now - 86400000 * 3)
    insertCost('JUDGE', 'google/gemini-2.5-flash-lite', 0.002, 2000, 400, now - 86400000 * 10) // older than 7d

    const summary = db.getCostSummary('week')
    expect(summary.total_calls).toBe(2)
    expect(summary.total_cost_usd).toBeCloseTo(0.011)
    expect(Object.keys(summary.by_stage)).toHaveLength(2)
  })

  it('returns empty summary when no data', () => {
    const summary = db.getCostSummary()
    expect(summary.total_calls).toBe(0)
    expect(summary.total_cost_usd).toBe(0)
    expect(summary.by_stage).toEqual({})
  })
})

// ── LLM: estimateCost + MODEL_PRICING ──

describe('estimateCost', () => {
  it('calculates cost for known model', () => {
    const { estimateCost } = require('../daemon/lib/llm.js')
    // flash-lite: input $0.10/MTok, output $0.40/MTok
    const cost = estimateCost('google/gemini-2.5-flash-lite', 1000000, 1000000)
    expect(cost).toBeCloseTo(0.50) // 0.10 + 0.40
  })

  it('calculates cost for small token counts', () => {
    const { estimateCost } = require('../daemon/lib/llm.js')
    // 1000 input, 200 output on flash-lite
    // input: 1000 / 1M * 0.10 = 0.0001
    // output: 200 / 1M * 0.40 = 0.00008
    const cost = estimateCost('google/gemini-2.5-flash-lite', 1000, 200)
    expect(cost).toBeCloseTo(0.00018, 6)
  })

  it('falls back to flash-lite pricing for unknown models', () => {
    const { estimateCost } = require('../daemon/lib/llm.js')
    const cost = estimateCost('unknown/model-x', 1000000, 1000000)
    expect(cost).toBeCloseTo(0.50) // same as flash-lite
  })

  it('handles zero tokens', () => {
    const { estimateCost } = require('../daemon/lib/llm.js')
    expect(estimateCost('google/gemini-2.5-flash-lite', 0, 0)).toBe(0)
  })
})

describe('MODEL_PRICING', () => {
  it('exports MODEL_PRICING with expected models', () => {
    const { MODEL_PRICING } = require('../daemon/lib/llm.js')
    expect(MODEL_PRICING).toHaveProperty('google/gemini-2.5-flash-lite')
    expect(MODEL_PRICING).toHaveProperty('google/gemini-2.5-flash')
    expect(MODEL_PRICING['google/gemini-2.5-flash'].input).toBe(0.30)
    expect(MODEL_PRICING['google/gemini-2.5-flash'].output).toBe(2.50)
  })
})

describe('callLLMWithUsage', () => {
  it('is exported from llm.js', () => {
    const llm = require('../daemon/lib/llm.js')
    expect(typeof llm.callLLMWithUsage).toBe('function')
  })
})
