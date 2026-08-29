import { describe, expect, test } from "bun:test";
import {
  solve,
  type KnapsackProblem,
  type KnapsackResult,
} from "@tenacy-labs/knapsack";

/**
 * Integration coverage deliberately imports the package by its public name.
 * This catches a broken package export as well as broken wiring between
 * validation, Pareto reduction, LP bounds, fathoming, exact DP, and result
 * reconstruction. Unit tests may import internals; this file must not.
 */
describe("public package pipeline", () => {
  test("raw MCKP traverses reduction, fathoming, exact DP, and reconstructs the optimum", () => {
    const problem: KnapsackProblem = {
      capacity: 31,
      groups: [
        {
          id: "g0",
          options: [
            { id: "o0", weight: 12, profit: 5 },
            { id: "o1", weight: 18, profit: 41 },
            { id: "o2", weight: 0, profit: 9 },
            { id: "o3", weight: 11, profit: 0 },
            { id: "o4", weight: 11, profit: 23 },
          ],
        },
        {
          id: "g1",
          options: [
            { id: "o0", weight: 9, profit: 22 },
            { id: "o1", weight: 0, profit: 34 },
            { id: "o2", weight: 19, profit: 36 },
            { id: "o3", weight: 10, profit: 40 },
            { id: "o4", weight: 6, profit: 31 },
          ],
        },
        {
          id: "g2",
          options: [
            { id: "o0", weight: 19, profit: 14 },
            { id: "o1", weight: 15, profit: 29 },
            { id: "o2", weight: 11, profit: 6 },
            { id: "o3", weight: 0, profit: 28 },
            { id: "o4", weight: 16, profit: 4 },
          ],
        },
        {
          id: "g3",
          options: [
            { id: "o0", weight: 0, profit: 47 },
            { id: "o1", weight: 4, profit: 16 },
            { id: "o2", weight: 5, profit: 21 },
            { id: "o3", weight: 15, profit: 16 },
            { id: "o4", weight: 4, profit: 5 },
          ],
        },
      ],
    };

    const result: KnapsackResult = solve(problem);

    expect(result).toEqual({
      status: "optimal",
      value: 156,
      choices: [
        { groupId: "g0", optionId: "o1" },
        { groupId: "g1", optionId: "o3" },
        { groupId: "g2", optionId: "o3" },
        { groupId: "g3", optionId: "o0" },
      ],
      bounds: { lpUpper: 156.2, greedyLower: 156 },
      stats: {
        groups: 4,
        optionsTotal: 20,
        optionsAfterDominance: 8,
        optionsAfterFathoming: 7,
        dpRequired: true,
        dpCellsVisited: 90,
        dpKernelUsed: expect.any(String),
      },
    });
  });
});
