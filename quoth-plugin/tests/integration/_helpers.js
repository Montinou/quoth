// tests/integration/_helpers.js
//
// Shared scaffolding for Task 21 end-to-end integration tests. Each test
// drives the real `processSessionWithPipeline` against a scratch QUOTH_HOME
// + fake LLMs + monkey-patched MiniLM. Kept small and spec-agnostic on
// purpose — tests own their own assertions.

'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function mkHome(prefix = 'quoth-e2e-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function rmHome(home) {
  try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
}

function freshRequire(require_) {
  // Clear every quoth-plugin CJS module so the next require re-evaluates
  // against the current QUOTH_HOME env. daemon-core caches stage modules at
  // first use; this purge is the only way to re-home them per test.
  for (const k of Object.keys(require_.cache)) {
    if (k.includes('/quoth-plugin/')) delete require_.cache[k]
  }
  // Monkey-patch the real MiniLM batch embedder with a 384-d zero vector
  // stub so integration tests stay hermetic (no ~100 MB model load) and
  // deterministic (no GPU/CPU variance).
  const libEmbed = require_('../../daemon/lib/embed.js')
  libEmbed.generateEmbeddingBatch = async (texts) =>
    texts.map(() => Array.from({ length: 384 }, () => 0))

  const core = require_('../../daemon/daemon-core.js')
  const ke = require_('../../daemon/lib/knowledge-entities.js')
  const { openDb } = require_('../../daemon/db.js')
  return { core, ke, db: openDb(), libEmbed }
}

function seedProcessing(home, sid, { project = 'quoth', lines = null } = {}) {
  const dir = path.join(home, 'trajectories', 'processing')
  fs.mkdirSync(dir, { recursive: true })
  const jsonl = path.join(dir, `${sid}.jsonl`)
  const meta = path.join(dir, `${sid}.meta.json`)
  const defaultLines = lines ?? [
    { event: 'tool_use', session: sid, tool: 'Write', tool_input: { file_path: 'x.js' }, outcome: 'success', task: 'wrote x' },
    { event: 'tool_use', session: sid, tool: 'Edit', tool_input: { file_path: 'y.js' }, outcome: 'success', task: 'edited y' },
  ]
  fs.writeFileSync(jsonl, defaultLines.map(l => JSON.stringify(l)).join('\n') + '\n')
  fs.writeFileSync(meta, JSON.stringify({
    session_id: sid, project, status: 'terminated',
    first_seen_ts: Date.now() - 1000, last_seen_ts: Date.now(),
    tool_count: defaultLines.length, closed_marker: true,
  }))
  return jsonl
}

function makeFakeLLMs({ productive = true, entities = [], urgency = 'medium' } = {}) {
  return {
    gemini: async () => ({
      text: JSON.stringify({ productive, urgency, suspected_kinds: ['pattern', 'fact'] }),
      cost_usd: 0.0001,
    }),
    kimi: async () => ({
      text: JSON.stringify({ entities }),
      cost_usd: 0.001,
    }),
  }
}

function inMemoryHnsw() {
  const byId = new Map()
  return {
    add: (id, vec) => { byId.set(id, vec) },
    save: () => {},
    _dump: () => byId,
  }
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

function donePath(home, project, sid) {
  return path.join(home, 'trajectories', 'done', todayDate(), project, `${sid}.jsonl`)
}

function routinePath(home, project, sid) {
  return path.join(home, 'trajectories', 'routine', todayDate(), project, `${sid}.jsonl`)
}

function errorPath(home, sid) {
  return path.join(home, 'trajectories', 'error', todayDate(), `${sid}.jsonl`)
}

module.exports = {
  mkHome,
  rmHome,
  freshRequire,
  seedProcessing,
  makeFakeLLMs,
  inMemoryHnsw,
  todayDate,
  donePath,
  routinePath,
  errorPath,
}
