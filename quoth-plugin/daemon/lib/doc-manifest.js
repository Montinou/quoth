'use strict'

/**
 * Doc Manifest — tracks docs/project/ staleness and version history.
 *
 * Manifest file: ~/.quoth/intelligence/doc-manifest.json
 * Format:
 * {
 *   "docs": {
 *     "05-daemon-pipeline.md": {
 *       "version": "1.0.3",
 *       "updatedAt": 1712345678000,
 *       "sourceFiles": ["daemon/daemon.js", "daemon/db.js"],
 *       "sourceHashes": { "daemon/daemon.js": "a1b2c3d4" },  // content hash per source file
 *       "hash": "a1b2c3d4"   // first 8 chars of doc content hash
 *     }
 *   },
 *   "recentUpdates": [
 *     { "doc": "05-daemon-pipeline.md", "version": "1.0.3", "timestamp": ..., "changes": 2 }
 *   ]
 * }
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MANIFEST_FILE = 'doc-manifest.json'

// Regex to extract "Source files:" blocks from markdown docs
const SOURCE_REF_RE = /[`']([^`']+\.(js|ts|tsx|mjs|py|json|sql))[`']/g
// Regex to extract version from doc header: > Version X.Y.Z
const VERSION_RE = /^>\s*Version\s+(\d+\.\d+\.\d+)/m

function contentHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 8)
}

function bumpPatch(version) {
  const parts = version.split('.')
  parts[2] = String(parseInt(parts[2] || '0') + 1)
  return parts.join('.')
}

/**
 * Scan docs/project/ and build/update the manifest.
 * @param {string} projectRoot - Path to the project root (where docs/project/ lives)
 * @param {string} stateDir - Path to ~/.quoth/intelligence/
 * @returns {Object} { manifest, staleDocs: [{doc, reason, changedFiles}] }
 */
function scanDocs(projectRoot, stateDir) {
  const docsDir = path.join(projectRoot, 'docs', 'project')
  const manifestPath = path.join(stateDir, MANIFEST_FILE)

  // Load existing manifest or create new
  let manifest = { docs: {}, recentUpdates: [] }
  try {
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    }
  } catch { manifest = { docs: {}, recentUpdates: [] } }

  if (!fs.existsSync(docsDir)) return { manifest, staleDocs: [] }

  const docFiles = fs.readdirSync(docsDir).filter(f => f.endsWith('.md') && f !== 'README.md')
  const staleDocs = []

  for (const docFile of docFiles) {
    const docPath = path.join(docsDir, docFile)
    let content
    try { content = fs.readFileSync(docPath, 'utf8') } catch { continue }

    const hash = contentHash(content)

    // Extract version
    const versionMatch = content.match(VERSION_RE)
    const version = versionMatch ? versionMatch[1] : '1.0.0'

    // Extract source file references
    const sourceFiles = []
    let match
    while ((match = SOURCE_REF_RE.exec(content)) !== null) {
      const ref = match[1]
      // Normalize: strip leading quoth-plugin/ or src/ prefix inconsistencies
      if (!ref.includes('node_modules') && !ref.includes('.next')) {
        sourceFiles.push(ref)
      }
    }
    // Deduplicate
    const uniqueSources = [...new Set(sourceFiles)]

    // Hash each source file's content for change detection (like Next.js cache tags)
    const currentHashes = {}
    const changedFiles = []
    for (const src of uniqueSources) {
      // Try multiple resolutions: relative to project root, with quoth-plugin/ prefix
      const candidates = [
        path.join(projectRoot, src),
        path.join(projectRoot, 'quoth-plugin', src),
        path.join(projectRoot, src.replace(/^quoth-plugin\//, '')),
      ]
      for (const candidate of candidates) {
        try {
          const srcContent = fs.readFileSync(candidate, 'utf8')
          currentHashes[src] = contentHash(srcContent)
          break
        } catch {}
      }
    }

    // Compare content hashes with stored hashes — detects real changes, not just mtime
    const stored = manifest.docs[docFile] || {}
    const storedHashes = stored.sourceHashes || {}

    for (const [src, hash_] of Object.entries(currentHashes)) {
      const prevHash = storedHashes[src]
      if (!prevHash || prevHash !== hash_) {
        changedFiles.push(src)
      }
    }

    // Update manifest entry — preserve stored sourceHashes (only recordUpdate may overwrite)
    // This prevents a failed doc update from masking staleness on retry.
    manifest.docs[docFile] = {
      version,
      updatedAt: stored.updatedAt || Date.now(),
      sourceFiles: uniqueSources,
      sourceHashes: storedHashes,
      hash,
    }

    // Detect staleness
    if (changedFiles.length > 0) {
      staleDocs.push({
        doc: docFile,
        version,
        reason: `${changedFiles.length} source file(s) changed`,
        changedFiles,
      })
    }
  }

  // Save updated manifest
  try {
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  } catch {}

  return { manifest, staleDocs }
}

/**
 * Record a doc update in the manifest.
 * Also snapshots current sourceHashes so future scans won't re-detect the same changes.
 * @param {string} projectRoot - Project root (to re-hash source files)
 */
function recordUpdate(stateDir, docFile, newVersion, projectRoot) {
  const manifestPath = path.join(stateDir, MANIFEST_FILE)
  let manifest = { docs: {}, recentUpdates: [] }
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch {}

  if (manifest.docs[docFile]) {
    manifest.docs[docFile].version = newVersion
    manifest.docs[docFile].updatedAt = Date.now()

    // Snapshot current source hashes — marks these changes as "seen"
    if (projectRoot) {
      const freshHashes = {}
      for (const src of (manifest.docs[docFile].sourceFiles || [])) {
        const candidates = [
          path.join(projectRoot, src),
          path.join(projectRoot, 'quoth-plugin', src),
          path.join(projectRoot, src.replace(/^quoth-plugin\//, '')),
        ]
        for (const candidate of candidates) {
          try {
            freshHashes[src] = contentHash(fs.readFileSync(candidate, 'utf8'))
            break
          } catch {}
        }
      }
      manifest.docs[docFile].sourceHashes = freshHashes
    }

    // Update doc content hash
    try {
      const docsDir = path.join(projectRoot || '', 'docs', 'project')
      const docContent = fs.readFileSync(path.join(docsDir, docFile), 'utf8')
      manifest.docs[docFile].hash = contentHash(docContent)
    } catch {}
  }

  manifest.recentUpdates.unshift({
    doc: docFile,
    version: newVersion,
    timestamp: Date.now(),
  })
  if (manifest.recentUpdates.length > 50) manifest.recentUpdates.length = 50

  try { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)) } catch {}
}

/**
 * Get recent updates since a given timestamp (for session-start reporting).
 */
function getRecentUpdates(stateDir, sinceTimestamp) {
  const manifestPath = path.join(stateDir, MANIFEST_FILE)
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    return (manifest.recentUpdates || []).filter(u => u.timestamp > sinceTimestamp)
  } catch { return [] }
}

module.exports = { scanDocs, recordUpdate, getRecentUpdates, bumpPatch, VERSION_RE }
