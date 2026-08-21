# 0244a — eleven literal guards ask `litKindOf` where the rule they call handles more

- **Status:** closed
- **Closed by:** agent-a, 2026-08-21 — all eleven guards, and the two rows that needed `0245a` first
- **Fixed in:** `5994244e` (eight guards), `faac51d9` (the two rows that needed a type), `9bf5534b` (the JSX pair), with `packages/wacc/test/wac/compoundlit_test.wac`
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** wrong answer — a wrongly-typed argument, element or payload is accepted whenever it is
  written as a *compound* literal

## Reproduction

```wac
i32 g(string s) { return s.len(); }
export i32 f() { return g(1 + 2); }
```

Expected: refused, exactly as `g(1)` is. The reference refuses both.

Actual: `g(1)` is refused and `g(1 + 2)` is accepted. Same for a ternary — `g(b ? 1 : 2)` — and, until
`issues/lang/0243a`, a `match` of literals.

## The rule is written for this and is never handed it

`reportLiteral` is the shared complaint for "a literal that cannot go in this slot". It reads the
family with `litFamily`, which is the function that understands *compound* literal expressions —
`1 + 2` is an integer literal sum, `b ? 1 : 2` is an integer literal, and since `0243a` so is
`match (e) { case A: 1, else: 2 }`. Its own comment says so outright:

> **At the literal's token where there is one** … The line and column arguments stay for the compound
> case, where no single token holds the expression.

So it takes line and column as arguments *specifically* to serve an expression with no single token.
And **all eleven of its call sites guard with `litKindOf`**, which knows only a direct literal and a
sign in front of one. The compound case it was built for cannot reach it from anywhere.

Measured, wacc against the reference (`compiler/wacCompile.ts`), direct form beside compound:

| slot | direct | compound |
|---|---|---|
| function argument | refused | **accepted** — `g(1 + 2)`, `g(b ? 1 : 2)` |
| array element | refused | **accepted** — `string[](1 + 2)` |
| array fill | — | **accepted** — `string[3](fill: 1 + 2)` |
| constructor, positional | refused | **accepted** — `S(1 + 2)` |
| variant construction | refused | **accepted** — `E.A(1 + 2)` |
| builtin argument | refused | **accepted** — `"ab".indexOf(1 + 2)`, `"ab".slice(1, "x" + "y")` |
| constructor, named | refused | refused — `S(v: 1 + 2)` |
| JSX attribute, JSX child | not measured | not measured |

The reference refuses every row of that table, both columns.

Two rows deserve their own note. **The named constructor argument is already right**, so whatever it
does is the model for the rest. And **the JSX rows measure nothing yet**: the programs I wrote were
refused for *"undefined type"* because `Node` was not in scope, which is not the question — so the two
JSX guards are unverified rather than sound, and the honest state is that nobody has asked them.

## Why it is the same finding three times over

`0242a` was a missing arm in `typeOfExpr`; `0243a` was a missing arm in `litFamily`; this is eleven
callers asking the narrower of two functions. All three are *"the rule existed and could not see its
input"*, which is what `issues/lang/0170a` named, and all three were found by enumerating a dispatch's
arms rather than by any differential — the corpus is this repository's own files plus `spec/cases`, and
nobody writes `g(1 + 2)` where a string belongs on purpose.

`spec/cases/0172` is the near miss worth reading: *"every arm answers i32, so the match does, and a
string cannot hold it — the rule a ternary already follows"*, with a **parameter** in the arm. One
substitution away — `n` for `1` — and it would have caught `0243a` two months earlier.

## What to do

Change the guard at each verified site from `litKindOf(e) != litNone()` to
`litFamily(c, e) != litNone()`, which is the question the callee already asks. `litFamily` needs a `C`
and every one of these sites has one.

The two **JSX** guards were held back at first, because a change wants a failing case and the case I
wrote was refused for *"undefined type"* — `Node` was not in scope, which is not the question. Asked
properly, with `import { Attr, Node } from "core";` as `spec/cases/0121` does, they have the same hole:

    <div class={1}></div>       refused        <div class={1 + 2}></div>       accepted
    <div>{1}</div>              refused        <div>{1 + 2}</div>              accepted

Both closed by the same swap. `<div class={"a"}></div>` stays legal, and `<div>{"a"}</div>` stays
refused — a child must be a `Node` and a string is not one, which is the guard doing its job.

## Measured after widening eight of them — 2026-08-21

Done in a scratch worktree so the change could be measured before it touched anything. Eight of the
ten reproductions flip to refused, and the six legal compound literals stay accepted — `g(1 + 2)` into
an `i64`, `g(b ? 1 : 2)` into an `i32`, `g(1.5 + 2.5)` into an `f64`, `i32[](1 + 2)`, `u8[](1 + 2)`,
`g("a" + "b")` into a `string`. That second half is the one that matters: widening a guard is how a
checker starts refusing correct programs.

**The two that did not flip are a different bug, now `issues/lang/0245a`.**
`"ab".slice(1, "x" + "y")` and `string.fromCodepoint("a" + "b")` stay accepted because `litFamily`'s
`Binary` arm answers only for the integer and float families — a *string* literal pair is not a
literal to it, deliberately — and `typeOfExpr` then has nothing either, because it discards a literal
operand's type on the grounds that a literal takes its type from the other side. True of `1`, false of
`"a"`. Those two rows belong to `0245a` and are not evidence about the guards.

`slice` is also worth a look on its own: its arguments go through `checkCountArg` rather than
`reportLiteral`, so it is a twelfth guard in this family that this issue has not examined.

## Closed — 2026-08-21

All eleven guards ask `litFamily` now, and all twelve reproductions are refused with the eight legal
compound literals still accepted. `packages/wacc/test/wac/compoundlit_test.wac` holds the four claims:
the twelve compound faults, the ten *direct* faults — a rule that fires only on the compound form is
not this rule — the eight legal ones, and that no row is accepted by the checker and the emitter both.
Canaried by putting the guards back: eight failures in each claim-test with both controls green.

**Two rows needed `0245a` rather than a guard.** `"ab".slice(1, "x" + "y")` and
`string.fromCodepoint("a" + "b")` survived the widening — a string literal *pair* is not a literal to
`litFamily`, whose `Binary` arm answers only for the integer and float families — and what refuses them
is `0245a` giving `"a" + "b"` a type at all, so the guards' ordinary type comparison can see it. Worth
keeping because it is the shape of the whole cluster: the guard was one of two things wrong, and fixing
it alone would have left a reader thinking the slot was covered.

Verified: `corpuscheck` over the repository, `cases` including the 103 executable spec cases,
`typecheck` rung 3 with 0 false alarms and 0 contradicted, `specsingle` 371 silent, `specmulti` 42
silent, `illtyped`, `binaryoperands`, `warnings`, `codes`.

## And three more guards, of the same shape and not among the eleven — 2026-08-21

An **array size**, an **array index read** and an **array index write** each ask
`acceptsLiteral("i32", …)` off a `litKindOf`, which is the same blindness in a rule that does not go
through `reportLiteral` at all. So the compound form slipped there too, and the reference refuses all
three:

    a[b ? "x" : "y"]            accepted     ← reference: array index must be i32, got string
    i32[b ? "x" : "y"]()        accepted     ← reference: array size must be i32, got string
    a[b ? "x" : "y"] = 1        accepted     ← reference: array index must be i32, got string

The *binary* form of each was already refused, because `0245a` gives `"a" + "b"` a type and the
non-literal path then compares types — which is why a ternary was needed to see the hole at all. Three
rows added, three legal ones beside them (`i32[1 + 1]()`, `a[b ? 1 : 2]`, `case 1 + 1:`), and the
canary shows exactly those three failing with the guards put back.

**A fourth was reverted for want of a failing case.** A `switch` case value takes the same shape, and
widening it changes nothing: `case "a" + "b":` is refused either way, by some other rule. The row stays
as coverage of the slot and the source change does not, because a change with no failing case is a
change nobody can check. That row is labelled in the test for what it is.

