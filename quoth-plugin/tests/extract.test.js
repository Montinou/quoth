import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import childProcess from 'child_process'

const {
  extract, makeId, buildSystemPrompt, buildUserPrompt, parseJson, parsePatterns,
  QUALITY_MAP, QUALITY_PRIORS, TOOL_DEFINITIONS,
} = require('../daemon/pipeline/extract.js')

// --- Test helpers: build a deps object for injection ---

function makeDeps(overrides = {}) {
  return {
    callMoonshotWithTools: vi.fn(),
    executeToolCall: vi.fn(() => 'mock tool output'),
    resolveProjectRoot: vi.fn(() => '/home/user/project'),
    sanitize: vi.fn((x) => typeof x === 'string' ? x : JSON.stringify(x)),
    generateEmbeddingBatch: vi.fn(async (texts) => texts.map(() => null)),
    ...overrides,
  }
}

beforeEach(() => {
  vi.spyOn(childProcess, 'execSync')
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mockDb() {
  return {
    insertPipelineError: vi.fn(),
    recordPipelineCost: vi.fn(),
  }
}

const SUMMARY = {
  project: 'quoth',
  outcome: 'success',
  success_rate: 0.9,
  user_intents: ['refactor auth module'],
  task: 'Session: 15 tool calls (Bash:8, Edit:4, Read:3). 14 ok, 1 fail.',
  session: 'sess-123',
}

const TOOL_ENTRIES = [
  { tool: 'Read', tool_input: '/home/user/project/auth.js', task: 'Read auth.js', outcome: 'success', llm_reasoning: 'Need to understand current auth flow', user_intent: 'understand auth' },
  { tool: 'Edit', tool_input: '/home/user/project/auth.js', task: 'Edit auth.js', outcome: 'success', llm_reasoning: 'Refactoring to middleware pattern', user_intent: 'refactor auth' },
  { tool: 'Bash', tool_input: 'npm test', task: 'Run npm test', outcome: 'success', llm_reasoning: 'Verify changes pass tests', user_intent: 'verify tests' },
]

// Helper to build a mock K2.5 response with content (no tool calls)
function mockContentResponse(content) {
  const str = typeof content === 'string' ? content : JSON.stringify(content)
  return {
    message: { content: str },
    tool_calls: null,
    content: str,
    reasoning_content: null,
    usage: { prompt_tokens: 500, completion_tokens: 200 },
  }
}

// Helper to build a mock K2.5 response with tool calls
function mockToolCallResponse(toolCalls, reasoningContent = null) {
  return {
    message: { content: null, tool_calls: toolCalls },
    tool_calls: toolCalls,
    content: null,
    reasoning_content: reasoningContent,
    usage: { prompt_tokens: 500, completion_tokens: 100 },
  }
}

describe('extract v2', () => {
  describe('makeId', () => {
    it('generates stable SHA1-based ID from content', () => {
      const id1 = makeId('When refactoring auth → read all middleware files first')
      const id2 = makeId('When refactoring auth → read all middleware files first')
      expect(id1).toBe(id2)
      expect(id1).toHaveLength(12)
      expect(id1).toMatch(/^[a-f0-9]+$/)
    })

    it('different text produces different ID', () => {
      const id1 = makeId('pattern A')
      const id2 = makeId('pattern B')
      expect(id1).not.toBe(id2)
    })

    it('sha1(condition+action) differs from sha1(condition) and sha1(action)', () => {
      const condition = 'When refactoring auth'
      const action = 'Read all middleware files first before making changes'
      const idBoth = makeId(condition + action)
      const idCondition = makeId(condition)
      const idAction = makeId(action)
      expect(idBoth).not.toBe(idCondition)
      expect(idBoth).not.toBe(idAction)
    })
  })

  describe('QUALITY_MAP', () => {
    it('maps categorical labels to numeric scores', () => {
      expect(QUALITY_MAP.universal).toBe(0.9)
      expect(QUALITY_MAP.domain).toBe(0.7)
      expect(QUALITY_MAP.project).toBe(0.5)
      expect(QUALITY_MAP.edge_case).toBe(0.3)
    })
  })

  describe('QUALITY_PRIORS', () => {
    it('maps categorical labels to initial alpha/beta', () => {
      expect(QUALITY_PRIORS.universal).toEqual({ alpha: 3, beta: 1 })
      expect(QUALITY_PRIORS.domain).toEqual({ alpha: 2, beta: 1 })
      expect(QUALITY_PRIORS.project).toEqual({ alpha: 1, beta: 1 })
      expect(QUALITY_PRIORS.edge_case).toEqual({ alpha: 1, beta: 2 })
    })
  })

  describe('buildSystemPrompt', () => {
    it('returns string with extraction rules and examples', () => {
      const prompt = buildSystemPrompt()
      expect(typeof prompt).toBe('string')
      expect(prompt).toContain('EXTRACTION RULES')
      expect(prompt).toContain('condition')
      expect(prompt).toContain('action')
      expect(prompt).toContain('GOOD PATTERNS')
      expect(prompt).toContain('BAD PATTERNS')
    })
  })

  describe('buildUserPrompt', () => {
    it('includes tool_input, user_intent, and project name', () => {
      const prompt = buildUserPrompt(SUMMARY, TOOL_ENTRIES)
      expect(prompt).toContain('quoth')
      expect(prompt).toContain('auth.js')
      expect(prompt).toContain('understand auth')
      expect(prompt).toContain('refactor auth')
      expect(prompt).toContain('success')
    })

    it('handles entries without tool_input (falls back to task)', () => {
      const entries = [{ tool: 'Read', task: 'Read file.js', outcome: 'success' }]
      const prompt = buildUserPrompt(SUMMARY, entries)
      expect(prompt).toContain('Read file.js')
    })

    it('handles empty tool entries', () => {
      const prompt = buildUserPrompt(SUMMARY, [])
      expect(prompt).toContain('No actions captured')
    })
  })

  describe('parsePatterns', () => {
    it('parses valid condition/action patterns', () => {
      const raw = JSON.stringify({
        session_type: 'productive',
        patterns: [{
          condition: 'When refactoring across multiple files',
          action: 'Read all target files in parallel before making batch edits to ensure consistency',
          tags: ['refactoring'],
          quality_signal: 'domain',
        }],
      })
      const result = parsePatterns(raw)
      expect(result).toHaveLength(1)
      expect(result[0].condition).toContain('refactoring')
      expect(result[0].action).toContain('parallel')
    })

    it('filters patterns with short condition (< 10 chars)', () => {
      const raw = JSON.stringify({
        session_type: 'productive',
        patterns: [
          { condition: 'Short', action: 'This action is long enough to pass the filter easily', tags: [], quality_signal: 'project' },
          { condition: 'When debugging intermittent failures', action: 'Isolate the failing test first with .only then add verbose logging', tags: [], quality_signal: 'universal' },
        ],
      })
      const result = parsePatterns(raw)
      expect(result).toHaveLength(1)
      expect(result[0].condition).toContain('debugging')
    })

    it('filters patterns with short action (< 20 chars)', () => {
      const raw = JSON.stringify({
        session_type: 'productive',
        patterns: [
          { condition: 'When doing something complex', action: 'Too short', tags: [], quality_signal: 'project' },
        ],
      })
      const result = parsePatterns(raw)
      expect(result).toHaveLength(0)
    })

    it('filters patterns with action > 500 chars', () => {
      const raw = JSON.stringify({
        session_type: 'productive',
        patterns: [
          { condition: 'When doing something complex', action: 'A'.repeat(501), tags: [], quality_signal: 'project' },
        ],
      })
      const result = parsePatterns(raw)
      expect(result).toHaveLength(0)
    })

    it('handles session_type routine → returns empty', () => {
      const raw = JSON.stringify({ session_type: 'routine', patterns: [] })
      const result = parsePatterns(raw)
      expect(result).toHaveLength(0)
    })

    it('handles missing patterns array → returns empty', () => {
      const raw = JSON.stringify({ session_type: 'productive' })
      const result = parsePatterns(raw)
      expect(result).toHaveLength(0)
    })
  })

  describe('TOOL_DEFINITIONS', () => {
    it('defines read_file and grep_codebase tools', () => {
      expect(TOOL_DEFINITIONS).toHaveLength(2)
      expect(TOOL_DEFINITIONS[0].function.name).toBe('read_file')
      expect(TOOL_DEFINITIONS[1].function.name).toBe('grep_codebase')
      expect(TOOL_DEFINITIONS[0].function.parameters.properties).toHaveProperty('path')
      expect(TOOL_DEFINITIONS[0].function.parameters.properties).toHaveProperty('maxLines')
      expect(TOOL_DEFINITIONS[1].function.parameters.properties).toHaveProperty('pattern')
      expect(TOOL_DEFINITIONS[1].function.parameters.properties).toHaveProperty('path')
      expect(TOOL_DEFINITIONS[1].function.parameters.properties).toHaveProperty('maxResults')
    })
  })

  describe('extract() — happy path', () => {
    it('returns condition/action patterns from K2.5 tool loop', async () => {
      const deps = makeDeps()
      deps.callMoonshotWithTools.mockResolvedValueOnce(mockContentResponse({
        session_type: 'productive',
        patterns: [{
          condition: 'When refactoring across multiple files in a monorepo',
          action: 'Read all target files in parallel before making batch edits to ensure consistency and catch dependencies',
          tags: ['refactoring', 'workflow'],
          quality_signal: 'domain',
        }],
      }))

      const db = mockDb()
      const result = await extract(SUMMARY, TOOL_ENTRIES, db, deps)

      expect(result).toHaveLength(1)
      expect(result[0].condition).toContain('refactoring across multiple files')
      expect(result[0].action).toContain('parallel')
      expect(result[0].tags).toContain('refactoring')
      expect(result[0].quality_signal).toBe('domain')
      expect(result[0].id).toHaveLength(12)
      expect(result[0].source).toBe('distilled')
      const expectedId = makeId(result[0].condition + result[0].action)
      expect(result[0].id).toBe(expectedId)
    })
  })

  describe('extract() — with tool calls', () => {
    it('executes tool calls and continues loop until content response', async () => {
      const deps = makeDeps()
      deps.executeToolCall.mockReturnValue('file content here')

      deps.callMoonshotWithTools.mockResolvedValueOnce(mockToolCallResponse(
        [{ id: 'call_1', function: { name: 'read_file', arguments: '{"path":"/home/user/project/auth.js"}' } }],
        'Let me read the auth file'
      ))

      deps.callMoonshotWithTools.mockResolvedValueOnce(mockContentResponse({
        session_type: 'productive',
        patterns: [{
          condition: 'When refactoring authentication middleware',
          action: 'Read all route handlers first to understand the dependency chain before making changes to middleware',
          tags: ['auth', 'refactoring'],
          quality_signal: 'domain',
        }],
      }))

      const db = mockDb()
      const result = await extract(SUMMARY, TOOL_ENTRIES, db, deps)

      expect(deps.callMoonshotWithTools).toHaveBeenCalledTimes(2)
      expect(deps.executeToolCall).toHaveBeenCalledTimes(1)
      expect(result).toHaveLength(1)
      expect(result[0].condition).toContain('authentication middleware')
    })
  })

  describe('extract() — empty patterns', () => {
    it('returns empty array when K2.5 returns no patterns', async () => {
      const deps = makeDeps()
      deps.callMoonshotWithTools.mockResolvedValueOnce(
        mockContentResponse({ session_type: 'productive', patterns: [] })
      )

      const result = await extract(SUMMARY, TOOL_ENTRIES, mockDb(), deps)
      expect(result).toHaveLength(0)
    })
  })

  describe('extract() — backward compat (session_type routine)', () => {
    it('returns empty array for routine sessions', async () => {
      const deps = makeDeps()
      deps.callMoonshotWithTools.mockResolvedValueOnce(
        mockContentResponse({ session_type: 'routine', patterns: [] })
      )

      const result = await extract(SUMMARY, TOOL_ENTRIES, mockDb(), deps)
      expect(result).toHaveLength(0)
    })
  })

  describe('extract() — fallback to claude -p', () => {
    it('falls back to claude -p when K2.5 fails', async () => {
      const deps = makeDeps()
      deps.callMoonshotWithTools.mockRejectedValueOnce(new Error('No MOONSHOT_API_KEY'))

      childProcess.execSync.mockReturnValue(JSON.stringify({
        session_type: 'productive',
        patterns: [{
          condition: 'When debugging authentication flows',
          action: 'Check token expiration and refresh logic before investigating middleware to avoid chasing stale state',
          tags: ['debugging', 'auth'],
          quality_signal: 'domain',
        }],
      }))

      const db = mockDb()
      const result = await extract(SUMMARY, TOOL_ENTRIES, db, deps)

      expect(result).toHaveLength(1)
      expect(result[0].condition).toContain('authentication')
      expect(db.insertPipelineError).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'extract',
          model_attempted: 'kimi-k2.5',
          fallback_attempted: 1,
        })
      )
    })

    it('returns empty when both K2.5 and fallback fail', async () => {
      const deps = makeDeps()
      deps.callMoonshotWithTools.mockRejectedValueOnce(new Error('No MOONSHOT_API_KEY'))
      childProcess.execSync.mockImplementation(() => { throw new Error('claude not found') })

      const db = mockDb()
      const result = await extract(SUMMARY, TOOL_ENTRIES, db, deps)

      expect(result).toHaveLength(0)
      expect(db.insertPipelineError).toHaveBeenCalledTimes(2)
    })
  })

  describe('extract() — JSON parse failure', () => {
    it('logs parse error and returns empty on invalid JSON', async () => {
      const deps = makeDeps()
      deps.callMoonshotWithTools.mockResolvedValueOnce(
        mockContentResponse('This is not JSON at all, just random text')
      )

      const db = mockDb()
      const result = await extract(SUMMARY, TOOL_ENTRIES, db, deps)

      expect(result).toHaveLength(0)
      expect(db.insertPipelineError).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'extract',
          error_message: expect.stringContaining('parse'),
        })
      )
    })
  })

  describe('extract() — quality_signal normalization', () => {
    it('normalizes invalid quality_signal to "project"', async () => {
      const deps = makeDeps()
      deps.callMoonshotWithTools.mockResolvedValueOnce(mockContentResponse({
        session_type: 'productive',
        patterns: [{
          condition: 'When encountering an unusual edge case',
          action: 'Pattern with invalid quality signal that should be normalized to project default value',
          tags: [],
          quality_signal: 'legendary',
        }],
      }))

      const result = await extract(SUMMARY, TOOL_ENTRIES, mockDb(), deps)
      expect(result).toHaveLength(1)
      expect(result[0].quality_signal).toBe('project')
    })
  })

  describe('extract() — tag capping', () => {
    it('caps tags at 5 per pattern', async () => {
      const deps = makeDeps()
      deps.callMoonshotWithTools.mockResolvedValueOnce(mockContentResponse({
        session_type: 'productive',
        patterns: [{
          condition: 'When working with a pattern that has many tags',
          action: 'A pattern with way too many tags for any reasonable extraction scenario to produce in practice',
          tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
          quality_signal: 'project',
        }],
      }))

      const result = await extract(SUMMARY, TOOL_ENTRIES, mockDb(), deps)
      expect(result[0].tags).toHaveLength(5)
    })
  })
})
