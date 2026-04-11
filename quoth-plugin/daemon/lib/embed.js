'use strict'

/**
 * Daemon embedding — local MiniLM-L6-v2 via @xenova/transformers (ONNX).
 * 384-dimensional vectors, zero API calls, ~5ms per embedding after warmup.
 */

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'
const DIMENSIONS = 384

let _pipeline = null

async function getPipeline() {
  if (_pipeline) return _pipeline
  const { pipeline } = require('@xenova/transformers')
  _pipeline = await pipeline('feature-extraction', MODEL_NAME, {
    quantized: true, // Use quantized model for speed
  })
  return _pipeline
}

async function generateEmbedding(text) {
  const clean = (text || '').replace(/\n+/g, ' ').trim()
  if (!clean) return null

  try {
    const pipe = await getPipeline()
    const output = await pipe(clean, { pooling: 'mean', normalize: true })
    return Array.from(output.data).slice(0, DIMENSIONS)
  } catch {
    return null
  }
}

/**
 * Batch embedding — accumulates texts and flushes when threshold is reached
 * or timeout fires. Returns a Map<text, embedding> on flush.
 */
const _queue = []         // { text, resolve }
let _flushTimer = null
const BATCH_THRESHOLD = 8
const FLUSH_DELAY_MS = 2000

async function _flushQueue() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
  if (_queue.length === 0) return

  const batch = _queue.splice(0)
  const texts = batch.map(b => b.text)

  try {
    const pipe = await getPipeline()
    const outputs = await pipe(texts, { pooling: 'mean', normalize: true })

    // outputs.data is a flat Float32Array of shape [N, DIMENSIONS]
    for (let i = 0; i < batch.length; i++) {
      const start = i * DIMENSIONS
      const vec = Array.from(outputs.data.slice(start, start + DIMENSIONS))
      batch[i].resolve(vec)
    }
  } catch (err) {
    // Resolve all with null on failure
    for (const b of batch) b.resolve(null)
  }
}

/**
 * Queue a text for batch embedding. Resolves when the batch flushes
 * (either BATCH_THRESHOLD texts accumulated or FLUSH_DELAY_MS elapsed).
 *
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
function queueEmbedding(text) {
  const clean = (text || '').replace(/\n+/g, ' ').trim()
  if (!clean) return Promise.resolve(null)

  return new Promise(resolve => {
    _queue.push({ text: clean, resolve })

    if (_queue.length >= BATCH_THRESHOLD) {
      _flushQueue()
    } else if (!_flushTimer) {
      _flushTimer = setTimeout(_flushQueue, FLUSH_DELAY_MS)
    }
  })
}

/**
 * Generate embeddings for an array of texts in a single model pass.
 *
 * @param {string[]} texts
 * @returns {Promise<(number[]|null)[]>}
 */
async function generateEmbeddingBatch(texts) {
  if (!texts || texts.length === 0) return []

  const cleaned = texts.map(t => (t || '').replace(/\n+/g, ' ').trim())
  const validIndices = []
  const validTexts = []
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i]) { validIndices.push(i); validTexts.push(cleaned[i]) }
  }

  if (validTexts.length === 0) return texts.map(() => null)

  try {
    const pipe = await getPipeline()
    const outputs = await pipe(validTexts, { pooling: 'mean', normalize: true })

    const results = new Array(texts.length).fill(null)
    for (let j = 0; j < validIndices.length; j++) {
      const start = j * DIMENSIONS
      results[validIndices[j]] = Array.from(outputs.data.slice(start, start + DIMENSIONS))
    }
    return results
  } catch {
    return texts.map(() => null)
  }
}

module.exports = { generateEmbedding, generateEmbeddingBatch, queueEmbedding, MODEL_NAME, DIMENSIONS }
