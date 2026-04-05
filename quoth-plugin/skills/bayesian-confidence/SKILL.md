---
name: bayesian-confidence
description: Beta-Bernoulli confidence tracking with empirical Bayes cold-start and exponential forgetting. Use when building pattern reliability scores from noisy reward signals, cold-starting new items with partial pooling, or implementing temporal decay in non-stationary bandit systems.
---

# Bayesian Confidence with Beta Posteriors

## When to use
- You have binary/continuous reward signals for items (patterns, articles, recommendations)
- You need UNCERTAINTY representation, not just point estimates
- You face cold-start (new items have no data)
- Signal distribution changes over time (non-stationarity)

## Core model
Each item has `Beta(α, β)` posterior. Start at Beta(1,1) = uniform.
- Mean: `μ = α / (α + β)`
- Variance: `σ² = αβ / ((α+β)² · (α+β+1))`
- 95% credible interval: Beta quantile at [0.025, 0.975] (or Wilson-score approximation)

## Update rules
Binary reward r ∈ {0,1}:
```
α ← α + r
β ← β + (1-r)
```
Continuous reward r ∈ [0,1]:
```
α ← α + r
β ← β + (1-r)
```

## Empirical Bayes cold-start (partial pooling)
New item in cluster C. Estimate cluster-level prior via method of moments:
```
μ̂_C = mean(r_i for i in C)
σ̂²_C = var(r_i for i in C)
ν = μ̂_C(1-μ̂_C)/σ̂²_C - 1         # effective sample size
α_C = μ̂_C · ν
β_C = (1-μ̂_C) · ν
```
New item inherits `α_new = α_C / prior_strength, β_new = β_C / prior_strength` (e.g., prior_strength=5 → weak inheritance).

## Exponential forgetting (non-stationarity)
Decay sufficient statistics (Garivier & Moulines ALT'11):
```
α_t ← γ · α_{t-1} + r_t
β_t ← γ · β_{t-1} + (1-r_t)
```
Typical γ = 0.99/day. Equivalent to exponentially-weighted moving average over rewards.

## Implementation pitfalls
- **Don't decay confidence directly**; decay α,β (preserves posterior shape)
- **Floor α,β ≥ 0.1** to keep Beta valid
- **Empirical Bayes fails on tiny clusters** — require ≥10 samples in cluster before pooling
- **Method of moments can produce invalid ν** when σ² > μ(1-μ); clip to ν=1 fallback
- **Continuous rewards degrade fast** when reward variance is high — cap update magnitude

## Reference SQL
```sql
UPDATE patterns SET
  alpha = alpha + :r,
  beta = beta + (1 - :r),
  confidence = (alpha + :r) / (alpha + beta + 1)
WHERE id = :id
```

## Reference JS (Beta sampling via Marsaglia-Tsang)
```javascript
function sampleBeta(alpha, beta) {
  const g1 = sampleGamma(alpha)
  const g2 = sampleGamma(beta)
  return g1 / (g1 + g2)
}

function sampleGamma(shape) {
  if (shape < 1) return sampleGamma(shape + 1) * Math.pow(Math.random(), 1/shape)
  const d = shape - 1/3, c = 1 / Math.sqrt(9*d)
  while (true) {
    let x, v
    do { x = normalRandom(); v = 1 + c*x } while (v <= 0)
    v = v*v*v
    const u = Math.random()
    if (u < 1 - 0.0331 * Math.pow(x, 4)) return d * v
    if (Math.log(u) < 0.5*x*x + d*(1 - v + Math.log(v))) return d * v
  }
}
```

## Papers
- Gelman et al. *Bayesian Data Analysis* (3rd ed.), Ch. 5 — partial pooling
- Garivier & Moulines. *On UCB Policies for Non-Stationary Bandits*, ALT 2011
- Agrawal & Goyal. *Thompson Sampling for Contextual Bandits*, ICML 2013
- Chapelle & Li. *An Empirical Evaluation of Thompson Sampling*, NeurIPS 2011
