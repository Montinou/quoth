'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

/**
 * Pure JS HNSW (Hierarchical Navigable Small World) index for approximate nearest neighbor search.
 * Replaces O(n) linear scan with O(log n) search over 384-dim embeddings (MiniLM-L6-v2 local).
 */

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}

function cosineDistance(a, b) {
  return 1 - cosineSimilarity(a, b)
}

class HnswIndex {
  /**
   * @param {number} dimensions - Vector dimensionality (default 384 for MiniLM-L6-v2)
   * @param {number} M - Max neighbors per layer (layer 0 gets 2*M)
   * @param {number} efConstruction - Size of dynamic candidate list during construction
   */
  constructor(dimensions = 384, M = 16, efConstruction = 200) {
    this.dimensions = dimensions
    this.M = M
    this.M0 = M * 2 // layer 0 max neighbors
    this.efConstruction = efConstruction
    this.mL = 1 / Math.log(M) // level generation factor

    // Node storage: id -> { vector, layers: [Set of neighbor ids], deleted }
    this.nodes = new Map()
    this.entryPoint = null
    this.maxLayer = -1
  }

  get size() {
    let count = 0
    for (const node of this.nodes.values()) {
      if (!node.deleted) count++
    }
    return count
  }

  /**
   * Assign a random layer to a new node using the HNSW probability distribution.
   */
  _randomLayer() {
    return Math.floor(-Math.log(Math.random()) * this.mL)
  }

  /**
   * Get distance between two nodes by id, or between a vector and a node.
   */
  _distance(a, b) {
    const vecA = Array.isArray(a) ? a : this.nodes.get(a).vector
    const vecB = Array.isArray(b) ? b : this.nodes.get(b).vector
    return cosineDistance(vecA, vecB)
  }

  /**
   * Greedy search: find the single closest node starting from entryId at a given layer.
   * Returns the closest node id.
   */
  _searchLayer(query, entryId, layer) {
    let current = entryId
    let currentDist = this._distance(query, current)

    let changed = true
    while (changed) {
      changed = false
      const node = this.nodes.get(current)
      if (!node || !node.layers[layer]) break

      for (const neighborId of node.layers[layer]) {
        const neighbor = this.nodes.get(neighborId)
        if (!neighbor || neighbor.deleted) continue
        const dist = this._distance(query, neighborId)
        if (dist < currentDist) {
          current = neighborId
          currentDist = dist
          changed = true
        }
      }
    }
    return current
  }

  /**
   * ef-bounded search at a single layer. Returns up to ef nearest candidates.
   * Each candidate is { id, distance }.
   */
  _searchLayerEf(query, entryIds, layer, ef) {
    const visited = new Set(entryIds)
    // candidates: min-heap by distance (closest first for expansion)
    // results: max-heap by distance (farthest first for pruning)
    const candidates = []
    const results = []

    for (const eid of entryIds) {
      const dist = this._distance(query, eid)
      candidates.push({ id: eid, distance: dist })
      results.push({ id: eid, distance: dist })
    }

    candidates.sort((a, b) => a.distance - b.distance)
    results.sort((a, b) => b.distance - a.distance)

    while (candidates.length > 0) {
      const nearest = candidates.shift() // closest candidate
      const farthestResult = results[0]  // farthest in results

      if (nearest.distance > farthestResult.distance) break

      const node = this.nodes.get(nearest.id)
      if (!node || !node.layers[layer]) continue

      for (const neighborId of node.layers[layer]) {
        if (visited.has(neighborId)) continue
        visited.add(neighborId)

        const neighbor = this.nodes.get(neighborId)
        if (!neighbor || neighbor.deleted) continue

        const dist = this._distance(query, neighborId)
        const farthest = results[0]

        if (dist < farthest.distance || results.length < ef) {
          candidates.push({ id: neighborId, distance: dist })
          results.push({ id: neighborId, distance: dist })
          results.sort((a, b) => b.distance - a.distance)
          if (results.length > ef) results.shift() // remove farthest (at index 0 after sort desc)

          // Re-sort candidates
          candidates.sort((a, b) => a.distance - b.distance)
        }
      }
    }

    return results
  }

  /**
   * Select neighbors using the simple heuristic: keep M closest.
   */
  _selectNeighbors(candidates, maxNeighbors) {
    candidates.sort((a, b) => a.distance - b.distance)
    return candidates.slice(0, maxNeighbors)
  }

  /**
   * Insert a vector into the index.
   * @param {string} id - Unique identifier
   * @param {number[]} vector - The embedding vector
   */
  add(id, vector) {
    if (!vector || vector.length !== this.dimensions) {
      throw new Error(`Vector must have ${this.dimensions} dimensions, got ${vector ? vector.length : 0}`)
    }

    // If node already exists (re-insert after remove), update it
    if (this.nodes.has(id)) {
      const existing = this.nodes.get(id)
      existing.vector = vector
      existing.deleted = false
      return
    }

    const nodeLayer = this._randomLayer()
    const layers = []
    for (let i = 0; i <= nodeLayer; i++) {
      layers.push(new Set())
    }

    this.nodes.set(id, { vector, layers, deleted: false })

    // First node: set as entry point
    if (this.entryPoint === null) {
      this.entryPoint = id
      this.maxLayer = nodeLayer
      return
    }

    let currentEntry = this.entryPoint

    // Phase 1: greedy descent from top layer to nodeLayer+1
    for (let layer = this.maxLayer; layer > nodeLayer; layer--) {
      currentEntry = this._searchLayer(vector, currentEntry, layer)
    }

    // Phase 2: insert at layers nodeLayer down to 0
    for (let layer = Math.min(nodeLayer, this.maxLayer); layer >= 0; layer--) {
      const maxM = layer === 0 ? this.M0 : this.M
      const neighbors = this._searchLayerEf(vector, [currentEntry], layer, this.efConstruction)
      const selected = this._selectNeighbors(neighbors, maxM)

      const node = this.nodes.get(id)
      for (const neighbor of selected) {
        // Add bidirectional edges
        node.layers[layer].add(neighbor.id)

        const neighborNode = this.nodes.get(neighbor.id)
        if (neighborNode && neighborNode.layers[layer]) {
          neighborNode.layers[layer].add(id)

          // Prune neighbor if over capacity
          if (neighborNode.layers[layer].size > maxM) {
            const neighborNeighbors = []
            for (const nnId of neighborNode.layers[layer]) {
              if (nnId === id) {
                neighborNeighbors.push({ id: nnId, distance: neighbor.distance })
              } else {
                neighborNeighbors.push({ id: nnId, distance: this._distance(neighborNode.vector, nnId) })
              }
            }
            const pruned = this._selectNeighbors(neighborNeighbors, maxM)
            neighborNode.layers[layer] = new Set(pruned.map(n => n.id))
          }
        }
      }

      // Use the closest found as entry for next layer down
      if (selected.length > 0) {
        currentEntry = selected[0].id
      }
    }

    // Update entry point if new node has higher layer
    if (nodeLayer > this.maxLayer) {
      this.entryPoint = id
      this.maxLayer = nodeLayer
    }
  }

  /**
   * Soft-delete a node. It remains in the graph but is excluded from results.
   * @param {string} id
   */
  remove(id) {
    const node = this.nodes.get(id)
    if (node) {
      node.deleted = true
    }
  }

  /**
   * Search for the k nearest neighbors to a query vector.
   * @param {number[]} queryVector
   * @param {number} k - Number of results
   * @param {number} efSearch - Search beam width (higher = more accurate, slower)
   * @returns {{ id: string, distance: number }[]}
   */
  search(queryVector, k = 5, efSearch = 50) {
    if (this.entryPoint === null || this.size === 0) return []
    if (!queryVector || queryVector.length !== this.dimensions) return []

    const ef = Math.max(efSearch, k)
    let currentEntry = this.entryPoint

    // Greedy descent from top layer to layer 1
    for (let layer = this.maxLayer; layer >= 1; layer--) {
      currentEntry = this._searchLayer(queryVector, currentEntry, layer)
    }

    // ef-bounded search at layer 0
    const candidates = this._searchLayerEf(queryVector, [currentEntry], 0, ef)

    // Filter deleted, sort by distance, return top k
    const results = candidates
      .filter(c => {
        const node = this.nodes.get(c.id)
        return node && !node.deleted
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k)

    return results
  }

  /**
   * Bulk load all active patterns with embeddings from the database.
   * @param {object} db - better-sqlite3 database instance
   */
  buildFromDb(db) {
    // Reset state
    this.nodes = new Map()
    this.entryPoint = null
    this.maxLayer = -1

    const rows = db.prepare(
      `SELECT id, embedding FROM patterns WHERE status = 'active' AND embedding IS NOT NULL`
    ).all()

    for (const row of rows) {
      try {
        const vector = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding
        if (Array.isArray(vector) && vector.length === this.dimensions) {
          this.add(row.id, vector)
        }
      } catch {
        // Skip malformed embeddings
      }
    }
  }

  /**
   * Serialize the index to a JSON file.
   * @param {string} filePath
   */
  save(filePath) {
    const data = {
      dimensions: this.dimensions,
      M: this.M,
      entryPoint: this.entryPoint,
      maxLayer: this.maxLayer,
      nodes: {}
    }

    for (const [id, node] of this.nodes) {
      if (node.deleted) continue
      data.nodes[id] = {
        vector: node.vector,
        layers: node.layers.map(layer => [...layer])
      }
    }

    const dir = require('path').dirname(filePath)
    if (!require('fs').existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, JSON.stringify(data))
  }

  /**
   * Deserialize the index from a JSON file.
   * @param {string} filePath
   */
  load(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8')
    const data = JSON.parse(raw)

    this.dimensions = data.dimensions || this.dimensions
    this.M = data.M || this.M
    this.M0 = this.M * 2
    this.mL = 1 / Math.log(this.M)
    this.entryPoint = data.entryPoint || null
    this.maxLayer = data.maxLayer ?? -1

    this.nodes = new Map()
    for (const [id, nodeData] of Object.entries(data.nodes || {})) {
      this.nodes.set(id, {
        vector: nodeData.vector,
        layers: nodeData.layers.map(neighbors => new Set(neighbors)),
        deleted: false
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Knowledge-entities-backed HNSW recovery (spec §2.2, §5.8)
// ---------------------------------------------------------------------------
//
// SQLite is the durable source of truth for knowledge_entities. The HNSW index
// is a derived cache. On daemon boot we try to load a previously persisted
// index; if the file is missing or corrupt we rebuild from `knowledge_entities`
// in bounded batches and save.
//
// A distinct file (`knowledge_hnsw.json`) is used to avoid colliding with the
// legacy `hnsw.index.json` built from the `patterns` table. Task 24 removes
// the legacy path; the two indices coexist until then.

const KNOWLEDGE_HNSW_FILENAME = 'knowledge_hnsw.json'

// Store the singleton on globalThis so we get one instance across every
// module evaluation — including cases where CJS `require` and ESM `import`
// end up with separate loader caches (vitest ESM-CJS interop, multiple
// workers, etc). The cache is keyed by QUOTH_HOME so separate tests using
// mkdtempSync get fresh indices.
const SINGLETON_KEY = Symbol.for('quoth.knowledgeHnsw')
function _getSingletonMap() {
  if (!globalThis[SINGLETON_KEY]) globalThis[SINGLETON_KEY] = new Map()
  return globalThis[SINGLETON_KEY]
}

function hnswPersistPath(home) {
  const h = home || process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
  return path.join(h, KNOWLEDGE_HNSW_FILENAME)
}

/**
 * Decode a `knowledge_entities.embedding` column into a plain Float32Array.
 * Accepts Buffer (BLOB), Uint8Array, JSON string, or already-decoded array.
 * Returns null on malformed input.
 */
function decodeEmbedding(raw) {
  if (raw == null) return null
  if (Array.isArray(raw)) return raw
  if (raw instanceof Float32Array) return raw
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const byteOffset = raw.byteOffset ?? 0
    const byteLength = raw.byteLength
    if (byteLength % 4 !== 0) return null
    // Copy into a fresh backing buffer — callers may mutate or persist.
    const copy = new ArrayBuffer(byteLength)
    new Uint8Array(copy).set(new Uint8Array(raw.buffer, byteOffset, byteLength))
    return new Float32Array(copy)
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

function _batchSize() {
  const n = Number(process.env.QUOTH_HNSW_REBUILD_BATCH)
  return Number.isFinite(n) && n > 0 ? n : 500
}

/**
 * Rebuild a fresh index from `knowledge_entities`. Reads in bounded batches
 * and marks each row `embedding_indexed=1` as it lands in the graph.
 */
function _rebuildFromKnowledgeEntities(db, idx) {
  const batch = _batchSize()
  const select = db.prepare(
    `SELECT id, embedding FROM knowledge_entities
     WHERE status = 'active' AND embedding IS NOT NULL
       AND id > ?
     ORDER BY id ASC
     LIMIT ?`
  )
  const markIndexed = db.prepare(
    `UPDATE knowledge_entities SET embedding_indexed = 1 WHERE id = ?`
  )

  let cursor = ''
  while (true) {
    const rows = select.all(cursor, batch)
    if (rows.length === 0) break
    for (const row of rows) {
      cursor = row.id
      const vec = decodeEmbedding(row.embedding)
      if (!vec || vec.length !== idx.dimensions) continue
      try {
        idx.add(row.id, vec)
        markIndexed.run(row.id)
      } catch {
        // Skip malformed vectors; persist.js will log failures.
      }
    }
    if (rows.length < batch) break
  }
}

/**
 * Load the knowledge-entities HNSW index from disk, or rebuild from SQLite
 * if the file is missing/corrupt. Returns a process-wide singleton so hooks,
 * workers, and the catch-up sweep share one graph.
 *
 * @param {{ home?: string, db?: object }} [opts]
 * @returns {Promise<HnswIndex>}
 */
async function loadOrInit({ home, db } = {}) {
  const filePath = hnswPersistPath(home)
  const cache = _getSingletonMap()
  if (cache.has(filePath)) return cache.get(filePath)

  const idx = new HnswIndex()

  let loaded = false
  if (fs.existsSync(filePath)) {
    try {
      idx.load(filePath)
      loaded = true
    } catch {
      loaded = false
    }
  }

  if (!loaded) {
    // Lazy-require to avoid a circular load at module init time.
    const database = db || require('../db.js').openDb()
    try {
      _rebuildFromKnowledgeEntities(database, idx)
      try { idx.save(filePath) } catch { /* best-effort persist */ }
    } catch {
      // Leave the index empty on total failure — catch-up sweep will retry.
    }
  }

  cache.set(filePath, idx)
  return idx
}

/**
 * Test-only: drop the cached singleton so a fresh `loadOrInit()` re-runs the
 * full load/rebuild path. Production code should never call this.
 */
function _resetKnowledgeSingleton() {
  _getSingletonMap().clear()
}

module.exports = {
  HnswIndex,
  loadOrInit,
  hnswPersistPath,
  decodeEmbedding,
  _resetKnowledgeSingleton,
}
