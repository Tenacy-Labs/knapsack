/**
 * Public-surface guard (future-work P1): the exports of src/index.ts are
 * the semver contract. This script compares them against the committed
 * snapshot api-surface.txt and fails on ANY drift — removals break
 * consumers, additions must be deliberate (update the snapshot in the
 * same PR so reviewers see the surface grow).
 *
 *   bun run scripts/check-api-surface.ts           # check
 *   bun run scripts/check-api-surface.ts --update  # regenerate snapshot
 */
const INDEX = "src/index.ts";
const SNAPSHOT = "api-surface.txt";

import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(INDEX, "utf8");

// Collect every exported name from `export { ... } from` /
// `export type { ... } from` blocks and inline declarations.
const names = new Set<string>();
for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
  for (const spec of m[1]!.split(",")) {
    // trim FIRST: split(',') keeps the leading whitespace of every
    // normal spec, which used to defeat the `type ` strip and leak
    // pseudo-names like "type DpResult" into the snapshot.
    const name = spec.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()!.trim();
    if (name) names.add(name);
  }
}
for (const m of src.matchAll(/export\s+(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
  names.add(m[1]!);
}
const current = [...names].sort();

if (process.argv.includes("--update")) {
  writeFileSync(SNAPSHOT, current.join("\n") + "\n");
  console.log(`api-surface.txt updated (${current.length} exports)`);
  process.exit(0);
}

let snapshot: string[] = [];
try {
  snapshot = readFileSync(SNAPSHOT, "utf8").split("\n").filter(Boolean);
} catch {
  console.error("api-surface.txt missing — run: bun run scripts/check-api-surface.ts --update");
  process.exit(1);
}

const removed = snapshot.filter((n) => !current.includes(n));
const added = current.filter((n) => !snapshot.includes(n));

if (removed.length || added.length) {
  if (removed.length) console.error(`BREAKING — removed from public surface:\n  ${removed.join("\n  ")}`);
  if (added.length) console.error(`surface addition (must be deliberate, P1 additive-only):\n  ${added.join("\n  ")}`);
  console.error("\nIf intentional, update the snapshot in this PR:\n  bun run scripts/check-api-surface.ts --update");
  process.exit(1);
}
console.log(`public surface OK — ${current.length} exports match api-surface.txt`);
