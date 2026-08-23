import { describe, expect, test } from "bun:test";
import { solve, type KnapsackProblem } from "../src/index.ts";

/**
 * Adversarial cross-check battery (docs/paper.md §7.1, committed here so
 * the claim is reproducible from the repo).
 *
 * 600 seeds; per seed one of four adversarial styles at one of three
 * capacity regimes. Checks per instance:
 *  - reported value equals the exhaustive brute-force optimum
 *    (or infeasibility agreement);
 *  - returned choices are feasible and realize the reported value;
 *  - bounds bracket the optimum (an invalid bound is a bug even when
 *    the value is right);
 *  - replay determinism: a second solve serializes byte-identically.
 *
 * The infeasible contract is asserted on every infeasible instance:
 * choices === null, bounds and stats remain populated.
 */

/** Deterministic PRNG (mulberry32) so any failure reproduces from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Independent exhaustive oracle: enumerate every combination of one
 * option per group. Deliberately shares no code with src/.
 */
function bruteForce(p: KnapsackProblem): { best: number; feasible: boolean } {
  let best = -Infinity;
  let anyFeasible = false;
  const n = p.groups.length;
  const rec = (gi: number, weight: number, profit: number): void => {
    if (gi === n) {
      if (weight <= p.capacity) {
        anyFeasible = true;
        if (profit > best) best = profit;
      }
      return;
    }
    for (const o of p.groups[gi]!.options) {
      rec(gi + 1, weight + o.weight, profit + o.profit);
    }
  };
  rec(0, 0, 0);
  return { best, feasible: anyFeasible };
}

type Style = "correlated" | "coarse" | "cliff" | "uniform";
type Regime = "tight" | "medium" | "roomy";

const STYLES: readonly Style[] = ["correlated", "coarse", "cliff", "uniform"];
const REGIMES: readonly Regime[] = ["tight", "medium", "roomy"];

function buildInstance(seed: number): { problem: KnapsackProblem; style: Style; regime: Regime } {
  const r = rng(seed);
  const style = STYLES[seed % STYLES.length]!;
  const regime = REGIMES[seed % REGIMES.length]!;
  const nGroups = 2 + Math.floor(r() * 6); // 2..7 groups
  const groups = Array.from({ length: nGroups }, (_, gi) => {
    const nOpts = 1 + Math.floor(r() * 6); // 1..6 options
    const options = Array.from({ length: nOpts }, (_, oi) => {
      let weight: number;
      let profit: number;
      switch (style) {
        case "correlated": {
          // profit ≈ 3×weight ± small noise — classic bound-hardening family
          weight = Math.floor(r() * 30);
          profit = 3 * weight + Math.floor(r() * 5) - 2;
          break;
        }
        case "coarse": {
          // multiples of 10 — lattice alignment stress
          weight = 10 * Math.floor(r() * 4);
          profit = Math.floor(r() * 100);
          break;
        }
        case "cliff": {
          // later options at ~30% profit — dent-heavy Pareto shapes
          weight = Math.floor(r() * 25);
          profit = oi > 0 ? Math.max(0, Math.floor(r() * 100 * 0.3)) : Math.floor(r() * 100);
          break;
        }
        default: {
          weight = Math.floor(r() * 30);
          profit = Math.floor(r() * 100);
        }
      }
      // Clamp: validation requires weight ≥ 0, profit ≥ 0.
      weight = Math.max(0, weight);
      profit = Math.max(0, profit);
      return { id: `o${oi}`, weight, profit };
    });
    return { id: `g${gi}`, options };
  });
  const minW = groups.reduce((s, g) => s + Math.min(...g.options.map((o) => o.weight)), 0);
  const maxW = groups.reduce((s, g) => s + Math.max(...g.options.map((o) => o.weight)), 0);
  let capacity: number;
  switch (regime) {
    case "tight":
      // Within 10 of the minimum-weight sum, sometimes below it — the
      // infeasibility-agreement check needs instances on both sides.
      capacity = Math.max(0, minW + Math.floor(r() * 20) - 10);
      break;
    case "roomy":
      capacity = maxW;
      break;
    default:
      capacity = minW + Math.floor(r() * Math.max(1, maxW - minW));
  }
  return { problem: { groups, capacity }, style, regime };
}

/** Choices must be one per group, feasible, and realize the reported value. */
function checkChoicesValid(p: KnapsackProblem, result: ReturnType<typeof solve>): void {
  expect(result.choices).not.toBeNull();
  const byGroup = new Map(p.groups.map((g) => [g.id, g]));
  let weight = 0;
  let profit = 0;
  for (const c of result.choices!) {
    const g = byGroup.get(c.groupId);
    expect(g).toBeDefined();
    const opt = g!.options.find((o) => o.id === c.optionId);
    expect(opt).toBeDefined();
    weight += opt!.weight;
    profit += opt!.profit;
  }
  expect(result.choices!.length).toBe(p.groups.length);
  expect(weight).toBeLessThanOrEqual(p.capacity);
  expect(profit).toBe(result.value);
}

describe("solve — adversarial fuzz battery (600 seeds × 4 styles × 3 regimes)", () => {
  let feasibleCount = 0;
  let dpCount = 0;

  for (let seed = 1; seed <= 600; seed++) {
    test(`adversarial seed ${seed}`, () => {
      const { problem } = buildInstance(seed);
      const expected = bruteForce(problem);
      const result = solve(problem);
      const replay = solve(problem);

      // Replay determinism: identical problems serialize identically.
      expect(JSON.stringify(replay)).toBe(JSON.stringify(result));

      if (!expected.feasible) {
        // Infeasible contract: choices null; bounds/stats stay populated.
        expect(result.status).toBe("infeasible");
        expect(result.choices).toBeNull();
        expect(result.bounds).toEqual({ lpUpper: 0, greedyLower: 0 });
        expect(result.stats).not.toBeNull();
        expect(result.stats.dpRequired).toBe(false);
        expect(result.stats.dpCellsVisited).toBe(0);
        return;
      }
      feasibleCount++;
      if (result.stats.dpRequired) dpCount++;

      checkChoicesValid(problem, result);
      expect(result.value).toBe(expected.best);
      // Bounds must bracket the optimum.
      expect(result.bounds.greedyLower).toBeLessThanOrEqual(result.value);
      expect(result.bounds.lpUpper).toBeGreaterThanOrEqual(result.value - 1e-9);
    });
  }

  test("battery summary — both paths exercised", () => {
    // The battery must actually exercise feasible AND infeasible paths:
    // if either count collapses the generator drifted and the battery
    // silently weakened. 600-seed run on 2026-08-23: 512 feasible,
    // 88 infeasible, 233 DP-required.
    expect(feasibleCount).toBeGreaterThan(400);
    expect(600 - feasibleCount).toBeGreaterThan(50); // infeasible coverage
    expect(dpCount).toBeGreaterThan(100);
  });
});

describe("solve — infeasible result contract (regression)", () => {
  test("bounds and stats are populated on infeasible", () => {
    const problem: KnapsackProblem = {
      capacity: 5,
      groups: [{ id: "g", options: [{ id: "a", weight: 10, profit: 1 }] }],
    };
    const result = solve(problem);
    expect(result.status).toBe("infeasible");
    expect(result.choices).toBeNull();
    expect(result.value).toBe(0);
    expect(result.bounds).toEqual({ lpUpper: 0, greedyLower: 0 });
    expect(result.stats).toEqual({
      groups: 1,
      optionsTotal: 1,
      optionsAfterDominance: 1,
      optionsAfterFathoming: 1,
      dpRequired: false,
      dpCellsVisited: 0,
    });
  });
});

describe("solve — bounds bracket the optimum exactly", () => {
  test("lpUpper never rounds below the returned optimal value (ulp tie)", () => {
    // Fresh-context review finding (2026-08-23): on density ties the
    // naive (rem/dw)*dp float rounds 1 ulp below the exact integral
    // bound. Family: two segments of identical density 9; X is walked
    // first (input order), breaks with rem=7, dw=10, dp=90 → exact
    // bound 63, naive float 62.99999999999999.
    const problem: KnapsackProblem = {
      capacity: 7,
      groups: [
        { id: "X", options: [{ id: "x0", weight: 0, profit: 0 }, { id: "x1", weight: 10, profit: 90 }] },
        { id: "Y", options: [{ id: "y0", weight: 0, profit: 0 }, { id: "y1", weight: 7, profit: 63 }] },
      ],
    };
    const r = solve(problem);
    expect(r.value).toBe(63);
    expect(r.bounds.lpUpper).toBe(63);          // was 62.99999999999999
    expect(r.bounds.greedyLower).toBe(63);
    // The exported contract: greedyLower ≤ value ≤ lpUpper, exactly.
    expect(r.bounds.lpUpper).toBeGreaterThanOrEqual(r.value);
  });
});

describe("solve — maxDpBytes through the public entry", () => {
  test("tight budget dispatches D&C and returns identical results", () => {
    // DP-requiring instance (verified: LP gap non-zero forces the DP stage).
    // Classic gap shape: LP wants a fraction of the middle option, so the
    // integrality certificate cannot close it and the DP must run.
    const problem: KnapsackProblem = {
      capacity: 10,
      groups: [
        { id: "a", options: [{ id: "x", weight: 5, profit: 10 }, { id: "y", weight: 1, profit: 1 }] },
        { id: "b", options: [{ id: "x", weight: 5, profit: 10 }, { id: "y", weight: 1, profit: 1 }] },
        { id: "c", options: [{ id: "x", weight: 6, profit: 13 }, { id: "y", weight: 1, profit: 1 }] },
      ],
    };
    const r = solve(problem);
    expect(r.stats.dpRequired).toBe(true); // guard: this instance needs the DP
    const tight = solve(problem, { maxDpBytes: 1 }); // far below expected bytes
    expect(tight.value).toBe(r.value);
    expect(tight.choices).toEqual(r.choices);
    expect(JSON.stringify(tight)).not.toBe(JSON.stringify({})); // sanity
  });
});
