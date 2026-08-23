/**
 * @connectotron/knapsack — exact multiple-choice knapsack (MCKP) solver.
 *
 * Pure functions, integer arithmetic for all bounds and pruning decisions,
 * deterministic output (no locale collation, no float ordering anywhere).
 */

/** A single choice within a group. Weight and profit are non-negative integers. */
export interface KnapsackOption {
  readonly id: string;
  readonly weight: number;
  readonly profit: number;
}

/** A group of mutually exclusive options; exactly one must be chosen. */
export interface KnapsackGroup {
  readonly id: string;
  readonly options: readonly KnapsackOption[];
}

/** The problem: choose one option per group, total weight <= capacity, maximize profit. */
export interface KnapsackProblem {
  readonly groups: readonly KnapsackGroup[];
  readonly capacity: number;
}

/** The solver's selection: one entry per group. */
export interface KnapsackChoice {
  readonly groupId: string;
  readonly optionId: string;
}

export interface KnapsackBounds {
  /** Dantzig upper bound from the LP relaxation (rational, reported as float). */
  readonly lpUpper: number;
  /** Integral greedy lower bound from rounding the LP solution down. */
  readonly greedyLower: number;
}

export interface KnapsackStats {
  readonly groups: number;
  readonly optionsTotal: number;
  readonly optionsAfterDominance: number;
  readonly optionsAfterFathoming: number;
  /** True when the exact DP ran (LP gap was non-zero). */
  readonly dpRequired: boolean;
  /** Inner-loop iterations executed by the DP (0 when skipped). */
  readonly dpCellsVisited: number;
}

export interface KnapsackResult {
  /**
   * 'optimal' — a proven-optimal selection is returned (either LP gap was zero,
   *   or the exact DP closed it).
   * 'infeasible' — no selection satisfies the capacity (min-weight sum exceeds it).
   */
  readonly status: "optimal" | "infeasible";
  readonly value: number;
  /** null iff infeasible. */
  readonly choices: readonly KnapsackChoice[] | null;
  /** Always populated. Infeasible: {lpUpper: 0, greedyLower: 0}. */
  readonly bounds: KnapsackBounds;
  /** Always populated (reduction pipeline stats; dpRequired false, 0 cells when infeasible). */
  readonly stats: KnapsackStats;
  /**
   * ADR-0001: present iff options.frontier. Kinks of the Pareto frontier
   * P*(w) = best achievable profit at total weight <= w, from an exact
   * standalone value-row sweep over dominance-reduced groups (equivalent
   * to the DP's final value row on every path). Ascending weight,
   * strictly increasing value, first point at weight 0 carrying P*(0) —
   * 0 under the purge convention, the free-profit value when zero-weight
   * positive-profit options exist — last point the classical optimum.
   * Infeasible: [{0, 0}].
   */
  readonly frontier?: readonly FrontierPoint[];
}

/**
 * One kink of the Pareto frontier: the smallest weight at which a given
 * best value is attainable. Between kinks, P*(w) is constant.
 */
export interface FrontierPoint {
  readonly weight: number;
  readonly value: number;
}

/** Internal: one group reduced to its strict upper hull, sorted by weight ascending. */
export interface ReducedGroup {
  readonly id: string;
  /** Hull options, weight strictly increasing, profit strictly increasing. */
  readonly options: readonly KnapsackOption[];
  /** Original (pre-reduction) option count, for stats. */
  readonly originalCount: number;
}

export class KnapsackValidationError extends Error {
  constructor(message: string) {
    super(`invalid problem: ${message}`);
    this.name = "KnapsackValidationError";
  }
}
