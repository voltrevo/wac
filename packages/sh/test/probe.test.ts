// The coverage probe still compiles.
//
// `cov.ts` is not part of `deno task test` — it is slow and it is a measurement, not a check — so
// nothing in the suite touches `test/wac/probe.wac`. That was fine until the probe started
// building a whole fake capability world, and now every change to `Cli` or `Core` in
// `packages/platform` breaks it silently. It has broken twice: once when capabilities began
// returning `Pending<T>`, and once when `waitAny` moved from `Cli` to `Core` and `spawn` gained an
// argument. Both times the suite stayed green and `deno task coverage:sh` was simply dead until
// someone happened to run it.
//
// One `wacBind` is enough to catch that, and it costs about a second. It deliberately asserts
// nothing about coverage: this is a compile check wearing a test's clothes, and saying so here is
// cheaper than the next person wondering why it asserts so little.

import { wacBind } from "../../../harness/wacBind.ts";

Deno.test("the coverage probe compiles against the current platform", async () => {
  const mod = await wacBind("packages/sh/test/wac/probe.wac") as unknown as {
    shStatus(src: string): number;
    shOut(src: string): Uint8Array;
  };
  // And it runs, so a probe that compiles but cannot build its fake world is caught too.
  const status = mod.shStatus("exit 3");
  if (status !== 3) throw new Error(`the probe ran 'exit 3' and reported ${status}`);

  // A world with no `spawn` falls through to the shell's own implementations rather than reporting
  // the program broken. The fake world answers -2 for `/bin/echo`, which is both a name on
  // `$WACPATH` and a builtin — so "hi" proves the fallthrough and 126 would prove the bug. This is
  // the browser terminal's case: a page cannot spawn, and sixty applets work there anyway.
  const out = new TextDecoder().decode(mod.shOut("WACPATH=/bin; echo hi"));
  if (out !== "hi\n") throw new Error(`a world without spawn did not fall through: ${JSON.stringify(out)}`);
  if (mod.shStatus("WACPATH=/bin; echo hi") !== 0) {
    throw new Error("...and its status was not 0");
  }
});

Deno.test("help's builtin list and the dispatcher agree", async () => {
  // Two lists of the same names is how they drift, and these had: the hand-written line in `help` had
  // lost `read`, `shift` and `set`, and would have lost `printf` the moment it became a builtin. `help`
  // reads `builtinNames` now, and this is what keeps that list honest against `isBuiltin`.
  const m = await wacBind("packages/sh/test/wac/probe.wac") as unknown as {
    shBuiltinsAgree(): number;
    shBuiltinCount(): number;
  };
  const count = m.shBuiltinCount();
  if (count < 15) throw new Error(`builtinNames lists only ${count} names — did it empty itself?`);
  const wrong = m.shBuiltinsAgree();
  if (wrong !== 0) throw new Error(`${wrong} of ${count} builtin names are not dispatched as builtins`);
});
