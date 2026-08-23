# @connectotron/knapsack

[![CI](https://github.com/Connectotron/knapsack/actions/workflows/ci.yml/badge.svg)](https://github.com/Connectotron/knapsack/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Connectotron/knapsack)](https://github.com/Connectotron/knapsack/releases)
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
| **Hot-loop fast** | 12 µs – 4.2 ms per solve at realistic shapes (median, measured) |
| **Zero dependencies** | pure TypeScript; the whole tarball is 34 kB |
| **Deterministic** | same input → byte-identical output, every run, forever |
| **Memory-bounded** | worst-case DP memory stays under `16·(C+1)` bytes at any input size |
| **Battle-tested** | 1,236 tests; ~92,000-instance adversarial fuzz vs brute force, zero wrong answers |

Born from [agent-kernel](https://github.com/Connectotron/agent-kernel)'s
per-turn context optimizer (ADR-0005: the render solve *is* an MCKP),
extracted as a standalone component for pure focus on mathematical
structure and implementation efficiency. First consumer: agent-kernel;
the library knows nothing about LLMs, tokens, or turns.

## Quick start

```sh
bun add github:Connectotron/knapsack
```

```ts
import { solve } from "@connectotron/knapsack";

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

Ships as TypeScript source (no build step under Bun; trivially
compilable with `tsc` for any runtime).

## The problem

```
maximize   Σ_i  p_i(x_i)          one option x_i per group i
subject to Σ_i  w_i(x_i) ≤ C      integer weights and profits
```

Agent-kernel's mapping: groups = context items, options = render variants,
weight = tokens, C = the turn budget, profit = utility.

## Input domain

`weight` and `profit` are non-negative integers (validated; throws
`KnapsackValidationError` otherwise). "Choose nothing" semantics are
modeled explicitly with a zero-weight zero-profit option — agent-kernel's
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
(`test/adversarial.test.ts`). Above a configurable budget (default
50 MiB) the solver automatically uses the O(C)-memory divide-and-conquer
traceback — exact, deterministic, ≤ 2× time — so worst-case memory stays
under `16·(C+1) + ε` bytes no matter how many groups the caller brings.

Determinism: no locale collation, no float ordering, no unordered
iteration in any decision path. Same input, byte-identical output, every
run.

## Performance

Measured on this machine (Mac Studio M4 Max, Bun 1.3.14), median
per-solve:

| shape | time | DP invoked |
|---|---|---|
| 20 groups × 3 options, w≤400 | 62 µs | 51% |
| 60 groups × 5 options, w≤600 | 91 µs | 3% |
| 120 groups × 6 options, w≤800 | 4.2 ms | 52% |
| 40 groups × 4 options, cap 8k (wide) | 703 µs | 26% |
| 30 groups × 3 options, roomy capacity | 12 µs | 0% |

Correctness gate: every release is cross-checked against exhaustive
brute force on randomized instances — a 600-seed adversarial battery
(strongly-correlated, coarse-weight, and profit-cliff styles; tight,
medium, and roomy capacities; infeasibility agreement; replay-hash
determinism) plus a 300-seed uniform battery, all committed in
`test/adversarial.test.ts` and `test/solver.test.ts` and run in CI.

## Development

```sh
bun install
bun run typecheck   # bunx tsc --noEmit, strictest flags
bun test            # 1,236 tests incl. the 600-seed adversarial cross-check
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
