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

  test("invalid rot params throw", () => {
    const ok = { kneeRetention: 0.95, floorRetention: 0.5 } as const;
    expect(() => solveRot(readme, { rot: { kneeFraction: 0, ...ok } })).toThrow();
    expect(() => solveRot(readme, { rot: { kneeFraction: 1, ...ok } })).toThrow();
    expect(() => solveRot(readme, { rot: { kneeFraction: 0.4, kneeRetention: 0.5, floorRetention: 0.9 } })).toThrow();
    expect(() => solveRot(readme, { rot: { kneeFraction: 0.4, kneeRetention: 1.2, floorRetention: 0.5 } })).toThrow();
    expect(() => solveRot(readme, { rot: { kneeFraction: 0.4, kneeRetention: 0.95, floorRetention: 0 } })).toThrow();
  });
});
