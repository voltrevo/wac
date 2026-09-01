# 0317 — a wapy dedent may land on a column no enclosing block sits at, and nothing says so

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-09-01
- **Kind:** missing feature
- **Symptom:** wrong answer — a program the spec forbids is accepted in silence

## The rule

`spec/spec/wapy.md`, in the grammar section:

> `block` is `INDENT , { statement } , DEDENT`, where INDENT and DEDENT are changes in leading
> whitespace rather than tokens. **A dedent must land on a column some enclosing block already sits
> at.**

## The reproduction

```
def f() -> i32:
    a = 1
  b = 2
  return b
```

`a` sits at column 5, the top level at column 1. `b` and `return b` sit at column 3, which is
neither — so the dedent lands on a column no enclosing block sits at, and the rule above forbids it.

Driven through `frontendOf("a.wapy", …)`:

    lexer errors: 0
    parser errors: 0

Accepted, in silence. `wapyParse` alone answers the same.

## What makes it more than an unimplemented check

**The error code exists and is never raised.** `packages/wacc/src/wapylex.wac` declares

    export i32 werrTab()          { return 40; }
    export i32 werrMisspelled()   { return 41; }
    export i32 werrDedent()       { return 42; }
    export i32 werrUnclosed()     { return 43; }
    export i32 werrIndent()       { return 44; }

`werrTab` and `werrUnclosed` are raised, at `wapylex.wac:207` and `:235`. **`werrDedent`,
`werrIndent` and `werrMisspelled` are raised nowhere** — `tools/wac/deadexports.wac` is how they
were found, and its closing line is that a dead function means either a call site is missing or the
function is. Here it is the call site: somebody numbered these deliberately, in the same table as
the two that work.

**And the rule is untagged, which is probably why.** Every `[§…]` clause in `spec/spec/` is held to
a case or a test by `packages/wacc/test/wac/spectags_test.wac`. This sentence carries no tag, so
that guard never asked for one, and no case exists. The two rules either side of it in the same file
are tagged — `§wac-wapy-nolines-4gt7wxb`, `§wac-wapy-words-p2vm9kx`. An untagged rule is a rule
with nothing holding the compiler to it, and this is what that looks like from the outside.

`packages/wacc/test/wac/wapy_test.wac` mentions indentation once, in a comment about continuations.
Nothing tests a bad dedent.

## The messages are written too — only the raising is missing

`packages/wacc/src/diag.wac` renders wapy's codes by number, and all three unraised ones have their
text already:

    if (code == 41) { return "wapy spells this differently"; }
    if (code == 42) { return "this dedent lands on no enclosing block"; }
    if (code == 44) { return "the indentation of this line is not a block"; }

Beside 40 and 43, which are raised. So somebody wrote *"this dedent lands on no enclosing block"* —
the sentence this issue is about — and nothing can ever print it.

That makes the work smaller than it looked: the diagnostic exists end to end except for the one
`errs.push(werrDedent())` that would reach it. The comment above that table is worth reading beside
this, because it is the same argument one level down: *"Unnamed is worse than mislabelled. Without
these the renderer fell back to 'the parser refused this' at the position of the end-of-file token,
which reads as a compiler bug rather than as a wapy program with a missing colon in it."*

**Found by looking at the wrong thing first.** Grepping for `werrDedent` across the tree finds only
its declaration, which reads as "there is no message for it either". `diag.wac` matches on the
*number*, not the name, so the text is invisible to that search. Ask how a code that *is* raised
gets rendered, and the table appears.

## Why it is filed rather than fixed

Raising `werrDedent` where the spec says to is a new diagnostic on a surface that already has
programs, and `wapyroundtrip_test.wac` renders wac to wapy and reads it back on every gate.

**The obvious risk is checked and looks clear.** `wapyOf` on a doubly-nested function emits

    @export
    def f(n: i32) -> i32:
        if n > 0:
            while n > 1:
                n = n - 1
            return n
        return 0

— four-space steps, and every dedent lands on a column an enclosing block sits at. So the printer's
own output is not what would go red. What is *not* checked is the rest of the corpus and whatever
`.wapy` a person has written by hand, which is the part worth a second pair of eyes before the check
is switched on rather than after.

Whoever takes it wants, in order: a tag on the sentence, a `spec/cases/` file holding it, then the
check, then `werrMisspelled` and `werrIndent` answered the same way — either raised where their name
says, or deleted with the reason written down.
