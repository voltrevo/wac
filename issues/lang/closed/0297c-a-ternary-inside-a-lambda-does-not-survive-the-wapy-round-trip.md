# 0297 — a ternary inside a lambda does not survive the wapy round trip

- **Status:** closed
- **Closed:** 2026-09-01 by agent-b
- **Fixed in:** the commit closing this
- **Claimed by:** agent-b (2026-09-01)
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** bug
- **Symptom:** wrong answer — the printer's output parses back to a different tree

## Reproduction

```wac
export i32 main() {
  i32[] slot = i32[1](fill: 0);
  fn[void()] r = () => { slot[0] = slot[0] > 0 ? 1 : 2; };
  r();
  return slot[0];
}
```

`packages/wacc/test/wac/wapyroundtrip_test.wac` renders this through the wapy printer and reads the
rendering back with wacc. The two trees differ.

## What narrows it

Bisected from a 60-line file down to those five, one construct at a time. Each of these survives, so
none of them is the cause:

| shape | result |
| --- | --- |
| a ternary in a **function** body — `return ok ? n : 0 - 1;` | survives |
| a lambda with a simple body — `() => { slot[0] = 1; }` | survives |
| an array of funcrefs, and assigning a lambda into one | survives |
| a generic static call — `Pending<i32>.of(…)` | survives |
| a method chain with a type argument — `cli.readFile(p).linkedTo(core)` | survives |
| **a ternary inside a lambda** | **differs** |

So it is the pair, not either half. The nearest thing already on that test's known-bad list is
*"a type-argument chain with an inline lambda"* — a lambda in a position the printer renders
differently — which suggests the two are the same underlying gap seen from different sides.

## The cause, found 2026-08-30

**A lambda body is rendered as wac statements whose expressions are in wapy form.** `wapyprint.wac`
says the first half itself, and says why:

> **wac's parameter spelling, not wapy's.** A lambda is an expression, and `spec/spec/wapy.md` says
> expressions are wac's unchanged — so it is `(i32 a)` here rather than `(a: i32)`.

The body keeps wac's `{ … ; … }` and its `return`, but a ternary inside it comes out as wapy's
`X if C else Y`. Reading back sends that body to the **wac** statement parser, which has no such
form: `if` after an expression begins a new statement. So one `return` of a conditional becomes two
expression statements, with a `null` where an arm was and the arms swapped:

    wac  : (lambda ((mut n (prim i32))) ((return (ternary (ident b) (ident n) (binary - (int 0) (int 1))))))
    wapy : (lambda ((mut n (prim i32))) ((expr (ternary (ident b) (null) (ident n)))
                                         (expr (call (null) ((binary - (int 0) (int 1)))))))

That explains the table above exactly. A ternary in a *function* body survives because that body is
wapy throughout; a lambda with a simple body survives because nothing in it spells differently. It is
the pair because it takes both to get a wapy-spelled expression inside a wac-parsed body.

So the fix is a choice rather than a patch: the body is wapy throughout, or the expressions inside it
stay wac's. Either closes it; mixing is what does not work.

**Worth checking beyond the ternary.** It is the one with a distinctive spelling, so it is the one
that shows. Anything else wapy writes differently would be rendered into a wac-parsed body the same
way and would fail the same silent test.

## Notes

Found because two new files tripped the round trip and neither contained anything exotic:
`packages/platform/test/wac/asynclower_test.wac` and `asyncchain_test.wac`, both hand-written
lowerings for `design/lang/0014`. They are on the known-bad list with this reason, measured rather
than guessed — which is what that list's own note asks for, having once been written from what its
author thought the failures were and naming five files that were not these.

## It is a separator set, not a choice — agent-b, 2026-09-01

This issue says *"the fix is a choice rather than a patch: the body is wapy throughout, or the
expressions inside it stay wac's. Either closes it; mixing is what does not work."* Neither was
needed, because **`wapyparse` does not parse wapy's expression spellings at all** — it rewrites the
tokens in place and hands the range to wac's parser:

> `X if C else Y` → `C ? X : Y` moves three operand groups around and retags two keywords … So the
> range is recomputed with the shared helpers and written over itself.

That rewrite runs through `segments` in `wapyrewrite.wac`, which cuts a level at its separators
before letting `topTernary` at each piece. The separators were `,` and `:`, and the header says why:

> A conditional's operands stop at the nearest `,` or `:` — in `f(a, 1 if c else b, d)` the then-arm
> is `1`, not `a, 1`. Scanning the whole level at once swallowed the argument list.

**A lambda body is the one place statements sit inside an expression range**, and its statements are
separated by `;`, which was not a separator. So `() => { slot[0] = 1 if c else 2; }` reached
`topTernary` as a single segment, and `topTernary` takes *everything* before the `if` as the then-arm
— `slice(t, 0, ifAt)` — which is `slot[0] = 1`. That is exactly the tree this issue records, arms
swapped with a `null` where one belonged.

**`wapyparse` already knew this and says so one level up.** `stmtAt` splits an assignment's two sides
before rewriting, with the comment *"the rewrites cannot be handed a whole line: `return 1 if c else
2` would take `return 1` as the arm, and `x = a if c else b` would take `x = a`"*. The same rule
simply never had to hold **inside** a bracket group, because until lambdas nothing put a statement
there.

So `segments` now cuts on `;` and on an assignment operator as well, and the printer is untouched —
which keeps it consistent with `[§wac-wapy-matchexpr-3jx8rvc]`, the existing ruling on this exact
shape: *"The match expression keeps braces, because it is an expression and cannot open an indented
block."* A lambda is the same kind of thing and keeps wac's braces for the same reason.

    packages/platform/test/wac/asynclower_test.wac — round-trips now, removed from the known-bad list

`packages/wacc/test/wac/wapy_test.wac` gains `test_a_conditional_inside_a_lambda_body`, with two
cases so the `;` split is exercised and not only the assignment one. Canaried: with the separators
back to `,` and `:` it fails on four assertions.

## The second file was mislabelled, and it stays

`packages/platform/test/wac/asyncchain_probe.wac` was listed with the same reason and **is not this
bug**. It contains no ternary inside a lambda: its two `?` are `Pending<U>?[]`, a nullable type, and
`return f.ok ? f.bytes.len() : 0 - 1` in `sizeOf`, which is a plain function. It still fails the
round trip after this fix, so its entry is kept with the reason corrected to *"cause unidentified —
not the ternary"*.

That list's own note asks for measured reasons, *"having once been written from what its author
thought the failures were and naming five files that were not these"* — this is the same slip one
file wide, and a wrong reason is worse than none because it makes the next reader think the cause is
known. What the file does have is **nested lambdas** — `fin` inside `armSecond` inside `force` —
which is `issues/lang/0296c`'s shape. Not verified as the cause, and named here only so whoever
picks it up starts there rather than at the ternary.

**So this issue stays open** for that file. The construct it is named for is fixed and pinned.

## The first fix was incomplete, and finishing it cleared three mislabelled files — agent-b, 2026-09-01

Splitting on `;` and on assignments mends `{ slot[0] = 1 if c else 2; }` and leaves
`{ return 1 if c else 2; }` broken, because `topTernary` still takes everything before the `if` —
here `return 1` — as the then-arm. That is the *same* sentence `wapyparse`'s `stmtAt` has one level
up, and I quoted it while implementing the fix without applying its second half:

> the rewrites cannot be handed a whole line: `return 1 if c else 2` would take `return 1` as the
> arm, and `x = a if c else b` would take `x = a`. So the two sides of an assignment are rewritten
> separately, **and a leading `return` or `trap` is stepped over first**.

**My regression test did not catch it because both of its cases assign.** A test written from the
reproduction I had, rather than from the rule, checked the half I had implemented — which is the
same shape of hole as the one this issue is about, one level down. There are four cases now,
including a returned conditional and one that is a lambda's whole body.

`segments` also treats `=>` as a separator, for an **expression** body: `(bool b) => 1 if b else 2`
has no `;` and no assignment, and is how `spec/cases/0248` writes its chain.

**Four files leave the known-bad list, and three of them were filed under the wrong cause:**

| file | was listed as |
|---|---|
| `packages/platform/src/frame.wac` | jsx text containing markup characters |
| `packages/platform/test/wac/scheduled_test.wac` | jsx text containing markup characters |
| `packages/wac/src/grants.wac` | jsx text containing markup characters |
| `spec/cases/0248-a-chain-of-method-type-arguments-with-inline-lambdas.wac` | a type-argument chain with an inline lambda |

None of the first three was a JSX problem. That list's own note asks for measured reasons "having
once been written from what its author thought the failures were", and this is the third time today
that asking it for evidence produced a different answer than the label. It is eight entries down to
four, and the four are three real JSX-text cases plus `asyncchain_probe.wac`.

**`asyncchain_probe.wac` still fails**, so its "cause unidentified" stands. I guessed it was the
type-argument chain — `line 123` has exactly that shape — and a minimal version of that shape
round-trips, so it is not that either. Whoever takes it should bisect the file rather than trust a
resemblance; two resemblances have now been wrong.

## Closed 2026-09-01 — three faults, one class, and `asyncchain_probe` with them

`asyncchain_probe.wac` round-trips, so the last non-JSX entry leaves the list and this closes. It was
never one bug. Bisecting the two dumps for the first offset at which they part named each in turn,
and each is the same class the ternary was: **wapy's spelling of something, inside a body the wac
parser reads.**

1. **A leading `return` or `trap`.** `{ return 1 if c else 2; }` took `return 1` as the arm. Above.
2. **A declaration's type.** `printInlineStmt`'s `case Var` printed `wapyPrintTy`, so `Pending<U> nxt
   = force();` was rendered `Pending[U] nxt = …` and came back as an *index* of `Pending` by `U`
   followed by a bare assignment — one declaration becoming two statements with the type gone. It
   uses `printTyInExpr` now, whose own comment already warned about exactly this one construct
   along: *"handing the inner type to `wapyPrintTy` puts the angle brackets back to square ones one
   level in and the parser reads an index again."*
3. **An `if` statement.** `topTernary` scanned for `kIf()` from index 0, so a body of
   `{ if (c) { … } else { … } }` had an `if` and an `else` at one depth and was rewritten into `?`
   and `:`. A wapy conditional is **infix** — `X if C else Y` always has its then-arm first — so an
   `if` in first position cannot be one, and the scan starts at 1.

**The list is eight entries down to three, and the three are the only real ones** — jsx text
containing markup characters, in the three cases written for it. Everything else on it was either
this bug or a wrong label: `frame.wac`, `scheduled_test.wac` and `grants.wac` were all filed as jsx
text and none was.

**Two things I got wrong, for the next person.** I guessed `asyncchain_probe` was the type-argument
chain at its line 123 because the shape resembled `spec/cases/0248`; a minimal version of that shape
round-trips. And my first probe called `DIFFER` on `and`/`or`/`not`, which the real test folds —
an instrument that disagrees with the oracle it is standing in for. Both cost a detour. The bisect
that names an offset is the tool; a resemblance is not.
