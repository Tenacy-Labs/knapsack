import { describe, expect, test } from "bun:test";
import { solve } from "../src/solve.ts";
import type { KnapsackGroup } from "../src/types.ts";

/**
 * ADR-0001 frontier exposure (ledger I3): `frontier` on the result when
 * requested via options. Kinks of P*(w) from the DP's value row over
 * dominance-reduced groups (fathoming is capacity-specific and therefore
 * frontier-unsafe; dominance is capacity-independent and safe).
 */
describe("frontier exposure (ADR-0001)", () => {
  const groups: KnapsackGroup[] = [
    { id: "system", options: [
      { id: "purge", weight: 0, profit: 0 },
      { id: "full", weight: 300, profit: 40 },
    ] },
    { id: "history", options: [
      { id: "purge", weight: 0, profit: 0 },
      { id: "summary", weight: 200, profit: 24 },
      { id: "full", weight: 700, profit: 60 },
    ] },
    { id: "files", options: [
      { id: "purge", weight: 0, profit: 0 },
      { id: "lean", weight: 150, profit: 20 },
      { id: "full", weight: 500, profit: 48 },
    ] },
  ];

  test("absent by default; present when requested; infeasible degenerates to [{0,0}]", () => {
    const plain = solve({ groups, capacity: 1000 });
    expect(plain.frontier).toBeUndefined();

    const r = solve({ groups, capacity: 1000 }, { frontier: true });
    expect(Array.isArray(r.frontier)).toBe(true);

    const inf = solve(
      { groups: [{ id: "g", options: [{ id: "heavy", weight: 5000, profit: 1 }] }], capacity: 10 },
      { frontier: true },
    );
    expect(inf.status).toBe("infeasible");
    expect(inf.frontier).toEqual([{ weight: 0, value: 0 }]);
  });

  test("starts at {0,0}, strictly increasing value, ascending weight, ends at the optimum", () => {
    const r = solve({ groups, capacity: 1000 }, { frontier: true });
    const f = r.frontier!;
    expect(f[0]).toEqual({ weight: 0, value: 0 });
    for (let i = 1; i < f.length; i++) {
      expect(f[i]!.weight).toBeGreaterThan(f[i - 1]!.weight);
      expect(f[i]!.value).toBeGreaterThan(f[i - 1]!.value);
    }
    const last = f[f.length - 1]!;
    expect(last.value).toBe(r.value);
    expect(last.weight).toBeLessThanOrEqual(1000);
  });

  test("capacity-sweep oracle: frontier kinks dominate every solve(w) and match P*(w) exactly", () => {
    const f = solve({ groups, capacity: 1000 }, { frontier: true }).frontier!;
    const pstar = (w: number): number => {
      let best = 0;
      for (const p of f) if (p.weight <= w && p.value > best) best = p.value;
      return best;
    };
    for (let w = 0; w <= 1000; w++) {
      const s = solve({ groups, capacity: w });
      expect(s.value).toBe(pstar(w));
    }
  });

  test("fathom-safety: an option fathomed at C is still reachable on the frontier at lower w", () => {
    // Reviewer-derived "bite" corpus: 2 options genuinely fathomed at
    // C=1000 (optionsAfterFathoming 7 < optionsAfterDominance 9, DP path).
    // Under a fathom-UNsafe refactor (frontier from fathomed sets), 10 of
    // these 14 kinks vanish and this test fails. Preconditions asserted.
    const g: KnapsackGroup[] = [
      { id: "A", options: [
        { id: "purge", weight: 0, profit: 0 },
        { id: "mid", weight: 100, profit: 11 },
        { id: "full", weight: 850, profit: 120 },
      ] },
      { id: "B", options: [
        { id: "purge", weight: 0, profit: 0 },
        { id: "small", weight: 120, profit: 14 },
        { id: "big", weight: 400, profit: 40 },
      ] },
      { id: "C", options: [
        { id: "purge", weight: 0, profit: 0 },
        { id: "x", weight: 220, profit: 25 },
        { id: "y", weight: 500, profit: 51 },
      ] },
    ];
    const pre = solve({ groups: g, capacity: 1000 });
    expect(pre.stats.optionsAfterFathoming).toBeLessThan(pre.stats.optionsAfterDominance);
    expect(pre.stats.dpRequired).toBe(true);
    const fr = solve({ groups: g, capacity: 1000 }, { frontier: true }).frontier!;
    for (const kink of [{ w: 100, v: 11 }, { w: 120, v: 14 }, { w: 220, v: 25 }]) {
      expect(fr.some((p) => p.weight === kink.w && p.value === kink.v)).toBe(true);
    }
  });

  test("free-profit shapes: lead point carries P*(0); last point is the classical optimum", () => {
    // Review M2: zero-weight positive-profit options. The frontier must be
    // a sufficient statistic for the U(w) scan even here.
    const r = solve({
      groups: [
        { id: "A", options: [{ id: "free", weight: 0, profit: 5 }] },
        { id: "B", options: [{ id: "purge", weight: 0, profit: 0 }] },
      ],
      capacity: 100,
    }, { frontier: true });
    expect(r.frontier).toEqual([{ weight: 0, value: 5 }]);
    expect(r.frontier![r.frontier!.length - 1]!.value).toBe(r.value);

    const r2 = solve({
      groups: [
        { id: "A", options: [{ id: "free", weight: 0, profit: 5 }] },
        { id: "B", options: [
          { id: "purge", weight: 0, profit: 0 },
          { id: "x", weight: 50, profit: 9 },
        ] },
      ],
      capacity: 100,
    }, { frontier: true });
    // P*(0) = 5 (free alone; groups are disjoint so B purges), P*(50) = 14
    // = optimum (free + x, additive across groups).
    expect(r2.frontier).toEqual([
      { weight: 0, value: 5 },
      { weight: 50, value: 14 },
    ]);
    const s = solve({
      groups: [
        { id: "A", options: [{ id: "free", weight: 0, profit: 5 }] },
        { id: "B", options: [
          { id: "purge", weight: 0, profit: 0 },
          { id: "x", weight: 50, profit: 9 },
        ] },
      ],
      capacity: 10,
    });
    expect(s.value).toBe(5); // oracle: solve(10) agrees with the lead point
  });
});
