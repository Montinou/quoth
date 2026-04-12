// tests/unit/daemon/session-restore-no-patterns.test.js
//
// Task 18 / spec §2.3 "session-restore":
// After the knowledge-entities redesign, session-restore must NOT run the
// legacy pattern-ranking + doc-chunk injection branch. Patterns now flow
// exclusively through the per-prompt route hook (/inject). session-restore
// keeps initGraph + project-context.md + facts injection only.
//
// Two complementary checks:
// 1. Source-level regression: the hook-dispatch.js `session-restore` handler
//    no longer contains the distinctive legacy-branch strings. The legacy
//    path was the only caller of `type: 'inject'` over the socket-JSON
//    protocol inside session-restore; the only emitter of the
//    `[Quoth] N patterns loaded` banner; and the only reader of the
//    `last-context-<project>.json` cache file.
// 2. Runtime regression: spawning the hook with a fake daemon that WOULD
//    answer the legacy `type:'inject'` request and return fake patterns
//    must not produce the legacy banner. A silent runtime pass combined
//    with the source-level check together prove the branch is gone.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DISPATCH = path.resolve(__dirname, '../../../hooks/hook-dispatch.js')
const HOOK_SOURCE = fs.readFileSync(DISPATCH, 'utf8')

// Carve out the `session-restore` handler body so the source-level checks
// don't accidentally match the route / subagent-start branches (which still
// legitimately use queryDaemon). Each handler is a key in the `handlers`
// object ending at the next top-level `'<name>': async () => {`.
function extractSessionRestoreBlock(src) {
  const start = src.indexOf(`'session-restore': async () => {`)
  if (start < 0) throw new Error('session-restore handler not found')
  const tail = src.slice(start + 1)
  // Terminate at the next sibling handler key. All handler keys are
  // single-quoted on their own line at ~4-space indent.
  const nextMatch = tail.match(/\n\s{2}'[a-z][a-z-]*': async/)
  const end = nextMatch ? start + 1 + nextMatch.index : src.length
  return src.slice(start, end)
}

const restoreBlock = extractSessionRestoreBlock(HOOK_SOURCE)

function runRestore(home) {
  return spawnSync('node', [DISPATCH, 'session-restore'], {
    env: {
      ...process.env,
      QUOTH_HOME: home,
      CLAUDE_PROJECT_DIR: home,
      CLAUDE_SESSION_ID: 'restore-no-patterns',
    },
    encoding: 'utf8',
    timeout: 5000,
    input: '{}',
  })
}

describe('session-restore — legacy pattern/doc injection removed', () => {
  describe('source-level regression', () => {
    it(`does not call queryDaemon with type: 'inject'`, () => {
      expect(restoreBlock).not.toMatch(/type:\s*['"]inject['"]/)
    })

    it('does not read the last-context-*.json cache', () => {
      expect(restoreBlock).not.toContain('last-context-')
    })

    it('does not emit the legacy "[Quoth] N patterns loaded" banner', () => {
      expect(restoreBlock).not.toContain('patterns loaded for project')
    })

    it('does not emit the legacy "[Quoth Docs] Session context" banner', () => {
      expect(restoreBlock).not.toContain('[Quoth Docs] Session context')
    })

    it('does not reference doc_chunks', () => {
      expect(restoreBlock).not.toContain('doc_chunks')
    })

    it('preserves facts injection (direct knowledge_entities SQL)', () => {
      expect(restoreBlock).toContain('knowledge_entities')
      expect(restoreBlock).toMatch(/kind\s*=\s*['"]fact['"]/)
    })
  })

  describe('runtime regression', () => {
    let home
    let server
    beforeEach(async () => {
      home = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-restore-nopatterns-'))
      // Pre-write STARTUP_FAILED so any latent spawnDaemonDetached path
      // short-circuits (no orphan daemon). This mirrors the Task 17
      // daemon-down test convention.
      fs.writeFileSync(path.join(home, 'STARTUP_FAILED'), 'test\n')

      // Stand up a fake daemon on daemon.sock that WOULD answer the legacy
      // JSON-over-socket `type:'inject'` query with fake patterns. If any
      // residual session-restore code still hits queryDaemon, it would
      // receive these and emit the legacy banner.
      server = net.createServer((sock) => {
        let buf = ''
        sock.on('data', (chunk) => {
          buf += chunk.toString()
          const nl = buf.indexOf('\n')
          if (nl < 0) return
          // Reply with a fake inject response. If the legacy handler still
          // runs, it would log `[Quoth] 1 patterns loaded for project ...`.
          const resp = {
            patterns: [
              { id: 'x', name: 'fake pattern', action: 'do the thing', confidence: 0.9 },
            ],
            doc_chunks: [
              { id: 'd1', doc_file: 'fake.md', content: 'fake doc chunk', score: 0.9 },
            ],
          }
          sock.write(JSON.stringify(resp) + '\n')
          sock.end()
        })
      })
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

    it('does not emit legacy banners even when a legacy daemon is available', () => {
      const res = runRestore(home)
      expect(res.status).toBe(0)
      const out = res.stdout || ''
      expect(out).not.toMatch(/\[Quoth\] \d+ patterns loaded/)
      expect(out).not.toContain('[Quoth Docs] Session context:')
    })
  })
})
