# @tenacy-labs/knapsack

[![CI](https://github.com/Tenacy-Labs/knapsack/actions/workflows/ci.yml/badge.svg)](https://github.com/Tenacy-Labs/knapsack/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Tenacy-Labs/knapsack)](https://github.com/Tenacy-Labs/knapsack/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-%23000.svg)](https://bun.sh)

**Pick one option per group under a budget — provably optimally, in
microseconds, with zero dependencies.**

Exact **multiple-choice knapsack problem (MCKP)** solver in pure
TypeScript, built for latency-sensitive in-process use: integer-exact
bounds, deterministic output, no floats in any decision path.
`status: "optimal"` is a *proof claim* — an LP certificate or an
exhaustive dynamic program established optimality, not a heuristic that
got close.

| | |
|---|---|
| **Exact, not heuristic** | never "probably optimal" — every result is certified |
| **Hot-loop fast** | 11 µs – 4.1 ms per solve at realistic shapes (median, measured) |
| **Zero dependencies** | pure TypeScript + one optional Rust kernel; ~1.5 MB with all five prebuilt binaries |
| **Deterministic** | same input → byte-identical output, every run, forever |
| **Memory-bounded** | DP memory capped by `maxDpBytes` (default 50 MiB); above it an O(C)-memory mode keeps peak at `16·(C+1)` bytes |
| **Battle-tested** | 1,280 tests; ~92,000-instance adversarial fuzz vs brute force, zero wrong answers |

Born from [tenacy](https://github.com/Tenacy-Labs/tenacy) (formerly
agent-kernel)'s
per-turn context optimizer (ADR-0005: the render solve *is* an MCKP),
extracted as a standalone component for pure focus on mathematical
structure and implementation efficiency. First consumer: tenacy;
the library knows nothing about LLMs, tokens, or turns.

## Quick start

Published to GitHub Packages (the `@tenacy-labs` scope):

```sh
npm config set @tenacy-labs:registry https://npm.pkg.github.com
# needs a GitHub token with read:packages in ~/.npmrc or the env
npm install @tenacy-labs/knapsack      # or: bun add @tenacy-labs/knapsack
```

Public-repo consumers without registry auth can also pin the git URL:

```sh
bun add github:Tenacy-Labs/knapsack
```

```ts
import { solve } from "@tenacy-labs/knapsack";

const result = solve({
  groups: [
    {
      id: "file:src/lp.ts",
      options: [
        { id: "full",    weight: 420, profit: 90 },
        { id: "outline", weight: 60,  profit: 55 },
        { id: "purge",   weight: 0,   profit: 0  },
      ],
    },
    {
      id: "file:src/dp.ts",
      options: [
        { id: "full",    weight: 380, profit: 84 },
        { id: "outline", weight: 55,  profit: 48 },
        { id: "purge",   weight: 0,   profit: 0  },
      ],
    },
    // ...one group per decision, any number of groups
  ],
  capacity: 8_000,
});

result.status;   // "optimal" (or "infeasible" — both are answers, not errors)
result.value;    // 174 — the proven maximum
result.choices;  // [{ groupId: "file:src/lp.ts", optionId: "full" }, ...]
result.bounds;   // { lpUpper, greedyLower } — the certificate bracket
result.stats;    // reduction counts, dpRequired, dpCellsVisited
result.frontier; // [{ weight: 0, value: 0 }, ... ] — ADR-0001 Pareto kinks of P*(w),
                 //   opt-in via solve(problem, { frontier: true }): the whole
                 //   length-vs-value tradeoff in one certified array, so the
                 //   consumer (not the solver) can price context rot
                 //   U(w) = ρ(w)·P*(w) + H(C−w)
```
Ships as TypeScript source: no build step under Bun; `tsc`-compilable
for any runtime. The native kernel loads only under Bun (`bun:ffi` is
resolved lazily at load time); every other runtime transparently runs
the TypeScript kernel with identical outputs.

## What a problem looks like

Every decision is a **group**; each way to make it is an **option**
carrying a cost (`weight`) and a value (`profit`); `capacity` is the
budget. The solver picks one option per group, maximizing total profit
within budget.

The quick start above is tenacy's context render, but the mapping
is domain-agnostic — a packing list works identically:

```ts
const trip = {
  groups: [
    {
      id: "jacket",
      options: [
        { id: "shell", weight: 480, profit: 90 }, // waterproof, warm
        { id: "vest",  weight: 220, profit: 55 },
        { id: "none",  weight: 0,   profit: 0  }, // "bring nothing"
      ],
    },
    {
      id: "camera",
      options: [
        { id: "body+2lenses", weight: 1_600, profit: 120 },
        { id: "body+1lens",   weight: 1_100, profit: 84  },
        { id: "phone",        weight: 0,     profit: 20  },
      ],
    },
    // ...one group per decision, any number of groups
  ],
  capacity: 4_000, // grams of carry-on allowance
};
```

Three conventions matter:

- `weight` and `profit` are non-negative integers — tokens and utility
  points, grams and priorities, all fit. No floats in, no floats out.
- "Choose nothing" is modeled *explicitly* as a zero-weight zero-profit
  option (the `none`/`purge` entries above). Omit it and opting out of a
  decision is not expressible.

## Reading the frontier

`result.frontier` answers "what is the best I can do at *any* budget?"
Each entry is a **kink**: the weight where the best achievable layout
changes, and the certified value there. For the quick-start problem at
`capacity: 800`:

```ts
solve(problem, { frontier: true }).frontier;
// [ { weight:   0, value:   0 },
//   { weight:  55, value:  48 },
//   { weight:  60, value:  55 },
//   { weight: 115, value: 103 },
//   { weight: 440, value: 139 },
//   { weight: 800, value: 174 } ]
```

Read it as a staircase — each row says: *"if my budget were at least
this much weight, this much profit is provably attainable, via this
layout"*:

| kink w | P\*(w) | the layout that earns it |
|---|---|---|
| 0 | 0 | purge both files |
| 55 | 48 | keep `dp.ts` as outline |
| 60 | 55 | keep `lp.ts` as outline |
| 115 | 103 | both files as outlines |
| 440 | 139 | `lp.ts` outline + `dp.ts` full |
| 800 | 174 | both files full — the classical optimum |

Three properties make the array trustworthy without reading source:

- **Certified, not sampled.** Every value is an exact optimum
  (P\*(w)); each layout is recoverable by re-solving at
  `capacity: w` — `solveRot()` does exactly that internally.
- **Kinks only.** Between two rows the earlier row stays optimal — the
  curve is flat between bends, so the array is the whole curve in
  compressed form.
- **Monotone, ascending.** More budget never hurts: weights strictly
  increase, values never decrease. The last row is always
  `solve(problem)` itself.

The frontier is what lets a consumer price trade-offs the solver cannot
see: context rot over a shorter layout (the `solveRot` section below),
headroom value in freed tokens, or knee-finding on your own curve.

## Solve with context rot in one call

`solve()` returns the classical optimum — it cannot prefer a shorter
layout, because length is not priced. `solveRot()` adds that price in the
consumer layer (ADR-0001): it scans the certified Pareto frontier under a
retention curve ρ and returns the layout at the best operating point.

```ts
import { solveRot } from "@tenacy-labs/knapsack";

const result = solveRot(problem);   // rot-default-v1 if you pass nothing
// `problem` here: the quick-start two-file problem at capacity: 800
// (the frontier table above is this same problem)

result.operatingWeight;    // 440 — the frontier point ρ picks
result.value;              // 139 — certified optimum AT that budget
result.choices;            // [{ groupId: "file:src/lp.ts", optionId: "outline" }, ...]
result.rotAdjustedValue;   // 116.41 — ρ(w*)·P*(w), the scan's objective
result.rot;                // the params used — defaults: knee 0.40·C,
                           //   ρ(knee)=0.95, ρ(C)=0.50 (rot-default-v1)
```

Tune the rot model per model card, or price unused capacity with
`headroom`:

```ts
// Mild rot — knee late, shallow cliff
solveRot(problem, { rot: { kneeFraction: 0.9, kneeRetention: 0.99, floorRetention: 0.95 } });

// Free-capacity utility: U(w) = ρ(w)·P*(w) + H(C−w)
solveRot(problem, { headroom: (freedTokens) => 0.3 * freedTokens });
// Non-finite H values throw KnapsackValidationError; rot params are
// validated the same way. On U ties the scan picks the shortest layout.
```

The core stays integer-pure and rot-blind; floats appear only in the
operating-point scan. The layout itself is always the certified integer
re-solve at `capacity: operatingWeight`.

## The problem

```
maximize   Σ_i  p_i(x_i)          one option x_i per group i
subject to Σ_i  w_i(x_i) ≤ C      integer weights and profits
```

Tenacy's mapping: groups = context items, options = render variants,
weight = tokens, C = the turn budget, profit = utility.

## API

```ts
import { solve } from "@tenacy-labs/knapsack";

const result = solve({
  groups: [
    {
      id: "file:src/lp.ts",
      options: [
        { id: "full",   weight: 420, profit: 90 },
        { id: "outline", weight: 60, profit: 55 },
        { id: "purge",   weight: 0,  profit: 0  },
      ],
    },
    // ... more groups
  ],
  capacity: 8_000,
});

result.status;        // "optimal" | "infeasible" | "bounded" (reliefMode)
result.value;         // optimal total profit
result.choices;       // [{ groupId, optionId }, ...] — one per group
result.bounds;        // { lpUpper, greedyLower } — LP/Dantzig bracket
result.stats;         // reduction counts, dpRequired, dpCellsVisited, dpKernelUsed
result.frontier;      // (options.frontier) certified Pareto kinks of P*(w)
```

## Input domain

`weight` and `profit` are non-negative integers (validated; throws
`KnapsackValidationError` otherwise). "Choose nothing" semantics are
modeled explicitly with a zero-weight zero-profit option — tenacy's
purge. Capacity is a non-negative integer below 2²¹, and the problem must
satisfy the exactness envelope (Σ per-group max profits)·(largest
weight) < 2⁵³, and each group may carry at most 255 options (all
validated; throws `KnapsackValidationError` otherwise). Option ids must
be unique within a group; group ids globally unique.

## Pipeline

Each stage is the classical exact-MCKP lineage, adapted for small
instances re-solved every turn (full survey with sources in
[`docs/survey.md`](docs/survey.md)):

1. **Validate** — structure and integer-domain enforcement.
2. **Pareto reduction** — within-group dominance: an option dominated in
   both weight and profit can never be chosen; exact, safe for the final
   search.
3. **LP relaxation on convex hulls** (Dyer–Zemel parametrization) — walk
   the hulls' incremental segments in density order using integer
   cross-product comparisons; yields the Dantzig upper bound, a greedy
   integral incumbent, and the break gradient. No floats touch any
   decision.
4. **Fathom** — drop hull options whose optimistic completion (base
   profits + λ_max slack bound, integer form) cannot reach the incumbent.
5. **Exact DP** — two-row `Int32Array` Bellman with reachable-weight
   windowing; skipped entirely when the LP solution is integral (the
   greedy walk consumed every segment — a certificate of optimality).
   Memory is budget-dispatched: when the back-pointer table would exceed
   50 MiB the DP switches to a divide-and-conquer traceback (Hirschberg
   shape) that uses only four `O(C)` rows — peak stays bounded at any
   input size the validation envelope admits, at ≤ 2× time (measured +2%
   at the largest benchmark shape).

## Memory

Peak DP allocation is predictable at solve time:
`expectedDpBytes(n, C) = n·(C+1) + 8·(C+1)` bytes in back-pointer mode
(u8 table). This formula is pinned by test (exact-change detector); the
budget dispatch it feeds is covered through the public `solve()` entry
(`test/adversarial.test.ts`). Two regimes: under the budget
(default 50 MiB), back-pointer mode uses exactly
`expectedDpBytes(n, C)` bytes; above it, the solver automatically uses
the O(C)-memory divide-and-conquer traceback — exact, deterministic,
≤ 2× time — so worst-case memory stays under `16·(C+1)` bytes no
matter how many groups the caller brings. `SolveOptions.maxDpBytes`
tunes the dispatch line; `reliefMode: "bounded"` swaps the over-budget
DP for the certified greedy incumbent with honest bounds instead.
Determinism: no locale collation, no float ordering, no unordered
iteration in any decision path. Same input, byte-identical output, every
run.

## Performance

Measured on this machine (Mac Studio M4 Max, Bun 1.3.14), median
per-solve:

| shape | time | DP invoked |
|---|---|---|
| 20 groups × 3 options, w≤400 | 61 µs | 51% |
| 60 groups × 5 options, w≤600 | 91 µs | 3% |
| 120 groups × 6 options, w≤800 | 4.1 ms | 52% |
| 40 groups × 4 options, cap ≈42k (wide) | 706 µs | 26% |
| 30 groups × 3 options, roomy capacity | 11 µs | 0% |

Correctness gate: every release is cross-checked against exhaustive
brute force on randomized instances — a 600-seed adversarial battery
(strongly-correlated, coarse-weight, and profit-cliff styles; tight,
medium, and roomy capacities; infeasibility agreement; replay-hash
determinism) plus a 300-seed uniform battery, all committed in
`test/adversarial.test.ts` and `test/solver.test.ts` and run in CI.

## Native kernel

`solve()` prefers a compiled SIMD kernel (Rust cdylib, `native/`) when a
prebuilt library for the host triple exists. All five triples ship
in-tree under `native/prebuilt/` (aarch64/x86_64 Apple, aarch64/x86_64
Linux, x86_64 Windows), built by the `Ship Native` GitHub workflow on
native runners with a pinned rustc — the workflow verifies every
committed binary byte-for-byte against a fresh build and runs the Bun
differential before any PR with native changes can merge (baseline
vector widths: NEON on aarch64, SSE2-class on x86_64 — no AVX
assumptions). If the dylib is absent, unloadable, or the runtime is not
Bun, the TypeScript SoA kernel serves the answer with identical outputs
(differential-proven: 500 problems, value/weight/choices/cellsVisited).
`stats.dpKernelUsed` reports which path ran
("native" | "soa" | "reference" | "none"). `dpKernel: "reference"`
opts out; `dpKernel: "soa"` pins the TypeScript path explicitly.
`KNAPSACK_NATIVE_DYLIB` overrides the dylib path (testing).

Provenance for prebuilt binaries (toolchain, sha256, source hash —
regenerated by the same workflow): `native/prebuilt/PROVENANCE.md`.

## Development

```sh
bun install
bun run typecheck   # bunx tsc --noEmit, strictest flags
bun test            # 1,280 tests incl. the 600-seed adversarial cross-check
bun run bench       # the numbers above
```

## Documentation

- **[docs/paper.md](docs/paper.md)** — the scientific write-up: problem
  statement, algorithm, correctness propositions, adversarial validation,
  measured results.
- **[docs/research/](docs/research/)** — the full research corpus this
  implementation was extracted from.
- **[docs/future-work.md](docs/future-work.md)** — five goal tracks
  (performance, product readiness, confidence, consumer integration,
  research); each item carries a build-when trigger, an estimate, or a
  revisit condition, and declined alternatives keep their reasoning.
- **[CHANGELOG.md](CHANGELOG.md)** — Keep-a-Changelog format.

## License

MIT — see [LICENSE](LICENSE).
