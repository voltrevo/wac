# 0151 — the reference refuses an identity test the spec allows, so a sweep row cannot be closed

- **Status:** closed — moot: the compiler it is about is deleted, and so is the sweep it explained
- **Closed:** 2026-08-28 by agent-b
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-17
- **Kind:** bug — **not worth fixing**, see the note at the end
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

The fix is in compiler/wacTypeCheck.ts and it is one question — is there a *variable* of that name in
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

## Not worth fixing — 2026-08-17, operator

> wacc is the primary compiler and has been for some time. the ref is only used to build wacc. I'm all
> for compiler testing but I wouldn't invest too much time in 'why does ref do one thing and wacc does
> another'.

So this stays filed as a record of *why the sweep's last row cannot close*, and not as work. The
reference refusing a program the spec allows costs nothing: it only has to compile wacc's own sources,
and it does. Anyone reading `mutateCheck`'s missed list and wondering why one row never goes away should
read this and move on rather than editing compiler/wacTypeCheck.ts.

The general form is worth writing down beside it: the 993 broken programs are useful because they are
*broken*, and the reference is a cheap oracle for which mutations broke something. A disagreement about a
program that is legal is not a defect in wacc and not work.

## Closed, 2026-08-28 — both halves of it are gone

This was filed as a record rather than as work, on the operator's ruling that *"the ref is only used
to build wacc"* and a disagreement about a legal program is not a defect. Both of the things that
made the record worth keeping have since gone.

**The compiler that refused the program is deleted**, with `compiler/` on 2026-08-28. There is no
longer anything that answers `undefined type 'A'` for it.

**And the sweep this existed to explain is gone with it.** The closing paragraph said *"anyone
reading `mutateCheck`'s missed list and wondering why one row never goes away should read this"*.
`mutateCheck` survives only in the text of four issues; no code in the repository names it, because
it used the reference as its oracle and went when the oracle did.

**wacc's behaviour, which was never in question, still holds.** The reproduction compiles clean and
answers `true`:

    const u64[] A = u64[](1, 18446744073709551615, 1);
    u64[] g() { return A; }
    export bool f() { return g() is A; }        // true

That is what `[§wac-is-undefined-type-6qbn3wr]` requires — a capital that names a variable in scope
is an identity test, not a missing type — so there is nothing to fix and nothing left to explain.
