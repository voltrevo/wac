# 0308b — `a < (…)` is parsed as generic type arguments when the parentheses contain a `>`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-09-01
- **Kind:** bug
- **Symptom:** compile error — on a program that is correct

## Reproduction

```wac
export i32 main() {
  i32 a = 5;
  bool b = (a < (a >> 1));
  return b ? 1 : 0;
}
```

    error: expected a type
      --> m.wac:3:17
       |
     3 |   bool b = (a < (a >> 1));
       |                 ^ found '('
       = help: a type is a name like `i32`, `string`, or one this file declares

    error: unexpected token
       ... expected '>', found '('

Expected: it compiles; `a < (a >> 1)` is `5 < 2`, so `b` is false and `main` answers 0.
Actual: two parse errors, and the help text offers to name a type — a program that never mentioned one.

## What triggers it

The `<` is being taken as the start of a **generic type-argument list**, and a `>` inside the
parentheses is taken as its close. Five shapes, one line apart:

| expression | parses? |
|---|---|
| `(a < (a + 1))` | yes |
| `(a < a + 1)` | yes |
| `(a<(a+1))` | yes |
| `(a < (a >> 1))` | **no** |
| `(a < (a > 1 ? 2 : 3))` | **no** |

So it is not `<` before `(` on its own, and not whitespace: it needs a `>` or `>>` **inside** the
parentheses. The parser evidently scans ahead for a closing `>` to decide whether `<` opens type
arguments, finds the inner one, and commits to the wrong reading.

The C-family answer to this ambiguity is that a type-argument list is only considered where a *type*
can appear, or that the lookahead stops at a token that cannot occur in one — `(` is such a token,
which is why `a < (` should never have been a candidate.

## Why it matters more than the error text suggests

A correct program is refused, and the diagnostic points at the wrong construct: it asks for a type on
a line whose author wrote a comparison. Somebody hitting this reads it as their own mistake.

It is also easy to hit by accident — `x < (y >> n)` and `x < (y > 0 ? a : b)` are ordinary — and the
workaround is invisible: adding a space, or removing the parentheses (`a < a >> 1` binds differently
and is not the same program), or reordering to `(a >> 1) > a`.

## How it was found

`tools/wac/langfuzz.wac`, at seed 7178, after the generator was widened to make `u32` observable. The
generated line was `bool v8 = (v4 < (v4 >> 20));`.

Worth noting for `issues/system/0161`'s account of that tool: this is a **parse** finding, and every
previous one from this generator was a wrong answer. Widening the type set found a bug in a different
phase than the one being widened toward.
