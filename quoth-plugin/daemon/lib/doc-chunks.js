'use strict'

/**
 * Doc Chunk Indexer — parses docs/project/*.md by ## sections,
 * embeds each chunk locally (MiniLM-L6), stores in SQLite doc_chunks table.
 * Skips unchanged chunks via content hash.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function contentHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)
}

/**
 * Parse a markdown doc into chunks split by ## headers.
 * Returns [{ header, content }] — content includes the header line.
 */
function parseChunks(markdown) {
  const lines = markdown.split('\n')
  const chunks = []
  let current = null

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current && current.content.trim()) chunks.push(current)
      current = { header: line.replace(/^## /, '').trim(), content: line + '\n' }
    } else if (current) {
      current.content += line + '\n'
    }
  }
  if (current && current.content.trim()) chunks.push(current)
  return chunks
}

/**
 * Index all docs in docs/project/ — parse, embed, upsert unchanged.
 * @param {string} projectRoot - Project root dir
 * @param {object} db - SQLite database with upsertDocChunk method
 * @param {Function} log - Logger (level, msg, data)
 * @returns {Promise<{indexed: number, skipped: number, total: number}>}
 */
async function indexDocs(projectRoot, db, log) {
  const docsDir = path.join(projectRoot, 'docs', 'project')
  if (!fs.existsSync(docsDir)) return { indexed: 0, skipped: 0, total: 0 }

  const { generateEmbedding } = require('./embed.js')
  const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md') && f !== 'README.md')

  let indexed = 0, skipped = 0, total = 0

  for (const file of files) {
    const content = fs.readFileSync(path.join(docsDir, file), 'utf8')
    const chunks = parseChunks(content)

    for (const chunk of chunks) {
      total++
      const id = `${file}::${chunk.header}`
      const hash = contentHash(chunk.content)

      // Skip if content unchanged
      const existing = db.prepare('SELECT content_hash FROM doc_chunks WHERE id = ?').get(id)
      if (existing && existing.content_hash === hash) {
        skipped++
        continue
      }

      // Embed the chunk text (header + content for context)
      const embText = `${file.replace('.md', '').replace(/^\d+-/, '')} — ${chunk.header}: ${chunk.content.slice(0, 500)}`
      const embedding = await generateEmbedding(embText)

      db.upsertDocChunk({
        id,
        doc_file: file,
        section_header: chunk.header,
        content: chunk.content.trim(),
        embedding: embedding ? JSON.stringify(embedding) : null,
        content_hash: hash,
      })
      indexed++
    }
  }

  // Clean up chunks for deleted docs/sections
  const allIds = new Set()
  for (const file of files) {
    const content = fs.readFileSync(path.join(docsDir, file), 'utf8')
    for (const chunk of parseChunks(content)) allIds.add(`${file}::${chunk.header}`)
  }
  const dbChunks = db.prepare('SELECT id FROM doc_chunks').all()
  let cleaned = 0
  for (const row of dbChunks) {
    if (!allIds.has(row.id)) {
      db.prepare('DELETE FROM doc_chunks WHERE id = ?').run(row.id)
      cleaned++
    }
  }

  if (log) log('info', 'Doc chunks indexed', { indexed, skipped, total, cleaned })
  return { indexed, skipped, total, cleaned }
}

module.exports = { parseChunks, indexDocs, contentHash }
