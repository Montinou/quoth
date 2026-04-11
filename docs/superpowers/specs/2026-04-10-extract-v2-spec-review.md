# Spec Review: Extract Pipeline v2 (v1.1 → v1.2)

**Date**: 2026-04-10
**Reviewer**: Claude Opus 4.6
**Spec**: `2026-04-10-extract-v2-tool-calling.md`
**Result**: 7 issues found and fixed, spec upgraded to v1.2

## Issues Fixed

### 1. FACTUAL: "tool_output is always empty" (Problem §4)

**Was**: Claimed `tool_output` is always empty because Claude Code hook payload doesn't include results.

**Reality**: `trajectory-capture.js:86-97` captures both `tool_input` and `tool_output` via `summarizeToolInput()` / `summarizeToolOutput()` with full sanitization. The data exists in JSONL — the actual problem is that `extract.js:buildPrompt()` never passes these fields to the LLM.

**Fixed**: Rewrote Problem §4 and root cause chain to accurately describe the data flow: captured in JSONL but unused by the extraction prompt.

### 2. FACTUAL: "no tool_input content" (What Changes table)

**Was**: Claimed current pipeline has "no tool_input content" in entries.

**Reality**: `buildPrompt()` at `extract.js:44` includes `e.task` which is `${toolName} ${summarizeInput(toolName, toolInput)}` — summarized input is present (file paths, commands), just truncated to 100 chars and buried inside the task string. Raw `tool_input`/`tool_output` fields from JSONL are not used.

**Fixed**: Updated table entry to: "input buried in `e.task` (truncated 100 chars), raw `tool_input`/`tool_output` from JSONL unused".

### 3. FACTUAL: `detectProjectFromTask()` direction (§12)

**Was**: Claimed `detectProjectFromTask()` "maps 'ips' → /home/lord_montino/IPS_audit/IPS" and proposed exposing it as `resolveProjectRoot()`.

**Reality**: `detectProjectFromTask()` at `daemon.js:242-265` does the **reverse** — maps file path regex patterns → project names (e.g. `/IPS_audit\/IPS/` → `'ips'`). No name→path lookup exists.

**Fixed**: Added clarification note, provided explicit `PROJECT_ROOTS` reverse mapping as implementation guidance, and clarified this is a new function to build, not a reuse.

### 4. MISSING: `session_type` field handling (§4)

**Was**: v2 output schema dropped the `session_type` field without noting it.

**Issue**: Current `extract.js:217` short-circuits on `session_type === 'routine'`. The v2 schema uses `{"patterns": []}` instead, but this wasn't documented.

**Fixed**: Added note after §4 system prompt that `parsePatterns()` should handle both formats during transition.

### 5. MISSING: `jsonPrefill` migration note (§10)

**Was**: §10 stated new function "Does NOT use the jsonPrefill hack" without noting the existing dependency.

**Issue**: `extract.js:132` currently calls `callMoonshot(prompt, 600, { jsonPrefill: true })`. Implementers need to know this dependency is intentionally removed.

**Fixed**: Added note after §10 explaining the existing `jsonPrefill` usage and that v2 migration removes this dependency.

### 6. INCOMPLETE: Cost comparison missing pricing basis (Cost Impact)

**Was**: Cost estimates given without stating K2.5 per-token rates, making them unverifiable.

**Fixed**: Added Kimi K2.5 pricing table (input: $1.40/MTok, output: $5.60/MTok, cached: $0.70/MTok) with reference URL. Recalculated all estimates against stated rates — original numbers were underestimated by ~2x.

### 7. DESIGN GAP: Embedding transition dedup drift (§8 + Migration)

**Was**: Acknowledged "0.92 threshold may need tuning" but didn't address the transition period where new embeddings (`condition → action` text) are compared against old embeddings (`pattern`-only text).

**Issue**: Different embedding text distributions produce systematically lower cosine similarity scores across the boundary, causing duplicate pattern creation during rollout.

**Fixed**: 
- Added transition risk analysis in §8 with two mitigation options (re-embed on startup vs. temporary threshold reduction).
- Added migration step 6: re-embed all active patterns on first startup (~500 patterns, ~2s with local MiniLM).
- Recommended the re-embed approach as it's fast, deterministic, and permanent.

## Verification Checklist

All fixes were verified against the actual codebase:

| File | Lines checked | Claim verified |
|------|--------------|----------------|
| `quoth-plugin/hooks/trajectory-capture.js` | 83-97, 137-167 | tool_input/tool_output captured and sanitized |
| `quoth-plugin/daemon/pipeline/extract.js` | 43-45, 125, 132 | buildPrompt uses e.task not tool_input, 30 limit, 600 tokens |
| `quoth-plugin/daemon/lib/llm.js` | 87-100 | jsonPrefill param, thinking disabled, 30s timeout |
| `quoth-plugin/daemon/daemon.js` | 242-265, 408-463 | detectProjectFromTask direction, insertNewPattern fields |
| `quoth-plugin/daemon/db.js` | 16-20, 431-441, 456 | Schema columns, findDuplicateByName, findDuplicateByEmbedding |
