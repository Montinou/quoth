import { describe, it, expect } from 'vitest'

const { routeTask } = require('../mcp/lib/routing.js')

describe('routeTask — expanded patterns', () => {
  // Git operations
  it('"commit these changes" → coder', () => {
    const r = routeTask('commit these changes')
    expect(r.agent).toBe('coder')
    expect(r.confidence).toBe(0.8)
  })

  it('"push to remote" → coder', () => {
    const r = routeTask('push to remote')
    expect(r.agent).toBe('coder')
    expect(r.confidence).toBe(0.8)
  })

  // Documentation
  it('"update the readme" → researcher', () => {
    const r = routeTask('update the readme')
    expect(r.agent).toBe('researcher')
  })

  it('"write changelog" → researcher', () => {
    const r = routeTask('write changelog')
    expect(r.agent).toBe('researcher')
  })

  // Spanish questions (lower confidence)
  it('"cómo funciona esto?" → researcher@0.6', () => {
    const r = routeTask('cómo funciona esto?')
    expect(r.agent).toBe('researcher')
    expect(r.confidence).toBe(0.6)
  })

  it('"qué es este archivo?" → researcher@0.6', () => {
    const r = routeTask('qué es este archivo?')
    expect(r.agent).toBe('researcher')
    expect(r.confidence).toBe(0.6)
  })

  // Debugging
  it('"fix this error" → coder', () => {
    const r = routeTask('fix this error')
    expect(r.agent).toBe('coder')
    expect(r.confidence).toBe(0.8)
  })

  it('"no funciona el build" → coder', () => {
    const r = routeTask('no funciona el build')
    expect(r.agent).toBe('coder')
    expect(r.confidence).toBe(0.8)
  })

  // Refactoring
  it('"refactor this module" → coder', () => {
    const r = routeTask('refactor this module')
    expect(r.agent).toBe('coder')
    expect(r.confidence).toBe(0.8)
  })

  it('"simplify the code" → coder', () => {
    const r = routeTask('simplify the code')
    expect(r.agent).toBe('coder')
    expect(r.confidence).toBe(0.8)
  })

  // Config/setup
  it('"setup the .env file" → devops', () => {
    const r = routeTask('setup the .env file')
    expect(r.agent).toBe('devops')
    expect(r.confidence).toBe(0.8)
  })

  it('"configure tsconfig" → devops', () => {
    const r = routeTask('configure tsconfig')
    expect(r.agent).toBe('devops')
    expect(r.confidence).toBe(0.8)
  })

  // Default fallback
  it('"ok" → coder@0.5 (default)', () => {
    const r = routeTask('ok')
    expect(r.agent).toBe('coder')
    expect(r.confidence).toBe(0.5)
    expect(r.reason).toMatch(/default/i)
  })

  // Existing patterns still work
  it('"implement a new feature" → coder', () => {
    const r = routeTask('implement a new feature')
    expect(r.agent).toBe('coder')
  })

  it('"deploy to production" → devops', () => {
    const r = routeTask('deploy to production')
    expect(r.agent).toBe('devops')
  })

  // Spanish implementation/deploy
  it('"implementar nuevo módulo" → coder', () => {
    const r = routeTask('implementar nuevo módulo')
    expect(r.agent).toBe('coder')
  })

  it('"desplegar en producción" → devops', () => {
    const r = routeTask('desplegar en producción')
    expect(r.agent).toBe('devops')
  })
})
