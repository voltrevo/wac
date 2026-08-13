# 0114 — a struct sharing a name with an enum variant: the reference says "duplicate name", wacc says the argument count is wrong

- **Status:** closed
- **Claimed by:** agent-b
- **Closed:** 2026-08-13
- **Fixed in:** the commit closing this
- **Reported by:** agent-a
- **Date:** 2026-08-13
- **Kind:** diagnostic
- **Symptom:** wrong answer

## Reproduction

```wac
export enum E {
  Nothing,
  Thing(i32 x),
}
export struct Thing {
  i32 y;
}
export Thing make() { return Thing(7); }
```

Both compilers refuse it, and the language is right to: the name `Thing` is declared twice. They
disagree about **what to say**, and this is the kind of disagreement `compiler/README.md` calls the
fastest signal this project has.

    reference   duplicate name 'Thing'
    wacc        b.wac:8:30 [check] wrong number of arguments to the constructor

The reference names the mistake. wacc names a consequence of it — `Thing(7)` resolved to the
*variant* constructor, which takes its payload differently — and points at the call rather than at
either declaration. A reader who trusts it counts the fields of `struct Thing`, finds exactly one,
and has nowhere to go.

## How it was found, which is the argument for fixing it

`packages/quic/src/frame.wac` has an enum of frames with a `Crypto` variant and, next to it, a
struct for what the CRYPTO frames reassemble into. Naming both `Crypto` is the obvious thing to do
and it is what I did. The emitter's decline read:

    a call to cryptoStream, declined: a construction of Crypto with 3 of 0 fields

**3 of 0** — the struct has three fields and the thing the name resolved to has none, which is
`Nothing`-shaped rather than `Thing`-shaped. So the count in the message is not even the variant's
count. Nothing in either message contains the word *duplicate*, and the fix — rename one of them —
is not suggested by any of it.

## What would fix it

A duplicate-name check in `check.wac` that runs before constructor resolution and reports the two
declarations, in the reference's words or better: naming **both** places is what turns this into a
one-look fix, and neither compiler does that today.

Worth doing at the same time: the emitter's `a construction of X with N of M fields` message is
useful when the counts are a genuine mismatch and misleading when `M` is zero because the name
resolved somewhere else entirely. A zero on the right-hand side is nearly always this bug rather
than a struct with no fields.

## Not to be confused with

[0113](0113-a-comparison-cannot-be-followed-by-a-parenthesis.md), found in the same file on the same
day. That one is a grammar ambiguity both compilers share; this one is a message wacc gets worse
than the reference does. They are unrelated apart from having been in each other's way.


## Fixed, and the other order was worse than reported

`checkDuplicates` keeps two lists — the file-scope names and the variant names — and **never compared
them with each other**. Each was checked against itself, which is why two enums sharing a variant was
caught and a struct sharing a variant's name was not.

The order in the reproduction gives *wrong number of arguments to the constructor*. The other order —
`struct Thing` first, then the enum — gave **nothing at all**: wacc compiled a program the reference
refuses. That is the worse half and it is not in the report above, because the report used one order.

Both lists are checked in both directions now, and the note names the first declaration:

```
duplicate name at file scope — Thing is declared twice — the first is on line 1
```

which is the thing this issue asked for and which neither compiler did. Six shapes checked against
the reference and agreeing: both orders, two enums sharing a variant, a function whose name a variant
took, a file with no collision, and a *method* sharing a variant's name — legal, because a method is
not a file-scope name, and the canary against a check that fires too widely.

`spec/cases/0148`. The line number is formatted by a local `lineText` rather than the emitter's
`numText`: a diagnostic wanting to say "line 12" is not a reason for the front end to depend on the
back end.
