# 0245a — `"a" + "b"` has no type, because the rule assumes a literal takes one

- **Status:** closed
- **Closed by:** agent-a, 2026-08-21 — both halves, once the mirror moved with them
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** wrong answer — an ill-typed initialiser, argument or element is accepted when both
  operands of a `+` are string literals

## Reproduction

```wac
export i32 f() { i32 n = "a" + "b"; return n; }
```

Expected: refused — the same *"expected i32, found string"* that `i32 n = "a";` gets.

Actual: no diagnostics. Measured beside its neighbours:

| program | diagnostics |
|---|---|
| `i32 n = "a";` | 1 — refused |
| `i32 n = "a" + s;` (a `string` parameter) | 1 — refused |
| `i32 n = "a" + "b";` | **0** |
| `bool b = "a" + "b";` | **0** |
| `string s = "a" + "b";` | 0 — correct, it is legal |

So the rule works when *either* operand is not a literal, and goes quiet when both are.

## Why

`typeOfExpr`'s `Binary` arm states its model in a comment:

> Everything else is the type of its operands, taken from whichever side is not a literal: `x + 1` is
> an `i32` because `x` is, and the literal takes its type from the other side rather than giving one.

That is exactly right for a **numeric** literal, which is polymorphic — `1` is an `i32`, an `i64`, a
`u32` or a `u64` depending on where it is going, so it genuinely has no type to offer. It is **wrong
for a string literal**, which is a `string` and nothing else, and equally wrong for `true`. The arm
computes `lLit = litKindOf(left) != litNone()` and then discards a literal operand's type, so with two
string literals it has nothing left and answers unknown — and unknown is silence.

`naturalTypeOf` in the same file already draws the distinction the right way round: it maps
`litString` to `"string"` and `litBool` to `"bool"`, and only hedges on the integer case (and there
only past nine digits). So the knowledge is present in the file and this arm does not use it.

## Notes on fixing it

The shape of the fix is to let a non-polymorphic literal give its type — a `litString` operand
contributes `"string"`, a `litBool` operand `"bool"` — rather than being folded into "unknown".

**Why this is filed rather than patched.** Every comment in that arm is about *not* reporting twice:
unknown-from-a-literal versus unknown-from-an-error being the same value and not the same thing; two
known operands that disagree answering unknown so that `t.a + t.b + t.c` reports once rather than
three times; a non-`+` operator on a string answering unknown so the enclosing `return` does not
complain again. Giving an operand a type where it had none can wake any of those, which is
`issues/lang/0238a`'s whole subject. So this wants its own canary — the diagnostic **count** on a
chain, not just the refusal — and its own gate run.

Worth checking at the same time, since they are the same question one operator along: `"a" + 1`,
`"a" * "b"`, and whether a `bool` literal pair behaves like the string pair here.

## How it was found

Trying to widen the eleven literal guards in `issues/lang/0244a`. Eight of that issue's ten
reproductions started being refused; two did not — `"ab".slice(1, "x" + "y")` and
`string.fromCodepoint("a" + "b")` — because `litFamily`'s `Binary` arm answers only for the integer
and float families, deliberately, and a string pair is therefore not a literal to it either. Chasing
why left this. `0244a` records those two rows as belonging here.

## Fixed, and measured by count rather than by refusal — 2026-08-21

A string or bool literal now contributes its type, where an integer or float literal still does not:

```wac
i32 lk = litKindOf(left);
bool lLit = lk == litInteger() || lk == litFloat();
string bl = lLit ? typeNone()
          : lk == litString() ? "string" : lk == litBool() ? "bool" : typeOfExpr(c, left);
```

**The canary is the count, not the refusal**, because every comment in that arm is about not reporting
twice. Fifteen programs, diagnostics before and after:

| program | before | after |
|---|---:|---:|
| `i32 n = "a" + "b";` | 0 | **1** |
| `bool b = "a" + "b";` | 0 | **1** |
| `i32 n = true + false;` | 0 | **1** |
| `t.a + t.b + t.c` on three strings | 1 | 1 |
| `i32 n = "a";` | 1 | 1 |
| `i32 n = "a" + s;` | 1 | 1 |
| `i32 n = s * 1000;` | 1 | 1 |
| `string s = "a" + "b";` | 0 | 0 |
| `i32 n = 1 + 2;` / `i64 n = 1 + 2;` / `f64 d = 1.5 + 2.5;` | 0 | 0 |
| `bool b = 1 == 2;` / `bool b = true && false;` | 0 | 0 |
| `bool b = true + false;` | 0 | 0 |
| `string s = "a" * "b";` | 0 | 0 |

Three rows improve and twelve are untouched. The chain row is the one that mattered: `t.a + t.b + t.c`
stays at **one** diagnostic, which is what the arm's comments are protecting and what `0238a` is about.

`corpuscheck`, `typecheck` (rung 3), `illtyped`, `cases` and `specsingle` are green with it.

## What the last two rows are, and why they are not this

`bool b = true + false;` and `string s = "a" * "b";` stay silent, and the reference refuses both — with
an **operand** complaint rather than a slot one: *"'+' requires numeric type, got bool"* and *"'*'
requires numeric type, got string"*. So they are a different rule, and this fix was never going to
reach them.

That rule is in `checkExpr`'s `Binary` arm and the gap is one identifier wide:

```wac
string alt = typeOfExpr(c, left);          // line ~3560 — blind to a literal
string nl = alt != typeNone() ? alt : naturalTypeOf(c, left);   // ~3591 — fills one in
...
bool lArith = alt != "string" && isReferenceName(c, alt);        // ~3624 — uses the blind one
if (arith && (alt == "bool" || art == "bool" || lArith || rArith)) { … }
```

`nl`/`nr` exist thirty lines above and were introduced for exactly this reason — the bitwise branch
beside it says so: *"`nl`/`nr`, not `typeOfExpr` alone, or this cannot see a literal … which left
`1.5 & 2.5`, `x & 1.5` and `x << "a"` checking clean"* (`issues/lang/0236a`). The arithmetic and string
branches next to it still ask `alt`/`art`. And the two-literals rule further down says it deliberately:
*"Same family is silent, including `true + false`, which is the numeric rule's business and not this
one's"* — true, and the numeric rule cannot see it.

**Reverted once, and the reason was a fourth edit rather than a wrong idea.** Both branches were pointed at `nl`/`nr`
and the arm was made to answer `typeNone()` when the operator rejected its operands, which is the
`Unary` arm's rule in the same words. `true + false` and `"a" * "b"` then report once each, all of
`corpuscheck`, `typecheck`, `cases`, `specsingle`, `specmulti` and `codes` stay green — and
`illtyped_test`'s **`n * a-literal`** row goes from one diagnostic to **two**. A *named* integer times a
string literal is already reported by another path, so filling the literal in makes the operator branch
a second voice for a fault that was already named. That row is the one to work against; it is not
visible from the `true + false` end of the problem at all.

So the remaining work is narrower than "swap the identifiers": find which path already reports
`n * "a"` and decide which of the two should own it. `issues/lang/0238a` is the same question for a
different pair and closed by making one of them silent.

## Closed — the mirror had to move too

`illtyped_test`'s `n * a-literal` row went to two diagnostics because the suppression that keeps the
mismatch rule quiet **mirrors** the operand rule's condition, and was written against `alt`/`art` for
exactly the same reason the operand rule was:

```wac
bool operandRuleSaid = k != kPlus() && (alt == "string" || art == "string");
```

`issues/lang/0238a` says so in the comment above it — *"suppressed only where the operand rule actually
spoke, which is narrower than 'not `+`'. That rule reads `typeOfExpr`, which is empty for a string
literal, so it never fires for `n * "a"`"*. So the pair is not two uses of one fact, it is a rule and a
model of that rule, and moving one without the other makes them disagree. Three edits, in lockstep:

* the two operand branches read `nl`/`nr`;
* `operandRuleSaid` reads `nl`/`nr`;
* the `Binary` arm answers `typeNone()` when an arithmetic operator was given a `bool`, so the slot rule
  does not speak second — the `Unary` arm's rule, which states it in the same words.

Counts after, all at one where the reference gives one: `i32 n = true + false`, `i32 n = true * false`,
`string s = "a" * "b"`, `bool b = true + false`, and `n * "a"` back to one. The chain
`t.a + t.b + t.c` is still one. `corpuscheck`, `typecheck` rung 3, `cases`, `specsingle`, `specmulti`,
`illtyped`, `binaryoperands`, `warnings` and `codes` are green.

**What to take from it.** The first attempt was reverted on the strength of one row in one test, and the
row was right — but the conclusion drawn from it, *"find which path already reports `n * "a"` and decide
which should own it"*, was the wrong question. Both paths should report it, one at a time, and the code
already had a mechanism for that. The comment naming the blindness was two lines above the thing that
depended on it.
