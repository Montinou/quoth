'use strict'

/**
 * EMBED pipeline stage.
 *
 * Thin wrapper over the local MiniLM-L6-v2 batch embedder in `../lib/embed.js`.
 * Takes an array of entities from the EXTRACT stage, batches ALL of them
 * (across all 4 kinds: pattern, decision, anti_pattern, fact) into a SINGLE
 * model pass, and returns the entities with `embedding` attached.
 *
 * Failure policy (spec §3.3):
 * - On embedding failure: log `pipeline_errors` row with
 *   severity='degraded' and return the entities with embedding=null and
 *   embedding_indexed=0. Do NOT throw — the persist stage still wants the
 *   entities, just without vectors. HNSW catch-up can re-index later.
 *
 * DI shape matches triage.js / extract.js: second arg is a deps object with
 * `generateEmbeddingBatch` defaulting to the real implementation.
 */

const { generateEmbeddingBatch: defaultBatch } = require('../lib/embed.js')
const { logPipelineError } = require('../db.js')

async function embedEntities(entities, deps = {}) {
  if (!Array.isArray(entities) || entities.length === 0) return entities
  const { generateEmbeddingBatch = defaultBatch } = deps

  try {
    const vectors = await generateEmbeddingBatch(entities.map(e => e.content))
    return entities.map((e, i) => ({
      ...e,
      embedding: vectors[i],
      // persist stage flips this to 1 after HNSW.add succeeds
      embedding_indexed: 0,
    }))
  } catch (err) {
    logPipelineError({
      stage: 'embed',
      severity: 'degraded',
      error_message: err?.message ?? String(err),
      context: { count: entities.length },
    })
    return entities.map(e => ({
      ...e,
      embedding: null,
      embedding_indexed: 0,
    }))
  }
}

module.exports = { embedEntities }
