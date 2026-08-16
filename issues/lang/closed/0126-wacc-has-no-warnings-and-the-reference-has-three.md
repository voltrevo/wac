# 0126 — wacc has no warning channel, so three of the reference's diagnostics have no port

- **Status:** closed
- **Claimed by:** agent-c
- **Fixed in:** this commit
- **Reported by:** agent-b
- **Date:** 2026-08-14
- **Kind:** missing feature
- **Symptom:** no error (a diagnostic that simply is not emitted)

## What

`compiler/wacTypeCheck.ts` has a `warnAt` and three call sites. `packages/wacc/src/check.wac` has
neither — the word "warn" appears once, in a prose comment about something else. So wacc emits no
warnings at all, and these three go unsaid:

| reference | says |
|---|---|
| `wacTypeCheck.ts:2021` | `'x is null' on T, which is never null` |
| `wacTypeCheck.ts:2073` | `'A is B' is always false — the types share no ancestor` |
| `wacTypeCheck.ts:2961` | `'x as! T' always traps — the types share no ancestor` |

All three are the same shape: a condition decided statically, where one branch is dead and the reader
believes it is defended.

## Why it is not covered by reference recall

`packages/wacc/README.md` reports **reference recall: 124 of 124**, which counts *errors*. A warning
is not an error, so the recall measure cannot see these — the port is complete against the thing it
measures and silent on a category beside it. The same is true of `spec/cases`, whose expectations are
`compiled` or `refused`.

## The first one has a measured cost

The reference's own comment records it, and it is the argument for the whole issue:

> `packages/platform` changed `env` from `string?` to `Pending<string?>`, every `cli.env(n) is not
> null` became a tautology, and five survived a migration the type checker otherwise caught
> completely [issue 0063].

Five live tautologies, in this repository, that only the warning found.

## And it must be a warning, not an error

Worth stating because the obvious first attempt is to make it an error, and that is wrong:

```wac
struct Slot<T> { T v; bool empty(const this) { return this.v is null; } }
```

has to instantiate for nullable *and* non-nullable `T`. Erroring would make any such generic
uninstantiable, which is why `[§wac-nonnull-isnull-k8fn3wp]` asserts that a non-null reference `is
null` is legal and returns `false`. Both compilers honour that today — I checked, and both return
`false` — so this issue is about adding a *warning* to wacc, not about changing what either accepts.

## What it needs

1. A warning channel in `packages/wacc/src/diag.wac` and `check.wac`, separate from `report`, that
   does not fail a compile.
2. The three rules above.
3. A way to measure it. Neither `spec/cases` (compiled/refused) nor reference recall (errors) can
   express "warns here", so this needs a third expectation or its own test — and getting that wrong
   means the warnings land and then rot unmeasured, which is `issues/lang/0125` one category along.

## Sized, 2026-08-14 — and it is not the small one

Worth stating because `issues/lang/0125`, filed the same afternoon and looking similar, turned out
to be half an hour's work. This one is not, and the difference is where the undone part is.

`check.wac` stores diagnostics as a flat `i32[]` — code, line, col, three slots each — with a
parallel `errorNotes`, touched at 21 sites. There is no severity field. Adding one would change the
stride and every site with it; a **parallel `warnings` array with its own count** is additive and
disturbs nothing, so the producer is easy.

The cost is the consumers. A warning has to reach somebody: `waccx`'s output, the harness that
binds packages, and whatever the API hands a caller. None of those has a place to put one today, and
a warning nothing surfaces is worse than none — it would pass every test by being invisible, which
is the failure mode this issue is about in the first place.

So: producer small, channel small, **consumers and a way to test them are the job**. `0125` was
cheap because its expensive half — establishing what every rule actually does — was already
finished before the issue was written. Here the expensive half has not started.

## How it was found

Chasing what looked like a divergence — wacc accepting `p is null` on a non-nullable where the
reference "refused" it. It refuses nothing; my probe read `[typecheck]` warning lines as refusals
without checking whether a module came out. Both compilers compile it and both return `false`.

The real difference was one compiler saying something useful and the other saying nothing.


## The channel exists, and one of the three rules — 2026-08-15

Built as sized: a **parallel `warnings` table** on `C` with its own count and its own `warn`, sharing
no storage and no counter with the errors, so nothing about a warning can reach a number that decides
whether a compile succeeded. `warnMessage` is separate from `checkMessage` for the same reason — a
code that is not an error should not be reachable by asking the error table for it.

Rule one is in: **`x is null` on a reference that is never null**, warning code 200. It fires only
where the type is known, is a reference, is not nullable and is not a generic — an unknown type is
what this checker answers wherever it cannot compute one, and warning on that is the false alarm that
teaches people to stop reading warnings.

    warning: this is never null, so the test is always false
      --> m.wac:3:9
       |
     3 |   if (p is null) { return 1; }
       |         ^

### The consumers, which the sizing correctly called the cost

There are three, and they wanted three different things.

- **The wire** grew a `warn` phase. That field already carried `lex`/`parse`/`check` and nothing
  switches on it exhaustively, so it is additive.
- **`waccx`** hardcoded `severity: "error"` when parsing the wire; `compiler/wacDiag.ts` has always
  rendered `${e.severity ?? "error"}`, so one line made warnings print as warnings. Its pass/fail then
  had to stop being "was there output" and become "was there an error", or wacc's first warning would
  refuse a legal program.
- **`example/wacc.wac`** — the compiler inside the `wac` binary — prints `diagnoseGraphRendered` and
  returns 1 when it is non-empty. That caller cannot be handed a warning at all, so the *rendered*
  path filters them out and the wire keeps them. `wac build` on a warning-only program still exits 0,
  which is the regression that would otherwise have arrived with the first warning.

### Measured, which is the part that would otherwise rot

`packages/wacc/test/warnings.test.ts` asserts the wire, not the rendering: that the rule fires, that
it does **not** fire on a nullable reference, a type parameter or a type test, and that the string a
build decides on carries no warnings while still carrying errors. Canaried by dropping the
nullability guard, which makes it warn on `P?` and fails the false-alarm test.

### All three rules, same day

Rules two and three landed straight after the channel, which is what the channel was the hard part
for. Both turn on `shareAncestor`, which `check.wac` already had for the ternary rule:

    warning: these types share no ancestor, so the test is always false     A is B
    warning: these types share no ancestor, so this cast always traps       x as! B

Each is guarded the same way as the first — both types known, both references, neither generic — and
each is measured in both directions. The quiet cases are the ones that would make the warnings
worthless: `p is Q` where `Q : P` is the ordinary narrowing this language is built on, and a
downcast that *can* hold is the whole reason `as!` exists. Canaried by dropping the `shareAncestor`
guard, which makes the rule fire on `p is Q` and fails that test.

`as` between unrelated references is already an error, so only `as!` warns — saying both would be two
complaints about one line.

### The native path too — closed

`example/wacc.wac` returned 1 whenever the rendered string was non-empty, which is right for errors
and refuses a program that merely warns. It takes the wire once now, renders it for the reader, and
asks `wireHasErrors` whether anything in it was an error — one pass, because rendering and deciding
from the same string is what keeps this from being the second whole-graph walk `issues/lang/0133` was
about.

So the filter that kept warnings out of the rendered path is gone: it protected that caller at the
cost of the binary never printing a warning at all. Both reach the reader now.

    $ wac build warn.wac -o w
    warning: this is never null, so the test is always false
      --> warn.wac:3:9
    w.wasm: 1260 bytes from 1 file(s)          # exit 0

and an error still exits 1.

**All three rules, all three consumers, measured.** `packages/wacc/test/warnings.test.ts` asserts the
wire rather than any rendering, both directions for each rule, and that a file with an error *and* a
warning prints both while the error decides. It does not shell out to `wac`: that binary carries a
prebuilt seed, so a test that ran it would be testing whatever seed happened to be on disk
(`issues/system/0160`).
