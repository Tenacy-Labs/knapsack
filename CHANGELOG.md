# Changelog

All notable changes to this project are documented here. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
semver. The v0.1.1 entry is seeded from its tag annotation.

## [Unreleased]

### Added
- **`solveRot()` — one-call rot-aware solving (ADR-0001 §6)**: scans the
  certified frontier under a retention spline ρ, picks the operating
  point w\* maximizing U(w) = ρ(w)·P\*(w) + H(C−w), re-solves exactly at
  w\*. Defaults to **rot-default-v1** (knee 0.40·C, ρ(knee)=0.95,
  ρ(C)=0.50) when no rot is passed — zero-config start. Optional
  `headroom: (freedTokens) => number` prices unused capacity. Returns
  `operatingWeight`, `rotAdjustedValue` (float, scan objective),
  `rot` (frozen; params used), `value`/`choices`/`bounds`/`stats` of the
  certified re-solve at w\*, plus the full-capacity `frontier` the scan
  ran over. Scan maximizes over attainable points only (min feasible
  weight floor); ties pick the shortest layout; non-finite `headroom`
  values throw `KnapsackValidationError`. Core stays integer-pure and
  rot-blind (ADR framing A); floats live only in the scan. New exports:
  `solveRot`, `DEFAULT_ROT`, types `RotParams`/`RotSolveOptions`/
  `RotSolveResult`; `maxDpBytes` passes through to both internal solves.
- **`result.frontier` (ADR-0001, ledger I3)** — opt-in via
  `{ frontier: true }`: the certified Pareto frontier P\*(w) of the solve
  — kinks from an exact standalone value-row sweep over
  dominance-reduced groups, ascending weight, strictly increasing value,
  lead point carrying P\*(0) (0 under the purge convention; the
  free-profit value when zero-weight positive-profit options exist —
  corrected in review), last point the classical optimum. Consumers scan
  U(w) = ρ(w)·P\*(w) + H(C−w) for a rot-aware operating point w\*, then
  re-solve at `capacity: w\*` for the layout. Frontier derives from
  dominance-reduced sets, never fathomed ones — fathoming is
  capacity-specific and frontier-unsafe; a randomized 600-seed battery
  now brute-forces P\*(w) at every w ∈ [0, C] against the exposed kinks.
  Default solve path unchanged (bench identical: 61/91/4248/708/11 µs).
  New public types `FrontierPoint`; `computeFrontier(reduced, capacity)`
  exported for advanced callers (input domain: validateProblem's).

## [0.1.2] — 2026-08-23

Review-hardened public surface: two fresh-context reviews (surface/hygiene
and core algorithm) burned down to zero known majors.

### Fixed
- **`lpUpper` could round 1 ulp below the proven optimum** on density
  ties — the pipeline's only float (`(rem/dw)*dp`) rounded down when the
  exact LP bound was integral, so the reported bounds could fail to
  bracket the very value the solver proved optimal (e.g. `lpUpper
  62.99999999999999` vs `value 63`). Now computed as the integer-product
  quotient `(rem*dp)/dw`, exact wherever the true bound is integral
  (envelope guarantees `rem*dp < 2^52`). No decision path consumed the
  old value; `value`/`choices` were never wrong. Regression-pinned.
- **Infeasible result shape misdocumented** — the paper claimed
  `bounds`/`stats` are `null` on infeasible; the code (correctly)
  populates both. Docs and `types.ts` now agree: `choices` is the only
  nullable field. Diagnostics survive infeasibility.
- **Correctness-gate claims now point at committed evidence** — the
  previously cited 600-seed adversarial fuzz + replay determinism
  harness exists only as /tmp scripts; it is now committed as
  `test/adversarial.test.ts` (4 adversarial styles × 3 capacity regimes;
  512 feasible / 88 infeasible / 233 DP-required; independent brute-force
  oracle; per-seed replay determinism; battery-summary drift guard).
  The uncommitted "±3% RSS cross-validation" claim was rewritten to what
  is actually tested.
- **`SolveOptions.maxDpBytes` doc drift** — D&C mode returns the same
  optimal *value*; tie-broken selections may differ between modes (~2%
  of tie instances select different equal-value option sets).

### Changed
- **Public surface trimmed 22 → 17 exports** to the P1-named tier;
  pipeline internals (`solveLp`, `solveDp`, `fathomOptions`,
  `reduceGroupToHull`) are module-level only. `maxDpBytes` is now
  covered through the public `solve()` entry.
- **CI**: Bun pinned to 1.3.14; strict `--frozen-lockfile` (silent
  regeneration fallback removed); benchmark step with per-commit
  artifact upload.
- **Package metadata**: `"license": "MIT"`, description, repository,
  `files` allowlist. Tarball 207 kB → 33.9 kB (13 files).

### Verified
- tsc (strictest) clean; tests 632 → **1,236**; bench unchanged within
  noise (62/91/4,163/703/12 µs across the five shapes); bare-specifier
  import through `exports` verified; `npm pack` verified.
- Core-algorithm review: **0 critical** across ~92,000 differential-fuzz
  instances (both DP modes + permutations), 5,000 exhaustive 2-group
  instances, 400 near-2^53-envelope instances — zero wrong values, false
  `optimal`s, crashes, or reconstruction errors. Review records in
  `CODE_REVIEW.md`; unreproduced hypotheses documented with refutations.

## [0.1.1] — O(C) DP memory, 50 MiB budget cap

Milestone: the DP memory wall is closed at any input size the validation
envelope admits.

Shipped since 0.1.0:
- `d10381c` u8 back-pointers (4× table cut; 4th input ceiling,
  `MAX_OPTIONS_PER_GROUP = 255`). A5 n=1920: OOM → 1,459 MB/1.75 s.
- `98da531` Hirschberg divide-and-conquer mode + budget dispatch
  (default 50 MiB). A5 peak RSS 1,459 MB → 61 MB total process; A4
  405 MB → 56 MB; realistic shapes unchanged. 631 tests incl. 300-seed
  forced-D&C oracle battery; 127-instance cross-language corpus parity,
  0 mismatches.

Defects caught by the forced-D&C battery before they shipped: window
bounds assumed weight-sorted options (now order-independent); split used
exact-weight rows (now prefix-max, ≤-semantics).

## [0.1.0] — Initial release

Exact MCKP solver: validate → dominance (convex hull/Pareto) → LP
bounds → fathom → exact DP with certificate. Pure TypeScript, zero
dependencies, integer-exact, deterministic, 307 tests.
