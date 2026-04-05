---
name: llm-as-judge
description: Pairwise LLM-as-judge evaluation with position randomization, active learning, and cost control. Use when building offline ground-truth labels for retrieval/recommender systems where explicit user feedback is unavailable or too sparse.
---

# Pairwise LLM-as-Judge

## When to use
- No explicit user labels (or too sparse for supervised training)
- Need to evaluate WHICH items in a ranked list mattered most
- Implicit signals (clicks, dwell) are too noisy alone
- Have LLM API budget ($1-$100/month)

## Why pairwise (not absolute)
Zheng et al. (NeurIPS 2023) show absolute scoring by LLMs has high noise variance. Pairwise comparisons reduce variance significantly and are the production SOTA across major evals (MT-Bench, Chatbot Arena, AlpacaEval).

## Core prompt pattern
```
Given [trajectory/context], which of these two items was more [useful/relevant/load-bearing]?
Item A: ...
Item B: ...
Answer: A, B, or NEITHER
```

## Mandatory guardrails

### Position bias (60/40 skew)
LLMs prefer the first option ~60% of the time without mitigation.
**Mitigation:** randomize order at prompt construction; store `positionMap` to decode verdict → actual item.

### Verbosity bias
Longer options rated higher. **Mitigation:** truncate both items to same length (e.g., 200 chars).

### Self-preference bias
Llama judges Llama outputs higher. **Mitigation:** judge with a DIFFERENT model family than generation.

### Hallucinated causation
When asked "did X cause Y?", judges construct plausible narratives even when X was irrelevant.
**Mitigation:** offer NEITHER as valid answer; anchor against observable outcome.

## Active learning: judge only uncertain cases

**Selection criterion — Beta credible interval width:**
```
width(α, β) = 2 · z · sqrt(p(1-p)/n)     where p = α/(α+β), n = α+β
```
Judge only if `width ≥ 0.3`. Skip high-confidence cases (either direction).

**Result:** 10-20x cost reduction with minimal accuracy loss — most items don't need judging.

## Cost model (Haiku 4.5, 2026)
- Input: ~$0.25/M tokens
- Output: ~$1.25/M tokens
- Per pairwise judgment: ~800 in + 10 out ≈ $0.0003
- 100 pairs/night = $0.03/night = **~$1/month**
- Hard cap: `QUOTH_JUDGE_DAILY_LIMIT=50` env var

## Pitfalls
- **Don't judge every pair** — active learning is essential
- **Don't trust single judgments** — aggregate multiple pairwise comparisons per item
- **Don't use judge verdicts for training the judge** — feedback loop / model collapse
- **Cache verdicts by (trajectory, patternA, patternB)** — same pair rarely changes verdict
- **Parse verdict defensively** — LLMs sometimes output "Pattern A is better because..." instead of just "A"

## Reference flow
```
1. Nightly: find uncertain clusters/patterns (CI width ≥ 0.3)
2. Build pair prompts, randomize positions
3. Call judge (Haiku) via CLI/API with 30s timeout
4. Parse verdict, map positions back via positionMap
5. Update Beta posteriors: winner α+0.5, loser β+0.5, NEITHER → no-op
6. Log cost per judgment for budget monitoring
```

## Papers
- Zheng et al. *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*, NeurIPS 2023
- Wang et al. *Large Language Models are not Fair Evaluators*, 2023 (bias analysis)
- Liu et al. *G-Eval: NLG Evaluation using GPT-4*, EMNLP 2023
- Dubois et al. *AlpacaFarm: A Simulation Framework for Methods that Learn from Human Feedback*, NeurIPS 2023
