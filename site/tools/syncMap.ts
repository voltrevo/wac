#!/usr/bin/env -S deno run --allow-read --allow-write
// Regenerate `src/data/built.ts` from the repository's generated MAP.md.
//
//   deno run --allow-read --allow-write site/tools/syncMap.ts
//
// The site claims what has been built in wac — thirty-odd packages with their sizes and test
// counts, the corpus, the applets. Those numbers belong to the tree, and typing them into JSX means
// they are wrong by the end of the week: this file exists because the front page said 652
// differential scripts against a corpus of 817, in four places. `MAP.md` is generated and its
// staleness is a failing test, so it is the closest thing to a source of truth there is.
//
// The generated file is committed, so a checkout can build the site without running this. The Pages
// build runs it first, so what the site serves is current as of that deploy. The page still rounds
// the headline figures: a snapshot of a moving tree should not pretend to four significant digits.
//
import { countTestsDeclaredHere } from "../../harness/testRegistrars.ts";

const mono = // The repository root. Run from there — these shell out to `deno task`, which needs the
// root's deno.json, and they read `packages/` and `MAP.md`. It used to be a sibling
// checkout of the packages repository; the merge made it the tree this file is in.
// **Defaulting to this file's own root rather than to `.`**, because the cwd is not the
// caller's promise: `tools/syncBootstrap.ts` had the same shape and took the website's
// deploy down when a workflow step ran it with `working-directory: site`.
Deno.args.find((a) => !a.startsWith("--")) ?? new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const map = await Deno.readTextFile(`${mono}/MAP.md`);

const totals = map.match(
  /^([\d,]+) packages, ([\d,]+) lines of wac, ([\d,]+) tests,\s*\n([\d,]+) command-line programs and ([\d,]+) browser pages/m,
);
if (totals === null) {
  console.error("MAP.md's totals line did not parse — has its format changed?");
  Deno.exit(1);
}

type Row = { name: string; what: string; lines: number; tests: number };
const rows: Row[] = [];
// `| [`name`](packages/name/) | summary | 1,234 | 56 | deps |`
for (const m of map.matchAll(/^\| \[`([a-z0-9-]+)`\][^|]*\| ([^|]+) \| ([\d,]+) \| (\d+) \|/gm)) {
  rows.push({
    name: m[1],
    // Backticks and bold markers go: the page renders this as text, not as markdown. A summary is
    // a package README's first sentence, and three of them start mid-emphasis — `lightclient`'s
    // reads "**The Altair sync protocol works." — so an unpaired `**` arrives as two asterisks on
    // screen rather than as nothing.
    what: m[2].trim().replace(/[`*]/g, ""),
    lines: Number(m[3].replace(/,/g, "")),
    tests: Number(m[4]),
  });
}
if (rows.length === 0) {
  console.error("no package rows parsed from MAP.md");
  Deno.exit(1);
}

/**
 * `Deno.test(` declarations under `dirs`, recursively, in `*.test.ts` only.
 *
 * MAP.md's test count is the *packages*, which is the right number beside a package table and is
 * not the size of the suite: it leaves out the harness, the tools and the compiler's own 1,200-odd.
 *
 * Counted through `harness/testRegistrars.ts`, which is what makes that claim true rather than
 * merely intended. It used to be a bare `/Deno\.test\(/g` here beside a shared list there, and the
 * two diverged the moment a wrapper existed: `docTest` — the doc checks, which warn rather than fail
 * — took **19 tests** out of this figure the day it landed, and `testBounded` had never been counted
 * at all. That is the third time this exact drift has happened, and the list's own comment predicted
 * the first two.
 *
 * It is still an *undercount* of what the suites report — a test generated inside a helper or a loop
 * is one declaration and several runs — which is the safe direction for a number on a landing page.
 */
async function testDecls(root: string, dirs: string[]): Promise<number> {
  let n = 0;
  for (const dir of dirs) {
    const walk = async (path: string): Promise<void> => {
      for await (const e of Deno.readDir(path)) {
        const full = `${path}/${e.name}`;
        if (e.isDirectory) await walk(full);
        else if (e.name.endsWith(".test.ts")) {
          n += countTestsDeclaredHere(await Deno.readTextFile(full));
        }
      }
    };
    try {
      await walk(`${root}/${dir}`);
    } catch {
      // A directory that is not there contributes nothing rather than failing the sync: this runs
      // against whatever checkout is beside it, and the layout is the other repo's to change.
    }
  }
  return n;
}

/**
 * The bash differential corpus, counted from the list itself.
 *
 * The site quoted this by hand and it was 652 against a corpus of 817 — a number that only moves
 * upward, so a stale one always understates. Counted rather than parsed for meaning: entries are
 * string literals in an exported array, and what is wanted is how many.
 */
async function corpusSize(root: string): Promise<number> {
  // Imported rather than pattern-matched. The first version counted lines that open with a quote
  // and answered 742 against a corpus of 817: an entry spanning two lines is one script, and a
  // heuristic that is 9% low is worse than no number, because it looks like a number. The file is
  // a data module with no imports of its own, so asking it is cheap and cannot be wrong.
  // `root` is relative to the working directory, as every other path in this script is, so it is
  // resolved to an absolute one rather than against this module's own URL.
  const abs = await Deno.realPath(`${root}/packages/sh/test/corpus.ts`);
  const mod = await import(`file://${abs}`) as { CORPUS?: string[] };
  if (!Array.isArray(mod.CORPUS)) throw new Error(`${abs}: no CORPUS array — has it moved?`);
  return mod.CORPUS.length;
}

/**
 * How many applets `packages/box` dispatches, from the same list `boxNames()` returns.
 *
 * "sixty applets" was on four pages while the answer was sixty-three. `appletNames` is what the
 * shell wires in, what `/bin` is built from and what box's own suite ties to the dispatcher, so
 * counting it is counting the thing every one of those claims is about.
 */
async function appletCount(root: string): Promise<number> {
  const src = await Deno.readTextFile(`${root}/packages/box/src/box.wac`);
  const body = src.match(/export string\[\] appletNames\(\) \{\s*return string\[\]\(([\s\S]*?)\);/);
  if (body === null) throw new Error("packages/box/src/box.wac: no appletNames — has it moved?");
  return (body[1].match(/"/g) ?? []).length / 2;
}

/**
 * Test files written in wac rather than in the host language.
 *
 * The site claimed 78 against an actual 131 — a claim that only grows, so a stale one always
 * understates the thing it is trying to boast about. Counted under each package's `test/`, which
 * is where a wac test lives whether or not it sits in a `wac/` subdirectory.
 */
async function wacTestFiles(root: string): Promise<number> {
  let n = 0;
  const walk = async (path: string): Promise<void> => {
    for await (const e of Deno.readDir(path)) {
      if (e.isDirectory) await walk(`${path}/${e.name}`);
      else if (e.name.endsWith(".wac")) n++;
    }
  };
  for await (const pkg of Deno.readDir(`${root}/packages`)) {
    if (!pkg.isDirectory) continue;
    try { await walk(`${root}/packages/${pkg.name}/test`); } catch { /* no test dir */ }
  }
  return n;
}

const here = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
// Everything outside `packages/`, which is what MAP.md counts. One repository since 2026-08-09, so
// this used to be two walks over two checkouts and is now one over four directories.
const otherTests = await testDecls(mono, ["compiler", "harness", "tools", "site/tools"]);
const corpus = await corpusSize(mono);
const applets = await appletCount(mono);
const wacTests = await wacTestFiles(mono);

const num = (s: string) => Number(s.replace(/,/g, ""));
const out = `// Generated by site/tools/syncMap.ts from MAP.md — do not edit by hand.
//
// Regenerate from the repository root:
//
//   deno run --allow-read --allow-write site/tools/syncMap.ts
//
// The committed copy is what the site serves if the script has not run; the Pages build runs it
// before building, so a deploy is current as of that moment. The page still rounds the headline
// figures: they are a snapshot at one moment, and a number like that should not pretend to four
// significant figures even when it happens to have them. Until 2026-08-12 this header told the
// reader to fetch a sibling checkout — three days after the two repositories became one and the
// map moved into this tree.

export type BuiltPackage = {
  name: string;
  what: string;
  lines: number;
  tests: number;
};

/** Package count, lines of wac, tests, command-line programs, browser pages. */
export const TOTALS = {
  packages: ${num(totals[1])},
  lines: ${num(totals[2])},
  /** the *packages* — the number that belongs beside the package table. */
  tests: ${num(totals[3])},
  programs: ${num(totals[4])},
  pages: ${num(totals[5])},
  /**
   * The whole repository: the packages (${num(totals[3])}), and the compiler, harness and tooling
   * around them (${otherTests}).
   *
   * An undercount, because a test generated in a helper or a loop is one declaration and several
   * runs — the suites themselves report more than this.
   */
  testsAll: ${num(totals[3]) + otherTests},
  /** Scripts in the bash differential corpus — \`packages/sh/test/corpus.ts\`. */
  corpus: ${corpus},
  /** Applets \`packages/box\` dispatches, which is what \`boxNames()\` returns and \`/bin\` lists. */
  applets: ${applets},
  /** Test files written in wac rather than in the host language. */
  wacTests: ${wacTests},
};

/** In dependency order, as MAP.md lists them: nothing imports anything above it. */
export const BUILT: BuiltPackage[] = [
${rows.map((r) => `  { name: ${JSON.stringify(r.name)}, what: ${JSON.stringify(r.what)}, lines: ${r.lines}, tests: ${r.tests} },`).join("\n")}
];
`;

const builtPath = new URL("../src/data/built.ts", import.meta.url).pathname;

/**
 * Digits blurred, so counts do not gate the check — the same bargain `tools/wac/map.wac` makes and for
 * the same reason: three agents share this repository, and a guard that fails whenever somebody
 * else adds a test is one everybody learns to re-run past.
 *
 * What it does catch is a package appearing or disappearing, which is what actually went wrong:
 * `raster` was in MAP.md and not here for as long as nothing regenerated this file, because
 * MAP.md's own staleness is a failing test and this file's was nobody's.
 */
const structure = (t: string) => t.replace(/\d[\d,]*/g, "#");

if (Deno.args.includes("--check")) {
  const have = await Deno.readTextFile(builtPath).catch(() => "");
  if (structure(have) !== structure(out)) {
    console.error("site/src/data/built.ts is out of date — run `wac task site:map`");
    Deno.exit(1);
  }
  console.log("site/src/data/built.ts is current");
  Deno.exit(0);
}

await Deno.mkdir(new URL("../src/data", import.meta.url).pathname, { recursive: true });
await Deno.writeTextFile(builtPath, out);
console.log(`src/data/built.ts: ${rows.length} packages, ${totals[3]} package tests, ` +
  `${otherTests} in the compiler, harness and tools, ` +
  `${corpus} corpus scripts, ${applets} applets, ${wacTests} wac test files`);
