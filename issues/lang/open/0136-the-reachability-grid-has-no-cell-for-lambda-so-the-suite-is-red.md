# 0136 — `ExprKind.Lambda` has no cell in the reachability grid, and the shared suite is red

- **Status:** open
- **Claimed by:** (nobody yet — whoever is doing `design/lang/0002` almost certainly wants this)
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
