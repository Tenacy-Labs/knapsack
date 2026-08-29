/**
 * Benchmark: tenacy-shaped instances (tens of groups × few options,
 * integer token weights) and stress shapes beyond it.
 *
 * Run: bun run bench/bench.ts
 *      bun run bench/bench.ts --json=bench.json   (machine-readable,
 *      consumed by the CI perf gate)
 *
 * The JSON emits machine-normalized values: solver median divided by a
 * fixed arithmetic calibration workload timed in the same process. A
 * slower CI runner slows solver and calibration equally, so the ratio
 * carries algorithmic signal, not machine speed. (Shared runners swing
 * ±30-70% in absolute terms on identical code — measured 2026-08-29.)
 */
import { solve } from "../src/index.ts";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Shape {
  name: string;
  groups: number;
  options: number;
  maxWeight: number;
  capacityFactor: number; // fraction of the way from min-sum to max-sum
  iterations: number;
}

const SHAPES: Shape[] = [
  { name: "tenacy small (20g × 3o, w≤400)", groups: 20, options: 3, maxWeight: 400, capacityFactor: 0.5, iterations: 2000 },
  { name: "tenacy full (60g × 5o, w≤600)", groups: 60, options: 5, maxWeight: 600, capacityFactor: 0.6, iterations: 500 },
  { name: "tenacy stress (120g × 6o, w≤800)", groups: 120, options: 6, maxWeight: 800, capacityFactor: 0.5, iterations: 200 },
  { name: "wide capacity (40g × 4o, cap 8k)", groups: 40, options: 4, maxWeight: 2000, capacityFactor: 0.55, iterations: 300 },
  { name: "LP-friendly (30g × 3o, roomy)", groups: 30, options: 3, maxWeight: 100, capacityFactor: 0.95, iterations: 1000 },
];

function buildProblem(shape: Shape, r: () => number) {
  const groups = Array.from({ length: shape.groups }, (_, gi) => {
    const opts = Array.from({ length: shape.options }, (_, oi) => ({
      id: `o${oi}`,
      weight: 1 + Math.floor(r() * shape.maxWeight),
      profit: 1 + Math.floor(r() * 1000),
    }));
    return { id: `g${gi}`, options: opts };
  });
  const minW = groups.reduce((s, g) => s + Math.min(...g.options.map((o) => o.weight)), 0);
  const maxW = groups.reduce((s, g) => s + Math.max(...g.options.map((o) => o.weight)), 0);
  const capacity = Math.round(minW + shape.capacityFactor * (maxW - minW));
  return { groups, capacity };
}

let CAL_SINK = 0; // defeats dead-code elimination in calibrate()

/** Fixed arithmetic workload (mulberry32 core, 4M steps). */
function calibrate(): number {
  const t0 = performance.now();
  let a = 1;
  for (let i = 0; i < 4_000_000; i++) {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    CAL_SINK ^= t;
  }
  return performance.now() - t0;
}

const results: { name: string; unit: string; value: number }[] = [];

console.log("shape | iters | total ms | per-solve µs (median of batch means)");
console.log("---|---|---|---");
for (const shape of SHAPES) {
  // Warmup.
  const w = rng(1);
  for (let i = 0; i < 20; i++) solve(buildProblem(shape, w));

  // Machine-normalization reference, measured immediately before the
  // shape it scales: same process, same CPU conditions. Warm-up first
  // (JIT), then min-of-3 — min is the robust statistic for a timing
  // reference (contention only ever inflates it).
  calibrate();
  const calMs = Math.min(calibrate(), calibrate(), calibrate());

  const batchMeans: number[] = [];
  // 10 batches: all SHAPES iteration counts divide evenly, and min-of-10
  // is tight enough for a 20% gate on shared runners.
  const Batches = 10;
  const perBatch = shape.iterations / Batches;
  let dpRuns = 0;
  let totalCells = 0;
  for (let b = 0; b < Batches; b++) {
    const r = rng(100 + b);
    const problems = Array.from({ length: perBatch }, () => buildProblem(shape, r));
    const t0 = performance.now();
    for (const p of problems) {
      const res = solve(p);
      if (res.stats?.dpRequired) {
        dpRuns++;
        totalCells += res.stats.dpCellsVisited;
      }
    }
    batchMeans.push((performance.now() - t0) / perBatch);
  }
  batchMeans.sort((a, b) => a - b);
  const median = batchMeans[Math.floor(batchMeans.length / 2)]!;
  const dpPct = Math.round((100 * dpRuns) / shape.iterations);
  // Relative units: solver ms per calibration ms. Comparisons across
  // runners compare these, never the absolute µs in the table above.
  // Min of batch means, not the median: interference on shared runners
  // only ever inflates a batch, so min recovers the true cost.
  const fastest = batchMeans[0]!;
  results.push({ name: shape.name, unit: "solver-ms/cal-ms", value: fastest / calMs });
  console.log(
    `${shape.name} | ${shape.iterations} | ${(median * shape.iterations).toFixed(0)} | ${Math.round(median * 1000)}µs (DP ${dpPct}%, ${dpRuns ? Math.round(totalCells / dpRuns) : 0} cells avg)`,
  );
}

// Machine-readable output for the CI perf gate (custom smaller-is-better).
const jsonArg = process.argv.find((a) => a.startsWith("--json="));
if (jsonArg) {
  const path = jsonArg.slice("--json=".length);
  await Bun.write(path, JSON.stringify(results, null, 2) + "\n");
  console.log(`wrote ${path}`);
}
