# 0280a — the wapy printer drops parentheses that decide what a program means

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-27
- **Kind:** bug
- **Symptom:** wrong answer — the rendering is a different program, and it compiles

## Reproduction

`spec/cases/0237-parentheses-are-the-escape-from-the-type-argument-reading.wac`, which exists to
pin exactly this rule:

```wac
i32 g(bool x, bool y) { return x && y ? 1 : 0; }
export i32 f() { i32 a = 1; i32 b = 2; i32 c = 4; i32 e = 3; return g((a < b), c > e); }
```

compiler/wapyPrint.ts renders the last line as

```
    return g(a < b, c > e)
```

Expected: the parentheses survive, because `(a < b)` is what stops `g(a < b, c > e)` being read as
the type arguments `g<a, b, c>`. `design/lang/0011` §`§wacc-type-args-commit` is the rule and this
case is its own documentation of it — *"a reader told to 'use parentheses' would reasonably write
four of them"*.

Actual: wacc reads the rendering as a construction of `g` with one null argument. The two trees:

```
wac : (construct (named g ()) ((binary < (ident a) (ident b)) (binary > (ident c) (ident e))))
wapy: (construct (named g ()) ((null)) ())
```

## Why nothing caught it

compiler/wapyRoundTrip.test.ts renders with this printer and reads back with
compiler/wapyParse.ts, and **the reference does not implement the rule** — the case says
`only: wacc`. So both of its sides read `g(a < b, c > e)` the same way and the round trip is exact.
The pair agrees; neither agrees with the language.

That is the shape compiler/wapyParse.ts's own header warns about — *"a round-trip test cannot
notice, because it only ever feeds the reader output from the printer"* — arriving through the other
door: not an invented spelling, but a rule the reader does not have.

Found by `packages/wacc/test/wapyRoundTrip.test.ts`, which renders with the printer and reads back
with **wacc**, on the first corpus it was pointed at.

## What to do

The printer decides parentheses from precedence alone. Under `§wacc-type-args-commit` a `<` in an
argument list is not decided by precedence: it depends on whether what follows commits to a type
argument reading. So the printer needs the rule, or a rule of its own that is safe under it — the
cheap version being *"keep the parentheses the source had around a comparison in an argument
list"*, which is not a general answer but covers what a reader can write.

**It is a printer question, not a wapy one.** The same parentheses would be needed if the printer
emitted wac. Whether it is worth fixing at all depends on whether `wapyPrint.ts` survives
`design/lang/0003`'s direction — it is the last thing the reference has that wacc does not, and this
issue is one of the arguments for giving wacc a printer instead.

## Not the escape bug

Five other files fail the same test for `issues/lang/0277a` — the printer writes a NUL as the
four-character escape `\u0000`, which wac has no spelling for. Different cause, same test, and both
are listed in that test's `KNOWN_BAD` with the issue they belong to.

**Writing this page cost a commit to that same bug.** The first draft carried the NUL itself rather
than a description of it, and `git commit` refused: *a NUL byte in commit log message not allowed*.
Which is the argument for `0277a` in one line — the byte travels invisibly through everything that
does not check.
