'use strict'

/**
 * Daemon embedding — local MiniLM-L6-v2 via @xenova/transformers (ONNX).
 * 384-dimensional vectors, zero API calls, ~5ms per embedding after warmup.
 *
 * Previously: voyage/voyage-4-lite (1536d) via Vercel AI Gateway ($0.02/MTok).
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

module.exports = { generateEmbedding, MODEL_NAME, DIMENSIONS }
