// Compile time, by phase.
//
// Every other benchmark here measures a program this repo produces. This one measures the thing
// that produces them, which had no instrument at all until `issues/lang/0129` — the finding that
// a build repeated the whole front end for each question was made by hand, with a throwaway script,
// which is exactly the state of affairs a benchmark exists to end.
//
// The interesting number is not the total. It is **emit's share of it**: `emitFiles` is the only
// call that generates code, and the others exist to check or describe the same program. If that
// share climbs toward 100% someone has finished 0129; if the total climbs while the share holds, the
// compiler got slower at everything at once.
//
//   deno task bench:compile          # four programs, small to large
//   deno task bench:compile --mem    # peak memory per phase, one process each
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
const mem = Deno.args.includes("--mem");
// `--phase <name> <entry>` is this file re-invoking itself: peak memory has to be measured one
// phase per process. A collection during phase 3 otherwise shows up as phase 4 using less, which
// is how the first version of this measurement reported `bindTypesFiles` at *minus* 178 MiB.
const phaseArg = Deno.args.indexOf("--phase");

// deno-lint-ignore no-explicit-any
const api = await waccApi() as any;

/**
 * The calls `harness/waccBuild.ts` makes for one build, in the order it makes them.
 *
 * **This has to track the harness or it measures a path nobody takes**, and asking politely does
 * not work. It listed five calls until `describeFiles` folded three into one, and reported 106 s
 * for a build that no longer cost that. The fix carried a note in bold saying to keep it in step;
 * one commit later `buildFiles` folded two more and the note was ignored by the person who wrote
 * it, within the hour, because nothing failed. So `benchCompile.test.ts` asserts that every
 * `api.*` call in `harness/waccBuild.ts` is either timed here or carries a `bench-exempt` line
 * saying why. Add a call to a build and this goes red until you decide which it is.
 */
// **The `In` variants, because that is what a build calls now.** `harness/waccBuild.ts` passes the
// project roots through so a `@/` import resolves (`issues/system/0229a`), and this guard went red the
// moment it did — which is the guard working: timing `diagnoseGraph` while a build calls
// `diagnoseGraphIn` would have reported the cost of a different function with the same body.
// An empty `Res` is what the repository's own programs resolve with, none of them having a `@/`.
const PHASES: [string, (p: string[], s: string[], e: string) => unknown][] = [
  ["diagnoseGraphIn", (p, s, e) => api.diagnoseGraphIn(p, s, api.Res.empty(), e)],
  ["buildFilesIn", (p, s, e) => api.buildFilesIn(p, s, api.Res.empty(), e)],
];

// bench-exempt: describeSeparator — a constant, not compiler work.
// bench-exempt: covTableFilesIn — only a coverage build asks for it.
// bench-exempt: emitFilesCoveredIn — the coverage path's own front.
// bench-exempt: describeFilesIn — the coverage path still uses it; its root-less twin is timed under
// SUPERSEDED, and the two differ only in whether the `Res` is empty.

/** What one call replaced, still exported, and timed here so the folds stay visible. */
const SUPERSEDED: [string, (p: string[], s: string[], e: string) => unknown][] = [
  ["blockedFiles", (p, s, e) => api.blockedFiles(p, s, e)],
  ["exportSigsFiles", (p, s, e) => api.exportSigsFiles(p, s, e)],
  ["bindTypesFiles", (p, s, e) => api.bindTypesFiles(p, s, e)],
  ["emitFiles", (p, s, e) => api.emitFiles(p, s, e)],
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

/** Peak resident set so far, in MiB. Linux only — `--mem` says so rather than printing NaN. */
function peakRssMiB(): number {
  const m = Deno.readTextFileSync("/proc/self/status").match(/VmHWM:\s+(\d+) kB/);
  return m ? parseInt(m[1]) / 1024 : NaN;
}

if (phaseArg >= 0) {
  // One phase, this process, then say what it peaked at. `baseline` runs nothing: wacc is bound
  // either way, and that floor is most of the number.
  const name = Deno.args[phaseArg + 1];
  const entry = Deno.args[phaseArg + 2];
  const { paths, sources } = await load(entry);
  const before = peakRssMiB();
  if (name !== "baseline") {
    // deno-lint-ignore no-explicit-any
    (api as any)[name](paths, sources, entry);
  }
  console.log(`${before.toFixed(0)}\t${peakRssMiB().toFixed(0)}`);
} else if (mem) {
  const entry = SAMPLES[3];
  if (Number.isNaN(peakRssMiB())) {
    console.log("`--mem` needs /proc/self/status — Linux only.");
  } else {
    console.log(`## Peak memory by phase\n\n${entry}\n`);
    console.log(`| phase | peak MiB | above baseline |\n|---|---:|---:|`);
    let base = 0;
    for (const name of ["baseline", ...PHASES.map(([n]) => n)]) {
      const out = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", import.meta.filename!, "--phase", name, entry],
      }).output();
      const [, peak] = new TextDecoder().decode(out.stdout).trim().split("\t").map(Number);
      if (name === "baseline") base = peak;
      console.log(
        `| ${name} | ${peak.toFixed(0)} | ${name === "baseline" ? "—" : (peak - base).toFixed(0)} |`,
      );
    }
    console.log(
      `\nOne phase per process: a collection during one otherwise reads as another using less.\n` +
        `The calls that are not \`emitFiles\` allocate about as much as emitting does, to check and\n` +
        `describe the program emitting has already parsed — \`issues/lang/0129\`.`,
    );
  }
} else if (!all) {
  console.log(`## Compile time by phase\n`);
  console.log(`| program | files | KiB | ${PHASES.map(([n]) => n).join(" | ")} | total | build |`);
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
    const emit = ms[1] / total * 100;
    const name = entry.replace(/^packages\//, "").replace(/\/src\/.*$/, "");
    console.log(
      `| ${name} | ${paths.length} | ${kib.toFixed(0)} | ` +
        `${ms.map((m) => m.toFixed(0)).join(" | ")} | ${total.toFixed(0)} | **${emit.toFixed(0)}%** |`,
    );
  }
  console.log(
    `\nMilliseconds, mean of 2 after a warm-up. \`buildFiles\` is the whole of a build's\n` +
      `compiler work in one call; \`diagnoseGraph\` is the checker. See \`issues/lang/0129\`.`,
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
  // **Look the phase up, do not name it twice.** These two lines said "emitFiles" and
  // "describeFiles" after PHASES had moved on, and printed `NaN%` — which is at least loud. The
  // drift guard in `benchCompile.test.ts` did not catch it: it checks that every call a *build*
  // makes is timed, not that this file's own summary names a phase it still has.
  const build = totals.get(PHASES[1][0])!;
  console.log(
    `\n${PHASES[1][0]} is ${(build / sum * 100).toFixed(0)}% of it; the rest is checking.`,
  );

  // And what the three folded calls cost when asked separately, which is what a build paid before
  // `describeFiles` and what the saving is measured against.
  let was = 0;
  for (const [, f] of SUPERSEDED) {
    for (const p of list) {
      let loaded;
      try { loaded = await load(p.path); } catch { continue; }
      const t = performance.now();
      try { f(loaded.paths, loaded.sources, p.path); } catch { /* declined; still timed */ }
      was += performance.now() - t;
    }
  }
  console.log(
    `\n\`${PHASES[1][0]}\` costs ${(build / 1000).toFixed(1)} s where the ` +
      `${SUPERSEDED.length} calls it replaced cost ${(was / 1000).toFixed(1)} s separately — ` +
      `one front end instead of ${SUPERSEDED.length}.`,
  );
}
