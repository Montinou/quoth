'use strict'

/**
 * Exploration slot for counterfactual data generation.
 * With probability ε=0.10, replaces one of the selected slots with a uniformly
 * random candidate from the pool. Creates clean counterfactual slices for
 * SNIPS-based offline evaluation.
 */

const EXPLORATION_RATE = 0.10

function shouldExplore(rate = EXPLORATION_RATE) { return Math.random() < rate }

/**
 * Replace a random slot with a random pool item with probability `rate`.
 * Marks the replacement with is_exploration=true and recomputes its propensity
 * as rate/|available|, so SNIPS can debias correctly.
 */
function replaceWithExploration(selected, pool, rate = EXPLORATION_RATE) {
  if (!selected || selected.length === 0 || !pool || pool.length === 0) return selected
  if (Math.random() >= rate) return selected
  const slotIdx = Math.floor(Math.random() * selected.length)
  const selectedIds = new Set(selected.map(s => s.id))
  const available = pool.filter(p => !selectedIds.has(p.id))
  if (available.length === 0) return selected
  const replacement = available[Math.floor(Math.random() * available.length)]
  const result = selected.slice()
  result[slotIdx] = {
    ...replacement,
    rank: selected[slotIdx].rank,
    cluster_id: replacement.cluster_id ?? selected[slotIdx].cluster_id,
    propensity: rate / available.length,
    is_exploration: true,
  }
  return result
}

module.exports = { EXPLORATION_RATE, shouldExplore, replaceWithExploration }
