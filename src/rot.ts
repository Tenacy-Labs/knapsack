import { solve } from "./solve.ts";
import { KnapsackValidationError } from "./types.ts";
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
   *  + H(C - w). The consumer's headroom value model. Must return a
   *  finite number for every freedTokens argument; throws otherwise. */
  readonly headroom?: (freedTokens: number) => number;
  /** DP memory budget passthrough for both internal solves. */
  readonly maxDpBytes?: number;
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
  /** rho(w*)*P*(w*) + H(C-w*): the scan's objective at the pick (float),
   *  recomputed against the certified re-solve value. */
  readonly rotAdjustedValue: number;
  /** The rot params used (a frozen copy; explicit input or rot-default-v1). */
  readonly rot: RotParams;
}
function validateRot(rot: RotParams): void {
  if (!(rot.kneeFraction > 0 && rot.kneeFraction < 1)) {
    throw new KnapsackValidationError("rot.kneeFraction must be in (0, 1)");
  }
  if (!(rot.kneeRetention > 0 && rot.kneeRetention < 1)) {
    throw new KnapsackValidationError("rot.kneeRetention must be in (0, 1)");
  }
  if (!(rot.floorRetention > 0 && rot.floorRetention < 1)) {
    throw new KnapsackValidationError("rot.floorRetention must be in (0, 1)");
  }
  if (rot.floorRetention > rot.kneeRetention) {
    throw new KnapsackValidationError("rot.floorRetention must be <= kneeRetention");
  }
}

/** rho(w) for the hinge parameterization (valid rot assumed). */
function retention(rot: RotParams, capacity: number, w: number): number {
  const knee = rot.kneeFraction * capacity;
  if (w <= knee) {
    return knee === 0 ? 1 : 1 - (1 - rot.kneeRetention) * (w / knee);
  }
  const t = (w - knee) / (capacity - knee);
  return Math.max(rot.floorRetention, rot.kneeRetention - (rot.kneeRetention - rot.floorRetention) * t);
}

/** Min feasible weight: sum of per-group lightest options. Frontier
 *  points below it are unattainable (fictional {0,0} lead included). */
function minFeasibleWeight(problem: KnapsackProblem): number {
  let sum = 0;
  for (const g of problem.groups) {
    let min = Infinity;
    for (const o of g.options) {
      if (o.weight < min) min = o.weight;
    }
    sum += min;
  }
  return sum;
}

/** Attainable scan points: frontier kinks at or above the floor, plus
 *  the floor itself (the lightest attainable layout — the frontier may
 *  carry no kink there when P*(floorW) repeats the previous value). */
function attainablePoints(
  frontier: readonly FrontierPoint[],
  floorW: number,
): FrontierPoint[] {
  const points: FrontierPoint[] = [];
  let valueBelow = 0;
  let floorAdded = false;
  for (const p of frontier) {
    if (p.weight < floorW) {
      valueBelow = p.value;
      continue;
    }
    if (!floorAdded) {
      points.push({ weight: floorW, value: valueBelow });
      floorAdded = true;
    }
    points.push(p);
  }
  if (!floorAdded) points.push({ weight: floorW, value: valueBelow });
  return points;
}
export function solveRot(
  problem: KnapsackProblem,
  options?: RotSolveOptions,
): RotSolveResult {
  const rot = options?.rot ? Object.freeze({ ...options.rot }) : DEFAULT_ROT;
  validateRot(rot);
  const base = solve(problem, { frontier: true, ...(options?.maxDpBytes !== undefined ? { maxDpBytes: options.maxDpBytes } : {}) });
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
  const floorW = minFeasibleWeight(problem);
  const points = attainablePoints(base.frontier!, floorW);
  let bestW = floorW;
  let bestU = -Infinity;
  for (const p of points) {
    const u = retention(rot, capacity, p.weight) * p.value + (H ? H(capacity - p.weight) : 0);
    if (!Number.isFinite(u)) {
      throw new KnapsackValidationError(
        "headroom returned a non-finite value at freedTokens=" + (capacity - p.weight),
      );
    }
    if (u > bestU) {
      bestU = u;
      bestW = p.weight;
    }
  }
  const resolved = solve({ ...problem, capacity: bestW }, { ...(options?.maxDpBytes !== undefined ? { maxDpBytes: options.maxDpBytes } : {}) });
  return {
    status: resolved.status,
    value: resolved.value,
    choices: resolved.choices,
    bounds: resolved.bounds,
    stats: resolved.stats,
    frontier: base.frontier!,
    operatingWeight: bestW,
    rotAdjustedValue: retention(rot, capacity, bestW) * resolved.value + (H ? H(capacity - bestW) : 0),
    rot,
  };
}
