// The numbers a `design/` document states, against the code it is describing.
//
// `design/0001`'s state-of-play table is the page anyone reads to find out where WacLand is, and it is
// the page nobody's test was reading. Four separate sentences said **sixty applets** where there were
// 63, step 1 said **57 scripts on both backings** where 817 run on three, step 2a said the network was
// what remained while `arrival_users.test.ts` was serving ssh from the second host, and step 7 said in
// its first sentence that `init` was done and in its last that `init` was what was left.
//
// None of that was carelessness. A count is written once by someone who has just counted, and then the
// thing counted grows — which is exactly the argument `packages/box/test/box.test.ts` already makes
// about its own README, in a test whose comment says "prose numbers drift silently. This one said
// fifty-nine when there were sixty, and forty-two in a paragraph further down, both written by someone
// who had just counted." The design documents had no such test, and they are read more.
//
// ## What can and cannot be checked here
//
// Only claims with a number and a mechanical source. "The network is in" is prose and stays prose; a
// human has to re-read it, and the way to make that likely is to keep the checkable half honest so the
// page is worth trusting. So this checks two things, and the design states them **in digits** so that
// it can:
//
//   - every "`N` applets" — against `box.wac`'s dispatcher, which is the same source
//     `packages/box/README.md` is held to
//   - every "`N` scripts" — against `packages/sh/test/corpus.ts`, which is the corpus itself
//
// Both are *every occurrence*, not the first: the box README's own drift was a second paragraph that
// disagreed with the first, and four of design/0001's five applet counts would have passed a check that
// stopped at one.

import { CORPUS } from "../packages/sh/test/corpus.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

/** Every `design/*.md`, so a document added later is covered without this file being edited. */
async function designDocs(): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  for await (const entry of Deno.readDir("design/system")) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    out.push({ path: `design/system/${entry.name}`, text: await Deno.readTextFile(`design/system/${entry.name}`) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The line a match falls on, so a failure names somewhere to look rather than a number. */
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

const appletCount = (() => {
  const src = Deno.readTextFileSync("packages/box/src/box.wac");
  // The same expression `box.test.ts` counts with, against the same file, so the two cannot disagree
  // about what an applet is. A doc *comment* in that file quotes this pattern with an ellipsis inside
  // the quotes; `[a-z0-9-]+` excludes it, which is why the two counts differ by one from a naive grep.
  return [...src.matchAll(/if \(applet == "([a-z0-9-]+)"/g)].length;
})();

Deno.test("every applet count a design document states is the dispatcher's", async () => {
  const wrong: string[] = [];
  for (const { path, text } of await designDocs()) {
    for (const m of text.matchAll(/(\d+) applets/g)) {
      if (Number(m[1]) !== appletCount) {
        wrong.push(`${path}:${lineOf(text, m.index)}: says ${m[1]}, box.wac dispatches ${appletCount}`);
      }
    }
  }
  assertEquals(wrong.join("\n"), "", "a design document's applet count has drifted");
});

Deno.test("every corpus size a design document states is the corpus's", async () => {
  const wrong: string[] = [];
  for (const { path, text } of await designDocs()) {
    for (const m of text.matchAll(/(\d+) scripts/g)) {
      // A *bounded sample* is a real claim too and reads the same way, so it is allowed to be smaller —
      // what must not happen is a number **larger** than the corpus, or one that used to be the whole
      // of it and has quietly become a fraction. Step 1's "57 scripts" was the second: true when it was
      // written, and by the time anyone read it the corpus was fourteen times that.
      if (Number(m[1]) > CORPUS.length) {
        wrong.push(`${path}:${lineOf(text, m.index)}: says ${m[1]}, the corpus has ${CORPUS.length}`);
      }
    }
  }
  assertEquals(wrong.join("\n"), "", "a design document claims more scripts than there are");
});

Deno.test("the checks above have something to check", () => {
  // The canary, and it is not decoration: both tests above pass vacuously if the regexes match nothing
  // — which is what would happen the day somebody rewrites a count as words. Four of design/0001's were
  // words when this was written ("sixty applets"), and putting them in digits is what makes them
  // checkable at all. If this fails, the numbers have gone back to prose rather than gone away.
  const text = Deno.readTextFileSync("design/system/0001-a-self-contained-system.md");
  assertEquals(
    [...text.matchAll(/\d+ applets/g)].length > 0,
    true,
    "design/0001 states no applet count in digits — a spelled-out number cannot be checked",
  );
  assertEquals([...text.matchAll(/\d+ scripts/g)].length > 0, true, "design/0001 states no corpus size");
  // And that the sources are real, so a mis-read file cannot make both lists trivially empty.
  assertEquals(appletCount > 50, true, `box.wac dispatches only ${appletCount} applets`);
  assertEquals(CORPUS.length > 500, true, `the corpus has only ${CORPUS.length} scripts`);
});
