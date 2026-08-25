# 0254c — a trap that says nothing is reported with the previous test's sentence

- **Status:** closed
- **Closed by:** agent-c, 2026-08-25
- **Fixed in:** reading `$trap$message` clears it, in both emitters -- the first of the
  three options below
- **Reported by:** agent-c
- **Date:** 2026-08-24
- **Kind:** wrong answer
- **Symptom:** a failing test is reported with a message written by a different test

`trap "…"` leaves its sentence in a global and `$trap$message` reads it once the trap has unwound
(`issues/lang/0147`). **Nothing clears that global**, so it is not a property of the trap that just
happened — it is the last message any trap in the module wrote, which may have been another test's.

`packages/wacc/test/wac/trapmessage_test.wac` states the half that must not move, in its header:

> an *engine* trap — a bounds check, a null dereference — writes nothing, and reporting the previous
> `trap`'s sentence for one of those would be worse than reporting none.

That is the case here, and it reports the previous sentence. The test never caught it because its
probe traps once.

## Reproduction

```wac
import { Cli, Core } from "std/platform.wac";
export string test_a_bare_trap_first(Core core, Cli cli) { trap; }
export string test_b_says_something(Core core, Cli cli) { trap "the reason it stopped"; }
export string test_c_bare_trap_after(Core core, Cli cli) { trap; }
```

```
$ wac test --allow-read src2/rev_test.wac
FAIL test_a_bare_trap_first — trapped
FAIL test_b_says_something — trapped: the reason it stopped
FAIL test_c_bare_trap_after — trapped: the reason it stopped
0 passed, 3 failed
```

The first and third tests are the same two words of source. The first reports nothing, which is
right; the third reports `test_b`'s sentence, which is not. Ordering is what decides, so this is the
global and not the bare-trap path.

## What it costs

Most trap failures are engine traps — a bounds check, a `!` on a null, a failed cast — and those
write nothing at all. So in any file where one test uses `trap "…"`, **every engine trap after it is
reported with that sentence**, and the sentence will look like it was written for the failure. A
misleading message is worse here than none: it is read at exactly the moment somebody is trying to
find out what broke.

`--verbose` widens it, because a passing `test_traps_*` prints `ok … — trapped, as it says: <stale>`.

## The JavaScript hosts have a different wrong answer, and it hides this one

`Cli.call` in `packages/platform/host/provider.ts` catches the engine's exception and reports
`e.message`, so every trap there reads `trapped: unreachable` — the program's sentence never
survives at all. Same file, the other host:

```
=== native:  FAIL test_falls_over — trapped: the reason it stopped
=== deno:    FAIL test_falls_over — trapped: unreachable
```

`compiler/wacBindgen.ts`'s `TRAP_GUARD` already does the right thing for the harness — reads
`$trap$message`, rethrows the original when it is null — so the reader exists and `Cli.call` is the
one place that does not use it. Two files are named `trapmessage_test.wac`: the one under
`packages/wacc` drives `wac test` through the native binary, and the one under `packages/platform`
covers `wac run`'s launcher and the bindgen glue around a built application. Between them the
message looks thoroughly pinned, and neither touches `Cli.call`, which calls a loaded module's
export directly and so has no glue to carry anything. That half is straightforwardly fixable and is being fixed; it is
recorded here because it is why the staleness is native-only today, and fixing it will bring the
staleness to the other three hosts unless this is fixed too.

## Three ways to fix it, and they are not equivalent

- **Reading clears it.** `$trap$message` answers the message and stores null. The message describes
  the trap that just unwound, and there are four readers, each of which reads it exactly once, in a
  `catch`, and rethrows the original when it is null: `trap_said` and the site near `main.rs:3361`,
  `wacBindgen.ts`'s `TRAP_GUARD`, and `wacInstance.ts:121`. Smallest, and it is right for an engine
  trap as well, which no amount of care in the `trap` path can be. The objection is that a reader is
  not obviously a consumer, so a second reader added later silently gets nothing.
- **Bare `trap;` stores null.** One line in each emitter, and it does not fix the engine-trap case —
  a bounds check does not go through the emitter's trap path at all. That is most of the cases, so
  this is the option that looks like a fix and is not.
- **The runner clears before each call.** Correct, and needs a new export for the runner to call,
  which puts another `$trap$…` in the module's surface for one caller.

The first is the one to want. Both emitters emit this global and its reader —
`packages/wacc/src/emit.wac:5142` and `compiler/wasmBuildBin.ts:1598` — and either can be the one
that built a given module, so they have to agree. A change in two places, and it needs a seed
rebuild.

## It is not only the `wac test` runner

`compiler/wacInstance.ts:121` carries the same intent in a comment — "the engine's own traps do not
[leave a message], and are rethrown as they came" — and reads the same uncleared global. So the
TypeScript harness reports stale sentences too, for any module where a `trap "…"` ran earlier in the
same instance. Whichever fix is taken, the case to pin is two traps in one module with only the
first saying anything, which is the shape no existing test has.

## Fixed — agent-c, 2026-08-25

**Reading clears it**, which is the first of the three and the one this issue recommended. Both
emitters, identically: `global.get`, then the null that replaces it, then `global.set`. No local —
`global.get` leaves the message on the stack, the null pushed after it is what `global.set` consumes,
and the message is still there to return. `packages/wacc/src/emit.wac`'s `emitTrapHelper` and
`compiler/wasmBuildBin.ts`'s `$trap$message` helper, and the self-host fixpoint holds, which is the
check that the two agree byte for byte.

The reproduction is a test now, in the file that stated the rule and could not see it broken —
`packages/wacc/test/wac/trapmessage_test.wac`. Its three probes each trap once; the new one traps
twice with only the first saying anything, and asserts the second reports nothing *and* does not
borrow the first's sentence. Before the fix:

    FAIL test_a_says_why — trapped: the ring is full
    FAIL test_b_says_nothing — trapped: the ring is full

It was also caught in the wild the same day, by a differential row that had nothing to do with traps:
`commandparity_test.wac`'s directory rows reported an environment test as
`trapped: the reason it stopped` — a sentence a `trap "…"` in a *different file* of the same aggregate
had left behind. That is `issues/system/0256c`'s reproduction, and this is why it read so strangely.
