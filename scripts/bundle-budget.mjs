#!/usr/bin/env node
/**
 * P3-4 bundle budget: client JavaScript may not grow unnoticed.
 *
 *   node scripts/bundle-budget.mjs [assetsDir]            # check (default .output/public/assets)
 *   node scripts/bundle-budget.mjs [assetsDir] --update   # write the measured sizes as the baseline
 *
 * Sizes are gzip (level 9) of every .js file in the client assets directory:
 *   entry       the chunk every other chunk imports from (the app shell)
 *   firstPaint  the entry plus every chunk it imports statically: what every page downloads
 *               before it can render (a vendor chunk the shell imports counts here, which the
 *               entry size alone missed)
 *   largest     the biggest chunk other than the entry
 *   total       all client JS
 *
 * Fails when entry, firstPaint or total grows more than 5 percent over build/bundle-baseline.json,
 * or a hard limit from the Phase 0 plan (section 9.2) is broken: any chunk other than
 * the entry over 150 kB, or total over 1.5 MB. The plan's entry limit (250 kB) is not
 * met yet, so it is reported, not enforced; the ratchet keeps the entry from growing
 * until work brings it under, after which `--update` locks the gain in.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const BASELINE_FILE = "build/bundle-baseline.json";
export const LIMITS = { entryKb: 250, chunkKb: 150, totalKb: 1500, growth: 0.05 };

const IMPORT_RE = /(?:from\s*|import\s*\(\s*)["']\.\/([^"']+\.js)["']/g;
/** Static imports only: `from "./x.js"` and a bare `import "./x.js"`, never `import("./x.js")`. */
const STATIC_IMPORT_RE = /(?:\bfrom\s*|\bimport\s*)["']\.\/([^"']+\.js)["']/g;

/** The chunk and every chunk it imports statically, transitively. */
export function staticClosure(start, sources) {
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name) || sources[name] === undefined) return;
    seen.add(name);
    for (const m of sources[name].matchAll(STATIC_IMPORT_RE)) visit(m[1]);
  };
  visit(start);
  return [...seen];
}

/** Which chunks each chunk imports, by file name. */
export function importCounts(sources) {
  const counts = {};
  for (const src of Object.values(sources)) {
    for (const m of src.matchAll(IMPORT_RE)) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  }
  return counts;
}

/** @param {Record<string, {source: string, gzipBytes: number}>} chunks */
export function measure(chunks) {
  const names = Object.keys(chunks);
  if (names.length === 0) throw new Error("no .js files in the assets directory");
  const counts = importCounts(Object.fromEntries(names.map((n) => [n, chunks[n].source])));
  const entry = [...names].sort(
    (a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a.localeCompare(b),
  )[0];
  const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;
  const others = names.filter((n) => n !== entry);
  const largestName = others.sort((a, b) => chunks[b].gzipBytes - chunks[a].gzipBytes)[0] ?? null;
  const firstPaintFiles = staticClosure(
    entry,
    Object.fromEntries(names.map((n) => [n, chunks[n].source])),
  );
  return {
    entry: { file: entry, kb: kb(chunks[entry].gzipBytes) },
    firstPaint: {
      kb: kb(firstPaintFiles.reduce((s, n) => s + chunks[n].gzipBytes, 0)),
      files: firstPaintFiles.length,
    },
    largest: largestName ? { file: largestName, kb: kb(chunks[largestName].gzipBytes) } : null,
    totalKb: kb(names.reduce((s, n) => s + chunks[n].gzipBytes, 0)),
    files: names.length,
  };
}

/** @returns {{ failures: string[], notes: string[] }} */
export function judge(m, baseline, limits = LIMITS) {
  const failures = [];
  const notes = [];
  const grew = (now, was) => was > 0 && now > was * (1 + limits.growth);
  if (baseline && grew(m.entry.kb, baseline.entryKb)) {
    failures.push(
      `entry chunk grew from ${baseline.entryKb} kB to ${m.entry.kb} kB gzip (more than ${limits.growth * 100}%)`,
    );
  }
  if (baseline?.firstPaintKb && m.firstPaint && grew(m.firstPaint.kb, baseline.firstPaintKb)) {
    failures.push(
      `first-paint JS (the entry and the chunks it imports up front) grew from ${baseline.firstPaintKb} kB to ${m.firstPaint.kb} kB gzip (more than ${limits.growth * 100}%)`,
    );
  }
  if (baseline && grew(m.totalKb, baseline.totalKb)) {
    failures.push(
      `total client JS grew from ${baseline.totalKb} kB to ${m.totalKb} kB gzip (more than ${limits.growth * 100}%)`,
    );
  }
  if (m.largest && m.largest.kb > limits.chunkKb) {
    failures.push(
      `${m.largest.file} is ${m.largest.kb} kB gzip, over the ${limits.chunkKb} kB chunk limit`,
    );
  }
  if (m.totalKb > limits.totalKb) {
    failures.push(`total client JS is ${m.totalKb} kB gzip, over the ${limits.totalKb} kB limit`);
  }
  if (m.entry.kb > limits.entryKb) {
    notes.push(
      `entry chunk is ${m.entry.kb} kB gzip, over the plan's ${limits.entryKb} kB target (reported, not enforced yet)`,
    );
  }
  return { failures, notes };
}

function readChunks(dir) {
  const out = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const buf = readFileSync(join(dir, f));
    out[f] = { source: buf.toString("utf8"), gzipBytes: gzipSync(buf, { level: 9 }).length };
  }
  return out;
}

function main(argv) {
  const update = argv.includes("--update");
  const dir = argv.find((a) => !a.startsWith("--")) ?? ".output/public/assets";
  let m;
  try {
    m = measure(readChunks(dir));
  } catch (e) {
    console.error(`Bundle budget: cannot measure ${dir}: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  console.log(
    `Bundle: entry ${m.entry.kb} kB (${m.entry.file}), first paint ${m.firstPaint.kb} kB across ${m.firstPaint.files} file(s), largest other ${m.largest?.kb ?? 0} kB (${m.largest?.file ?? "-"}), total ${m.totalKb} kB gzip across ${m.files} files`,
  );
  if (update) {
    const baseline = {
      entryKb: m.entry.kb,
      firstPaintKb: m.firstPaint.kb,
      totalKb: m.totalKb,
      measuredAt: new Date().toISOString().slice(0, 10),
    };
    writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Wrote ${BASELINE_FILE}.`);
    return 0;
  }
  let baseline = null;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  } catch {
    console.error(`Bundle budget: ${BASELINE_FILE} is missing; run with --update to create it.`);
    return 1;
  }
  const { failures, notes } = judge(m, baseline);
  for (const n of notes) console.log(`  note: ${n}`);
  if (failures.length === 0) {
    console.log("Bundle budget: within budget.");
    return 0;
  }
  for (const f of failures) console.error(`  over budget: ${f}`);
  console.error(
    "If the growth is intended, lazy-load it or update the baseline with --update and say why.",
  );
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
