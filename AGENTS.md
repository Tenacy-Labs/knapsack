# AGENTS.md

Working conventions for coding agents in this repo. Humans: applies to
you too.

## Commands

- `bun install --frozen-lockfile` — install. The lockfile is frozen on
  purpose: a mismatch is an error, never a silent regeneration.
- `bunx tsc --noEmit` — typecheck.
- `bun test` — full suite. Must be green before any push.
- `bun run bench` — perf shapes; numbers are baseline-sensitive.

CI pins bun 1.3.14. Bench baselines and paper §7.2 measurements are
taken on that version; drifting it changes numbers silently.

## Git hooks — one-time setup after cloning

    git config core.hooksPath .githooks

- `pre-commit` runs the static type check (`bun run typecheck`). A
  commit with type errors is blocked.
- `pre-push` runs the frozen install plus the full unit and
  integration suite (`bun test`), mirroring CI. A push with failures
  is blocked.

Plain shell in `.githooks/` — no dependency, nothing to install
beyond git. CI runs the same gates, so skipping a hook
(`git push --no-verify`) only moves the failure downstream.

## main is protected

PRs are mandatory — `main` requires `CI / test` and `PR Guard / guard`
to pass on an up-to-date branch. Force pushes are blocked for everyone.
(Owner/admin retains a direct-push bypass for hotfixes; agents never
have it.)

## PR gates (PR Guard workflow)

PRs run anti-weakening checks beyond the test suite
(`.github/workflows/pr-guard.yml`):

- No added `.skip()`/`.only()`/`.todo()`, suppression comments
  (`@ts-ignore`, `eslint-disable`, ...), or `console.log` in the diff.
- No net test deletion — deleting tests is not a fix.
- The public surface must match `api-surface.txt` exactly; surface
  changes must update the snapshot deliberately in the same PR
  (`bun run scripts/check-api-surface.ts --update`). P1: additive-only.
- Automation, policy, and provenance paths (`.github/`, release-please
  files, `AGENTS.md`, `api-surface.txt`, `.githooks/`, `docs/adr/`,
  `docs/paper.md`, `docs/future-work.md`) require owner review.
- PR titles must be Conventional Commits (`feat:`, `fix:`, ...) —
  Release Please versions from them.
- Perf gate: a PR whose calibrated per-shape bench cost (min of the 2
  PR runs) regresses more than 20% against the median of the 5-run
  main-branch history fails CI (baseline maintained on `gh-pages` by
  main-branch runs). Re-run the bench before assuming a machine blip.
- Nightly deep fuzz widens the adversarial seed battery (no keys —
  the oracle is an in-process brute force). A failure names its seed;
  reproduce with `FUZZ_SEEDS=<n> FUZZ_SEED_OFFSET=<off> bun test
  test/adversarial.test.ts`.
- Native kernel: `native/src/lib.rs` changes require the prebuilt
  binaries in `native/prebuilt/` to be refreshed in the same PR —
  dispatch the `Ship Native` workflow with refresh=true on the branch
  and merge the refreshed binaries it commits; the verify job fails
  any PR that edits native sources without refreshing.

## Releases are automated — do not do these by hand

- **No hand-pushed `v*` tags.** A tag push publishes to GitHub
  Packages (`.github/workflows/release.yml`).
- **No direct `npm publish`.**
- Releases flow through Release Please: conventional commits on `main`
  (`feat:`, `fix:`) keep a running release PR open. **Merging that PR
  is the owner-approval gesture** — it bumps the version, updates the
  changelog, cuts the tag, and publishes to GitHub Packages in one
  test-gated run (policy: `docs/future-work.md` P2).
- Use Conventional Commit types. Anything not `feat:`/`fix:` is treated
  as chore and ships only with the next feat/fix.
- Do not hand-edit `CHANGELOG.md`; Release Please owns it.

## Naming (stable — do not "fix")

- Org: `Tenacy-Labs` on GitHub, npm scope `@tenacy-labs`. The scope
  must equal the lowercase org login or GitHub Packages rejects
  publishes. `Tenacy` ≠ `Tenacity`: the spelling without the second
  "i" is correct.
- First consumer: [`tenacy`](https://github.com/Tenacy-Labs/tenacy)
  (formerly `agent-kernel`).

## Where things live

- Policy and roadmap: `docs/future-work.md` (authoritative).
- Decisions: `docs/adr/`.
- The public export surface is frozen per future-work P1:
  additive-only; breaking changes require a version bump and a
  migration note. Check `docs/future-work.md` before adding exports.
