// Quoth/quoth-plugin/tests/integration.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
})
