'use strict'

/**
 * In-memory cache of active patterns for a namespace.
 * Parses trigrams/tags eagerly, embeddings lazily (as Float32Array).
 *
 * Designed for per-hook-invocation use: load once at hook start,
 * reuse across multiple ranking calls within the same process.
 */

function loadPatternCache(db, namespace, opts = {}) {
  const { minConfidence = 0.2, limit = 1000 } = opts
  const rows = db.prepare(`
    SELECT id, name, condition, action, confidence, alpha, beta, tags,
           pattern_trigrams, embedding, namespace, exposure_count,
           success_count, failure_count, last_exposed_at, applicability
    FROM patterns
    WHERE status = 'active'
      AND (namespace = ? OR namespace = 'global')
      AND confidence >= ?
    ORDER BY confidence DESC
    LIMIT ?
  `).all(namespace, minConfidence, limit)

  const patterns = rows.map(r => {
    let trigramSet = new Set()
    try {
      const arr = JSON.parse(r.pattern_trigrams || '[]')
      trigramSet = new Set(arr)
    } catch {}

    let tags = []
    try { tags = JSON.parse(r.tags || '[]') } catch {}

    // Lazy embedding parse — only materialized if getEmbedding() called
    let _embeddingCache = null
    const rawEmbedding = r.embedding
    const getEmbedding = () => {
      if (_embeddingCache) return _embeddingCache
      if (!rawEmbedding) return null
      try {
        const arr = JSON.parse(rawEmbedding)
        _embeddingCache = new Float32Array(arr)
        return _embeddingCache
      } catch { return null }
    }

    return { ...r, tags, trigramSet, getEmbedding }
  })

  return {
    patterns,
    namespace,
    loadedAt: Date.now(),
    size: patterns.length,
  }
}

module.exports = { loadPatternCache }
