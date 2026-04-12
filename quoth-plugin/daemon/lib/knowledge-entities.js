'use strict'

const crypto = require('node:crypto')
const { openDb } = require('../db.js')

function computeEntityId(kind, canonicalContent) {
  const h = crypto.createHash('sha1')
  h.update(kind)
  h.update('\0')
  h.update(canonicalContent)
  return h.digest('hex').slice(0, 16)
}

function upsertEntity({ kind, scope, summary, content, metadata = {}, embedding = null, tags = [], source, source_session_id }) {
  const db = openDb()
  const id = computeEntityId(kind, content)
  const now = Date.now()
  const meta = JSON.stringify(metadata)
  const tagsJson = JSON.stringify(tags.slice(0, 5))
  db.prepare(`
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
  `).run(
    id, kind, scope, summary, content, meta, embedding, tagsJson,
    kind === 'anti_pattern' ? 'negative' : 'positive',
    source, source_session_id, now, now, embedding ? 1 : 0,
  )
  return getById(id)
}

function getById(id) {
  return openDb().prepare(`SELECT * FROM knowledge_entities WHERE id = ?`).get(id)
}

function searchByKind(kind, limit = 20) {
  return openDb().prepare(`
    SELECT * FROM knowledge_entities
    WHERE kind = ? AND status = 'active'
    ORDER BY confidence DESC
    LIMIT ?
  `).all(kind, limit)
}

function listByScope(scope, limit = 50) {
  return openDb().prepare(`
    SELECT * FROM knowledge_entities
    WHERE scope = ? AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(scope, limit)
}

function markIndexed(id) {
  openDb().prepare(`UPDATE knowledge_entities SET embedding_indexed = 1 WHERE id = ?`).run(id)
}

function listUnindexed(limit = 500) {
  return openDb().prepare(`
    SELECT id, embedding FROM knowledge_entities
    WHERE status='active' AND embedding IS NOT NULL AND embedding_indexed = 0
    LIMIT ?
  `).all(limit)
}

module.exports = { computeEntityId, upsertEntity, getById, searchByKind, listByScope, markIndexed, listUnindexed }
