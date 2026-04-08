// Quoth/quoth-plugin/tests/integration.test.js
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execSync, spawn } from 'child_process'

let tmpDir, dbPath

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'quoth-integration-'))
  dbPath = join(tmpDir, 'memory.db')
  process.env.QUOTH_HOME = tmpDir
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true })
  delete process.env.QUOTH_HOME
})

describe('integration: db + pipeline', () => {
  it('creates db and writes a pattern via upsert', () => {
    const { createDb } = require('../daemon/db.js')
    const db = createDb(dbPath)
    db.upsertPattern({
      id: 'integ-1', name: 'test pattern', pattern_type: 'code-pattern',
      condition: 'test', action: 'do something', confidence: 0.6,
      tags: ['test'], source: 'distilled'
    })
    const p = db.getPattern('integ-1')
    expect(p).not.toBeNull()
    expect(p.confidence).toBeCloseTo(0.6)
    db.close()
  })

  it('MCP server responds to tools/list', () => {
    const result = execSync(
      `printf '%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | QUOTH_HOME=${tmpDir} node ${join(__dirname, '../mcp/quoth-learning-server.js')}`,
      { encoding: 'utf8', timeout: 5000 }
    )
    const lines = result.trim().split('\n').map(l => JSON.parse(l))
    const toolsListResponse = lines.find(l => l.id === 2)
    const toolNames = toolsListResponse.result.tools.map(t => t.name)
    expect(toolNames).toContain('quoth_log_outcome')
    expect(toolNames).toContain('quoth_top_patterns')
    expect(toolNames).toContain('quoth_daemon_status')
  })

  it('quoth_daemon_status returns running:false when no daemon', () => {
    const input = JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'quoth_daemon_status', arguments: {} } }
    ].map(m => JSON.stringify(m)).join('\n'))

    const result = execSync(
      `printf '%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"quoth_daemon_status","arguments":{}}}' | QUOTH_HOME=${tmpDir} node ${join(__dirname, '../mcp/quoth-learning-server.js')}`,
      { encoding: 'utf8', timeout: 5000 }
    )
    const lines = result.trim().split('\n').map(l => JSON.parse(l))
    const callResult = lines.find(l => l.id === 2)
    const content = JSON.parse(callResult.result.content[0].text)
    expect(content.running).toBe(false)
  })

  it('quoth_propose_update returns error when pattern not found', () => {
    const messages = [
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test"}}}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"quoth_propose_update","arguments":{"patternId":"nonexistent-id"}}}'
    ].join('\n')

    const result = execSync(
      `printf '%s\\n' ${messages.split('\n').map(m => `'${m}'`).join(' ')} | QUOTH_HOME=${tmpDir} node ${join(__dirname, '../mcp/quoth-learning-server.js')}`,
      { encoding: 'utf8', timeout: 10000 }
    )

    const lines = result.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    const toolResponse = lines.find(l => l.id === 2)
    expect(toolResponse.result).toBeDefined()
    const parsed = JSON.parse(toolResponse.result.content[0].text)
    expect(parsed).toHaveProperty('error')
  })

  it('tools/list includes quoth_extract_skill and quoth_list_skills', () => {
    const result = execSync(
      `printf '%s\\n%s\\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | QUOTH_HOME=${tmpDir} node ${join(__dirname, '../mcp/quoth-learning-server.js')}`,
      { encoding: 'utf8', timeout: 5000 }
    )
    const lines = result.trim().split('\n').map(l => JSON.parse(l))
    const toolsListResponse = lines.find(l => l.id === 2)
    const toolNames = toolsListResponse.result.tools.map(t => t.name)
    expect(toolNames).toContain('quoth_extract_skill')
    expect(toolNames).toContain('quoth_list_skills')
  })

  it('tools/list includes quoth_propose_update', () => {
    const result = execSync(
      `printf '%s\\n%s\\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | QUOTH_HOME=${tmpDir} node ${join(__dirname, '../mcp/quoth-learning-server.js')}`,
      { encoding: 'utf8', timeout: 5000 }
    )
    const lines = result.trim().split('\n').map(l => JSON.parse(l))
    const toolsListResponse = lines.find(l => l.id === 2)
    const toolNames = toolsListResponse.result.tools.map(t => t.name)
    expect(toolNames).toContain('quoth_propose_update')
  })
})

// ── Agent-Type Pipeline Integration Tests ──

describe('integration: agent-type pipeline', () => {
  const { batchJudge, VALID_DOMAINS } = require('../daemon/pipeline/batch-judge.js')
  const { AGENT_TYPES } = require('../mcp/lib/routing.js')
  const { createDb } = require('../daemon/db.js')

  it('VALID_DOMAINS matches AGENT_TYPES from routing.js', () => {
    const domainArray = [...VALID_DOMAINS].sort()
    const typesArray = [...AGENT_TYPES].sort()
    expect(domainArray).toEqual(typesArray)
  })

  it('batch judge classifies effective/ineffective entries with domains', async () => {
    const entries = [
      { agent: 'claude-code', task: 'implement login form', outcome: 'success', tool_calls: 5 },
      { agent: 'claude-code', task: 'write unit tests', outcome: 'failure', tool_calls: 2 },
      { agent: 'claude-code', task: 'deploy to staging', outcome: 'success', tool_calls: 3 },
    ]

    const mockCallLLM = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        judgments: [
          { index: 0, effective: true, domain: 'frontend-dev', reason: 'login form built' },
          { index: 1, effective: false, domain: 'tester', reason: 'tests failed' },
          { index: 2, effective: true, domain: 'devops', reason: 'deployed ok' },
        ],
      }),
      model: 'google/gemini-2.5-flash',
      input_tokens: 300,
      output_tokens: 120,
      estimated_cost_usd: 0.00039,
    })

    const mockRouteTask = vi.fn(() => ({ agent: 'coder', confidence: 0.5 }))
    const result = await batchJudge(entries, { callLLMWithUsage: mockCallLLM, routeTask: mockRouteTask })

    expect(result.judgments).toHaveLength(3)
    expect(result.judgments[0]).toMatchObject({ effective: true, domain: 'frontend-dev' })
    expect(result.judgments[1]).toMatchObject({ effective: false, domain: 'tester' })
    expect(result.judgments[2]).toMatchObject({ effective: true, domain: 'devops' })
    expect(result.usage.input_tokens).toBe(300)
  })

  it('patterns with agent tags are filterable via getTopPatterns', () => {
    const testDbPath = join(tmpDir, `integ-tags-${Date.now()}.db`)
    const db = createDb(testDbPath)

    db.upsertPattern({
      id: 'integ-coder-1', name: 'use strict types', condition: 'coding',
      action: 'use TypeScript strict', confidence: 0.8, alpha: 10, beta: 2,
      namespace: 'test', tags: ['agent:coder', 'typescript'],
    })
    db.upsertPattern({
      id: 'integ-tester-1', name: 'test edge cases', condition: 'testing',
      action: 'cover edge cases', confidence: 0.7, alpha: 8, beta: 3,
      namespace: 'test', tags: ['agent:tester', 'testing'],
    })

    const coderOnly = db.getTopPatterns(10, ['agent:coder'])
    expect(coderOnly).toHaveLength(1)
    expect(coderOnly[0].id).toBe('integ-coder-1')

    const all = db.getTopPatterns(10, [])
    expect(all).toHaveLength(2)

    db.close()
  })

  it('cost tracking records and summarizes across stages', () => {
    const testDbPath = join(tmpDir, `integ-cost-${Date.now()}.db`)
    const db = createDb(testDbPath)

    db.recordPipelineCost({
      stage: 'judge-batch', model: 'google/gemini-2.5-flash',
      input_tokens: 2000, output_tokens: 500,
      estimated_cost_usd: 0.00185, batch_size: 30,
      session_id: 'sess-integ', project: 'quoth',
    })
    db.recordPipelineCost({
      stage: 'distill', model: 'google/gemini-2.5-flash-lite',
      input_tokens: 3000, output_tokens: 800,
      estimated_cost_usd: 0.00062, batch_size: 5,
      session_id: 'sess-integ', project: 'quoth',
    })

    const summary = db.getCostSummary()
    expect(summary.total_calls).toBe(2)
    expect(summary.total_cost_usd).toBeCloseTo(0.00247, 5)
    expect(summary.by_stage['judge-batch'].calls).toBe(1)
    expect(summary.by_stage['distill'].calls).toBe(1)
    expect(summary.by_stage['judge-batch'].input_tokens).toBe(2000)
    expect(summary.by_stage['distill'].output_tokens).toBe(800)

    db.close()
  })

  it('end-to-end: judge → tag patterns → filtered retrieval', async () => {
    // Step 1: Judge entries
    const entries = [
      { agent: 'claude-code', task: 'refactor auth module', outcome: 'success', tool_calls: 8 },
      { agent: 'claude-code', task: 'review PR #42', outcome: 'success', tool_calls: 3 },
    ]

    const mockCallLLM = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        judgments: [
          { index: 0, effective: true, domain: 'coder', reason: 'clean refactor' },
          { index: 1, effective: true, domain: 'reviewer', reason: 'thorough review' },
        ],
      }),
      model: 'google/gemini-2.5-flash',
      input_tokens: 200, output_tokens: 80, estimated_cost_usd: 0.00026,
    })

    const mockRouteTask = vi.fn(() => ({ agent: 'coder', confidence: 0.5 }))
    const judgeResult = await batchJudge(entries, { callLLMWithUsage: mockCallLLM, routeTask: mockRouteTask })

    // Step 2: Insert patterns tagged with domains from judge
    const testDbPath = join(tmpDir, `integ-e2e-${Date.now()}.db`)
    const db = createDb(testDbPath)

    for (const j of judgeResult.judgments) {
      if (j.effective) {
        db.upsertPattern({
          id: `e2e-${j.index}`, name: `pattern from ${entries[j.index].task}`,
          condition: entries[j.index].task, action: `learned: ${j.reason}`,
          confidence: 0.7, alpha: 5, beta: 2, namespace: 'quoth',
          tags: [`agent:${j.domain}`, 'batch-distilled'],
        })
      }
    }

    // Step 3: Filter by agent tag
    const coderPatterns = db.getTopPatterns(10, ['agent:coder'])
    expect(coderPatterns).toHaveLength(1)
    expect(coderPatterns[0].id).toBe('e2e-0')
    expect(coderPatterns[0].tags).toContain('agent:coder')

    const reviewerPatterns = db.getTopPatterns(10, ['agent:reviewer'])
    expect(reviewerPatterns).toHaveLength(1)
    expect(reviewerPatterns[0].id).toBe('e2e-1')

    const allPatterns = db.getTopPatterns(10, [])
    expect(allPatterns).toHaveLength(2)

    // No devops patterns exist
    const devopsPatterns = db.getTopPatterns(10, ['agent:devops'])
    expect(devopsPatterns).toHaveLength(0)

    db.close()
  })
})
