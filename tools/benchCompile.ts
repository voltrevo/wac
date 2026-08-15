// Compile time, by phase.
//
// Every other benchmark here measures a program this repo produces. This one measures the thing
// that produces them, which had no instrument at all until `issues/lang/0129` — the finding that
// a build lexes and parses the whole program five times was made by hand, with a throwaway script,
// which is exactly the state of affairs a benchmark exists to end.
//
// The interesting number is not the total. It is **emit's share of it**: `emitFiles` is the only
// call that generates code, and the other four exist to describe the same program. If that share
// climbs toward 100% someone has fixed 0129; if the total climbs while the share holds, the
// compiler got slower at everything at once.
//
//   deno task bench:compile          # four programs, small to large
//   deno task bench:compile --all    # every program in the repo — about two minutes, and the
//                                    # number `issues/lang/0129` quotes
//
// Timings are wall-clock on a shared box. The *shares* are what to quote: they are ratios taken
// within one run and do not care what else is running, which the absolute milliseconds very much
// do — `packages/zstd/README.md` has the cautionary tale of a table published without its load.

import { findPrograms } from "../harness/programs.ts";
import { waccApi } from "../harness/waccBuild.ts";
import { wacFiles } from "../harness/wacFiles.ts";

const all = Deno.args.includes("--all");

// deno-lint-ignore no-explicit-any
const api = await waccApi() as any;

/** The five calls `harness/waccBuild.ts` makes for one build, in the order it makes them. */
const PHASES: [string, (p: string[], s: string[], e: string) => unknown][] = [
  ["diagnoseGraph", (p, s, e) => api.diagnoseGraph(p, s, e)],
  ["blockedFiles", (p, s, e) => api.blockedFiles(p, s, e)],
  ["emitFiles", (p, s, e) => api.emitFiles(p, s, e)],
  ["bindTypesFiles", (p, s, e) => api.bindTypesFiles(p, s, e)],
  ["exportSigsFiles", (p, s, e) => api.exportSigsFiles(p, s, e)],
];

/** Small to large, spanning about 20x — the range over which emit's share stayed flat. */
const SAMPLES = [
  "packages/zstd/src/frame.wac",
  "packages/json/src/json.wac",
  "packages/wacc/src/api.wac",
  "packages/box/src/box.wac",
];

async function load(entry: string) {
  const files = await wacFiles(entry);
  const paths = [...files.keys()];
  const sources = paths.map((p) => files.get(p)!);
  return { paths, sources, kib: sources.reduce((n, s) => n + s.length, 0) / 1024 };
}

if (!all) {
  console.log(`## Compile time by phase\n`);
  console.log(`| program | files | KiB | ${PHASES.map(([n]) => n).join(" | ")} | total | emit |`);
  console.log(`|---|---:|---:|${PHASES.map(() => "---:").join("|")}|---:|---:|`);

  for (const entry of SAMPLES) {
    const { paths, sources, kib } = await load(entry);
    const ms = PHASES.map(([, f]) => {
      f(paths, sources, entry); // warm
      const t = performance.now();
      const n = 2;
      for (let i = 0; i < n; i++) f(paths, sources, entry);
      return (performance.now() - t) / n;
    });
    const total = ms.reduce((a, b) => a + b, 0);
    const emit = ms[2] / total * 100;
    const name = entry.replace(/^packages\//, "").replace(/\/src\/.*$/, "");
    console.log(
      `| ${name} | ${paths.length} | ${kib.toFixed(0)} | ` +
        `${ms.map((m) => m.toFixed(0)).join(" | ")} | ${total.toFixed(0)} | **${emit.toFixed(0)}%** |`,
    );
  }
  console.log(
    `\nMilliseconds, mean of 2 after a warm-up. **emit** is \`emitFiles\`' share of the total —\n` +
      `the only one of the five that generates code. See \`issues/lang/0129\`.`,
  );
} else {
  // The whole repo, once each. No warm-up and one run: this is the cold-build cost a change to a
  // widely-imported file actually imposes, and warming it would measure something nobody pays.
  const list = await findPrograms();
  const totals = new Map(PHASES.map(([n]) => [n, 0]));
  let done = 0, kib = 0, skipped = 0;

  for (const p of list) {
    let loaded;
    try {
      loaded = await load(p.path);
    } catch {
      skipped++;
      continue;
    }
    const { paths, sources } = loaded;
    let failed = false;
    for (const [name, f] of PHASES) {
      const t = performance.now();
      try {
        f(paths, sources, p.path);
      } catch {
        // A program wacc declines is still worth the phases that got that far — but say so at the
        // end rather than reporting a total that quietly covers fewer programs than it claims.
        failed = true;
      }
      totals.set(name, totals.get(name)! + (performance.now() - t));
      if (failed) break;
    }
    if (failed) skipped++;
    else {
      done++;
      kib += loaded.kib;
    }
  }

  console.log(`## Cold build, every program\n`);
  console.log(`${done} programs, ${(kib / 1024).toFixed(1)} MiB of source` +
    (skipped > 0 ? `, ${skipped} skipped (unreadable or declined)` : ""));
  console.log(`\n| phase | s |\n|---|---:|`);
  let sum = 0;
  for (const [name, ms] of totals) {
    sum += ms;
    console.log(`| ${name} | ${(ms / 1000).toFixed(1)} |`);
  }
  console.log(`| **total** | **${(sum / 1000).toFixed(1)}** |`);
  const emit = totals.get("emitFiles")!;
  console.log(`\nCode generation is ${(emit / sum * 100).toFixed(0)}% of it.`);
}
