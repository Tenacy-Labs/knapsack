// Public surface. Deliberately small: P1 semver discipline names exactly
// these symbols (docs/future-work.md). Anything else is internal — import
// it from its module in-repo, but it is not contract.
export { solve, type SolveOptions } from "./solve.ts";
export { solveRot, DEFAULT_ROT, type RotParams, type RotSolveOptions, type RotSolveResult } from "./rot.ts";
export {
  expectedDpBytes,
  DEFAULT_DP_BUDGET,
  computeFrontier,
  type DpResult,
} from "./dp.ts";
export { validateProblem } from "./validate.ts";
export { KnapsackValidationError } from "./types.ts";
export type {
  KnapsackProblem,
  KnapsackOption,
  KnapsackGroup,
  KnapsackChoice,
  KnapsackBounds,
  KnapsackStats,
  KnapsackResult,
  FrontierPoint,
  ReducedGroup,
} from "./types.ts";
