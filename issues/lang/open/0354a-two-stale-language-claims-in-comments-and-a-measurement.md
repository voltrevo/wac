# 0354a — two stale language claims in comments, and a measurement that says the sweep is not worth it

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** bug
- **Symptom:** a comment names a language limitation that is not the real one, in the file most likely to be believed

> **Rewritten 2026-09-05, after filing.** The first version of this issue was built on a count —
> *"658 constants are spelled as function calls"* — and got two things wrong that change what should
> be done. Both corrections are below, before anything else, because a reader who acts on the
> original does damage.
>
> **1. The count already existed, is better, and is larger.** `vision/QUESTIONS.md`'s *828 constants
> are written as functions, and I called it an oddity four times* counts the same corpus and gets
> **828 functions against 197 `const`s and 47 enums**, with evidence this issue did not have: seven
> files use *both* forms, `packages/tor/src/relay.wac` has three consecutive lines mixing them, and
> `issues/lang/0269a`'s recommendation that `switch` cases be constant would make the two forms
> non-interchangeable. My 658/281 came from a narrower body pattern and is superseded. **The count is
> not this issue and this issue should not have restated it.**
>
> **2. `kinds.wac`'s comment is not simply stale, and sweeping it would break the bootstrap.**
> That entry measured what this issue assumed: `packages/wacc` holds **265 of the 828 and zero
> consts**, because its source must compile on **wac-L5**, and driving L5 directly shows
> `const i32 LIMIT = 509;` at module scope is **refused** — *"unexpected token = before 509"* — along
> with the exported and array forms. So for `packages/wacc/src/kinds.wac` the function form is
> **forced, not drifted**. The comment's fault is that it says *"wac has no module-level constants"*
> when it means *the rung that compiles this file has none*; the constraint it describes is real and
> current.
>
> What survives, and is what the issue is now about: **two comments that name the wrong limitation**,
> and **a bench saying the conversion buys nothing**, which supports the existing entry's conclusion
> that outside `wacc` this is style rather than a decision.

## The two comments

**`packages/wacc/src/kinds.wac`**, above 89 declarations:

> Every one of these is a zero-argument function because wac has no module-level constants.

wac has them — `spec/spec/variables.md`, landed 2026-07-31, `export const u32 POLY = 0xEDB88320;` as
the worked example, verified by compiling and running it. **wac-L5 does not**, and that is the
constraint on this file. One clause: *"…because wac-L5, which must be able to compile this file, has
no top-level `const` — see `issues/lang/0285b`."* That is the whole fix, and it converts a sentence
that will send the next reader to sweep into one that tells them why they cannot.

**`packages/fmt/src/atof.wac:402`**, on `bisect32`:

> Separate rather than shared because the two return different types and wac has no generics

wac has generic functions — `spec/spec/generics.md` §Generic functions,
`packages/platform/src/frame.wac`'s `export Pending<T> ready<T>(…)` — and a type parameter may be a
primitive. `packages/fmt` is not in `wacc`'s graph, so no L5 qualification applies.

**But the conclusion survives its false reason**, which is the part to carry into any sweep.
Generics monomorphise — `[§wac-generic-fn-5hvq3mt]` — so `bisect<T>` would produce two concrete
functions, exactly what the file has by hand. What stops it is `f64.fromBits(lo)` in the body: a
primitive named on a *type*, with no way to write `T.fromBits` and have it resolve per instantiation.
A reader who corrected the comment and merged the two functions would get a body that does not
compile. **Check each conclusion, not only each reason.**

## And the conversion buys nothing, measured

`vision/bench/constcall.wac` times the shape these are consumed in — a chain of eight equality
tests, which is `packages/wacc/src/wapyrewrite.wac:105` — with the eight spelled as `const`, as
private functions, and as exported functions:

        tests     konst     priv   export    again
    536870912       178      178      178      178

A dead tie, about one comparison per cycle. **So there is no performance case**, which agrees with
`packages/gzip/src/tables.wac`, whose author measured the array version at thirty nanoseconds per
gzip operation and declined the change as churn, writing the reason that this issue should have
started from:

> What was wrong was the *reason*, and a false constraint in a comment is worth more than the thirty
> nanoseconds: the next person to need a table at file scope reads this and believes they cannot.

One caveat worth keeping. The compiler did not remove the call: `emit.wac`'s only inlining is of
constant scalars and there is no function-inlining pass, so the module holds a real `call` and **v8
erases it**. `--host wasmtime` is the engine whose stated purpose is testing that a wac program needs
no JavaScript, it is not built in this checkout (`issues/system/0208`), and it was not asked.

## What to do

**Fix the two sentences.** That is the whole ask. Neither is a sweep, both are one clause, and the
`kinds.wac` one prevents a change that would break the top bootstrap rung.

Do **not** convert `packages/wacc` — it cannot. For the 563 outside `wacc`'s graph the existing
QUESTIONS entry has the argument, and its conclusion is that the closed-set cases want an enum and
the rest are style. `issues/lang/0269a` is the thing that would make it a decision rather than a
sweep, by making `case relayBegin():` stop compiling.

## Related

- `vision/QUESTIONS.md`, *828 constants are written as functions* — the real count, the L5
  qualification, and the `0269a` interaction. **Read that first.**
- `issues/lang/0285b` — L5 has no top-level `const` production; its title says "array" and its defect
  is wider.
- `issues/lang/0269a` — requiring `switch` cases to be constant, which is what would force the issue.
- `issues/system/0356a` — the same rot in cross-references, and a check that catches four of it.
