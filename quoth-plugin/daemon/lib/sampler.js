'use strict'

/**
 * Thompson sampling from Beta(alpha, beta) distribution.
 * Uses Marsaglia-Tsang method for gamma sampling. Pure JS, no deps.
 */

// Box-Muller for standard normal
function randn() {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Marsaglia-Tsang gamma sampling (shape k, scale 1)
function sampleGamma(k) {
  if (k < 1) {
    return sampleGamma(k + 1) * Math.pow(Math.random(), 1 / k)
  }
  const d = k - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  while (true) {
    let x, v
    do {
      x = randn()
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = Math.random()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

/**
 * Sample from Beta(alpha, beta) = Gamma(alpha) / (Gamma(alpha) + Gamma(beta))
 */
function sampleBeta(alpha, beta) {
  const a = Math.max(0.01, alpha)
  const b = Math.max(0.01, beta)
  const x = sampleGamma(a)
  const y = sampleGamma(b)
  return x / (x + y)
}

/**
 * Score patterns with Thompson-sampled values.
 * Input patterns need { alpha, beta } or derives from { success_count, failure_count }.
 */
function scoreWithThompson(patterns) {
  return patterns.map(p => {
    const alpha = p.alpha ?? ((p.success_count || 0) + 1)
    const beta = p.beta ?? ((p.failure_count || 0) + 1)
    return { ...p, _sampled: sampleBeta(alpha, beta) }
  })
}

module.exports = { sampleBeta, sampleGamma, scoreWithThompson }
