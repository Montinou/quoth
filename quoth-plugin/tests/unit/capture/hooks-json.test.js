import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function findTrajCapture(jsonPath) {
  const json = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const posts = json.hooks?.PostToolUse ?? []
  return posts.find(h =>
    (h.hooks ?? []).some(sub => String(sub.command ?? '').includes('trajectory-capture'))
  )
}

describe('hooks.json PostToolUse matcher', () => {
  it('uses matcher="*" for trajectory-capture in hooks/hooks.json', () => {
    const entry = findTrajCapture(resolve('hooks/hooks.json'))
    expect(entry).toBeDefined()
    expect(entry.matcher).toBe('*')
  })

  it('uses matcher="*" for trajectory-capture in .claude-plugin/hooks/hooks.json', () => {
    const entry = findTrajCapture(resolve('.claude-plugin/hooks/hooks.json'))
    expect(entry).toBeDefined()
    expect(entry.matcher).toBe('*')
  })
})
