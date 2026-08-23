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
    const g: KnapsackGroup[] = [
      { id: "A", options: [
        { id: "purge", weight: 0, profit: 0 },
        { id: "full", weight: 800, profit: 100 },
      ] },
      { id: "B", options: [
        { id: "purge", weight: 0, profit: 0 },
        { id: "small", weight: 100, profit: 10 },
        { id: "heavy", weight: 200, profit: 15 },
      ] },
    ];
    const r = solve({ groups: g, capacity: 1000 }, { frontier: true });
    expect(r.frontier!.some((p) => p.weight === 100 && p.value === 10)).toBe(true);
  });
});
