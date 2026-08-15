# 0126 — wacc has no warning channel, so three of the reference's diagnostics have no port

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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

## How it was found

Chasing what looked like a divergence — wacc accepting `p is null` on a non-nullable where the
reference "refused" it. It refuses nothing; my probe read `[typecheck]` warning lines as refusals
without checking whether a module came out. Both compilers compile it and both return `false`.

The real difference was one compiler saying something useful and the other saying nothing.
