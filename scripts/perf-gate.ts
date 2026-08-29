/**
 * Perf gate: fail when median per-solve time regresses >20% against the
 * main-branch baseline (bench-baseline.json on the gh-pages branch).
 *
 *   bun run scripts/perf-gate.ts --check                 # PR gate
 *   bun run scripts/perf-gate.ts --check --baseline-file /tmp/b.json
 *   bun run scripts/perf-gate.ts --update                # main only, needs GH_TOKEN
 *
 * --update stores the current bench.json as the new baseline via the
 * GitHub contents API (creates gh-pages on first run).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const REPO = "Tenacy-Labs/knapsack";
const BRANCH = "gh-pages";
const FILE = "bench-baseline.json";
const THRESHOLD = 1.2; // 20% regression budget

const argv = process.argv.slice(2);
const mode = argv[0];
const baselineFileArg = argv.find((a) => a.startsWith("--baseline-file="))?.slice("--baseline-file=".length);

function sh(cmd: string, args: string[]) {
  return spawnSync(cmd, args, { encoding: "utf8" });
}

if (!existsSync("bench.json")) {
  console.error("perf-gate: bench.json missing — run `bun run bench --json=bench.json` first");
  process.exit(1);
}
const current: { name: string; unit: string; value: number }[] = JSON.parse(readFileSync("bench.json", "utf8"));

if (mode === "--check") {
  let baselineText: string | null = null;
  if (baselineFileArg) {
    baselineText = readFileSync(baselineFileArg, "utf8");
  } else {
    // Fetch only the gh-pages ref; absent branch = no baseline yet.
    if (sh("git", ["fetch", "origin", BRANCH, "--depth=1"]).status === 0) {
      const show = sh("git", ["show", `FETCH_HEAD:${FILE}`]);
      if (show.status === 0) baselineText = show.stdout;
    }
  }
  if (!baselineText) {
    console.log("perf-gate: no baseline yet — gate passes vacuously (first main run will store one)");
    process.exit(0);
  }
  const baseline = JSON.parse(baselineText) as typeof current;
  let failed = false;
  for (const c of current) {
    const b = baseline.find((x) => x.name === c.name);
    if (!b) {
      console.log(`  ~ ${c.name}: no baseline entry (new shape)`);
      continue;
    }
    const delta = (c.value / b.value - 1) * 100;
    const mark = delta > 20 ? "REGRESSION" : delta < -20 ? "improved" : "ok";
    console.log(`  ${delta > 20 ? "✗" : "✓"} ${c.name}: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs baseline (${mark})`);
    if (delta > 20) failed = true;
  }
  if (failed) {
    console.error("\nperf-gate FAIL: >20% median per-solve regression on one or more shapes.\nIf intentional, say so in the PR and land the baseline update on main.");
    process.exit(1);
  }
  console.log("perf-gate: OK (all shapes within 20% of baseline)");
  process.exit(0);
}

if (mode === "--update") {
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    console.error("perf-gate --update: needs GH_TOKEN or GITHUB_TOKEN");
    process.exit(1);
  }
  const sha = process.env.GITHUB_SHA;
  if (!sha) { console.error("perf-gate --update: needs GITHUB_SHA"); process.exit(1); }
  // Ensure gh-pages exists (seed from the current main commit).
  if (sh("gh", ["api", `/repos/${REPO}/branches/${BRANCH}`]).status !== 0) {
    const created = sh("gh", ["api", "-X", "POST", `/repos/${REPO}/git/refs`, "-f", `ref=refs/heads/${BRANCH}`, "-f", `sha=${sha}`]);
    if (created.status !== 0) { console.error(`perf-gate: could not create ${BRANCH}: ${created.stderr}`); process.exit(1); }
    console.log(`perf-gate: created ${BRANCH}`);
  }
  // PUT bench.json as the baseline (with current file sha if it exists).
  const content = Buffer.from(JSON.stringify(current, null, 2) + "\n").toString("base64");
  const args = ["api", "-X", "PUT", `/repos/${REPO}/contents/${FILE}`,
    "-f", "message=perf baseline update", "-f", `branch=${BRANCH}`, "-f", `content=${content}`];
  const existing = sh("gh", ["api", `/repos/${REPO}/contents/${FILE}?ref=${BRANCH}`]);
  if (existing.status === 0) {
    const fileSha = JSON.parse(existing.stdout).sha as string;
    args.push("-f", `sha=${fileSha}`);
  }
  const put = sh("gh", args);
  if (put.status !== 0) { console.error(`perf-gate: baseline update failed: ${put.stderr}`); process.exit(1); }
  console.log(`perf-gate: baseline updated on ${BRANCH}/${FILE}`);
  process.exit(0);
}

console.error("usage: perf-gate.ts --check | --update");
process.exit(1);
