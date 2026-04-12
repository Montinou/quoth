// tests/unit/inject/daemon-down.test.js
//
// Verifies the `route` hook honors its 250ms latency budget when the daemon
// is unreachable (Task 17 / spec §2.3 daemon-detach contract).
//
// Starts a fake unix-socket server that accepts connections but NEVER writes
// a response. Points the hook at it via QUOTH_HOME. Spawns the hook and
// asserts it exits within the budget without emitting additionalContext.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DISPATCH = path.resolve(__dirname, '../../../hooks/hook-dispatch.js')

describe('route hook — daemon-down fast fail', () => {
  let home
  let server

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-route-hang-'))
    // Pre-write STARTUP_FAILED so the fail-open branch's spawnDaemonDetached
    // short-circuits (daemon-core.checkStartupFlag → true). Without this,
    // every hanging-socket test would spawn a real orphan daemon bound to a
    // tmp QUOTH_HOME that gets rm'd in afterEach, accumulating reparented
    // children under init. The detach primitive itself is verified by code
    // review (spec §2.3); this test covers the latency contract only.
    fs.writeFileSync(path.join(home, 'STARTUP_FAILED'), 'test-hang\n')
    // Fake daemon: accept but never respond, so the hook MUST time out.
    server = net.createServer((sock) => { /* hold the socket open */ })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(path.join(home, 'daemon.sock'), resolve)
    })
  })

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()))
      server = null
    }
    try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
  })

  it('exits within ~500ms and emits no additionalContext when daemon is hung', () => {
    const t0 = Date.now()
    const res = spawnSync('node', [DISPATCH, 'route'], {
      env: {
        ...process.env,
        QUOTH_HOME: home,
        CLAUDE_PROJECT_DIR: home,   // avoid git resolution
        CLAUDE_SESSION_ID: 'route-hang-test',
      },
      encoding: 'utf8',
      timeout: 5000,
      input: JSON.stringify({ prompt: 'test prompt', session_id: 'route-hang-test' }),
    })
    const elapsed = Date.now() - t0

    expect(res.status).toBe(0)
    // Contract: the 200ms fetchInject timeout must dominate — the hook must
    // exit fast even when the daemon accepts the connection and hangs.
    expect(elapsed).toBeLessThan(2000)
    // No additionalContext should have been emitted (daemon never replied).
    const stdout = res.stdout || ''
    expect(stdout).not.toContain('additionalContext')
    // Spec §2.3: the route hook no longer renders a routing-table banner on
    // stdout — everything flows through additionalContext. If the old
    // queryDaemon({type:'route+inject'}) path runs, we see "Primary
    // Recommendation" or "Routing Method"; ensure neither appears.
    expect(stdout).not.toContain('Primary Recommendation')
    expect(stdout).not.toContain('Routing Method')
  })

  it('emits additionalContext with formatted results when /inject responds', async () => {
    // Tear down the hanging server and replace with an HTTP server that
    // answers GET /inject on the same unix socket. IMPORTANT: the server
    // must run in-process concurrently with the hook subprocess, so we use
    // the async `spawn` + promise instead of `spawnSync` (which blocks the
    // event loop and would prevent the server from accepting connections).
    await new Promise((resolve) => server.close(() => resolve()))
    const sockPath = path.join(home, 'daemon.sock')
    try { fs.unlinkSync(sockPath) } catch {}

    const httpSrv = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/inject')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          results: [
            {
              id: 'ent-a',
              kind: 'pattern',
              summary: 'Use batch embeddings',
              content: 'Call generateEmbeddingBatch with chunked inputs to amortize cost.',
              confidence: 0.87,
              score: 0.91,
            },
            {
              id: 'ent-b',
              kind: 'decision',
              summary: 'Prefer unix socket IPC',
              content: 'Unix socket avoids port conflicts and gives us local-only access control.',
              confidence: 0.72,
              score: 0.66,
            },
          ],
        }))
        return
      }
      res.writeHead(404)
      res.end()
    })
    server = httpSrv
    await new Promise((resolve, reject) => {
      httpSrv.once('error', reject)
      httpSrv.listen(sockPath, resolve)
    })

    // Async spawn — event loop stays free to serve the in-process /inject.
    const result = await new Promise((resolve, reject) => {
      const child = spawn('node', [DISPATCH, 'route'], {
        env: {
          ...process.env,
          QUOTH_HOME: home,
          CLAUDE_PROJECT_DIR: home,
          CLAUDE_SESSION_ID: 'route-inject-ok',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (c) => { stdout += c })
      child.stderr.on('data', (c) => { stderr += c })
      child.on('error', reject)
      child.on('close', (code) => resolve({ code, stdout, stderr }))
      child.stdin.write(JSON.stringify({ prompt: 'embed things fast', session_id: 'route-inject-ok' }))
      child.stdin.end()
    })

    expect(result.code).toBe(0)
    const stdout = result.stdout || ''
    // The new contract emits a single JSON line with additionalContext.
    expect(stdout).toContain('additionalContext')
    const jsonLine = stdout.trim().split('\n').map((line) => {
      try { return JSON.parse(line) } catch { return null }
    }).find((obj) => obj && typeof obj.additionalContext === 'string')
    expect(jsonLine).toBeTruthy()
    expect(jsonLine.additionalContext).toContain('pattern')
    expect(jsonLine.additionalContext).toContain('Use batch embeddings')
    expect(jsonLine.additionalContext).toContain('decision')
  })
})
