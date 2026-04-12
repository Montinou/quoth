'use strict'

/**
 * PERSIST pipeline stage.
 *
 * Single-transaction upsert of entities into `knowledge_entities` plus
 * post-commit HNSW indexing. Session-level idempotency via `pipeline_runs`.
 *
 * Contract (spec §2.2):
 * 1. If `entities` is empty, no-op.
 * 2. If a committed `pipeline_runs` row already exists for `sessionId`,
 *    short-circuit — the session has already been persisted.
 * 3. Open an IMMEDIATE transaction on a single db handle and, for each entity,
 *    run the same ON CONFLICT upsert used by `upsertEntity` in
 *    `lib/knowledge-entities.js`. Then insert a committed row into
 *    `pipeline_runs` (ON CONFLICT DO NOTHING).
 * 4. AFTER the SQLite transaction commits, best-effort HNSW.add each entity
 *    outside the DB transaction. Failures are logged as degraded errors and
 *    leave `embedding_indexed=0`; the catch-up sweep re-indexes later.
 *
 * The upsert SQL is inlined here (rather than delegating to
 * `upsertEntity`) to keep the entire batch in a single IMMEDIATE
 * transaction on one db handle. The SQL is kept byte-for-byte identical
 * to the canonical definition in `daemon/lib/knowledge-entities.js::upsertEntity`.
 */

const { openDb, logPipelineError } = require('../db.js')
const { computeEntityId, markIndexed } = require('../lib/knowledge-entities.js')

// The `embedding BLOB` column requires a Buffer / TypedArray for binding.
// better-sqlite3 treats a plain JS array as a "bound array" and spreads its
// elements into sequential placeholders, producing "Too many parameter values
// were provided". `embed.js` returns plain arrays, so we normalize here.
function toBlobEmbedding(v) {
  if (v == null) return null
  if (Buffer.isBuffer(v)) return v
  if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
  if (Array.isArray(v)) return Buffer.from(new Float32Array(v).buffer)
  return null
}

async function persistSession({ sessionId, entities }, { hnsw }) {
  if (!entities || entities.length === 0) return { inserted: 0 }

  const db = openDb()

  // Session-level idempotency guard (spec §2.2 step 2).
  const existing = db
    .prepare(`SELECT 1 FROM pipeline_runs WHERE source_session_id = ? AND status = 'committed'`)
    .get(sessionId)
  if (existing) return { inserted: 0, skipped: 'already-committed' }

  const upsertStmt = db.prepare(`
    INSERT INTO knowledge_entities
      (id, kind, scope, summary, content, metadata, embedding, tags, confidence, alpha, beta, polarity, status, source, source_session_id, created_at, updated_at, exposure_count, embedding_indexed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.5, 1.0, 1.0, ?, 'active', ?, ?, ?, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET
      alpha = CASE WHEN excluded.source_session_id = knowledge_entities.source_session_id
                   THEN knowledge_entities.alpha
                   ELSE knowledge_entities.alpha + 1 END,
      source_session_id = CASE WHEN excluded.source_session_id = knowledge_entities.source_session_id
                               THEN knowledge_entities.source_session_id
                               ELSE excluded.source_session_id END,
      confidence = CASE WHEN excluded.source_session_id = knowledge_entities.source_session_id
                        THEN knowledge_entities.confidence
                        ELSE (knowledge_entities.alpha + 1) /
                             (knowledge_entities.alpha + 1 + knowledge_entities.beta) END,
      updated_at = CASE WHEN excluded.source_session_id = knowledge_entities.source_session_id
                        THEN knowledge_entities.updated_at
                        ELSE excluded.updated_at END
  `)

  const ensureRun = db.prepare(`
    INSERT INTO pipeline_runs (source_session_id, run_id, status, created_at)
    VALUES (?, ?, 'committed', ?)
    ON CONFLICT(source_session_id) DO NOTHING
  `)

  const tx = db.transaction(() => {
    for (const e of entities) {
      const id = computeEntityId(e.kind, e.content)
      const now = Date.now()
      const meta = JSON.stringify(e.metadata ?? {})
      const tagsJson = JSON.stringify((e.tags ?? []).slice(0, 5))
      // embedding_indexed starts at 0 and is flipped to 1 by markIndexed()
      // after HNSW.add succeeds, outside this transaction.
      upsertStmt.run(
        id,
        e.kind,
        e.scope,
        e.summary,
        e.content,
        meta,
        toBlobEmbedding(e.embedding),
        tagsJson,
        e.kind === 'anti_pattern' ? 'negative' : 'positive',
        e.source,
        e.source_session_id,
        now,
        now,
        0,
      )
    }
    ensureRun.run(sessionId, `${sessionId}-${Date.now()}`, Date.now())
  })
  tx.immediate()

  // Post-commit HNSW indexing — failures are non-fatal; the DB is authoritative.
  for (const e of entities) {
    if (!e.embedding) continue
    const id = computeEntityId(e.kind, e.content)
    try {
      hnsw.add(id, e.embedding)
      markIndexed(id)
    } catch (err) {
      logPipelineError({
        stage: 'persist',
        severity: 'degraded',
        session_id: sessionId,
        error_message: `HNSW.add: ${err?.message ?? String(err)}`,
      })
    }
  }

  return { inserted: entities.length }
}

module.exports = { persistSession }
