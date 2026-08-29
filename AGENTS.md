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
