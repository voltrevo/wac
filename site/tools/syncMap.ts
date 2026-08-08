#!/usr/bin/env -S deno run --allow-read --allow-write
// Regenerate `src/data/built.ts` from wac-mono's generated MAP.md.
//
//   deno run --allow-read --allow-write tools/syncMap.ts [path-to-wac-mono]
//
// The site's landing page claims what has been built in wac — thirty-odd packages with their
// sizes and test counts. Those numbers belong to the other repo, and typing them into JSX means
// they are wrong by the end of the week. wac-mono generates `MAP.md` from its own tree and its
// suite fails when that file is stale, so it is the closest thing to a source of truth that
// exists for this, and this reads it.
//
// Not run in CI, deliberately: GitHub Pages builds this repo alone and has no wac-mono beside
// it. So the generated file is committed, and the freshness of the numbers is a thing somebody
// refreshes when they notice, not a thing that can break a deploy. Rounded on the page for the
// same reason — see `src/data/built.ts`.

const mono = Deno.args[0] ?? "../wac-mono";
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
 * MAP.md's test count is wac-mono's *packages*, which is the right number beside a package table
 * and is not the size of either suite: it leaves out wac-mono's own harness and tools, and it
 * knows nothing about this repo, where the compiler's 1,200-odd tests live.
 *
 * Counted the same way `map.ts` counts a package's host tests, so the two halves are commensurable.
 * It is an *undercount* of what the suites report — a test generated inside a helper or a loop is
 * one declaration and several runs — which is the safe direction for a number on a landing page.
 */
async function testDecls(root: string, dirs: string[]): Promise<number> {
  let n = 0;
  for (const dir of dirs) {
    const walk = async (path: string): Promise<void> => {
      for await (const e of Deno.readDir(path)) {
        const full = `${path}/${e.name}`;
        if (e.isDirectory) await walk(full);
        else if (e.name.endsWith(".test.ts")) {
          n += (await Deno.readTextFile(full)).match(/Deno\.test\(/g)?.length ?? 0;
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
const compilerTests = await testDecls(here, ["atoms", "tools", "src"]);
const monoOtherTests = await testDecls(mono, ["harness", "tools"]);
const corpus = await corpusSize(mono);
const applets = await appletCount(mono);
const wacTests = await wacTestFiles(mono);

const num = (s: string) => Number(s.replace(/,/g, ""));
const out = `// Generated by tools/syncMap.ts from wac-mono's MAP.md — do not edit by hand.
//
// Regenerate with a wac-mono checkout beside this one:
//
//   deno run --allow-read --allow-write tools/syncMap.ts ../wac-mono
//
// The committed copy is a fallback, for a checkout with no wac-mono beside it. The Pages build
// does have one and runs this script before building, so what the site serves is current as of
// that deploy. The page still rounds the headline figures: they are a snapshot of another
// repository at one moment, and a number like that should not pretend to four significant
// figures even when it happens to have them.

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
  /** wac-mono's *packages* — the number that belongs beside the package table. */
  tests: ${num(totals[3])},
  programs: ${num(totals[4])},
  pages: ${num(totals[5])},
  /**
   * Both suites: wac-mono's packages (${num(totals[3])}), its harness and tools (${monoOtherTests}),
   * and this repo's compiler (${compilerTests}).
   *
   * An undercount, because a test generated in a helper or a loop is one declaration and several
   * runs — the suites themselves report more than this.
   */
  testsAll: ${num(totals[3]) + monoOtherTests + compilerTests},
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

await Deno.mkdir(new URL("../src/data", import.meta.url).pathname, { recursive: true });
await Deno.writeTextFile(new URL("../src/data/built.ts", import.meta.url).pathname, out);
console.log(`src/data/built.ts: ${rows.length} packages, ${totals[3]} package tests, ` +
  `${monoOtherTests} in wac-mono's harness and tools, ${compilerTests} in the compiler, ` +
  `${corpus} corpus scripts, ${applets} applets, ${wacTests} wac test files`);
