# Future Work Ledger

Five goal tracks, each with an objective and a success signal. Items
carry a status: **build-when** (trigger condition stated — do not build
before it fires), **opportunistic** (cheap; bundle with adjacent work),
**declined** (measured or reasoned against; revisit condition stated).
Everything here preserves the library's contract: exact, deterministic,
zero dependencies. Anything that breaks the contract is not on any
track — see the do-not-do list.

Measured context for all estimates (2026-08-22, `v0.1.1`): design-shape
solves run 61–123 µs end-to-end with the certificate path firing 57–97%
of runs; the DP kernel streams at ~3.5 ns/cell; peak DP memory is
budget-capped at 50 MiB by D&C dispatch. The library is already faster
than its consumer's ability to notice — tracks exist so effort is spent
only when a trigger earns it.

## Goal 1 — Speed and memory at scale

*Objective: keep the exact solve bounded and fast at any shape the
validation envelope admits. Success signal: no realistic shape exceeds
budget or latency targets.*

### Shipped (context)

- **u8 back-pointers** (`d10381c`) — one byte per cell, 4× table cut,
  fourth validation ceiling (≤ 255 options/group).
- **O(C) divide-and-conquer traceback** (`98da531`) — Hirschberg-shape
  budget dispatch, default 50 MiB. A5 (n=1920): 1,459 MB → 61 MB total
  process. Cell overhead +2.2% at the largest shape (windowing absorbs
  the theoretical 2×).
- **`expectedDpBytes(n, C)` / `SolveOptions.maxDpBytes`** — the pre-flight
  allocation formula, cross-validated within ±3% against measured peak
  RSS, exported so callers can pre-check or tune the dispatch line.

### Build-when

**F0. Heap-based greedy walk + single-walk reuse.** The LP argmax rescan
is O(S·n) ≈ O(n²·k) and runs up to 3× per solve (solveLp, fathomOptions,
integral path) — measured 4.0–4.1× per n-doubling, ~1.7 s at n=16k
(fresh-context review 2026-08-23). Invisible at the design regime (tens
of groups, sub-100 µs); fix = Dyer–Zemel-style k-way segment merge (one
O(S log n) walk) + reusing the walk's terminal state instead of
re-walking. Not a correctness issue; no decision consumes it wrong.
- Trigger: a real workload with n ≳ 500 groups.
- Cost: heap merge rewrite of lp.ts walk + fathom reuse; needs the full
  oracle battery re-run. Est. 1 day.

**F1. Core DP (break-item partition; Pisinger's mcknap lineage).** The
LP walk already computes the break gradient. Groups far below it take
their minimum, groups far above take their maximum; only the *core* —
groups straddling the break — are ambiguous. DP over 10–30 core groups
instead of all n. Complements fathoming (which shrinks per-group k̄;
this shrinks n). Expected 5–20× on DP-heavy shapes.
- Trigger: n ≳ 100 AND certificate fire rate ≲ 50% on a real workload.
- Cost: the incumbent-safe core bound is subtle; needs a fresh oracle
  battery and the 127-parity gate. Est. 1–2 days with review.

**F2. Incremental re-solve (append-only prefix reuse).** agent-kernel
re-solves every turn, and turns *append* groups. The first n−1 groups'
DP rows are unchanged by an append: re-solve is one sweep of the new
group, O(C·k̄), instead of O(C·n·k̄) — ~100× on the consumer's actual
pattern. Requires a checkpoint handle from `solve()`.
- Trigger: agent-kernel's `solver.ts` swap (I1) — build together; the
  consumer defines the API.
- Cost: checkpoint lifecycle + invalidation on non-append edits.
  Est. 1 day + battery.

### Opportunistic

- **F3. Single-option group absorption** — a group that hulls down to
  one option is a deterministic shift: pre-sum profit, reduce capacity.
  Exact, ~15 lines, no new bound reasoning.
- **F4. Scratch row pooling** — grow-only module-level row pool (safe:
  full-clear is mandated). May shave 10–20% off DP-path latency; must
  not change the formula the budget dispatch relies on.
- **F5. D&C buffer threading** — allocate the recursion's four rows
  once, thread them down: the 61 MB peak by construction, not GC timing.

### Declined

- **D1. Window-scoped back-pointer rows** — measured windows run nearly
  full-width once n is large (Σmin ≪ C ≪ Σmax), and D&C caps the
  over-budget case. Revisit only for a shape family with mid-range
  windows AND tables under budget.
- **D2. Native/WASM/SIMD kernel** — measured ~1.7–2× kernel edge
  (bandwidth-bound: ~1.9 vs ~3.5 ns/cell); u8+D&C removed the crash
  asymmetry and pinned both languages to O(C) rows. Buys a constant
  factor on a path costing microseconds 57–97% of the time, at the
  price of a second implementation and drift between two exact solvers.
  Revisit at n ≳ 1,000 with tight latency requirements.
- **D3. Default pre-flight greedy fallback** — surrenders exactness by
  default; the library's identity is exactness, and D&C already bounds
  memory. The `maxDpBytes` knob exists for callers; policy below the
  line is theirs, not ours.

## Goal 2 — Product readiness

*Objective: make the library consumable beyond its author. Success
signal: a stranger can install, call, and interpret results without
reading the source.*

- **P1. Semver discipline** — *build-when: first external consumer.* Public
  surface as of v0.1.2 + Unreleased: `solve`, `SolveOptions`,
  `solveRot`, `DEFAULT_ROT`, `RotParams`, `RotSolveOptions`,
  `RotSolveResult`, `expectedDpBytes`, `DEFAULT_DP_BUDGET`,
  `computeFrontier`, `DpResult`, `validateProblem`,
  `KnapsackValidationError`, and the `Knapsack*`/`FrontierPoint`/
  `ReducedGroup` types. v0.1.x is additive-only over this surface;
  pipeline internals (`solveLp`, `solveDp`, `fathomOptions`, `reduceAll`,
  `reduceGroupToHull`) are module-level exports for in-repo composition,
  deliberately NOT on the package surface since 2026-08-23; breaking
  changes to either tier require v0.2 and a migration note. Policy, not
  code.
- **P2. Package publishing** — *build-when: the agent-kernel swap lands
  AND the owner approves external publication.* Repo is private;
  GitHub Packages under the `@connectotron` scope is the first stop
  (org-visible, no public exposure); public npm only if the library
  outgrows the org. Publishing leaves the machine — owner approval is
  part of the trigger, not a formality.
- **P3. Cookbook** — *opportunistic; bundle with P2.* `docs/examples.md`:
  choosing `maxDpBytes`, reading `stats` (bounds gap, certificate,
  cellsVisited, mode), the four validation ceilings, what each envelope
  error means.
- **P4. CHANGELOG.md** — *opportunistic; bundle with P2.*
  Keep-a-Changelog format, seeded from the `v0.1.1` tag annotation.

## Goal 3 — Confidence and regression infrastructure

*Objective: protect exactness and performance against future changes.
Success signal: no DP or pipeline change ships without oracle, parity,
and bench evidence — automatically.*

Motivating incident: the Infinity-initialized window bound shipped green
through 631 tests (correct, but 65% slower); only the A/B bench caught
it. Tests prove correctness; they do not watch performance.

- **Q1. Benchmark history** — *build-when: the next DP-touching change.*
  Persist bench output (JSON) as a CI artifact per commit; a comparison
  script flags medians drifting beyond noise (the stress shape's ~50%
  jump is the calibration example).
- **Q2. Extended fuzz battery** — *build-when: first external consumer
  or any DP algorithm change.* Beyond CI's 300 seeds: 10k+ oracle seeds
  with adversarial shapes — tie-dense profits, extreme weight ratios,
  255-option groups, capacity-edge infeasibility.
- **Q3. Committed parity corpus** — *build-when: F1 lands, or any DP
  change after v0.1.1.* Commit `scaling.bin` as a fixture (with the
  `.gitattributes` binary marker) and wire the cross-language parity
  run; the Rust twin currently lives only in the scratch harness.

## Goal 4 — Consumer integration

*Objective: the library replaces agent-kernel's hand-rolled solver.
Success signal: agent-kernel solves through this package in production.*

- **I1. agent-kernel `solver.ts` swap — Stage 1+2 shipped (PR #7, 2026-08-22).**
  Stage 1: the survey II.4 hazards (O(n²) find, `indexOf` comparator,
  `localeCompare` nondeterminism) fixed in agent-kernel directly —
  byte-stable. Stage 2: budget relief now solves through this library
  (`reliefMode: "exact-mckp"`, flag-gated; density remains the ruled
  default per ADR-0005 v1.1). Exact dominance proven by test: ≥ density
  everywhere, strictly better on greedy-suboptimal instances. Consumed
  as vendored pin v0.1.1 (`file:vendor/knapsack`) — private-repo
  dependency cannot resolve via bun github forms (404 on the
  credential-less tarball API) nor repo-scoped CI tokens. Remaining:
  flip the default once A/B evidence on real corpora justifies it;
  then F2 (incremental re-solve) builds on the same checkpoint API.
- **I2. v0.2 replay-corpus format** — deterministic re-render under
  chosen parameters (ADR-0003's replay harness) needs a stable,
  versioned corpus format; the exchange format (i32 stream) is the
  natural seed. Corpus files need a `.gitattributes` binary marker.
- **I3. Frontier exposure (ADR-0001)** — SHIPPED 2026-08-23
  (feat/frontier-exposure): `result.frontier` when requested via
  `{ frontier: true }`. Kinks of P\*(w) from an exact standalone sweep
  over dominance-reduced groups — fathoming is capacity-specific and
  frontier-unsafe (a fathomed-at-C option can be the w-optimum at lower
  w; the fathom-safety test now asserts a genuinely-fathoming corpus and
  would fail under a fathom-unsafe refactor). The 600-seed adversarial
  battery brute-forces P\*(w) at every w against the exposed kinks.
  Default path untouched; bench at baseline.

- **I4. `solveRot()` convenience wrapper (2026-08-23, feat/rot-convenience)**
  — SHIPPED: frontier scan + default rot (rot-default-v1) + optional
  headroom, one call; the library's own first consumer, per Daniel's
  approachability ruling. Consumer-side math lives in `src/rot.ts`;
  core untouched (ADR framing A preserved). Canonicity of
  rot-default-v1 moves to the library: agent-kernel imports `DEFAULT_ROT`
  rather than re-declaring it (0004/A2 versioned param sets reference
  the export; amendment note in ADR-0001 §6).

## Goal 5 — Research extensions

*Objective: extend only what a measured workload demands. Success
signal: every extension has a consumer that asked for it.*

- **R1. All-capacity value-function export** — *build-when: a consumer
  needs capacity sweeps or a warm-start substrate.* The DP's final row
  is the value function v(C) for all capacities at once; exposing it
  (fold into F2's checkpoint API) turns the survey's honest negative —
  no fetched source describes true MCKP warm-starting — into the
  nearest practical substrate. Scope guard: data export only; no
  scheduling or policy logic in the library. First consumer: ADR-0001's
  frontier contract (kinks by default; full row = R1's escape hatch).
- **R2. Cache-prefix-augmented DP (ADR-0001 §7.3)** — *build-when:
  ledger divergence shows the per-option cache approximation misprices
  evictions.* One extra DP state bit (prefix diverged?) charges
  diverged-suffix weights at re-prefill price; certificate stays exact.
  Exposed frontier becomes cache-adjusted P̃\*(w). Est. 1–2 days with
  review (state-doubling through dominance, fathom, and D&C traceback).
- **R3. Per-zone frontiers for positional rot (ADR-0001 §9)** —
  *build-when: positional rot observability exists in the ledger.*
  Lost-in-the-middle breaks the one-dimensional scan; needs a frontier
  over zone-vectors — a different object, not a parameter of this one.
- **R4. Cross-turn DP (ADR-0001 §9, named rejected-general frame)** —
  state = content inventory, decisions = renders/transforms,
  transitions = turn growth. Transition dynamics unestimable today;
  hysteresis, transaction costs, and turnover caps are its pragmatic
  stand-ins. Single-turn frontier + consumer ρ/H is the composable
  myopic approximation. Not a build-when; a do-not-pretend.
- Multi-period, MILP, and float decisions stay on the do-not-do list.
  The library is deliberately narrow; that is a feature, not a gap.

## Do-not-do list

Hard "no" pending a contract change from the owner:

- No floats in any decision path (the reported `lpUpper` float is
  display-only, never consulted).
- No MILP/external-solver dependency — the zero-dep specialized pipeline
  is the product.
- No nondeterministic tie-breaking, `localeCompare`, or unordered
  iteration in decisions.

## Changelog

- 2026-08-23: ADR-0001 accepted (context rot as consumer-side disutility
  over the solver frontier); ledger gains I3 (frontier exposure) and
  R2–R4 (cache-prefix DP, per-zone frontiers, cross-turn DP as the
  named rejected-general frame).
- 2026-08-22 (post-`v0.1.1`): restructured into five goal tracks —
  performance, product readiness, confidence, consumer integration,
  research — at the owner's direction. Performance items (F/D) carried
  over unchanged; P/Q/R tracks added.
- 2026-08-22 (`v0.1.1`): ledger created from the speed/memory campaign
  record (scaling benchmark, memory instrumentation, u8 + D&C shipping,
  native-Rust verdict).
