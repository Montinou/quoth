import { describe, it, expect, beforeEach, afterEach } from 'vitest'
const { createSessionMemory } = require('../hooks/session-memory.js')
const fs = require('fs')
const path = require('path')
const os = require('os')

let tmpDir
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-sess-'))
})
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

describe('session memory', () => {
  it('recordPrompt accumulates topics', () => {
    const sm = createSessionMemory({ dir: tmpDir, sessionId: 's1', project: 'demo' })
    sm.recordPrompt('Write React component for login form')
    sm.recordPrompt('Add React tests for login component')
    const summary = sm.getContextSummary()
    expect(summary.topTopics).toContain('react')
    expect(summary.topTopics).toContain('login')
  })

  it('recordEdit tracks file touch counts', () => {
    const sm = createSessionMemory({ dir: tmpDir, sessionId: 's1', project: 'demo' })
    sm.recordEdit('/src/auth.ts')
    sm.recordEdit('/src/auth.ts')
    sm.recordEdit('/src/user.ts')
    const summary = sm.getContextSummary()
    expect(summary.topFiles[0]).toBe('/src/auth.ts')
  })

  it('recordInjection + markPatternUsed tracks stale injections', () => {
    const sm = createSessionMemory({ dir: tmpDir, sessionId: 's1', project: 'demo' })
    sm.recordInjection(['p1', 'p2', 'p3'])
    sm.markPatternUsed('p1')
    const stale = sm.getStaleInjections(0)
    expect(stale).toContain('p2')
    expect(stale).toContain('p3')
    expect(stale).not.toContain('p1')
  })

  it('persists and loads from disk', () => {
    const sm = createSessionMemory({ dir: tmpDir, sessionId: 's1', project: 'demo' })
    sm.recordPrompt('test prompt')
    sm.save()
    const sm2 = createSessionMemory({ dir: tmpDir, sessionId: 's1', project: 'demo' })
    const summary = sm2.getContextSummary()
    expect(summary.recentPrompts).toContain('test prompt')
  })

  it('getQueryText returns joined topics + prompt', () => {
    const sm = createSessionMemory({ dir: tmpDir, sessionId: 's1', project: 'demo' })
    sm.recordPrompt('Build react login component')
    const q = sm.getQueryText()
    expect(q).toContain('react')
    expect(q.length).toBeGreaterThan(0)
  })
})
