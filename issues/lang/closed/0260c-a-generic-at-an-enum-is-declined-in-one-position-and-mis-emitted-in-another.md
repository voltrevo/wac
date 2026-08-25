# 0260c — a generic at an enum is declined in one position and mis-emitted in another

- **Status:** closed — 2026-08-25
- **Reported by:** agent-c, 2026-08-25
- **Kind:** bug
- **Symptom:** a module the emitter is happy with and the engine will not load

`ready<T>` — `packages/platform/src/frame.wac`, a one-line generic returning `Pending<T>` — gives a
second type index to its instantiation when `T` is an enum from `core`. The function then returns a
reference type its own signature does not name.

    WebAssembly.Module(): Compiling function #1041:"noRecv" failed:
      type error in return[0] (expected (ref null 336), got (ref null 387))

## The reproduction is five files

    import { Core, Cli, Pending } from "std/platform.wac";
    import { Read } from "core";
    import { ready } from ".../packages/platform/src/frame.wac";

    Pending<Read> noRecv(i32 handle) { return ready(Read.End); }     // emits an invalid module

    export i32 main(Core core, Cli cli) {
      Pending<Read> p = noRecv(0);
      core.log("built a Pending<Read>");
      return 0;
    }

**Two neighbouring spellings behave differently, which is the interesting half:**

| | |
|---|---|
| `Pending<Read> f() { return ready(Read.End); }` | invalid module, no diagnostic |
| `Pending<Read> p = ready(Read.End);` in a body | **declined**: "an assignment between related reference types" |
| `Pending<i32> f() { return ready(1); }` | fine |

So the checker has the rule and applies it to an assignment, and a `return` against a declared return
type does not reach it. The enum is what makes the two instantiations distinct; `i32` from the same
third module through the same generic is fine.

## Why it matters more than the workaround suggests

The workaround is to build the `Pending` explicitly —
`Pending.of(0, resolveEnd, alwaysSettled, ignoreDrop)`, which is what
`packages/sh/test/wac/probe.wac` has always done for this exact type — and `packages/wac/src/grants.wac`
now does. That is a fine local answer and it hides the defect: the file compiles, the module loads,
and nothing says the generic route is unusable at an enum.

**The operator's principle is that a case which is not implemented must fail**, and half of this one
does. The declined spelling is the correct behaviour; the mis-emitted spelling is
`issues/lang/0106`'s class — the compiler is happy and the program does not run — and the difference
between them is a position, not a construct.

`wac validate` says `rejected` and nothing else, which is how this took a Deno one-liner
(`new WebAssembly.Module(bytes)`) to diagnose. A validator that knows a module is bad and will not say
why is worth its own look; the engine's message named the function, the two type indices and the byte
offset.

## The mis-emission is fixed — the `return` declines now, 2026-08-25

`unsupportedStmt`'s `Var` case made a "two known types that differ" comparison and the `Return` case
did not; it only called `unsupportedValueAt`. So the rule existed and one position did not reach it.
`Return` makes the same comparison now, against `env.returnType`, and the reproduction says:

    wacc: cannot emit … — the exported function `mk` is not in the module the emitter produced
                          — a return between related reference types

**Minimised to four lines with no imports**, which is better than the cross-module version this issue
was filed with:

    struct Hold<T> { T v; }
    enum Colour { Red, Green }
    Hold<T> hold<T>(T v) { return Hold(v); }
    export Hold<Colour> mk() { return hold(Colour.Red); }

So the operator's principle is satisfied — the case that is not implemented fails — and
`issues/lang/0106`'s class loses a member. **This issue stays open** because the underlying fault is
untouched: a generic instantiated at an enum still gets a second type index, so the construct is
*declined* rather than working. That is the remaining work, and it is a question about how
instantiations are keyed rather than about where the checks are.

`returnType` is `""` for a void function and `isStructName("")` is false, so the new comparison costs
nothing there. Verified against the whole tree: the compiler is a fixed point with the rule in, and
`corpusemit_test.wac` compiles 1075 of 1075 files whole with 0 invalid.

## It also retired a canary that had inverted

`corpusemit_test.wac` asserted `partial > 0` — "every file emitted whole, which cannot be true yet" —
and `reasons > 0`. Both were proofs that the *harness* was working, and both now fail **because the
thing they were watching for has been achieved**: 1075 of 1075 whole where 2026-08-20 was 702 of 729.
A canary that fires on success is worse than none, because the natural response is to stop believing
it.

The walk is now checked against the four lines above — a file that must be declined, held inline —
rather than against the corpus happening to contain a defect. README, `Home.tsx` and `Stack.tsx`
carried "702 of 729" and "twenty-seven it cannot compile whole"; all three say 1075 now.

## Closed: the type argument was the variant, not the enum

`typeOfE(Colour.Red)` is the **variant**, so `hold(Colour.Red)` inferred `T = Colour.Red` and built
`Hold<Colour.Red>` — a different struct from the `Hold<Colour>` the caller's signature names, with a
type index of its own. Hence `(ref null 387)` where the signature said `(ref null 336)`.

One line, in the loop that builds an instantiation's name from the inferred bindings:

    bound[i] = env.canonType(bound[i]);

`canonType` is exactly the right instrument and its own docstring says so — *"a variant and its enum
are one struct … everywhere a wac type name reaches wasm, it goes through here first"*. An
instantiation name is such a place, and it was the one that did not go through it. Applied to `bound`
rather than to the name alone, so the substitution inside the body agrees: the instance is
`Hold<Colour>` and `T` stands for `Colour` throughout it.

All three reproductions now **compile and run** rather than being declined:

    export Hold<Colour> mk() { return hold(Colour.Red); }        compiles, 2670 bytes
    Hold<Colour> h = mk();                                        runs, prints ok
    Pending<Read> noRecv(i32 h) { return ready(Read.End); }       runs, prints ok

So the `return`-position check added earlier is no longer what makes this fail — it makes nothing fail
today, and it stays as the guard the `Var` case has always had. `packages/wac/src/grants.wac`'s
explicit `Pending.of(0, resolveEnd, …)` could go back to `ready(Read.End)` now; left alone because it
is working code and the explicit form is what `probe.wac` uses.

**And it cost a canary.** `corpusemit_test.wac`'s harness check used this very construct — declined
when written, compiling an hour later. Its subject is a *cap* now (`capsPerLambda()` is 32, and the
checker has no opinion about it), because a test subject that is a bug has a shelf life. The wider
problem that turned up on the way is `issues/lang/0262c`: the per-function decline path has no
reachable test at all, and the test that claims it passes on the `f` in "of".

Verified: the compiler is a fixed point with the change in, at 1,666,689 bytes.
