import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

const { readFile, grepCodebase, resolveProjectRoot, executeToolCall, sanitize } = require('../daemon/lib/tool-executor.js')

let tmpDir

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-tool-executor-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('sanitize', () => {
  it('redacts API keys', () => {
    const text = 'my key is token_sample_abc123def456ghi789jkl012'
    expect(sanitize(text)).toContain('[REDACTED_KEY]')
    expect(sanitize(text)).not.toContain('abc123def456')
  })

  it('redacts JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    expect(sanitize(jwt)).toBe('[REDACTED_JWT]')
  })

  it('redacts passwords in URLs', () => {
    const url = 'postgres://user:s3cretP4ss@db.host.com:5432/mydb'
    const result = sanitize(url)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('s3cretP4ss')
  })

  it('redacts env-style secrets', () => {
    const text = 'API_KEY=my_super_secret_value_here'
    expect(sanitize(text)).toContain('[REDACTED]')
  })

  it('returns null for non-string non-serializable input', () => {
    const circular = {}
    circular.self = circular
    expect(sanitize(circular)).toBeNull()
  })

  it('returns falsy values as-is', () => {
    expect(sanitize('')).toBe('')
    expect(sanitize(null)).toBeNull()
    expect(sanitize(undefined)).toBeUndefined()
  })
})

describe('readFile', () => {
  it('reads file with numbered lines', () => {
    const filePath = path.join(tmpDir, 'test.txt')
    fs.writeFileSync(filePath, 'line one\nline two\nline three\n')
    const result = readFile(filePath)
    expect(result).toContain('1\tline one')
    expect(result).toContain('2\tline two')
    expect(result).toContain('3\tline three')
  })

  it('respects maxLines parameter', () => {
    const filePath = path.join(tmpDir, 'long.txt')
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`)
    fs.writeFileSync(filePath, lines.join('\n'))
    const result = readFile(filePath, 10)
    const resultLines = result.trim().split('\n')
    expect(resultLines).toHaveLength(10)
    expect(result).toContain('1\tline 1')
    expect(result).not.toContain('11\t')
  })

  it('hard caps at 200 lines', () => {
    const filePath = path.join(tmpDir, 'huge.txt')
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`)
    fs.writeFileSync(filePath, lines.join('\n'))
    const result = readFile(filePath, 300)
    const resultLines = result.trim().split('\n')
    expect(resultLines).toHaveLength(200)
  })

  it('returns error string on missing file', () => {
    const result = readFile(path.join(tmpDir, 'nonexistent.txt'))
    expect(result).toContain('Error')
  })

  it('sanitizes secrets in output', () => {
    const filePath = path.join(tmpDir, 'secrets.txt')
    fs.writeFileSync(filePath, 'TOKEN=token_sample_abc123def456ghi789jkl012\n')
    const result = readFile(filePath)
    expect(result).toContain('[REDACTED')
    expect(result).not.toContain('abc123def456ghi789')
  })
})

describe('grepCodebase', () => {
  it('finds matches in files', () => {
    const subDir = path.join(tmpDir, 'src')
    fs.mkdirSync(subDir)
    fs.writeFileSync(path.join(subDir, 'app.js'), 'const foo = "hello"\nconst bar = "world"\n')
    fs.writeFileSync(path.join(subDir, 'lib.js'), 'function foo() {}\n')
    const result = grepCodebase('foo', tmpDir)
    expect(result).toContain('foo')
    expect(result.split('\n').filter(l => l.trim()).length).toBeGreaterThanOrEqual(2)
  })

  it('excludes node_modules', () => {
    const nmDir = path.join(tmpDir, 'node_modules', 'pkg')
    fs.mkdirSync(nmDir, { recursive: true })
    fs.writeFileSync(path.join(nmDir, 'index.js'), 'const target = true\n')
    const srcDir = path.join(tmpDir, 'src')
    fs.mkdirSync(srcDir)
    fs.writeFileSync(path.join(srcDir, 'main.js'), 'const target = true\n')
    const result = grepCodebase('target', tmpDir)
    expect(result).not.toContain('node_modules')
    expect(result).toContain('main.js')
  })

  it('respects maxResults', () => {
    const srcDir = path.join(tmpDir, 'src')
    fs.mkdirSync(srcDir)
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(srcDir, `file${i}.js`), 'match_me_here\n')
    }
    const result = grepCodebase('match_me_here', tmpDir, 3)
    const lines = result.trim().split('\n').filter(l => l.trim())
    expect(lines.length).toBeLessThanOrEqual(3)
  })

  it('handles no matches gracefully', () => {
    const srcDir = path.join(tmpDir, 'src')
    fs.mkdirSync(srcDir)
    fs.writeFileSync(path.join(srcDir, 'app.js'), 'hello world\n')
    const result = grepCodebase('zzz_nonexistent_pattern_zzz', tmpDir)
    expect(result).toContain('No matches found')
  })

  it('handles invalid regex gracefully', () => {
    const result = grepCodebase('[invalid(', tmpDir)
    expect(typeof result).toBe('string')
  })

  it('sanitizes secrets in output', () => {
    const srcDir = path.join(tmpDir, 'src')
    fs.mkdirSync(srcDir)
    fs.writeFileSync(path.join(srcDir, 'config.js'), 'const key = "token_sample_abc123def456ghi789jkl012"\n')
    const result = grepCodebase('token_sample', tmpDir)
    expect(result).toContain('[REDACTED')
  })
})

describe('resolveProjectRoot', () => {
  it('extracts common ancestor from file paths in tool entries', () => {
    const entries = [
      { tool_input: 'file: /home/user/project/src/app.js, content: ...' },
      { tool_input: 'file: /home/user/project/tests/test.js, old: ...' },
    ]
    const result = resolveProjectRoot('unknown', entries)
    expect(result).toBe('/home/user/project')
  })

  it('falls back to PROJECT_ROOTS mapping', () => {
    expect(resolveProjectRoot('quoth')).toBe('/home/lord_montino/projects/agents-tools/quoth')
    expect(resolveProjectRoot('ips')).toBe('/home/lord_montino/IPS_audit/IPS')
    expect(resolveProjectRoot('exolar')).toBe('/home/lord_montino/projects/agents-tools/exolar')
  })

  it('returns null for unknown project with no paths', () => {
    expect(resolveProjectRoot('totally-unknown-project')).toBeNull()
  })
})

describe('executeToolCall', () => {
  it('dispatches read_file with spec parameter names (path, maxLines)', () => {
    const filePath = path.join(tmpDir, 'dispatch.txt')
    fs.writeFileSync(filePath, 'dispatched content\n')
    const result = executeToolCall({
      function: { name: 'read_file', arguments: JSON.stringify({ path: filePath }) }
    }, tmpDir)
    expect(result).toContain('dispatched content')
  })

  it('dispatches grep_codebase with spec parameter names (pattern, path, maxResults)', () => {
    const srcDir = path.join(tmpDir, 'src')
    fs.mkdirSync(srcDir)
    fs.writeFileSync(path.join(srcDir, 'code.js'), 'findable_token_xyz\n')
    const result = executeToolCall({
      function: { name: 'grep_codebase', arguments: JSON.stringify({ pattern: 'findable_token_xyz' }) }
    }, tmpDir)
    expect(result).toContain('findable_token_xyz')
  })

  it('returns error for unknown tool', () => {
    const result = executeToolCall({
      function: { name: 'unknown_tool', arguments: '{}' }
    }, tmpDir)
    expect(result).toContain('Unknown tool')
  })

  describe('path confinement (security)', () => {
    it('rejects read_file with absolute path outside projectRoot', () => {
      const result = executeToolCall({
        function: { name: 'read_file', arguments: JSON.stringify({ path: '/etc/passwd' }) }
      }, tmpDir)
      expect(result).toContain('outside project root')
    })

    it('rejects read_file with ../ traversal escape', () => {
      const result = executeToolCall({
        function: { name: 'read_file', arguments: JSON.stringify({ path: '../../../etc/passwd' }) }
      }, tmpDir)
      expect(result).toContain('outside project root')
    })

    it('rejects read_file with ~/.ssh/id_rsa-style path', () => {
      const result = executeToolCall({
        function: { name: 'read_file', arguments: JSON.stringify({ path: '/home/nonexistent_user/.ssh/id_rsa' }) }
      }, tmpDir)
      expect(result).toContain('outside project root')
    })

    it('allows relative paths inside projectRoot', () => {
      fs.writeFileSync(path.join(tmpDir, 'allowed.txt'), 'ok content\n')
      const result = executeToolCall({
        function: { name: 'read_file', arguments: JSON.stringify({ path: 'allowed.txt' }) }
      }, tmpDir)
      expect(result).toContain('ok content')
    })

    it('allows absolute paths that resolve inside projectRoot', () => {
      const filePath = path.join(tmpDir, 'abs.txt')
      fs.writeFileSync(filePath, 'abs content\n')
      const result = executeToolCall({
        function: { name: 'read_file', arguments: JSON.stringify({ path: filePath }) }
      }, tmpDir)
      expect(result).toContain('abs content')
    })

    it('rejects read_file when no projectRoot is resolved', () => {
      const result = executeToolCall({
        function: { name: 'read_file', arguments: JSON.stringify({ path: '/etc/passwd' }) }
      }, null)
      expect(result).toContain('no project root')
    })

    it('rejects grep_codebase with explicit path outside projectRoot', () => {
      const result = executeToolCall({
        function: { name: 'grep_codebase', arguments: JSON.stringify({ pattern: 'root', path: '/etc' }) }
      }, tmpDir)
      expect(result).toContain('outside project root')
    })

    it('rejects grep_codebase with ../ path traversal', () => {
      const result = executeToolCall({
        function: { name: 'grep_codebase', arguments: JSON.stringify({ pattern: 'root', path: '../../../etc' }) }
      }, tmpDir)
      expect(result).toContain('outside project root')
    })

    it('allows grep_codebase with no explicit path (defaults to projectRoot)', () => {
      const srcDir = path.join(tmpDir, 'src')
      fs.mkdirSync(srcDir)
      fs.writeFileSync(path.join(srcDir, 'x.js'), 'findable_confinement_ok\n')
      const result = executeToolCall({
        function: { name: 'grep_codebase', arguments: JSON.stringify({ pattern: 'findable_confinement_ok' }) }
      }, tmpDir)
      expect(result).toContain('findable_confinement_ok')
    })
  })
})
