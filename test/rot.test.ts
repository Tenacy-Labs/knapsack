import { describe, expect, test } from "bun:test";
import { solveRot, DEFAULT_ROT } from "../src/rot.ts";

/** README quick-start corpus. C=800; frontier kinks at 0/55/60/115/440/800. */
const readme = {
  groups: [
    { id: "file:src/lp.ts", options: [
      { id: "full", weight: 420, profit: 90 },
      { id: "outline", weight: 60, profit: 55 },
      { id: "purge", weight: 0, profit: 0 },
    ] },
    { id: "file:src/dp.ts", options: [
      { id: "full", weight: 380, profit: 84 },
      { id: "outline", weight: 55, profit: 48 },
      { id: "purge", weight: 0, profit: 0 },
    ] },
  ],
  capacity: 800,
} as const;

describe("solveRot (ADR-0001 convenience layer)", () => {
  test("default rot (rot-default-v1) picks the interior operating point", () => {
    const r = solveRot(readme);
    expect(r.status).toBe("optimal");
    expect(r.rot).toEqual(DEFAULT_ROT);
    expect(DEFAULT_ROT).toEqual({ kneeFraction: 0.4, kneeRetention: 0.95, floorRetention: 0.5 });
    // Scan: U(440)=0.8375*139=116.4125 beats U(115)=101.149 and U(800)=87
    // — the mixed outline/full layout wins over the classical full render.
    expect(r.operatingWeight).toBe(440);
    expect(r.value).toBe(139); // certified re-solve at capacity 440
    expect(r.choices).toEqual([
      { groupId: "file:src/lp.ts", optionId: "outline" },
      { groupId: "file:src/dp.ts", optionId: "full" },
    ]);
    expect(r.rotAdjustedValue).toBeCloseTo(116.4125, 6);
    expect(r.frontier!.length).toBe(6); // frontier always exposed
  });

  test("mild rot keeps the classical optimum; params change the outcome", () => {
    const r = solveRot(readme, { rot: { kneeFraction: 0.9, kneeRetention: 0.99, floorRetention: 0.95 } });
    expect(r.operatingWeight).toBe(800); // U(800)=0.95*174=165.3 wins
    expect(r.value).toBe(174);
    expect(r.rotAdjustedValue).toBeCloseTo(165.3, 6);
  });

  test("zero-profit problem degenerates to the purge layout at w*=0", () => {
    const r = solveRot({
      groups: [{ id: "g", options: [{ id: "purge", weight: 0, profit: 0 }] }],
      capacity: 100,
    });
    expect(r.status).toBe("optimal");
    expect(r.operatingWeight).toBe(0);
    expect(r.value).toBe(0);
    expect(r.choices).toEqual([{ groupId: "g", optionId: "purge" }]);
  });

  test("infeasible mirrors solve(): status/choices, zeroed rot fields", () => {
    const r = solveRot({
      groups: [{ id: "g", options: [{ id: "heavy", weight: 5000, profit: 1 }] }],
      capacity: 10,
    });
    expect(r.status).toBe("infeasible");
    expect(r.choices).toBeNull();
    expect(r.operatingWeight).toBe(0);
    expect(r.rotAdjustedValue).toBe(0);
    expect(r.rot).toEqual(DEFAULT_ROT);
  });

  test("headroom H(C-w) shifts the pick toward shorter layouts", () => {
    // U(w) = rho(w)*P*(w) + 0.3*(800-w): U(115)=101.1+205.5=306.6 beats
    // U(440)=116.4+108=224.4 — the pick pulls back from 440 to 115.
    const r = solveRot(readme, { headroom: (freed) => 0.3 * freed });
    expect(r.operatingWeight).toBe(115);
    expect(r.value).toBe(103);
  });

  test("capacity 0 is in-contract: finite scan output", () => {
    // M1: capacity 0 → knee=0 → 0/0=NaN → rotAdjustedValue -Infinity.
    const a = solveRot({ groups: [{ id: "g", options: [{ id: "purge", weight: 0, profit: 0 }] }], capacity: 0 });
    expect(a.status).toBe("optimal");
    expect(a.rotAdjustedValue).toBe(0);
    const b = solveRot({ groups: [{ id: "g", options: [{ id: "free", weight: 0, profit: 42 }] }], capacity: 0 });
    expect(b.value).toBe(42);
    expect(b.rotAdjustedValue).toBe(42);
  });

  test("no-purge zero-profit: feasible stays feasible at the min-weight floor", () => {
    // M2A: default params, zero caller config. solve() finds a layout;
    // solveRot() must not call a feasible problem infeasible.
    const r = solveRot({ groups: [{ id: "g", options: [{ id: "heavy", weight: 5000, profit: 0 }] }], capacity: 8000 });
    expect(r.status).toBe("optimal");
    expect(r.choices).toEqual([{ groupId: "g", optionId: "heavy" }]);
    expect(r.operatingWeight).toBe(5000);
    expect(r.rotAdjustedValue).toBe(0);
  });

  test("no-purge + headroom: scan maximizes over attainable points only", () => {
    // M2B: H=0.9/token prices fictional w=0 (U=720) over w=200; w=0 is
    // unattainable — no group has a zero-weight option. w*=200 wins.
    const r = solveRot({
      groups: [
        { id: "a", options: [{ id: "x", weight: 100, profit: 50 }] },
        { id: "b", options: [{ id: "y", weight: 100, profit: 50 }] },
      ],
      capacity: 800,
    }, { headroom: (f) => 0.9 * f });
    expect(r.status).toBe("optimal");
    expect(r.operatingWeight).toBe(200);
    expect(r.value).toBe(100);
  });

  test("non-finite headroom values throw", () => {
    expect(() => solveRot(readme, { headroom: () => NaN })).toThrow();
    expect(() => solveRot(readme, { headroom: (f) => (f > 700 ? Infinity : 0.3 * f) })).toThrow();
  });

  test("returned rot is frozen; NaN rot params throw", () => {
    const r = solveRot(readme);
    expect(Object.isFrozen(r.rot)).toBe(true);
    expect(() => solveRot(readme, { rot: { kneeFraction: NaN, kneeRetention: 0.95, floorRetention: 0.5 } })).toThrow();
  });
});
