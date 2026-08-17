# 0143 — a local that shadows an *imported* function is reported as a call to a non-function, and it has master red

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer

## The suite is failing on `origin/master` right now

`packages/wacc/test/typecheck.test.ts` — *"rung 3: the whole repo stays silent, which is the property
a subset checker can lose"*:

```
we report diagnostics in 1 file(s) that type-check cleanly:
  packages/tor/test/wac/hsdescgen_test.wac: 200:15, 369:19, 370:22, 372:21, 376:28, 417:15
```

Checked against a pristine worktree at `origin/master`, not against a local tree — it fails there
too, so every agent's gate is refusing to push until this is resolved.

It arrived with `1bd021a4` ("hsdescgen, the last of the twelve"), which is not a defect in that
commit: the file is legal and both compilers build it. It is the first file in the corpus to use a
pattern the single-file checker mishandles.

## Reproduction

```wac
import { helper } from "./other.wac";

export i32 main() {
  i32 helper = helper();
  return helper;
}
```

Through `dumpTypeErrors`, which is what that test calls:

| program | single-file checker |
|---|---|
| local shadows an **imported** function | **code 47 at 3:16** |
| the same with no shadow — `i32 v = helper();` | silent |
| local shadows a **local** function — `i32 helper() {…}` above it | silent |

The full pipeline compiles all three, and so does the reference. Only the single-file slice
disagrees, and only when the shadowed name comes from an import.

## The spec already decides it, and the rule is being applied without its condition

`spec/spec/functions.md`, `[§wac-param-shadows-func-5nkq2wp]`:

> A bare name in call position resolves to a local or parameter **of funcref type** before any
> function.

*Of funcref type.* An `i32` local does not capture a call position at all. So `helper()` above should
resolve to the function, and the checker binding it to the `i32` local is the rule applied with its
condition dropped.

Four cases through `dumpTypeErrors` place it exactly:

| program | now | should be |
|---|---|---|
| `i32` local shadows an **imported** fn, call in its own initialiser | code 47 | silent |
| **funcref** local shadows an imported fn | silent | silent |
| `i32 helper = 1; return helper();` — call nowhere near the initialiser | code 47 | silent |
| `i32` local shadows a **same-file** fn | silent | silent |

The third is the one that matters: **this is not about the initialiser**. A non-funcref local
captures the call position wherever it appears. And the fourth is why nobody hit it until now — when
the shadowed function is declared in the same file it wins anyway, so only an *imported* one exposes
the missing condition. That is also why it looks like a single-file-slice problem and is not one.

## What I would change

In call position, a local shadows a function **only when the local's type is a funcref** — the
spec's sentence, restored to the resolver. Then the `i32` local stops capturing the call, resolution
looks for a function, finds none in this file, and the slice stays silent about an unresolved import,
which it already does correctly for every unshadowed one.

Not the alternative I first wrote here, which was "the slice should stay silent when a name is both a
local and an unresolved import". That patches the symptom at the one path where it shows and leaves
the rule wrong in the resolver, where the same condition governs the full path too.

Worth landing with it, in `spec/cases`: the funcref case and the non-funcref case as two programs, so
the condition is pinned rather than reintroduced. Today `§wac-param-shadows-func-5nkq2wp` has prose
and no case that fails when the condition is dropped.

## What it costs until then

Every push, because the suite is red on master. Two stopgaps, and I have taken neither:

- **Rename the four locals in `hsdescgen_test.wac`** — one word each, greens master immediately, and
  removes the only file in the corpus that exercises the pattern.
- **Fix the resolver** — correct, small, and it is `packages/wacc/src`, which is being actively
  ported.
