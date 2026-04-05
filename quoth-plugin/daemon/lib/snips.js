'use strict'

/**
 * Self-Normalized Inverse Propensity Scoring (SNIPS).
 * Unbiased reward estimation from logged bandit feedback with bounded variance.
 *
 * Reference:
 *   Swaminathan & Joachims. *The Self-Normalized Estimator for Counterfactual Learning*,
 *   NeurIPS 2015.
 */

const DEFAULT_CAP = 10

function clipWeight(propensity, cap = DEFAULT_CAP) {
  const safe = Math.max(propensity ?? 0, 1e-6)
  const w = 1 / safe
  return Math.min(w, cap)
}

/**
 * SNIPS point estimate of expected reward.
 * observations: [{ reward, propensity }, ...]
 * cap: max weight (production standard = 10)
 * Returns: E[reward | policy] ∈ [0, 1]
 */
function snipsEstimate(observations, cap = DEFAULT_CAP) {
  if (!observations || observations.length === 0) return 0.5
  let num = 0, denom = 0
  for (const o of observations) {
    const w = clipWeight(o.propensity, cap)
    num += w * o.reward
    denom += w
  }
  return denom > 0 ? num / denom : 0.5
}

/**
 * SNIPS variance estimate (for computing confidence bounds).
 */
function snipsVariance(observations, estimate, cap = DEFAULT_CAP) {
  if (!observations || observations.length < 2) return 0.25
  const est = estimate ?? snipsEstimate(observations, cap)
  let num = 0, denom = 0
  for (const o of observations) {
    const w = clipWeight(o.propensity, cap)
    const diff = o.reward - est
    num += w * w * diff * diff
    denom += w
  }
  return denom > 0 ? num / (denom * denom) : 0.25
}

/**
 * Effective sample size (ESS): how many "equivalent" unweighted samples we have.
 * Lower ESS → higher variance, wider CI.
 */
function effectiveSampleSize(observations, cap = DEFAULT_CAP) {
  if (!observations || observations.length === 0) return 0
  let sumW = 0, sumW2 = 0
  for (const o of observations) {
    const w = clipWeight(o.propensity, cap)
    sumW += w
    sumW2 += w * w
  }
  return sumW2 > 0 ? (sumW * sumW) / sumW2 : 0
}

module.exports = { snipsEstimate, snipsVariance, effectiveSampleSize, clipWeight, DEFAULT_CAP }
