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
import { docTest } from "./docCheck.ts";


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

docTest("the README's figures are still true of the tree", async () => {
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
 * The same, for `packages/README.md`, which states the figures again and was in no check at all.
 *
 * It said **32 packages, ~64,000 lines of wac, ~1,300 tests** while `MAP.md` — generated from the
 * tree, in the same repository, checked by the suite — said 35, 102,644 and 1,766. Sixty per cent
 * out on the line count and thirty-five on the tests, in the file a new package author reads first.
 * The test above had existed for days and passes, because it reads the *root* README and nothing
 * had noticed there were two.
 *
 * Compared against `MAP.md`'s own headline sentence rather than recomputed, because that sentence
 * is generated and this one is a copy of it: what is being checked is whether the copy still says
 * what the original does. Same tolerance and same doctrine as above — this fails on rot, not on
 * somebody else's new package.
 */
docTest("packages/README's headline figures are the ones MAP.md generates", async () => {
  const flat = (s: string) => s.replace(/\s+/g, " ");
  const map = flat(await Deno.readTextFile(new URL("../MAP.md", import.meta.url)));
  const readme = flat(await Deno.readTextFile(new URL("../packages/README.md", import.meta.url)));

  const shape =
    /([\d,]+) packages, ([\d,]+) lines of wac, ([\d,]+) tests[^,]*, ([\d,]+) command-line programs and ([\d,]+) browser pages/;
  const names = ["packages", "lines of wac", "tests", "command-line programs", "browser pages"];

  const generated = shape.exec(map);
  if (generated === null) {
    throw new Error(
      "MAP.md no longer states its figures in the shape this reads — `deno task map` generates " +
        "that sentence, so reword this test with it rather than deleting the check.",
    );
  }
  const copied = shape.exec(readme);
  if (copied === null) {
    throw new Error(
      "packages/README.md no longer states the figures MAP.md does. If they were dropped on " +
        "purpose, delete this test in the same commit; a check that matches nothing passes by " +
        "checking nothing.",
    );
  }

  const wrong: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const want = Number(generated[i + 1].replace(/,/g, ""));
    const got = Number(copied[i + 1].replace(/,/g, ""));
    if (!near(got, want)) {
      wrong.push(
        `${names[i]}: packages/README says ${got.toLocaleString()}, MAP.md says ` +
          `${want.toLocaleString()} (${((got - want) / want * 100).toFixed(0)}%, tolerance ` +
          `±${TOLERANCE * 100}%)`,
      );
    }
  }
  assertEquals(wrong, [], `packages/README has gone stale:\n  ${wrong.join("\n  ")}`);
});

/**
 * The README's shell transcript is the front page's, character for character.
 *
 * `frontpage.test.ts` runs those commands for real — but it reads `Home.tsx`, so the README's copy
 * is a second transcription with nothing behind it. The README says out loud that the lines are
 * tested, which is only true while the two agree, so this is what makes that sentence honest.
 */
docTest("the README's transcript is the one the front page tests", async () => {
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

// ---------------------------------------------------------------------------------------------
// The same figure, in every document that states it.
//
// `packages/box`'s README says out loud why its own count is a digit — "it kept going stale: it said
// fifty-nine when the dispatcher had sixty, and before that forty-two in one paragraph and something
// else in another" — and `box.test.ts` ties that digit to the dispatcher's own branches. That fixed
// the copy with a test under it and nothing else. Six other live documents stated the size of `box`
// too, and five of them said **sixty** or **sixty-odd** or **forty-two** while the dispatcher had 65:
// `packages/README.md`'s one-line description of the package, `packages/sh`'s table of shells,
// `native/README.md`, `packages/box/example/README.md` twice, `packages/platform/README.md` twice,
// and `design/system/0001`'s userland claim.
//
// A word is what let it drift: "sixty" against 65 is 8%, which any tolerance this test could sanely
// carry would wave through, and it reads as a round number rather than a claim. So the rule here is
// the one box's README already states — **a count of applets in a live document is a digit** — and
// then the digit is checked like any other figure.
//
// A count that is deliberately *not* the total goes in `NOT_THE_TOTAL` with the words and the reason.
// That list is the maintenance cost and it is also the point: a new count appearing anywhere fails
// until somebody says which kind it is.

/** Where a number word is a real claim about how many applets there are, this is the whole list. */
const WORD = /\b(ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(-[a-z]+)?\b/;

/** Counts that are not the size of the program, each with what it does count. */
const NOT_THE_TOTAL: { file: string; phrase: string; why: string }[] = [
  {
    file: "packages/box/README.md",
    phrase: "a dozen applets were",
    why: "how many were still stubs when the flag parser arrived",
  },
  {
    file: "packages/box/README.md",
    phrase: "Ten applets printed `c.message` raw",
    why: "how many printed the host's sentence before 2026-08-09",
  },
  {
    file: "packages/box/README.md",
    phrase: "375 flags and 43 applets",
    why: "the applets that take flags, which is the flag corpus rather than the program",
  },
];

/** Every tracked markdown file outside `issues/`, which records what was true on a day. */
async function liveDocs(): Promise<string[]> {
  const r = await new Deno.Command("git", { args: ["ls-files", "*.md"], stdout: "piped" }).output();
  const all = new TextDecoder().decode(r.stdout).split("\n").filter((l) => l.length > 0);
  if (all.length === 0) throw new Error("git ls-files listed no markdown — this check would pass by seeing nothing");
  return all.filter((p) => !p.startsWith("issues/"));
}

docTest("every document that counts box's applets counts them the same, in digits", async () => {
  const actual = await applets();
  const docs = await liveDocs();
  const wrong: string[] = [];
  let checked = 0;

  for (const path of docs) {
    const text = await Deno.readTextFile(new URL(`../${path}`, import.meta.url));
    for (const line of text.split("\n")) {
      for (const m of line.matchAll(/([A-Za-z0-9,-]+)[ -]applets\b/g)) {
        const token = m[1];
        const excused = NOT_THE_TOTAL.find((e) => e.file === path && line.includes(e.phrase));
        if (excused !== undefined) continue;
        if (WORD.test(token.toLowerCase())) {
          wrong.push(`${path}: "${token} applets" — write the count as a digit, or say in NOT_THE_TOTAL what it counts`);
          continue;
        }
        if (!/^\d[\d,]*$/.test(token)) continue; // "the applets", "its applets" — not a count
        checked++;
        const claimed = Number(token.replace(/,/g, ""));
        if (!near(claimed, actual)) {
          wrong.push(`${path}: "${claimed} applets", the dispatcher has ${actual}`);
        }
      }
    }
  }

  // The corpus is eight or so occurrences across six files. Zero means the regex stopped matching,
  // which is the failure this test cannot otherwise see: it would report a clean sweep of nothing.
  if (checked === 0) throw new Error("no applet count was found in any live document — has the wording changed?");
  assertEquals(wrong, [], `an applet count has gone stale:\n  ${wrong.join("\n  ")}`);
});
