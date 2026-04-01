# Autonomous Test Pipeline — Design Document

**Date:** 2026-04-01
**Status:** Approved
**Scope:** Triqual agents + Quoth self-learning + Exolar integration — full autonomy

---

## Goal

Remove all human approval gates from the Triqual + Quoth + Exolar pipeline. Make test creation, promotion, pattern learning, and skill extraction fully autonomous. Prevent false positives and code duplication architecturally.

## Architecture: Three Combined Approaches

### Layer 1: Closed-Loop Autonomy (Approach B)

Close all feedback loops between Triqual agents and Quoth:

- failure-classifier outcomes auto-update pattern confidence via `quoth_log_outcome`
- test-healer success auto-promotes `.draft/` → `tests/` after quality gates pass
- pattern-learner auto-dispatched at session end, auto-promotes to Quoth (no user approval)
- Exolar consumed passively via MCP queries during RESEARCH and classification

### Layer 2: Decision Attribution (Approach A)

Track WHICH patterns were active during successes and failures:

- subagent-start.sh logs injected pattern IDs to trajectory file
- subagent-stop.sh runs Haiku attribution: which pattern contributed to outcome?
- Three tip types extracted and stored as patterns:
  - **Strategy tips** (from successes)
  - **Recovery tips** (from failures that were fixed)
  - **Optimization tips** (from slow/inefficient successes)
- Auto-calls `quoth_log_outcome` with causal attribution, not just pass/fail

### Layer 3: Skill Library (Approach C)

Parameterized, reusable test recipes stored in Quoth cloud:

- After test auto-promoted, Sonnet 4.6 + `/skill-creator` extracts a skill
- Skill = `{template, params, selectors, pageObjects, assertions, sourceTest}`
- Stored as `docType: 'skills'` in Quoth cloud
- test-generator composes from skills when available, generates from patterns when not
- Failing skill-based tests: fix the test directly, update skill AFTER fix confirmed
- Other tests using same skill: flagged as queryable list (no auto-trigger)

---

## Gates Removed

| Gate | Current Behavior | New Behavior |
|------|-----------------|--------------|
| test-healer promotion | STOP on success, wait for user "promote" | Auto-promote after quality gates pass |
| pattern-learner Quoth proposal | Must present to user, get "promote" approval | Auto-call `quoth_propose_update` when confidence threshold met |
| pattern-learner trigger | Only runs when explicitly requested | Auto-dispatched at session end via stop hook |
| .draft/ → tests/ move | Blocked by hook, user must approve | Hook allows when quality gates pass |

## Feedback Loops Closed

| Loop | Mechanism |
|------|-----------|
| failure-classifier → confidence | Auto `quoth_log_outcome(patternId, 'failure')` for active patterns |
| test-healer success → confidence | Auto `quoth_log_outcome(patternId, 'success')` for patterns used in fix |
| test-healer success → skill | Sonnet 4.6 + `/skill-creator` extracts skill from promoted test |
| subagent-stop → pattern-learner | stop hook auto-dispatches when completed run logs with LEARN stages exist |

## What Stays the Same

- 6-stage documentation loop (ANALYZE→RESEARCH→PLAN→WRITE→RUN→LEARN) — agents document autonomously
- Context loading gate (triqual_load_context mandatory) — runs without human involvement
- Retry escalation (2+, 12+, 25+ gates) — enforces agent discipline, not human approval
- Exolar as passive data source — queried during RESEARCH and by failure-classifier, never triggers agents

---

## False Positive Detection: Mutation Testing

Promotion flow from `.draft/` → `tests/`:

```
test PASSES (consecutive #1)
    │
    ▼
test PASSES (consecutive #2)
    │
    ▼
MUTATION TEST PHASE:
  1. Haiku analyzes test + component → generates 2-3 targeted mutations
     (comment out render, change API response, break route)
  2. Run test against each mutation
  3. Test MUST FAIL on at least 1 mutation
    │
    ├── Catches mutation → PASS
    │       │
    │       ▼
    │   DUPLICATION CHECK:
    │   - grep for similar selectors/helpers in existing tests/
    │   - if >70% overlap with existing helper → flag "reuse X instead"
    │   - if new PO created → verify no existing PO covers same page
    │       │
    │       ├── No duplication → AUTO-PROMOTE, commit
    │       └── Duplication → test-healer refactors, re-run
    │
    └── Still passes after mutation → FALSE POSITIVE
            │
            ▼
        Flag in run log, decrease pattern confidence
        test-healer gets feedback: "Assertions don't validate behavior"
        → retry loop continues
```

**Cost**: 2-3 extra test runs per promotion. Acceptable since promotions are infrequent.

---

## Code Duplication Prevention

Built into two stages:

### At Generation Time (test-generator)
- RESEARCH stage surfaces existing Page Objects, helpers, fixtures via `triqual_load_context`
- test-generator instructions: "REUSE what exists — only create new when nothing covers the need"
- subagent-start.sh injects list of available reusable code

### At Promotion Time (quality gate)
- Static analysis: extract selectors, helper calls, PO references from new test
- Search existing `tests/` for matching patterns
- Block promotion if existing helper covers the same action
- test-healer refactors to reuse, then re-runs quality gates

---

## Skill Model

### What a Skill Is

```javascript
{
  name: "verify-table-row-count",
  description: "Navigate to page with data table, verify row count",
  template: `
    await page.goto('{{url}}');
    await page.waitForSelector('{{tableSelector}}');
    const rows = page.locator('{{rowSelector}}');
    await expect(rows).toHaveCount({{expectedCount}});
  `,
  params: ["url", "tableSelector", "rowSelector", "expectedCount"],
  selectors: ["[data-testid='data-table']", "tbody tr"],
  pageObjects: ["DashboardPage"],
  assertions: ["toHaveCount"],
  sourceTest: "tests/my-referrals-counts.spec.ts",
  confidence: 0.91,
  usedBy: ["my-referrals-v45", "probe-counts3"],
  source: "skill-derived"
}
```

### Skill Lifecycle

1. Test passes all quality gates → auto-promoted to `tests/`
2. Sonnet 4.6 + `/skill-creator` extracts skill → stores in Quoth cloud as `docType: 'skills'`
3. Future test-generator finds matching skills via `quoth_search_index` → composes
4. If skill-based test fails → test-healer fixes test directly, skill updated after fix confirmed
5. Other tests using same skill → flagged as list (no auto-trigger)

### Skill vs Pattern vs Anti-Pattern

| Type | docType | Content | Example |
|------|---------|---------|---------|
| Pattern | `'patterns'` | Text advice (condition/action) | "Use `:visible` for ambiguous selectors" |
| Skill | `'skills'` | Parameterized code template + metadata | Login-and-verify-dashboard template |
| Anti-pattern | `'patterns'` tagged `anti-pattern` | What NOT to do | "Don't assert `toBeTruthy()` on always-present elements" |

### Promotion: Pattern → Skill

During nightly Sonnet consolidation, patterns with 5+ consistent code shapes across different tests become skill candidates. Sonnet 4.6 + `/skill-creator` extracts and stores.

---

## Decision Attribution

### At Agent Start
subagent-start.sh logs injected pattern IDs to trajectory:
```json
{"event":"patterns_injected","patterns":["pat-abc","pat-def"],"agent":"test-healer","feature":"login"}
```

### At Agent Stop
Haiku attribution call analyzes trajectory + outcome:
```json
[
  {"patternId": "pat-abc", "attribution": "success", "reason": "visible selector pattern applied"},
  {"patternId": "pat-def", "attribution": "irrelevant", "reason": "not applicable to this test"}
]
```

### Auto-Scoring
- `attribution: "success"` → `quoth_log_outcome(patternId, 'success')`
- `attribution: "failure"` → `quoth_log_outcome(patternId, 'failure')`
- `attribution: "irrelevant"` → no change

---

## Bayesian Confidence Scoring

### Beta Distribution

Replace `+0.03/-0.005` with `Beta(alpha, beta)`:
- `alpha` = successes + 1 (prior)
- `beta` = failures + 1 (prior)
- `confidence = alpha / (alpha + beta)`
- New pattern: `Beta(1, 1)` = 0.5 (maximum uncertainty)
- Time decay: decay `alpha` slowly, not confidence directly

### Promotion Tiers

| Tier | Storage | Gate | Confidence | Min Uses |
|------|---------|------|-----------|----------|
| Ephemeral | Local SQLite | Auto (distill creates) | Any | 0 |
| Local Persistent | Local SQLite, `source: 'distilled'` | Nightly consolidation | > 0.7 | > 5 |
| Cloud Shared | Quoth cloud (NeonDB) | Nightly promotion | > 0.8 | > 10 |
| Skill | Quoth cloud, `docType: 'skills'` | Extracted from passing tests | > 0.85 | > 5 + code template |

### Source Tagging

| Source | Set When |
|--------|----------|
| `distilled` | Daemon DISTILL step |
| `exolar-seeded` | `quoth_seed_from_exolar` import |
| `healer-learned` | test-healer fix produces pattern |
| `attributed` | Decision Attribution extracts tip |
| `skill-derived` | Extracted from promoted test |

### Exolar Cross-Validation

Nightly consolidation cross-validates pattern confidence against Exolar execution logs. If a pattern claims 90% success but Exolar shows tests using it fail 30% of the time, confidence gets corrected downward. Prevents self-reinforcing false positive loops.

---

## Exolar's Role

Exolar is the **authoritative execution history** — passive data source, never triggers agents.

| Use Case | Who Queries | When |
|----------|-------------|------|
| Failure patterns | `triqual_load_context` | RESEARCH stage |
| Flake detection | failure-classifier | Classifying failures |
| Regression detection | Skill maintenance | When skill-based test fails |
| Mutation validation | Promotion quality gate | Cross-reference real CI failures |
| Confidence validation | Nightly consolidation | Compare claimed vs actual success rates |

---

## End-to-End Flow

```
USER: /test login
  │
  ▼
1. triqual_load_context (Quoth patterns + skills, Exolar failures)
  │
  ▼
2. test-planner (autonomous: ANALYZE → RESEARCH → PLAN)
  │
  ▼
3. test-generator (autonomous: compose from skills or generate from patterns)
   - DUPLICATION CHECK before creating new helpers
  │
  ▼
4. test-healer (autonomous loop, up to 25 attempts)
   - failure-classifier auto-classifies
   - Decision Attribution auto-scores patterns
   - Exolar queried for similar failures
  │
  ▼
5. QUALITY GATES (all automated):
   a) 2 consecutive passes
   b) Mutation test catches feature break
   c) No code duplication
  │
  ▼
6. AUTO-PROMOTE .draft/ → tests/, commit
  │
  ▼
7. Decision Attribution (strategy/recovery/optimization tips)
  │
  ▼
8. Skill Extraction (Sonnet 4.6 + /skill-creator)
  │
  ▼
9. SESSION END: pattern-learner auto-dispatched, Exolar seeding
  │
  ▼
10. NIGHTLY: Sonnet consolidation, cloud promotion, Exolar cross-validation
```

### Failing Skill-Based Test

```
Exolar reports failure → next session surfaces it
  → test-healer fixes test directly (NOT the skill)
  → fix passes quality gates → committed
  → skill auto-updated via Sonnet 4.6 + /skill-creator
  → other tests using skill: flagged as list (no auto-trigger)
```

---

## Files Changed

### Quoth Plugin (quoth-plugin/)

| Action | Path | Change |
|--------|------|--------|
| Modify | `daemon/db.js` | Bayesian scoring (alpha/beta columns), source tagging |
| Modify | `daemon/daemon.js` | Exolar cross-validation in nightly, pattern→skill promotion |
| Modify | `daemon/pipeline/distill.js` | Source tagging on extraction |
| Create | `daemon/lib/mutate.js` | Mutation test generator |
| Create | `daemon/lib/attribute.js` | Decision attribution logic |
| Create | `daemon/lib/skill-extract.js` | Skill extraction orchestrator (dispatches Sonnet + /skill-creator) |
| Modify | `mcp/quoth-learning-server.js` | New tools: `quoth_extract_skill`, `quoth_list_skills` |
| Modify | `hooks/lib/common.sh` | Pattern ID logging in trajectories |

### Triqual Plugin (triqual-plugin/)

| Action | Path | Change |
|--------|------|--------|
| Modify | `.agents/test-healer.md` | Remove "STOP and wait for user" → auto-promote after quality gates |
| Modify | `.agents/pattern-learner.md` | Remove "present proposal to user" → auto-promote |
| Modify | `hooks/subagent-start.sh` | Log injected pattern IDs to trajectory |
| Modify | `hooks/subagent-stop.sh` | Decision attribution call + auto pattern-learner dispatch |
| Modify | `hooks/pre-spec-write.sh` | Allow promotion when quality gates pass (mutation + no duplication) |
| Modify | `hooks/stop.sh` | Auto-dispatch pattern-learner at session end |
| Modify | `hooks/lib/common.sh` | Quality gate helpers (mutation, duplication check) |

### Quoth Server (src/)

| Action | Path | Change |
|--------|------|--------|
| Create | `src/app/api/v1/skills/route.ts` | GET/POST skills endpoint |
| Modify | `src/db/schema.ts` | Add 'skills' to docType enum (if not already) |

---

## Env Vars (No New Ones)

Existing vars sufficient:
- `QUOTH_API_KEY`, `QUOTH_PROJECT_ID`, `QUOTH_API_URL` — cloud promotion
- `OPENAI_API_KEY` — embeddings
- `JINA_API_KEY` — reranking

---

## Success Criteria

1. **Zero human approval gates** — agent runs `/test feature` → test in production, skill extracted, patterns learned, all without user interaction
2. **Zero false positives** — mutation testing catches trivial assertions before promotion
3. **Zero code duplication** — duplication check blocks promotion until reuse is applied
4. **Confidence reflects reality** — Exolar cross-validation prevents self-reinforcing scores
5. **Skills compound** — second test for similar feature takes fewer attempts than first
