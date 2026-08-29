// Bounded relief mode (2026-08-24) contract tests — review round 4 M1:
// the mode had ZERO coverage, which let the bounded return path omit
// the frontier (documented "present iff options.frontier", types.ts).
// Pins: status/value honesty, bracket, stats, choice feasibility, the
// frontier contract, below-budget equivalence with exact mode, and the
// frontier + over-budget (D&C reference) combination.
import { describe, expect, test } from "bun:test";
import { solve } from "../src/solve.ts";
import { expectedDpBytes } from "../src/dp.ts";
import type { KnapsackChoice, KnapsackProblem } from "../src/types.ts";

/** Deterministic problem that requires the DP (LP breaks fractionally). */
function dpProblem(): KnapsackProblem {
  const groups = [];
  for (let g = 0; g < 14; g++) {
    const options = [];
    for (let o = 0; o < 5; o++) {
      const w = 40 + o * 45 + ((g * 7 + o * 13) % 11);
      options.push({ id: "o" + o, weight: w, profit: w * 2 - (o * (g % 3)) });
    }
    groups.push({ id: "g" + g, options });
  }
  return { groups, capacity: 700 };
}

function totalWeight(p: KnapsackProblem, choices: readonly KnapsackChoice[]): number {
  let weight = 0;
  const byGroup = new Map(p.groups.map((g) => [g.id, g]));
  for (const c of choices) weight += byGroup.get(c.groupId)!.options.find((o) => o.id === c.optionId)!.weight;
  return weight;
}

describe("solve — reliefMode bounded (over budget: certified incumbent)", () => {
  const problem = dpProblem();
  // Force the bounded path: budget below expectedDpBytes(n, C).
  const tinyBudget = 1024;

  test("status bounded, never optimal; stats say no DP ran", () => {
    const r = solve(problem, { reliefMode: "bounded", maxDpBytes: tinyBudget });
    expect(r.status).toBe("bounded");
    expect(r.stats.dpRequired).toBe(false);
    expect(r.stats.dpKernelUsed).toBe("none");
    expect(r.stats.dpCellsVisited).toBe(0);
    expect(r.choices).not.toBeNull();
  });

  test("choices are feasible and realize the reported value", () => {
    const r = solve(problem, { reliefMode: "bounded", maxDpBytes: tinyBudget });
    expect(r.choices)!.toHaveLength(problem.groups.length);
    expect(totalWeight(problem, r.choices!)).toBeLessThanOrEqual(problem.capacity);
    let profit = 0;
    const byGroup = new Map(problem.groups.map((g) => [g.id, g]));
    for (const c of r.choices!) {
      profit += byGroup.get(c.groupId)!.options.find((o) => o.id === c.optionId)!.profit;
    }
    expect(profit).toBe(r.value);
  });

  test("bounds bracket OPT: greedyLower == value, lpUpper >= exact value", () => {
    const bounded = solve(problem, { reliefMode: "bounded", maxDpBytes: tinyBudget });
    const exact = solve(problem, { reliefMode: "exact" });
    expect(exact.status).toBe("optimal"); // premise: the exact DP would run
    expect(bounded.bounds.greedyLower).toBe(bounded.value);
    expect(bounded.value).toBeLessThanOrEqual(exact.value);
    expect(bounded.bounds.lpUpper + 1e-9).toBeGreaterThanOrEqual(exact.value);
  });

  test("frontier contract: present iff requested (review round 4 M1)", () => {
    const withFrontier = solve(problem, { reliefMode: "bounded", maxDpBytes: tinyBudget, frontier: true });
    const without = solve(problem, { reliefMode: "bounded", maxDpBytes: tinyBudget });
    expect(withFrontier.frontier).toBeDefined();
    expect(withFrontier.frontier!.length).toBeGreaterThan(0);
    expect(withFrontier.frontier![0]).toEqual({ weight: 0, value: 0 });
    expect(without.frontier).toBeUndefined();
  });

  test("bounded frontier equals exact-mode frontier (budget-independent sweep)", () => {
    const bounded = solve(problem, { reliefMode: "bounded", maxDpBytes: tinyBudget, frontier: true });
    const exact = solve(problem, { frontier: true });
    expect(JSON.stringify(bounded.frontier)).toBe(JSON.stringify(exact.frontier));
  });

  test("below budget: bounded is identical to exact (gate never fires)", () => {
    const under = solve(problem, {
      reliefMode: "bounded",
      maxDpBytes: expectedDpBytes(problem.groups.length, problem.capacity) + 1,
    });
    const exact = solve(problem);
    expect(under.status).toBe("optimal");
    expect(JSON.stringify(under)).toBe(JSON.stringify(exact));
  });
});

describe("solve — frontier + over-budget reference D&C combination", () => {
  test("frontier survives the divide-and-conquer dispatch (no back-pointers)", () => {
    const problem = dpProblem();
    // Over budget but EXACT mode: solveDp routes to the O(C)-memory
    // divide-and-conquer; frontier must still be present and correct.
    const r = solve(problem, {
      maxDpBytes: 1024,
      dpKernel: "reference",
      frontier: true,
    });
    expect(r.status).toBe("optimal");
    expect(r.frontier).toBeDefined();
    // Kinks: ascending weight, strictly increasing value, last = optimum.
    const f = r.frontier!;
    for (let i = 1; i < f.length; i++) {
      expect(f[i]!.weight).toBeGreaterThan(f[i - 1]!.weight);
      expect(f[i]!.value).toBeGreaterThan(f[i - 1]!.value);
    }
    expect(f[f.length - 1]!.value).toBe(r.value);
    // The same problem solved without the budget squeeze agrees.
    const roomy = solve(problem, { frontier: true });
    expect(JSON.stringify(r.frontier)).toBe(JSON.stringify(roomy.frontier));
    expect(r.value).toBe(roomy.value);
  });
});
