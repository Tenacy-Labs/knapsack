# Future Work Ledger

Status vocabulary: **build-when** (trigger condition stated — do not build
before it fires), **opportunistic** (cheap; bundle with adjacent work),
**declined** (measured or reasoned against; revisit condition stated).
Everything here preserves the library's contract: exact, deterministic,
zero dependencies. Anything that breaks the contract is not on this list.

Measured context for all estimates (2026-08-22, `v0.1.1`): design-shape
solves run 61–123 µs end-to-end with the certificate path firing 57–97%
of runs; the DP kernel streams at ~3.5 ns/cell; peak DP memory is
budget-capped at 50 MiB by D&C dispatch. The library is already faster
than its consumer's ability to notice — this ledger exists so effort is
spent only when a trigger earns it.

## Shipped (context)

These were ledger items once; recorded here so the numbers below have
their provenance:

- **u8 back-pointers** (`d10381c`) — one byte per cell, 4× table cut,
  fourth validation ceiling (≤ 255 options/group).
- **O(C) divide-and-conquer traceback** (`98da531`) — Hirschberg-shape
  budget dispatch, default 50 MiB. A5 (n=1920): 1,459 MB → 61 MB total
  process. Cell overhead +2.2% at the largest shape (windowing absorbs
  the theoretical 2×).
- **`expectedDpBytes(n, C)` / `SolveOptions.maxDpBytes`** — the pre-flight
  allocation formula, cross-validated within ±3% against measured peak
  RSS, exported so callers can pre-check or tune the dispatch line.

## Tier 1 — build-when

### F1. Core DP (break-item partition; Pisinger's mcknap lineage)

The LP walk already computes the break gradient. Groups far below it take
their minimum, groups far above take their maximum; only the *core* —
groups straddling the break — are ambiguous. DP over 10–30 core groups
instead of all n. Complements fathoming (which shrinks per-group k̄;
this shrinks n). Expected 5–20× on DP-heavy shapes; converts most
certificate misses into near-certificate-sized solves.

- **Trigger:** a real workload where the DP branch dominates latency
  (n ≳ 100 AND certificate fire rate ≲ 50%).
- **Cost:** the incumbent-safe core bound is subtle; needs a fresh
  oracle battery and 127-parity gate. Est. 1–2 days with review.

### F2. Incremental re-solve (append-only prefix reuse)

agent-kernel re-solves every turn, and turns *append* groups. The first
n−1 groups' DP rows are unchanged by an append: re-solve is one sweep of
the new group, O(C·k̄), instead of O(C·n·k̄) — ~100× on the consumer's
actual pattern. Requires a checkpoint handle from `solve()` (keep the
final value rows; validated groups memoized). Memory: one retained row
pair (~23 MB at realistic shapes; the 50 MiB budget dispatch still
governs above it).

- **Trigger:** agent-kernel's `solver.ts` swap lands (see I1) — build
  them together, since the consumer defines the API.
- **Cost:** API design (checkpoint lifecycle, invalidation on non-append
  edits) is most of it. Est. 1 day + battery.

## Tier 2 — opportunistic

### F3. Single-option group absorption

A group that hulls down to one option is a deterministic shift: pre-sum
its profit into a base and reduce capacity, instead of sweeping
full-width for nothing. Exact, ~15 lines, no new bound reasoning.
Bundle with any DP-touching work above.

### F4. Scratch row pooling

The DP path allocates ~5.6 MB of rows per solve at stress shapes. A
grow-only module-level pool (safe: full-clear is already mandated by the
windowing discipline) may shave 10–20% off DP-path latency. Measure
before keeping; pooling must not change the allocation formula the
budget dispatch relies on (pool grows, never shrinks — account for it in
`expectedDpBytes` reporting, not dispatch).

### F5. D&C buffer threading

The recursion should allocate its four rows once and thread them down,
making the 61 MB peak true by construction rather than by GC timing.
Small, defensive; bundle with any D&C touch.

## Tier 3 — declined (with revisit conditions)

### D1. Window-scoped back-pointer rows

Sounds appealing (store bp only across each group's reachable window),
but measured windows run nearly full-width once n is large
(Σmin ≪ C ≪ Σmax), and D&C already caps the over-budget case. Saves
little in practice. Revisit only if a shape family arrives with
mid-range windows AND tables under budget.

### D2. Native/WASM/SIMD kernel

Native Rust was measured at ~1.7–2× on the kernel (bandwidth-bound
streaming: ~1.9 vs ~3.5 ns/cell). u8+D&C removed the crash asymmetry and
pinned both languages to O(C) rows; the working set now fits the cache
hierarchy in either language. A twin buys a constant factor on a path
that costs microseconds 57–97% of the time — purchased with a second
implementation, a second CI stack, and drift risk between two exact
solvers. Revisit if a real workload arrives at n ≳ 1,000 with tight
latency requirements.

### D3. Default pre-flight greedy fallback

`expectedDpBytes` above budget could trigger greedy-degrade instead of
D&C. Declined: it surrenders exactness by default, and the library's
identity is exactness. D&C makes the fallback unnecessary — memory is
already bounded. The knob exists (`SolveOptions.maxDpBytes`) for callers
who want to draw the line elsewhere; what they do below it is their
policy, not ours.

## Integration notes (consumer-side)

- **I1. agent-kernel `solver.ts` swap** — the old solver carries O(n²)
  `find`, an `indexOf` comparator, and `localeCompare` (nondeterminism
  hazards documented in the survey). Swapping to this library is the
  single largest consumer-side win. Held: survey PR on agent-kernel
  (feature/knapsack-survey) awaits Daniel's TUI/REPL merge ruling.
- **I2. v0.2 replay-corpus format** — deterministic re-render under
  chosen parameters (ADR-0003's replay harness) needs a stable,
  versioned corpus format; the exchange format (i32 stream) is the
  natural seed. Note: corpus files must not be committed without a
  `.gitattributes` binary marker.

## Do-not-do list

Hard "no" pending a contract change from the owner:

- No floats in any decision path (the reported `lpUpper` float is
  display-only, never consulted).
- No MILP/external-solver dependency — the zero-dep specialized pipeline
  is the product.
- No nondeterministic tie-breaking, `localeCompare`, or unordered
  iteration in decisions.
- No warm-starting research (the survey found no fetched source
  describing true MCKP warm-starting; the all-capacity value function is
  the nearest substrate if a consumer needs capacity sweeps — fold into
  F2's checkpoint API if it ever earns its keep).

## Changelog

- 2026-08-22 (`v0.1.1`): ledger created from the speed/memory campaign
  record (scaling benchmark, memory instrumentation, u8 + D&C shipping,
  native-Rust verdict). Paper §5.7/§8 cross-outdated entries updated to
  point here.
