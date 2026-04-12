#!/usr/bin/env bash
# scripts/verify-cleanup.sh
#
# Greenfield-reset guard (spec §6.5). Scans the quoth-plugin tree for
# references to subsystems that must be fully excised by Task 24. Greps
# that match stale terms print the offending file:line and the script
# exits non-zero.
#
# This script is EXPECTED TO FAIL until Task 24 is complete. The
# `cleanup-verification` integration test is `describe.skip`'d until
# then for exactly this reason.
#
# Run from repo root or from quoth-plugin/ — both are supported via
# the `cd` at the top.

set -euo pipefail

cd "$(dirname "$0")/.."

EXCLUDE_PATHS=(
  '_archive'
  'docs/superpowers/specs/archive'
  'docs/superpowers/plans'
  'docs/superpowers/implementations'
  'CHANGELOG.md'
  '.git'
  'node_modules'
  'tests/migration'
)

STALE_TERMS=(
  '\bJUDGE\b'
  '\bDISTILL\b'
  '\bCONSOLIDATE\b'
  'voyage-4-lite'
  'bandit-v2'
  '\bSNIPS\b'
  'judge_queue'
  'cluster_posterior'
)

# The spec file for the redesign itself mentions the stale terms in
# its prose (that's the whole point of the redesign). Exclude it by
# absolute basename so the grep below can't match inside it.
SPEC_EXCLUDE='2026-04-11-session-capture-and-pattern-extraction-design.md'

exclude_args=()
for p in "${EXCLUDE_PATHS[@]}"; do
  exclude_args+=(--exclude-dir="$p")
done
exclude_args+=(--exclude="$SPEC_EXCLUDE")
exclude_args+=(--exclude='verify-cleanup.sh')

fail=0
for term in "${STALE_TERMS[@]}"; do
  if grep -rInE "${exclude_args[@]}" "$term" . 2>/dev/null; then
    echo "STALE TERM FOUND: $term"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "verify-cleanup: OK (no stale terms)"
fi
exit "$fail"
