// The figures the README quotes are still roughly the figures in the tree.
//
//     deno test -A tools/readmeFigures.test.ts
//
// ## Why
//
// The README said "24 packages, 41,000 lines of wac, 897 tests" for long enough that all three were
// wrong by more than half — the tree had 34 packages and about 89,000 lines by the time anybody
// looked. Nothing caught it because nothing was checking: `links.test.ts` checks that every path in
// a markdown file exists, and `docSignatures.test.ts` that every wac signature it prints is real,
// but a *number* in prose had no oracle at all.
//
// ## Why a tolerance rather than an equality
//
// An exact check would be red on the commit after every merge, and a test that is red for a reason
// nobody caused is a test people learn to ignore — worse than none, because it also blocks everyone
// else's push. So this fails on **rot**, not on drift: 10% either way is fine, and what it catches
// is the shape the README actually reached, where the packages were out by 42% and the line count by
// 117%.
//
// The consequence is deliberate: this will not tell you the README is a little stale. It will tell
// you when it has stopped being true.

/** Local, because this repository has no dependencies and the tools tree asserts for itself. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(`assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`);
  }
}

const TOLERANCE = 0.1;

/** Every package row's line count in `MAP.md`, which `deno task map` generates from the tree. */
async function mapFigures(): Promise<{ packages: number; wacLines: number }> {
  const map = await Deno.readTextFile(new URL("../MAP.md", import.meta.url));
  let packages = 0;
  let wacLines = 0;
  for (const line of map.split("\n")) {
    // A package row, whose shape is: a link to `packages/<name>/`, a description, the wac line
    // count, the test count, then what it uses. Written with angle brackets rather than a sample
    // path, because `links.test.ts` scans source comments too and a plausible-looking one is a
    // link it will go looking for — which is how this file first turned the suite red.
    const m = /^\| \[`[^`]+`\]\(packages\/[^)]+\) \|[^|]*\| *([\d,]+) *\|/.exec(line);
    if (m === null) continue;
    packages++;
    wacLines += Number(m[1].replace(/,/g, ""));
  }
  return { packages, wacLines };
}

/** The applet count, which `packages/box`'s own README states and `MAP.md` repeats. */
async function applets(): Promise<number> {
  const map = await Deno.readTextFile(new URL("../MAP.md", import.meta.url));
  const m = /(\d+) applets in one program/.exec(map);
  if (m === null) throw new Error("MAP.md no longer states an applet count — this test's source is gone");
  return Number(m[1]);
}

function near(claimed: number, actual: number): boolean {
  return Math.abs(claimed - actual) <= actual * TOLERANCE;
}

Deno.test("the README's figures are still true of the tree", async () => {
  const readme = await Deno.readTextFile(new URL("../README.md", import.meta.url));
  const { packages, wacLines } = await mapFigures();
  const appletCount = await applets();

  // Each entry is a sentence the README actually contains, so a failure names the words to change
  // rather than a variable. A pattern that stops matching is itself a failure: the figure was
  // reworded or dropped, and this test would otherwise pass by checking nothing.
  const claims: { what: string; re: RegExp; actual: number; scale: number }[] = [
    { what: "packages", re: /(\d+) packages, \d+k lines of wac/, actual: packages, scale: 1 },
    { what: "lines of wac", re: /\d+ packages, (\d+)k lines of wac/, actual: wacLines, scale: 1000 },
    { what: "applets", re: /A shell, (\d+) applets and a filesystem/, actual: appletCount, scale: 1 },
  ];

  const wrong: string[] = [];
  for (const { what, re, actual, scale } of claims) {
    const m = re.exec(readme);
    if (m === null) {
      wrong.push(`${what}: the README no longer contains a figure matching ${re} — reword the test with it`);
      continue;
    }
    const claimed = Number(m[1]) * scale;
    if (!near(claimed, actual)) {
      wrong.push(
        `${what}: README says ${claimed.toLocaleString()}, the tree has ${actual.toLocaleString()}` +
          ` (${((claimed - actual) / actual * 100).toFixed(0)}%, tolerance ±${TOLERANCE * 100}%)`,
      );
    }
  }
  assertEquals(wrong, [], `the README has gone stale:\n  ${wrong.join("\n  ")}`);
});

/**
 * The README's shell transcript is the front page's, character for character.
 *
 * `frontpage.test.ts` runs those commands for real — but it reads `Home.tsx`, so the README's copy
 * is a second transcription with nothing behind it. The README says out loud that the lines are
 * tested, which is only true while the two agree, so this is what makes that sentence honest.
 */
Deno.test("the README's transcript is the one the front page tests", async () => {
  const readme = await Deno.readTextFile(new URL("../README.md", import.meta.url));
  const home = await Deno.readTextFile(new URL("../site/src/next/Home.tsx", import.meta.url));

  const block = /export const TRANSCRIPT: \[string, string\]\[\] = \[([\s\S]*?)\n\];/.exec(home);
  if (block === null) throw new Error("Home.tsx has no TRANSCRIPT table — has it been renamed?");
  const theirs: string[] = [];
  for (const m of block[1].matchAll(/\[\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"\s*\]/g)) {
    theirs.push(`$ ${JSON.parse(`"${m[1]}"`)}`, JSON.parse(`"${m[2]}"`));
  }
  if (theirs.length === 0) throw new Error("no entries parsed out of TRANSCRIPT — this check is blind");

  const fence = /```\n(\$ seq[\s\S]*?)```/.exec(readme);
  if (fence === null) throw new Error("the README no longer opens with a `$ seq …` transcript block");
  const ours = fence[1].trimEnd().split("\n");

  assertEquals(ours, theirs, "the README's transcript has drifted from the front page's");
});
