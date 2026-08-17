# 0151 — the reference refuses an identity test the spec allows, so a sweep row cannot be closed

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** compile error — on a program the spec describes as legal

## Reproduction

```wac
const u64[] A = u64[](1, 18446744073709551615, 1);
u64[] g() { return A; }
export bool f() { return g() is A; }
```

The reference answers, at the `A` on the last line:

    undefined type 'A'

wacc is silent, which is what `spec/spec/imports.md` says to be:

> Which side of `is` a bare name belongs to is decided by naming convention — an initial capital reads
> as a type, lowercase as a value (see operators.md). **When the name has a capital but names a
> *variable* in scope, the convention has simply guessed wrong, and the test is checked as reference
> identity rather than reported as a missing type.** `[§wac-is-undefined-type-6qbn3wr]`

`A` is a `const u64[]` in scope. So `g() is A` is an identity test between two `u64[]` references, and
the spec's own tag covers the case: the neighbouring paragraph in `spec/spec/structs.md` uses the same
tag for the case that *is* an error — `p is Nonexistent`, a name that resolves nowhere.

## Why it is filed rather than fixed

It came out of `mutateCheck.test.ts`'s missed list, where the reference is the oracle: the row reads
`1 missed of 1  undefined type '…'` and it can never be closed, because closing it means reporting a
program the spec calls legal. That is the one direction a subset checker may not be wrong in, so the
recall number carries a permanent 1 that a reader will keep trying to fix.

The fix is in `compiler/wacTypeCheck.ts` and it is one question — is there a *variable* of that name in
scope — asked before the type lookup fails. What makes it worth an issue rather than a patch is what
else moves with it:

- the reference is the seed's fallback (`design/lang/0003`), so a change to what it accepts is a change
  to what can be bootstrapped;
- three rungs compare wacc against it by position, so a diagnostic that disappears from the reference
  changes what "no contradiction" means on the programs that carry it;
- `spec/cases/` may hold a case asserting the current behaviour, in which case the spec text and a spec
  case disagree and that is the thing to settle first.

## What to check first

Whether the reference distinguishes the two shapes at all. If `p is Nonexistent` and `g() is A` take the
same path, the fix adds the scope lookup; if they already differ, then the capital-letter convention is
implemented and the bug is narrower than it looks — perhaps only for a `const` binding, which is the one
this reproduction uses.
