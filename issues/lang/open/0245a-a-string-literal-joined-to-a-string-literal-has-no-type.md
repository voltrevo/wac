# 0245a — `"a" + "b"` has no type, because the rule assumes a literal takes one

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
