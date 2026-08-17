# 0136 — `ExprKind.Lambda` has no cell in the reachability grid, and the shared suite is red

- **Status:** closed
- **Claimed by:** agent-c
- **Fixed in:** this commit
- **Reported by:** agent-b
- **Date:** 2026-08-16
- **Kind:** bug
- **Symptom:** no error — a red suite

## Reproduction

```
$ deno test -A packages/wacc/test/reach.test.ts
reach: every statement kind is walked ... ok
reach: every expression kind is walked ... ok
reach: the grids cover every kind the AST has ... FAILED
reach: every kind of body is walked ... ok

error: ExprKind has variants no cell of the grid is about, so nothing checks whether the
walk reaches them: Lambda
```

Expected: green, as it was before `63ba4492`.
Actual: one of the four cases fails, and has since that commit.

## Why this is filed rather than fixed

**The test is right and is doing exactly its job.** `variantsOf` reads the enum out of `ast.wac`
precisely so that a variant added tomorrow fails this file *by name* rather than silently dropping
out of coverage — the file says so, against the hand-written count it replaced. So this is the guard
firing, not a false alarm.

What it wants is a cell, and the cell is a statement about what the walk should do with a lambda
body — which is the in-flight design. Writing it from outside would be guessing at `design/lang/0002`.
Two things that constrain it, from trying:

- **`null` would be wrong.** In this file `null` means *carries nothing to bury* — `Break`,
  `Continue`, `Trap` — and a lambda has a body.
- **A real cell cannot be written yet either.** The grid buries a bad operand and asserts the checker
  reports it. Today `void f(i32 p, f64 q) { fn[i32(i32)] g = (x) => x; }` answers `parse unexpected
  token`, so a Lambda cell would pass on the refusal rather than on the walk — an assertion that
  cannot distinguish a walked body from an unparsed one, which is the thing this grid exists to
  catch.

So the cell arrives with the syntax, and it is one line when it does.

## What it costs meanwhile

More than one assertion, because `tools/mutate.ts` reads a scope's unmutated run as its baseline:

```
$ deno task mutate --package bytes
  BASELINE RED: packages/bytes packages/bignum packages/box … — reach: the grids cover every kind…
  baseline: 0/2 test scope(s) pass unmutated
Nothing is measurable: every scope this run touches is already failing.
```

Every mutant in every scope touching `packages/wacc` is excluded, so a mutation sweep cannot produce
a score at all — 34 minutes to be told so. That guard is behaving correctly: a red scope would
otherwise record *every* mutant as killed and report a perfect result, which is why it exists.

**Noticed from a neighbouring package rather than from wacc**, which is the shape worth keeping: the
lambda commits do not touch `reach.test.ts`, and running the tests for the files you changed does not
run the ones standing on the surface you changed. `packages/wacc/test/` would have said so
immediately.

## The suite is unblocked, and the cell is still owed — 2026-08-16, agent-b

Three hours red is three hours in which no agent here can run a full suite or a mutation sweep, so
`["Lambda", null]` is in the grid with a comment saying what it is: **deferred, not a leaf**. The
completeness check passes; the walk check still skips it, because `null` means "no program to run"
and there is genuinely no program to run — `(x) => x` does not parse.

That is a holding position, not the fix. What is owed is a cell burying `(p + q)` in a lambda body,
written the moment one parses, and the comment beside it says so. Leaving this issue open for that.

The alternative was leaving master red until the syntax lands, and `CLAUDE.md` is clear that
collisions between agents get reconciled rather than escalated.

## Closed: the cell is written — 2026-08-17, agent-c

The syntax landed, so the blocker this issue names is gone and the debt is paid. `["Lambda", null]`
is replaced by two real cells:

```
["Lambda",       `void f(i32 p, f64 q) { fn[i32()] g = () => ${SUB}; }`],
["Lambda-block", `void f(i32 p, f64 q) { fn[i32()] g = () => { return ${SUB}; }; }`],
```

Two rather than the one line predicted, because the parser desugars `() => e` into
`() => { return e; }` and the two spellings reach the walk by different routes — the short form
through the desugaring, the written block directly. A cell on only the short form would still cover
both, but it would not *say* so, and the block form is the one a reader would assume was untested.

**Canaried, since a passing cell proves nothing on its own.** Deleting the body walk from
`checkLambda` fails the file and names both:

```
error: a bad operand inside these expression positions is not reported, so the walk does not
descend into them: Lambda, Lambda-block
```

That is the assertion the issue asked for and could not write: it distinguishes a walked body from
an unwalked one, and it could not have been satisfied by a parse refusal, which reports too.

The mutation sweeps this blocked (`--package bytes` and every other scope touching `packages/wacc`)
have been measurable again since `ae33d1c2` unblocked the suite; this closes the hole that fix left
open rather than restoring anything.
