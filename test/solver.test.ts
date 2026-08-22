import { describe, expect, test } from "bun:test";
import { solve, KnapsackProblem } from "../src/index.ts";

/** Deterministic PRNG (mulberry32) so failures reproduce exactly. */
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

interface BruteResult {
  best: number;
  feasible: boolean;
}

/** Exhaustive optimum: every combination of one option per group. */
function bruteForce(p: KnapsackProblem): BruteResult {
  let best = -Infinity;
  let feasible = false;
  const combo: number[] = new Array(p.groups.length).fill(0);
  const n = p.groups.length;

  const rec = (gi: number, weight: number, profit: number): void => {
    if (gi === n) {
      feasible = feasible || weight <= p.capacity;
      if (weight <= p.capacity && profit > best) best = profit;
      return;
    }
    for (const o of p.groups[gi]!.options) {
      combo[gi] = o.weight;
      rec(gi + 1, weight + o.weight, profit + o.profit);
    }
  };
  rec(0, 0, 0);
  return { best, feasible };
}

/** Verify the returned choices are valid: one per group, weight <= capacity, value matches. */
function checkChoicesValid(p: KnapsackProblem, result: ReturnType<typeof solve>): void {
  expect(result.status).toBe("optimal");
  const choices = result.choices!;
  expect(choices.length).toBe(p.groups.length);
  let weight = 0;
  let value = 0;
  for (let i = 0; i < choices.length; i++) {
    const g = p.groups[i]!;
    const c = choices[i]!;
    expect(c.groupId).toBe(g.id);
    const opt = g.options.find((o) => o.id === c.optionId);
    expect(opt).toBeDefined();
    weight += opt!.weight;
    value += opt!.profit;
  }
  expect(weight).toBeLessThanOrEqual(p.capacity);
  expect(value).toBe(result.value);
}

describe("solve — randomized brute-force cross-check", () => {
  for (let seed = 1; seed <= 300; seed++) {
    test(`seed ${seed}`, () => {
      const r = rng(seed);
      const nGroups = 2 + Math.floor(r() * 4); // 2..5 groups
      const groups = Array.from({ length: nGroups }, (_, gi) => ({
        id: `g${gi}`,
        options: Array.from(
          { length: 1 + Math.floor(r() * 5) }, // 1..5 options
          (_, oi) => ({
            id: `o${oi}`,
            weight: Math.floor(r() * 30), // 0..29
            profit: Math.floor(r() * 100), // 0..99
          }),
        ),
      }));
      const minW = groups.reduce(
        (s, g) => s + Math.min(...g.options.map((o) => o.weight)),
        0,
      );
      const maxW = groups.reduce(
        (s, g) => s + Math.max(...g.options.map((o) => o.weight)),
        0,
      );
      const capacity = minW + Math.floor(r() * (maxW - minW + 10));
      const problem: KnapsackProblem = { groups, capacity };

      const expected = bruteForce(problem);
      const result = solve(problem);

      if (!expected.feasible || expected.best === -Infinity) {
        // min-weight sum exceeds capacity
        expect(result.status).toBe("infeasible");
        return;
      }
      checkChoicesValid(problem, result);
      expect(result.value).toBe(expected.best);
      // Bounds must bracket the optimum.
      expect(result.bounds!.greedyLower).toBeLessThanOrEqual(result.value);
      expect(result.bounds!.lpUpper).toBeGreaterThanOrEqual(result.value - 1e-9);
    });
  }
});

describe("solve — determinism", () => {
  test("identical problems yield byte-identical choices", () => {
    const r = rng(4242);
    const problem: KnapsackProblem = {
      groups: Array.from({ length: 12 }, (_, gi) => ({
        id: `g${gi}`,
        options: Array.from({ length: 4 }, (_, oi) => ({
          id: `o${oi}`,
          weight: Math.floor(r() * 200),
          profit: Math.floor(r() * 500),
        })),
      })),
      capacity: 800,
    };
    const a = solve(problem);
    const b = solve(problem);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("solve — edge cases", () => {
  test("infeasible when min weights exceed capacity", () => {
    const result = solve({
      groups: [
        { id: "a", options: [{ id: "x", weight: 10, profit: 5 }] },
        { id: "b", options: [{ id: "y", weight: 10, profit: 5 }] },
      ],
      capacity: 15,
    });
    expect(result.status).toBe("infeasible");
    expect(result.choices).toBeNull();
  });

  test("capacity 0 with zero-weight options is feasible", () => {
    const result = solve({
      groups: [
        { id: "a", options: [{ id: "free", weight: 0, profit: 7 }] },
        { id: "b", options: [{ id: "free", weight: 0, profit: 3 }] },
      ],
      capacity: 0,
    });
    expect(result.status).toBe("optimal");
    expect(result.value).toBe(10);
  });

  test("zero-capacity purge-only problem picks zero-weight options", () => {
    const result = solve({
      groups: [
        {
          id: "a",
          options: [
            { id: "purge", weight: 0, profit: 0 },
            { id: "keep", weight: 5, profit: 9 },
          ],
        },
      ],
      capacity: 0,
    });
    expect(result.status).toBe("optimal");
    expect(result.value).toBe(0);
    expect(result.choices![0]!.optionId).toBe("purge");
  });

  test("LP gap zero skips the DP", () => {
    const result = solve({
      groups: [
        {
          id: "a",
          options: [
            { id: "small", weight: 1, profit: 1 },
            { id: "big", weight: 2, profit: 2 },
          ],
        },
      ],
      capacity: 100, // everything fits; LP integral
    });
    expect(result.status).toBe("optimal");
    expect(result.value).toBe(2);
    expect(result.stats!.dpRequired).toBe(false);
  });

  test("validation rejects negative/float weights", () => {
    expect(() =>
      solve({
        groups: [{ id: "a", options: [{ id: "x", weight: -1, profit: 1 }] }],
        capacity: 5,
      }),
    ).toThrow(/weight/);
    expect(() =>
      solve({
        groups: [{ id: "a", options: [{ id: "x", weight: 1.5, profit: 1 }] }],
        capacity: 5,
      }),
    ).toThrow(/weight/);
    expect(() =>
      solve({
        groups: [{ id: "a", options: [{ id: "x", weight: 1, profit: 1 }] }],
        capacity: -5,
      }),
    ).toThrow(/capacity/);
  });
});

describe("dominance — hull reduction", () => {
  test("dominated options vanish", async () => {
    const { reduceGroupToHull } = await import("../src/dominance.ts");
    const hull = reduceGroupToHull({
      id: "g",
      options: [
        { id: "bad-heavy-poor", weight: 10, profit: 1 }, // dominated by light-rich
        { id: "light-rich", weight: 3, profit: 9 },
        { id: "mid", weight: 5, profit: 6 },
        { id: "heavy-best", weight: 12, profit: 20 },
        { id: "dominated-tie", weight: 5, profit: 5 }, // dominated by mid
      ],
    });
    const ids = hull.options.map((o) => o.id);
    // mid(5,6) IS dominated: light-rich(3,9) has lower weight AND higher profit.
    expect(ids).toEqual(["light-rich", "heavy-best"]);
    // Hull invariants: weight strictly increasing, profit strictly increasing.
    for (let i = 1; i < hull.options.length; i++) {
      expect(hull.options[i]!.weight).toBeGreaterThan(hull.options[i - 1]!.weight);
      expect(hull.options[i]!.profit).toBeGreaterThan(hull.options[i - 1]!.profit);
    }
  });
});
