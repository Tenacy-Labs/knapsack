import { ReducedGroup } from "./types.ts";

/**
 * Exact MCKP via two-row Bellman DP with reachable-weight windowing
 * (fontanf shape; Kellerer–Pferschy–Pisinger DP lineage).
 *
 * Two Int32Array rows of width capacity+1, swapped by reference. Per group,
 * only weights inside the reachable window
 *   [sum of hull minima so far, min(capacity, sum of hull maxima so far)]
 * are touched; the destination range is cleared to -1 just before the sweep,
 * so no stale values survive a row swap. A flat back-pointer array
 * (bp[gi * width + w] = option index chosen by group gi to arrive at weight
 * w, -1 = unreachable) gives O(groups) traceback.
 *
 * The inner loop is a plain scan — or-tools' own measurements favor plain
 * loops over clever arithmetic at this scale. All values are integers.
 */
export interface DpResult {
  readonly value: number;
  /** Final weight of the optimal selection (<= capacity). */
  readonly weight: number;
  /** Option index chosen per group, aligned with the input order. */
  readonly choiceIndex: readonly number[];
  readonly cellsVisited: number;
}

export function solveDp(
  reduced: readonly ReducedGroup[],
  capacity: number,
): DpResult {
  const n = reduced.length;
  const width = capacity + 1;
  let prev = new Int32Array(width).fill(-1); // -1 = unreachable
  let cur = new Int32Array(width).fill(-1);
  // Int32 back-pointers keep one uniform type; memory = 4 * n * (capacity+1)
  // bytes. (v0.2 may shrink this or adopt or-tools' re-solve-on-residual.)
  const bp = new Int32Array(n * width).fill(-1);

  let cells = 0;

  // Stage 0: group 0's options seed prev (ties -> first writer wins, which is
  // the lower hull index — deterministic).
  const g0 = reduced[0]!;
  for (let i = 0; i < g0.options.length; i++) {
    const o = g0.options[i]!;
    if (o.weight <= capacity && o.profit > prev[o.weight]!) {
      prev[o.weight] = o.profit;
      bp[o.weight] = i; // row 0 doubles as group 0's back-pointers
    }
    cells++;
  }

  // Reachable weight window after group 0 (hull is weight-sorted).
  let windowLo = g0.options[0]!.weight;
  let windowHi = g0.options[g0.options.length - 1]!.weight;

  for (let gi = 1; gi < n; gi++) {
    const g = reduced[gi]!;
    const gMin = g.options[0]!.weight;
    const gMax = g.options[g.options.length - 1]!.weight;
    const lo = Math.min(capacity, windowLo + gMin);
    const hi = Math.min(capacity, windowHi + gMax);
    const bpBase = gi * width;

    cur.fill(-1); // FULL clear: stale data outside the sweep window (from two
    // stages back) must never leak into a later stage's read range — reads can
    // dip below the cumulative weight minimum via large option weights.
    for (let w = lo; w <= hi; w++) {
      let best = -1;
      let bestOpt = -1;
      for (let i = 0; i < g.options.length; i++) {
        const o = g.options[i]!;
        const pw = w - o.weight;
        if (pw < 0) continue;
        const pv = prev[pw]!;
        if (pv < 0) continue;
        const v = pv + o.profit;
        if (v > best) {
          best = v;
          bestOpt = i;
        }
      }
      if (best >= 0) {
        cur[w] = best;
        bp[bpBase + w] = bestOpt;
      }
      cells++;
    }

    windowLo += gMin;
    windowHi = hi;
    const t = prev;
    prev = cur;
    cur = t;
  }

  // Extract optimum: max value over the final row; ties -> smallest weight.
  let bestVal = -1;
  let bestW = -1;
  for (let w = 0; w <= capacity; w++) {
    const v = prev[w]!;
    if (v > bestVal) {
      bestVal = v;
      bestW = w;
    }
  }
  if (bestVal < 0) {
    return { value: -1, weight: -1, choiceIndex: [], cellsVisited: cells };
  }

  // Traceback: recover each group's option index from the back-pointers.
  const choiceIndex: number[] = new Array<number>(n).fill(-1);
  let w = bestW;
  for (let gi = n - 1; gi >= 1; gi--) {
    const optIdx = bp[gi * width + w]!;
    choiceIndex[gi] = optIdx;
    w -= reduced[gi]!.options[optIdx]!.weight;
  }
  choiceIndex[0] = bp[w]!;
  return { value: bestVal, weight: bestW, choiceIndex, cellsVisited: cells };
}
