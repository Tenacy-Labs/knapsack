import { solve } from "./solve.ts";
import type { KnapsackProblem, KnapsackChoice, KnapsackBounds, KnapsackStats, FrontierPoint } from "./types.ts";

/** ADR-0001 §5: monotone piecewise-linear retention spline, hinge (m=2)
 *  parameterization. Floats live HERE ONLY, in the scan that picks the
 *  operating point; certification stays the integer re-solve. */
export interface RotParams {
  /** Knee location as a fraction of capacity: 0 < kneeFraction < 1. */
  readonly kneeFraction: number;
  /** Retention at the knee: 0 < kneeRetention < 1. */
  readonly kneeRetention: number;
  /** Retention at full capacity: 0 < floorRetention <= kneeRetention. */
  readonly floorRetention: number;
}

/** rot-default-v1 (ADR-0001 §6): knee 0.40·C, rho(knee)=0.95,
 *  rho(C)=0.50. Conservative by the asymmetric-loss principle:
 *  under-priced rot = past the cliff = catastrophic; over-priced rot =
 *  slightly short = cheap. */
export const DEFAULT_ROT: Readonly<RotParams> = Object.freeze({
  kneeFraction: 0.4,
  kneeRetention: 0.95,
  floorRetention: 0.5,
});

export interface RotSolveOptions {
  /** Retention spline parameters; defaults to rot-default-v1. */
  readonly rot?: RotParams;
  /** Optional per-freed-token utility of unused capacity: U(w) gains
   *  + H(C - w). The consumer's headroom value model. */
  readonly headroom?: (freedTokens: number) => number;
}

export interface RotSolveResult {
  readonly status: "optimal" | "infeasible";
  /** Certified best value AT the operating weight (integer, exact). */
  readonly value: number;
  readonly choices: readonly KnapsackChoice[] | null;
  /** Bounds/stats of the certified re-solve at capacity = operatingWeight. */
  readonly bounds: KnapsackBounds;
  readonly stats: KnapsackStats;
  /** The full-capacity Pareto frontier the scan ran over. */
  readonly frontier: readonly FrontierPoint[];
  /** The scan's pick: the w maximizing U(w) = rho(w)*P*(w) + H(C-w). */
  readonly operatingWeight: number;
  /** rho(w*)*P*(w*) + H(C-w*): the scan's objective at the pick (float). */
  readonly rotAdjustedValue: number;
  /** The rot params used (explicit or rot-default-v1). */
  readonly rot: RotParams;
}
function validateRot(rot: RotParams): void {
  if (!(rot.kneeFraction > 0 && rot.kneeFraction < 1)) {
    throw new Error("rot.kneeFraction must be in (0, 1)");
  }
  if (!(rot.kneeRetention > 0 && rot.kneeRetention < 1)) {
    throw new Error("rot.kneeRetention must be in (0, 1)");
  }
  if (!(rot.floorRetention > 0 && rot.floorRetention < 1)) {
    throw new Error("rot.floorRetention must be in (0, 1)");
  }
  if (rot.floorRetention > rot.kneeRetention) {
    throw new Error("rot.floorRetention must be <= kneeRetention");
  }
}

/** rho(w) for the hinge parameterization (valid rot assumed). */
function retention(rot: RotParams, capacity: number, w: number): number {
  const knee = rot.kneeFraction * capacity;
  if (w <= knee) {
    return 1 - (1 - rot.kneeRetention) * (w / knee);
  }
  const t = (w - knee) / (capacity - knee);
  return Math.max(rot.floorRetention, rot.kneeRetention - (rot.kneeRetention - rot.floorRetention) * t);
}

/** Solve with context rot priced consumer-side (ADR-0001 framing A):
 *  scan the certified frontier under rho, pick w*, re-solve exactly at
 *  w*. Floats never touch certification. */
export function solveRot(
  problem: KnapsackProblem,
  options?: RotSolveOptions,
): RotSolveResult {
  const rot = options?.rot ?? DEFAULT_ROT;
  validateRot(rot);
  const base = solve(problem, { frontier: true });
  if (base.status === "infeasible") {
    return {
      status: "infeasible",
      value: 0,
      choices: null,
      bounds: base.bounds,
      stats: base.stats,
      frontier: base.frontier!,
      operatingWeight: 0,
      rotAdjustedValue: 0,
      rot,
    };
  }
  const capacity = problem.capacity;
  const H = options?.headroom;
  let bestW = 0;
  let bestU = -Infinity;
  for (const p of base.frontier!) {
    const u = retention(rot, capacity, p.weight) * p.value + (H ? H(capacity - p.weight) : 0);
    if (u > bestU) {
      bestU = u;
      bestW = p.weight;
    }
  }
  const resolved = solve({ ...problem, capacity: bestW });
  return {
    status: resolved.status,
    value: resolved.value,
    choices: resolved.choices,
    bounds: resolved.bounds,
    stats: resolved.stats,
    frontier: base.frontier!,
    operatingWeight: bestW,
    rotAdjustedValue: bestU,
    rot,
  };
}
