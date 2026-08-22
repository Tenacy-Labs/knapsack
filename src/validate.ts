import {
  KnapsackGroup,
  KnapsackProblem,
  KnapsackValidationError,
} from "./types.ts";

/** Max safe value storable in the DP's Int32 rows (profit sums must stay below). */
export const MAX_TOTAL_PROFIT = 0x7fffffff;

/**
 * Max capacity. Keeps every integer sum/product in the solver (including the
 * fathom bound `(baseP + p)·λw + λp·slack`, with factors up to ~2^31 and C)
 * strictly inside 2^53, where IEEE-754 doubles are still exact integers.
 */
export const MAX_CAPACITY = 0x1fffff; // 2^21 − 1

function isNonNegInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/**
 * Validate structural invariants. Throws KnapsackValidationError on violation.
 *
 * Deliberate scope: weights and profits are NON-NEGATIVE integers, and exactly
 * one option must be chosen per group. A caller that wants "choose nothing"
 * semantics adds a zero-weight, zero-profit option to the group explicitly
 * (agent-kernel's purge option does exactly this).
 */
export function validateProblem(problem: KnapsackProblem): void {
  if (!isNonNegInt(problem.capacity)) {
    throw new KnapsackValidationError("capacity must be a non-negative integer");
  }
  if (problem.capacity > MAX_CAPACITY) {
    throw new KnapsackValidationError(
      `capacity must stay below ${MAX_CAPACITY + 1} (got ${problem.capacity}); ` +
        "scale weights down or solve per subsystem",
    );
  }
  if (problem.groups.length === 0) {
    throw new KnapsackValidationError("at least one group is required");
  }
  const groupIds = new Set<string>();
  let totalMaxProfit = 0;
  for (const g of problem.groups) {
    if (typeof g.id !== "string" || g.id.length === 0) {
      throw new KnapsackValidationError("every group needs a non-empty string id");
    }
    if (groupIds.has(g.id)) {
      throw new KnapsackValidationError(`duplicate group id ${JSON.stringify(g.id)}`);
    }
    groupIds.add(g.id);
    validateGroupOptions(g);
    let groupMaxProfit = 0;
    for (const o of g.options) groupMaxProfit = Math.max(groupMaxProfit, o.profit);
    totalMaxProfit += groupMaxProfit;
  }
  if (totalMaxProfit >= MAX_TOTAL_PROFIT) {
    throw new KnapsackValidationError(
      `sum of per-group max profits must stay below ${MAX_TOTAL_PROFIT} ` +
        `(got ${totalMaxProfit}); scale profits down or solve per subsystem`,
    );
  }
}

function validateGroupOptions(g: KnapsackGroup): void {
  if (!Array.isArray(g.options) || g.options.length === 0) {
    throw new KnapsackValidationError(
      `group ${JSON.stringify(g.id)} needs at least one option`,
    );
  }
  const ids = new Set<string>();
  for (const o of g.options) {
    if (typeof o.id !== "string" || o.id.length === 0) {
      throw new KnapsackValidationError(
        `group ${JSON.stringify(g.id)} has an option with an invalid id`,
      );
    }
    if (ids.has(o.id)) {
      throw new KnapsackValidationError(
        `duplicate option id ${JSON.stringify(o.id)} in group ${JSON.stringify(g.id)}`,
      );
    }
    ids.add(o.id);
    if (!isNonNegInt(o.weight)) {
      throw new KnapsackValidationError(
        `option ${JSON.stringify(o.id)}: weight must be a non-negative integer`,
      );
    }
    if (!isNonNegInt(o.profit)) {
      throw new KnapsackValidationError(
        `option ${JSON.stringify(o.id)}: profit must be a non-negative integer`,
      );
    }
  }
}

/** True when at least one feasible selection exists (min-weight hull fits). */
export function isFeasible(minWeightSum: number, capacity: number): boolean {
  return minWeightSum <= capacity;
}
