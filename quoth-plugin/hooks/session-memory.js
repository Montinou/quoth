'use strict'

const fs = require('fs')
const path = require('path')

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'is','was','are','were','be','been','being','have','has','had','do','does','did',
  'will','would','should','could','may','might','can','i','you','we','they','it',
  'this','that','these','those','my','your','our','their','me','us','them','from'
])

function tokenizeForTopics(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t))
}

function createSessionMemory({ dir, sessionId, project }) {
  const filePath = path.join(dir, `session-${sessionId}.json`)
  let state = {
    sessionId, project,
    startedAt: Date.now(),
    topics: {},
    files: {},
    recentPrompts: [],
    injectedPatterns: {},
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    state = { ...state, ...JSON.parse(raw) }
  } catch {}

  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(filePath, JSON.stringify(state))
    } catch {}
  }

  function recordPrompt(prompt) {
    if (!prompt) return
    const tokens = tokenizeForTopics(prompt)
    for (const t of tokens) state.topics[t] = (state.topics[t] || 0) + 1
    state.recentPrompts.push(prompt.slice(0, 200))
    if (state.recentPrompts.length > 5) state.recentPrompts.shift()
    save()
  }

  function recordEdit(file) {
    if (!file) return
    state.files[file] = (state.files[file] || 0) + 1
    save()
  }

  function recordInjection(patternIds) {
    if (!patternIds || patternIds.length === 0) return
    const now = Date.now()
    for (const id of patternIds) {
      if (!state.injectedPatterns[id]) {
        state.injectedPatterns[id] = { at: now, used: false }
      }
    }
    save()
  }

  function markPatternUsed(patternId) {
    if (state.injectedPatterns[patternId]) {
      state.injectedPatterns[patternId].used = true
      save()
    }
  }

  function getStaleInjections(minAgeMinutes = 10) {
    const cutoff = Date.now() - minAgeMinutes * 60 * 1000
    return Object.entries(state.injectedPatterns)
      .filter(([, v]) => !v.used && v.at <= cutoff)
      .map(([id]) => id)
  }

  function getContextSummary() {
    const topTopics = Object.entries(state.topics)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t]) => t)
    const topFiles = Object.entries(state.files)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([f]) => f)
    return { topTopics, topFiles, recentPrompts: state.recentPrompts }
  }

  function getQueryText(currentPrompt) {
    const { topTopics, recentPrompts } = getContextSummary()
    return [currentPrompt, ...recentPrompts.slice(-2), topTopics.slice(0, 5).join(' ')]
      .filter(Boolean)
      .join(' ')
  }

  function clear() {
    try { fs.unlinkSync(filePath) } catch {}
  }

  return {
    recordPrompt, recordEdit, recordInjection, markPatternUsed,
    getStaleInjections, getContextSummary, getQueryText,
    save, clear, _state: () => state,
  }
}

module.exports = { createSessionMemory }
