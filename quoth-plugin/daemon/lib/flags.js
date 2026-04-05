'use strict'

/**
 * V2 feature flag infrastructure.
 * Master flag: QUOTH_LEARNING_V2 enables all subflags.
 * Per-feature subflags: QUOTH_V2_INJECTION, QUOTH_V2_EXPLORATION, QUOTH_V2_JUDGE, QUOTH_V2_CURATION.
 */

function truthy(v) { return v === 'true' || v === '1' || v === 'yes' }

function isV2Enabled() { return truthy(process.env.QUOTH_LEARNING_V2) }

function isSubFlag(name) {
  if (isV2Enabled()) return true
  const key = `QUOTH_V2_${name.toUpperCase()}`
  return truthy(process.env[key])
}

module.exports = { isV2Enabled, isSubFlag }
