'use strict'

/**
 * LLM-as-Judge pairwise evaluation for pattern relevance.
 * Uses active learning (only judge uncertain cases) + position randomization
 * to kill LLM position bias.
 *
 * Reference:
 *   Zheng et al. *Judging LLM-as-a-Judge with MT-Bench*, NeurIPS 2023
 */

/**
 * Wilson-score approximation for Beta credible interval.
 * Faster than exact quantile, sufficient for uncertainty sampling.
 */
function betaCredibleInterval(alpha, beta, level = 0.05) {
  const n = alpha + beta
  if (n <= 0) return { lower: 0, upper: 1 }
  const p = alpha / n
  const z = level <= 0.025 ? 1.96 : 1.64
  const se = Math.sqrt(p * (1 - p) / n)
  return { lower: Math.max(0, p - z * se), upper: Math.min(1, p + z * se) }
}

function betaCredibleWidth(alpha, beta) {
  const { lower, upper } = betaCredibleInterval(alpha, beta)
  return upper - lower
}

/**
 * Select uncertain cluster pairs for judging.
 * Criterion: Beta CI width >= widthThreshold.
 */
function selectUncertainPairs(clusters, opts = {}) {
  const { maxPairs = 10, widthThreshold = 0.3 } = opts
  const uncertain = clusters.filter(c => betaCredibleWidth(c.alpha, c.beta) >= widthThreshold)
  const pairs = []
  for (let i = 0; i < uncertain.length && pairs.length < maxPairs; i++) {
    for (let j = i + 1; j < uncertain.length && pairs.length < maxPairs; j++) {
      pairs.push({ a: uncertain[i], b: uncertain[j] })
    }
  }
  return pairs
}

/**
 * Build pairwise prompt with randomized position.
 * Returns { prompt, positionMap: [first_actual_id, second_actual_id] }
 * so verdicts can be mapped back correctly.
 */
function buildPairwisePrompt(trajectory, patternA, patternB) {
  const order = Math.random() < 0.5
  const [first, second] = order ? [patternA, patternB] : [patternB, patternA]
  const firstId = order ? 'A' : 'B'   // display label
  const secondId = order ? 'B' : 'A'
  // positionMap[i] = actual pattern id corresponding to display letter
  const positionMap = order
    ? { A: patternA.id, B: patternB.id }
    : { A: patternB.id, B: patternA.id }
  const trimAction = s => (s || '').slice(0, 200)
  const prompt = `You are evaluating which of two injected patterns was more load-bearing for an AI agent's task.

Session trajectory summary:
${trajectory || '(no trajectory available)'}

Pattern A:
  Name: ${first.name || '(unnamed)'}
  Action: ${trimAction(first.action)}
  Tags: ${Array.isArray(first.tags) ? first.tags.join(', ') : (first.tags || '')}

Pattern B:
  Name: ${second.name || '(unnamed)'}
  Action: ${trimAction(second.action)}
  Tags: ${Array.isArray(second.tags) ? second.tags.join(', ') : (second.tags || '')}

Which pattern was MORE load-bearing for the observed trajectory and outcome? Consider whether its action content or tags actually appear in or align with what the agent did.

Respond with ONLY one token:
  A        Pattern A was more load-bearing
  B        Pattern B was more load-bearing
  NEITHER  Neither pattern influenced the trajectory meaningfully

Answer:`
  return { prompt, positionMap }
}

/**
 * Parse judge verdict back to actual pattern id (or NEITHER/UNPARSEABLE).
 */
function parseJudgeVerdict(raw, positionMap) {
  if (!raw) return 'UNPARSEABLE'
  const answer = raw.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10)
  if (answer.startsWith('NEITHER') || answer === 'N') return 'NEITHER'
  if (answer.startsWith('A')) return positionMap.A
  if (answer.startsWith('B')) return positionMap.B
  return 'UNPARSEABLE'
}

module.exports = {
  betaCredibleInterval, betaCredibleWidth, selectUncertainPairs,
  buildPairwisePrompt, parseJudgeVerdict,
}
