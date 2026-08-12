// Branch coverage for one package, driven by that package's own exercises.
//
// `tools/coverage.ts` measures gzip: it hardcodes gzip's entry points and drives them
// with gzip's corpus. That is not a criticism of it — coverage without an exercise
// measures nothing, so the exercise has to come from whoever knows the package. This
// is the shared half, so each package can supply only its own half.
//
// A package adds `cov.ts` that instruments its entry points, runs whatever exercises
// them, and calls `report`. See `packages/json/cov.ts`.

import { wacCompile } from "wac/wacCompile.ts";
import { wacBindgen } from "wac/wacBindgen.ts";
import { wacFiles } from "./wacFiles.ts";

export type Point = {
  index: number;
  file: string;
  line: number;
  col: number;
  kind: string;
};

export type Instrumented = {
  mod: Record<string, unknown>;
  points: Point[];
  /** Counter values as they stand now. */
  counts(): number[];
};

/**
 * Compile an entry point with instrumentation and import the bound module.
 *
 * **The reference by default, and this is the one place that is still true.** `WAC_COV_FROM=wacc`
 * switches it, and everything needed for that switch works: wacc's emitter exports `__cov_init`,
 * `__cov_len` and `__cov_get`, the generator writes wrappers for them, and `covTableFiles` says what
 * each counter is, in the file and at the line the file's own editor shows.
 *
 * What is not ready is the *instrument*, and this paragraph used to say it was the ledgers. A
 * package's `cov.ts` carries a `NOT_COVERED` list naming the branches its tests deliberately do not
 * drive, and those lists are calibrated against one compiler's branch points. wacc instruments six
 * that the reference does not in `packages/fs` alone — real branches, at real lines — so switching
 * turns `deno task coverage:fs` red until somebody who knows why those branches are unreached
 * writes the reasons. That is a package's call, not this file's [issue 0105].
 *
 * **That is the smaller half of the difference and it is the one that shows.** wacc emits no `case`
 * points and no ternary points at all: for the same file the reference finds 125 match arms and 314
 * ternary sides that wacc does not, against the 298 `else` points wacc adds. So the switch drops 439
 * decisions and the ratchet reports a *higher* percentage for measuring less — the failure mode a
 * coverage number cannot show you, because the points that vanish are the hard ones. [issue 0112]
 * has the kind table and blocks the switch.
 */
export async function instrument(entry: string): Promise<Instrumented> {
  const files = await wacFiles(entry);
  await Deno.mkdir(".cache", { recursive: true });
  const out = `.cache/cov_${entry.replaceAll("/", "_")}.gen.ts`;

  let points: Point[];
  if (Deno.env.get("WAC_COV_FROM") !== "wacc") {
    const result = wacCompile(files, entry, { coverage: true });
    if (!result.ok) {
      throw new Error(`compile failed for ${entry}:\n${result.diagnostics.map(d =>
        `  ${d.file}:${d.line}:${d.col} ${d.message}`).join("\n")}`);
    }
    await Deno.writeTextFile(out, wacBindgen(result.compiled));
    points = result.compiled.coverage!;
  } else {
    const { waccArtifacts } = await import("./waccBuild.ts");
    const art = await waccArtifacts(files, entry, { coverage: true });
    await Deno.writeTextFile(out, art.glue);
    points = art.covPoints;
  }
  const mod = await import(`${Deno.cwd()}/${out}`) as Record<string, unknown>;
  // The counter array is allocated here, not at instantiation. Skip this and every
  // instrumented function traps on its first branch with "dereferencing a null
  // pointer" — a message that points at the program under test rather than at the
  // missing call. Done here so a caller cannot forget it.
  (mod.__cov_init as () => void)();
  return {
    mod,
    points,
    counts() {
      const len = (mod.__cov_len as () => number)();
      const get = mod.__cov_get as (i: number) => number;
      return Array.from({ length: len }, (_, i) => get(i));
    },
  };
}

/**
 * Merge several instrumented runs and print the result.
 *
 * Merged per (file, line, col, kind) rather than per module, because a file reachable
 * from two entry points appears in both and the union is what counts. Files are
 * filtered to `prefix` so a package's report does not claim coverage of its
 * dependencies — `bytes` is measured by its own run, not incidentally by json's.
 */
export function report(
  runs: Instrumented[],
  prefix: string,
  opts: { verbose?: boolean } = {},
): { total: number; covered: number; missed: Point[] } {
  const all = new Map<string, Point>();
  const hit = new Set<string>();
  for (const run of runs) {
    const counts = run.counts();
    for (const p of run.points) {
      if (!p.file.startsWith(prefix)) continue;
      const key = `${p.file}:${p.line}:${p.col}:${p.kind}`;
      all.set(key, p);
      if (counts[p.index] > 0) hit.add(key);
    }
  }

  const byFile = new Map<string, { n: number; c: number }>();
  for (const [key, p] of all) {
    const e = byFile.get(p.file) ?? { n: 0, c: 0 };
    e.n++;
    if (hit.has(key)) e.c++;
    byFile.set(p.file, e);
  }

  console.log("| file | points | covered | % |");
  console.log("|---|---:|---:|---:|");
  let total = 0, covered = 0;
  for (const file of [...byFile.keys()].sort()) {
    const { n, c } = byFile.get(file)!;
    total += n;
    covered += c;
    console.log(`| ${file} | ${n} | ${c} | ${(c / n * 100).toFixed(1)} |`);
  }
  const pct = total === 0 ? 100 : covered / total * 100;
  console.log(`| **${prefix}** | **${total}** | **${covered}** | **${pct.toFixed(1)}** |`);

  const missed = [...all.entries()].filter(([k]) => !hit.has(k)).map(([, p]) => p);
  if (missed.length > 0) {
    console.log(`\n${missed.length} branch points never executed:`);
    const show = opts.verbose ? missed : missed.slice(0, 20);
    for (const p of show.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(`  ${p.file}:${p.line}:${p.col}  ${p.kind}`);
    }
    if (!opts.verbose && missed.length > show.length) {
      console.log(`  ... and ${missed.length - show.length} more (--verbose for all)`);
    }
  }
  return { total, covered, missed };
}
