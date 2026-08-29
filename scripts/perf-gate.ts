/**
 * Perf gate: fail when solver cost regresses >20% against the
 * main-branch baseline, machine-noise-robust by construction:
 *
 *   - bench.ts emits calibrated relative units (solver-ms per cal-ms),
 *     so machine speed cancels out;
 *   - CI runs the bench twice per PR; the gate compares the per-shape
 *     MIN of the two runs (contention only inflates);
 *   - the baseline (gh-pages:bench-baseline.json) keeps a 5-run
 *     history per shape and compares against the history MEDIAN, so a
 *     single outlier run — fast or slow — poisons neither side.
 *
 *   bun run scripts/perf-gate.ts --check [--baseline-file f]  # PR gate
 *   bun run scripts/perf-gate.ts --check                       # vs gh-pages
 *   bun run scripts/perf-gate.ts --update                      # main, needs GH_TOKEN
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const REPO = "Tenacy-Labs/knapsack";
const BRANCH = "gh-pages";
const FILE = "bench-baseline.json";
const THRESHOLD = 1.2; // 20% regression budget
const HISTORY = 5;

type Entry = { name: string; unit: string; value: number };
type Baseline = { schema: 2; history: { name: string; unit: string; values: number[] }[] };

const argv = process.argv.slice(2);
const mode = argv[0];
const baselineFileArg = argv.find((a) => a.startsWith("--baseline-file="))?.slice("--baseline-file=".length);

function sh(cmd: string, args: string[]) {
  return spawnSync(cmd, args, { encoding: "utf8" });
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function parseBaseline(text: string): Baseline {
  const raw = JSON.parse(text) as unknown;
  if (Array.isArray(raw)) {
    // schema 1 (flat single-run array) → history of one
    return { schema: 2, history: (raw as Entry[]).map((e) => ({ name: e.name, unit: e.unit, values: [e.value] })) };
  }
  return raw as Baseline;
}

// Current capability: min across every bench run present (bench.json
// required; bench2.json merged in when CI ran a second pass).
function currentRuns(): { name: string; unit: string; value: number }[] {
  const files = ["bench.json", "bench2.json"].filter(existsSync);
  if (!files.length) {
    console.error("perf-gate: no bench.json — run `bun run bench --json=bench.json` first");
    process.exit(1);
  }
  const runs = files.map((f) => JSON.parse(readFileSync(f, "utf8")) as Entry[]);
  const names = runs[0]!.map((e) => e.name);
  return names.map((name, i) => ({
    name,
    unit: runs[0]![i]!.unit,
    value: Math.min(...runs.map((r) => r[i]!.value)),
  }));
}

if (mode === "--check") {
  const current = currentRuns();
  let baselineText: string | null = null;
  if (baselineFileArg) {
    baselineText = readFileSync(baselineFileArg, "utf8");
  } else if (sh("git", ["fetch", "origin", BRANCH, "--depth=1"]).status === 0) {
    const show = sh("git", ["show", `FETCH_HEAD:${FILE}`]);
    if (show.status === 0) baselineText = show.stdout;
  }
  if (!baselineText) {
    console.log("perf-gate: no baseline yet — gate passes vacuously (first main run stores one)");
    process.exit(0);
  }
  const baseline = parseBaseline(baselineText);
  let failed = false;
  for (const c of current) {
    const h = baseline.history.find((x) => x.name === c.name);
    if (!h || !h.values.length) {
      console.log(`  ~ ${c.name}: no baseline entry (new shape)`);
      continue;
    }
    const base = median(h.values);
    const delta = (c.value / base - 1) * 100;
    const verdict = delta > 20 ? "REGRESSION" : delta < -20 ? "improved" : "ok";
    console.log(`  ${delta > 20 ? "✗" : "✓"} ${c.name}: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs baseline median (of ${h.values.length} runs) — ${verdict}`);
    if (delta > 20) failed = true;
  }
  if (failed) {
    console.error("\nperf-gate FAIL: >20% regression on one or more shapes (min of 2 runs vs baseline median).\nIf a re-run still fails, the regression is real: say so in the PR, or fix it.");
    process.exit(1);
  }
  console.log("perf-gate: OK (all shapes within 20% of baseline median)");
  process.exit(0);
}

if (mode === "--update") {
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    console.error("perf-gate --update: needs GH_TOKEN or GITHUB_TOKEN");
    process.exit(1);
  }
  const sha = process.env.GITHUB_SHA;
  if (!sha) { console.error("perf-gate --update: needs GITHUB_SHA"); process.exit(1); }
  const current = JSON.parse(readFileSync("bench.json", "utf8")) as Entry[];

  let baseline: Baseline = { schema: 2, history: [] };
  const existing = sh("gh", ["api", `/repos/${REPO}/branches/${BRANCH}`]).status === 0
    ? sh("gh", ["api", `/repos/${REPO}/contents/${FILE}?ref=${BRANCH}`])
    : { status: 1, stdout: "", stderr: "" };
  let fileSha: string | undefined;
  if (existing.status === 0) {
    fileSha = JSON.parse(existing.stdout).sha as string;
    const decoded = JSON.parse(Buffer.from(JSON.parse(existing.stdout).content, "base64").toString("utf8"));
    baseline = parseBaseline(JSON.stringify(decoded));
  } else if (sh("gh", ["api", `/repos/${REPO}/branches/${BRANCH}`]).status !== 0) {
    const created = sh("gh", ["api", "-X", "POST", `/repos/${REPO}/git/refs`, "-f", `ref=refs/heads/${BRANCH}`, "-f", `sha=${sha}`]);
    if (created.status !== 0) { console.error(`perf-gate: could not create ${BRANCH}: ${created.stderr}`); process.exit(1); }
    console.log(`perf-gate: created ${BRANCH}`);
  }

  for (const e of current) {
    const h = baseline.history.find((x) => x.name === e.name);
    if (h) {
      h.unit = e.unit;
      h.values = [...h.values, e.value].slice(-HISTORY);
    } else {
      baseline.history.push({ name: e.name, unit: e.unit, values: [e.value] });
    }
  }

  const args = ["api", "-X", "PUT", `/repos/${REPO}/contents/${FILE}`,
    "-f", "message=perf baseline update", "-f", `branch=${BRANCH}`,
    "-f", `content=${Buffer.from(JSON.stringify(baseline, null, 2) + "\n").toString("base64")}`];
  if (fileSha) args.push("-f", `sha=${fileSha}`);
  const put = sh("gh", args);
  if (put.status !== 0) { console.error(`perf-gate: baseline update failed: ${put.stderr}`); process.exit(1); }
  console.log(`perf-gate: baseline updated (${HISTORY}-run history per shape) on ${BRANCH}/${FILE}`);
  process.exit(0);
}

console.error("usage: perf-gate.ts --check | --update");
process.exit(1);
