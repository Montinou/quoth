// tests/unit/daemon/subagent-start.test.js
//
// Task 19 / spec §2.3 "subagent-start":
// The subagent-start hook must use the new /inject fast-path (Task 15)
// instead of the legacy queryDaemon({type:'inject'}) socket-JSON protocol,
// and it must forward the spawned subagent's type as an agentType query
// parameter so the daemon can filter knowledge_entities by agent tag.
//
// Strategy: stand up an in-process HTTP server on the unix socket that
// answers GET /inject, records the received URL, and returns a fake
// entity. Spawn the hook with matching env, assert:
//   (a) the received URL contains `agentType=<type>`
//   (b) stdout contains the legacy `additionalContext` JSON emission so
//       downstream Claude Code still picks up the injection.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DISPATCH = path.resolve(__dirname, '../../../hooks/hook-dispatch.js')
const HOOK_SOURCE = fs.readFileSync(DISPATCH, 'utf8')

function extractSubagentStartBlock(src) {
  const start = src.indexOf(`'subagent-start': async (hookInput) => {`)
  if (start < 0) throw new Error('subagent-start handler not found')
  const tail = src.slice(start + 1)
  const nextMatch = tail.match(/\n\s{2}'[a-z][a-z-]*':/)
  const end = nextMatch ? start + 1 + nextMatch.index : src.length
  return src.slice(start, end)
}

async function spawnHook({ home, agentType, taskText }) {
  return await new Promise((resolve, reject) => {
    const child = spawn('node', [DISPATCH, 'subagent-start'], {
      env: {
        ...process.env,
        QUOTH_HOME: home,
        CLAUDE_PROJECT_DIR: home,
        CLAUDE_SESSION_ID: 'sa-start-test',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => { stdout += c })
    child.stderr.on('data', (c) => { stderr += c })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.write(JSON.stringify({
      agent_type: agentType,
      prompt: taskText,
      session_id: 'sa-start-test',
    }))
    child.stdin.end()
  })
}

describe('subagent-start — /inject fast-path with agentType', () => {
  describe('source-level regression', () => {
    const block = extractSubagentStartBlock(HOOK_SOURCE)

    it('does not call queryDaemon / ensureDaemon for injection', () => {
      expect(block).not.toMatch(/queryDaemon\s*\(/)
      expect(block).not.toMatch(/ensureDaemon\s*\(/)
    })

    it(`does not pass type: 'inject' as a socket-JSON query`, () => {
      expect(block).not.toMatch(/type:\s*['"]inject['"]/)
    })

    it('uses fetchInject and forwards agentType', () => {
      expect(block).toContain('fetchInject')
      expect(block).toContain('agentType')
    })

    it('does not reference doc_chunks', () => {
      expect(block).not.toContain('doc_chunks')
    })
  })

  describe('runtime regression', () => {
    let home, server, receivedUrls
    beforeEach(async () => {
      home = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-sa-start-'))
      fs.writeFileSync(path.join(home, 'STARTUP_FAILED'), 'test\n')
      receivedUrls = []
      const sockPath = path.join(home, 'daemon.sock')
      server = http.createServer((req, res) => {
        receivedUrls.push(req.url)
        if (req.method === 'GET' && req.url.startsWith('/inject')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            results: [
              {
                id: 'ent-1',
                kind: 'pattern',
                summary: 'Use io.Reader over []byte for large inputs',
                content: 'io.Reader is a streaming interface; []byte materializes everything.',
                confidence: 0.88,
                score: 0.91,
              },
            ],
          }))
          return
        }
        res.writeHead(404)
        res.end()
      })
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(sockPath, resolve)
      })
    })
    afterEach(async () => {
      if (server) {
        await new Promise((resolve) => server.close(() => resolve()))
        server = null
      }
      try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
    })

    it('forwards agentType in the GET /inject URL', async () => {
      const res = await spawnHook({
        home,
        agentType: 'backend-dev',
        taskText: 'design a new http endpoint',
      })
      expect(res.code).toBe(0)
      expect(receivedUrls.length).toBeGreaterThan(0)
      const injectUrl = receivedUrls.find((u) => u.startsWith('/inject'))
      expect(injectUrl).toBeTruthy()
      expect(injectUrl).toContain('agentType=backend-dev')
    })

    it('emits additionalContext JSON with fetched entities', async () => {
      const res = await spawnHook({
        home,
        agentType: 'backend-dev',
        taskText: 'http endpoint',
      })
      expect(res.code).toBe(0)
      const stdout = res.stdout || ''
      expect(stdout).toContain('additionalContext')
      const jsonLine = stdout.trim().split('\n').map((line) => {
        try { return JSON.parse(line) } catch { return null }
      }).find((obj) => obj && typeof obj.additionalContext === 'string')
      expect(jsonLine).toBeTruthy()
      expect(jsonLine.additionalContext).toContain('io.Reader')
    })

    it('omits agentType param when agent_type is missing', async () => {
      const res = await spawnHook({
        home,
        agentType: '',
        taskText: 'generic task',
      })
      expect(res.code).toBe(0)
      const injectUrl = receivedUrls.find((u) => u.startsWith('/inject'))
      expect(injectUrl).toBeTruthy()
      expect(injectUrl).not.toContain('agentType=')
    })
  })
})
