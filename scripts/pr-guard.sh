#!/bin/bash
# PR guard for agent-contributed PRs: catches the classic ways a red
# suite turns "green" without getting better. Run with the PR base SHA:
#   bash scripts/pr-guard.sh <base_sha>
# Checks are path-scoped (test/, src/, bench/) so documentation and
# tooling that merely *mentions* bad patterns don't trip them.
set -uo pipefail

BASE="${1:?usage: pr-guard.sh <base_sha>}"
MERGE_BASE="$(git merge-base "$BASE" HEAD)" || exit 1
DIFF_TEST="$(git diff "$MERGE_BASE" HEAD -- test/)"
DIFF_SRC="$(git diff "$MERGE_BASE" HEAD -- src/)"
DIFF_CODE="$(git diff "$MERGE_BASE" HEAD -- src/ test/ bench/)"
FILES="$(git diff --name-only "$MERGE_BASE" HEAD)"
fail=0

# 1. Skipped/focused tests added in test files.
if printf '%s' "$DIFF_TEST" | grep -E '^\+[^+].*\.(skip|only|todo)\(' >/dev/null; then
  echo "PR-GUARD FAIL: diff adds .skip()/.only()/.todo() in tests — weaken the suite elsewhere, not here" >&2
  printf '%s' "$DIFF_TEST" | grep -nE '^\+[^+].*\.(skip|only|todo)\(' | head -5 >&2
  fail=1
fi

# 2. Suppression comments added in code (type/lint escapes).
if printf '%s' "$DIFF_CODE" | grep -E '^\+[^+].*(@ts-ignore|@ts-expect-error|eslint-disable|biome-ignore)' >/dev/null; then
  echo "PR-GUARD FAIL: diff adds suppression comments (@ts-ignore, eslint-disable, ...) in src/test/bench" >&2
  printf '%s' "$DIFF_CODE" | grep -nE '^\+[^+].*(@ts-ignore|@ts-expect-error|eslint-disable|biome-ignore)' | head -5 >&2
  fail=1
fi

# 3. Logging added to library code (src/ must stay silent). All console
#    methods — info/warn/error are just as much a channel leak as log.
if printf '%s' "$DIFF_SRC" | grep -E '^\+[^+].*console\.(log|debug|info|warn|error)\(' >/dev/null; then
  echo "PR-GUARD FAIL: diff adds console.log/debug/info/warn/error to src/ — the library must stay silent" >&2
  fail=1
fi

# 4. Net test removal (test(/it( lines deleted exceed added in test/).
del=$(echo "$DIFF_TEST" | grep -cE '^-[^-].*(\btest\(|\bit\()' || true)
add=$(echo "$DIFF_TEST" | grep -cE '^\+[^+].*(\btest\(|\bit\()' || true)
if [ "$del" -gt "$add" ]; then
  echo "PR-GUARD FAIL: net test deletion ($del removed vs $add added) — deleting tests is not a fix" >&2
  fail=1
fi

# 5. Protected paths: automation, policy, and provenance need owner
#    review. Dependabot is exempt (workflow bumps are its job).
if [ "${ALLOW_PROTECTED:-0}" != "1" ]; then
  protected=$(echo "$FILES" | grep -E '^(\.github/|release-please-config\.json$|\.release-please-manifest\.json$|AGENTS\.md$|api-surface\.txt$|\.githooks/|^docs/(adr/|paper\.md$|future-work\.md$))' || true)
  if [ -n "$protected" ]; then
    echo "PR-GUARD FAIL: PR touches protected paths (owner review required):" >&2
    echo "$protected" | sed 's/^/  /' >&2
    fail=1
  fi
fi

exit $fail
