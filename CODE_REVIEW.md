# Code Review — @connectotron/knapsack v0.1.0 (2026-08-22)

Reviewer: Robby (author review, evidence-gated — every probe below was
executed, not asserted). Scope: all of `src/` (916 lines), tests, docs
claims vs. code reality.

## Verdict

**Ship-worthy.** One latent exactness-envelope defect found and fixed in
review; no correctness defects found by probe or fuzz in the admissible
domain. 325/325 tests green, tsc strictest clean, CI green.

## Findings

### 🔴 FIXED IN REVIEW — exactness envelope gap (validate.ts)

Individual option weights had NO ceiling while `convexHull` cross-products
and `fathom.ts` bounds multiply weight-diffs (≤ max weight) against
profit-diffs (≤ Σ max profits). The MAX_CAPACITY doc comment claimed all
products stay inside 2⁵³ — false for weights ≥ 2²² with large profits:
comparisons at >2⁵³ can silently misorder (probability ~2⁻⁵² per compare
for random inputs, but certain for engineered near-ties).

Probe evidence: 2000-seed adversarial fuzz (weights to 2⁴⁴, profits to
2²⁴, brute-force oracle) — 0 value mismatches in the admissible domain
even pre-fix (flipping a comparison needs an engineered near-tie within
1 ULP at 2⁵³); the defect was in the *guarantee*, not observed behavior.

Fix: adaptive envelope guard `totalMaxProfit · maxWeight < 2⁵³`
(`MAX_EXACT_PRODUCT`), throws with scale-down guidance. Adaptive, not a
flat weight cap — small-profit problems legitimately admit huge weights.
Guard soundness: if the true product ≤ 2⁵³ the multiply is exact (every
integer ≤ 2⁵³ is representable); if > 2⁵³ the result can only round to
≥ 2⁵³, never below. Boundary-tested both sides (2·2⁵² rejects;
2·(2⁵²−1) accepts).

### 🟡 MINOR — non-array `groups` threw raw TypeError (validate.ts)

`problem.groups.length` on non-array crashes with TypeError before any
KnapsackValidationError. Fixed: explicit Array.isArray check. (No caller
ever hit this; belt-and-braces.)

### 🟡 MINOR — result contract for infeasible (types.ts / solve.ts)

`infeasible` returns `choices: null, bounds: {lpUpper: 0, greedyLower: 0}`
— the paper documents this, but zero bounds on infeasible is a mild
contract wart (a caller checking `bounds.lpUpper > 0` as a feasibility
proxy would be misled by a feasible-zero-profit problem... actually not:
feasible-zero-profit returns optimal/0 with lpUpper 0; the statuses
disambiguate). No change made; documented here for the record.

### 🟢 NOTES — no action

- `fathomOptions` runs `greedyWalk` a second time (solve.ts already ran
  it inside solveLp) — O(k²) worst-case duplicated, measured 67µs at the
  design regime; not worth a caching refactor at current scale. Flagged
  for v0.2 if shapes grow.
- `solve.ts` exports internals (`solveLp`, `solveDp`, etc.) alongside
  `solve` — intentional (agent-kernel composition), documented.
- Tests: 325 across 2 files; determinism coverage is 1 explicit test
  (byte-identical re-solve); fuzz protocols live outside the suite as
  /tmp scripts — candidates for a `bench/fuzz.ts` harness in v0.2.
- `dp.ts` back-pointer array is O(n·C) Int32 — known, documented as v0.2
  re-solve-on-residual target (or-tools lineage).

## Comparison against researched solvers (survey Part II)

Baseline: Pisinger's `mcknap.c`, or-tools MCKP (specialized), fontanf
reference, KPP-book technique lineage.

| dimension | mcknap.c | or-tools | fontanf | ours |
|---|---|---|---|---|
| core engine | B&B + DP hybrid | CP-SAT-ish specialized | two-row Bellman | two-row Bellman |
| LP bound | Dantzig w/ LP-core | LP relaxation | greedy only | Dantzig + LP-integrality certificate |
| integer compares | DET determinant | n/a (exact arithmetic) | int arrays | integer cross-multiply |
| preprocess | LP-core reduction | break-item bounds | Pareto + hull | Pareto + hull + fathom |
| determinism | C code, deterministic | solver internals | TS, deterministic | TS, no-locale, no-float-decisions |
| deps | none (C) | protobuf/absl chain | none | **zero** |
| latency @ design shape | sub-ms | ~ms | sub-ms | 67µs @ 20×3, 103µs @ 60×5 |
| exactness guarantee | yes (integer C) | yes | yes | yes, with enforced envelope |
| coverage | general MCKP | general MCKP | general MCKP | 10–100 groups × 1–6 options, C < 2²¹ |

Honest assessment:

1. **No algorithmic novelty claim.** The pipeline is classical — Dyer–Zemel
   LP parametrization, Pisinger-style preprocessing, fontanf-shape DP. The
   contribution is selection+adaptation for the latency-budgeted TS niche:
   zero-dep, sub-100µs, deterministic, envelope-enforced.
2. **We lack a B&B core.** mcknap.c branches; we fathom once then DP. For
   120×6 stress we measured 4.4ms (2.2M cells) vs mcknap's likely sub-ms —
   B&B typically prunes harder. At our design regime the certificate
   skips the DP 57–97% of the time, so the DP's worst case is rare; a
   Pisinger-style core DP around the break item is the v0.2 upgrade path
   if 120-group shapes become real.
3. **The envelope guard is stricter than the classical codes.** mcknap.c
   in C uses native ints; or-tools uses exact arithmetic internally. We
   run on JS doubles and enforce exactness by validation — a real
   constraint (weights × profits < 2⁵³) that C code never faces, traded
   for zero-dependency portability. Token-scale weights and profits fit
   with ~9 orders of magnitude to spare.
4. **Pareto/hull discipline exceeds the references.** mcknap and or-tools
   Pareto-reduce; fontanf hulls. None of the surveyed codes separate the
   exact-reduction (Pareto) from the bounds-only reduction (hull) as
   distinct typed artifacts — the bug history (inverted cross-product,
   global-id dropped-set) shows this seam is where implementations rot,
   and the separation is what made those bugs findable.
- The LP-integrality certificate is our structural edge over fontanf
  (greedy-only): when the LP is integral we return in O(k log k) with a
  proof, no DP at all — measured 11µs and 57%+ fire rate on stress shapes.
- Pisinger's break-item core DP (re-solve on residual) remains the
  referenced-but-unimplemented technique; noted in paper §8.

## Evidence appendix

- Gates: `bunx tsc --noEmit` clean; `bun test` 325/325 (4203 expects).
- Envelope boundary tests: 2·2⁵² → reject; 2·(2⁵²−1) → accept.
- Adversarial fuzz (huge weights × large profits): 0 value mismatches
  admissible-domain; out-of-envelope instances now throw loudly.
- CI: green on main (run 32540894165 at time of review; new run for this
  commit will follow).

## Honest limitations of this review

- Author review, not fresh-context: the reviewer (me) designed and built
  the solver. The probes were adversarial against my own claims, but a
  second pair of eyes with no investment in the design remains the gold
  standard — the agent-kernel merge used three scoped fresh subagents.
  If this library heads toward external consumers, re-run with scoped
  fresh-context reviewers before any 1.0.
- The comparison table relies on the research corpus (docs/research/,
  docs/survey.md) as it stood at survey time; or-tools and fontanf
  evolve, mcknap.c is frozen (2005-era C, still reference-grade).
  Latency figures for the references are the survey's measurements, not
  re-run head-to-head on this machine.
- Fuzz probes ran as /tmp scripts, not the committed suite; they are
  reproducible from this document's descriptions (seeds, shapes, oracle).
- The multi-period/fitter questions were design reviews, not code —
  ruled out-of-charter for this library in the paper and ADR lineage.


---

# Code Review — public surface & hygiene (2026-08-23)

Fresh-context subagent review (report preserved at review time in
/tmp/knapsack-review-surface.md; all findings re-verified by the
orchestrator before acceptance). **0 critical / 5 major / 7 minor.**
Kernel clean; defects concentrated at the package boundary. All 5
majors fixed on `fix/review-majors`:

1. **M1 — infeasible result shape misdocumented.** Paper §3.4 claimed
   `bounds`/`stats` are `null` on infeasible; code populates both.
   Ruling: the code's contract is better (diagnostics survive); docs
   and `types.ts` narrowed to match (`choices` is the only nullable
   field). Regression test committed (infeasible-contract describe
   block + assertions on every infeasible battery instance).
2. **M2 — correctness-gate evidence not committed.** README/paper §7.1
   cited a 600-seed adversarial fuzz + replay-hash determinism harness
   that existed only as /tmp scripts. Committed as
   `test/adversarial.test.ts`: 600 seeds × 4 styles × 3 capacity
   regimes (tight regime straddles feasibility: 512 feasible / 88
   infeasible / 233 DP-required), independent brute-force oracle,
   per-seed replay determinism, bounds-bracketing, choice-validity.
   The uncommitted "±3% RSS cross-validation" claim rewritten to what
   is actually tested (formula pin + budget dispatch coverage).
3. **M3 — CI perf-blind + lockfile freeze voided.** CI now pins
   Bun 1.3.14, runs `bun install --frozen-lockfile` strictly (fallback
   removed), and runs the bench with per-commit artifact upload
   (Q1 made real, threshold-free).
4. **M4 — export surface vs semver policy.** `index.ts` trimmed to the
   P1-named surface (22 → 17 symbols: pipeline internals `solveLp`,
   `solveDp`, `fathomOptions`, `reduceAll`, `reduceGroupToHull` are now
   module-level only); duplicate re-export block removed from
   `solve.ts`; P1 ledger updated to name the full public tier;
   `maxDpBytes` now covered through the public `solve()` entry
   (tight-budget D&C dispatch, results identical).
5. **M5 — package metadata.** `"license": "MIT"`, description,
   repository, `files` allowlist. Tarball: 26 files / 207 kB →
   13 files / 33.9 kB (verified `npm pack --dry-run`).

Gates after fixes: tsc strictest clean; 1,235/1,235 tests (632 → 1,235);
bench unchanged within noise (62/91/4,217/705/11 µs); bare-specifier
import through `exports` verified.

Minors (documented, not all fixed): README perf table omits the
wide-capacity row; three `solve —` describe names exercise `solveDp`
directly; oracle `combo` array dead; integration golden pins internals
(intentional change-detector); v0.1.1 tag predates these fixes — bump
to 0.1.2 at P2 rather than retag.
