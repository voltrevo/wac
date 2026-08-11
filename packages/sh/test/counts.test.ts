// **The corpus size, as three documents state it.**
//
// `packages/sh/README.md` said the differential ran 817 scripts. The corpus had grown to 821 and the
// differential had *shrunk* to 552, because 0103 moved eleven programs to `packages/box` and
// `usesDeleted` filters out every script naming one — those run in `packages/box/test/corpus.test.ts`
// instead. So the number was wrong in both directions at once, and nothing failed: a prose number is
// not read by anything.
//
// This is the same shape as `packages/box`'s "the README states the applet count the dispatcher
// actually has", for the same reason. The split matters more than the total, because the split is
// what tells a reader that a script naming `grep` is still compared with bash — somewhere else.

import { CORPUS, needsProgram, usesDeleted } from "./corpus.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    const detail = msg === undefined ? "" : ` — ${msg}`;
    throw new Error(
      `assertEquals failed${detail}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

Deno.test("the README states the corpus split the corpus actually has", async () => {
  const readme = await Deno.readTextFile("packages/sh/README.md");
  const claimed = [...readme.matchAll(/\*\*(\d+)\*\*/g)].map((m) => Number(m[1])).slice(0, 3);

  const total = CORPUS.length;
  const differential = CORPUS.filter((s) => !usesDeleted(s)).length;
  const box = CORPUS.filter(needsProgram).length;

  assertEquals(
    claimed.join("/"),
    [total, differential, box].join("/"),
    `the README claims ${claimed.join("/")}, the corpus is ${total}/${differential}/${box}`,
  );

  // Every script is on exactly one side. If this ever fails, one of the two suites has stopped
  // covering scripts the other never took — which is the failure the split was written to rule out.
  assertEquals(differential + box, total, "a script is in both halves, or in neither");
});
