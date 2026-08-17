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

## Why the slice is the wrong place to decide it

That test's own comment says what the rule is:

> Single-file: this slice reports nothing that depends on another module, so the import graph is not
> needed to know that *we* should be quiet about all of them.

A call to an imported function **is** module-dependent, and the checker is quiet about it — until a
local of the same name exists. Then the name resolves to the local, the local is an `i32` rather
than a function, and the call becomes an error. The information that would settle it — that `helper`
is also an imported function — is exactly the information this slice has decided not to load.

So the fix is not "resolve harder". It is that a name which is *both* a local and an unresolved
import cannot be judged without the graph, and the slice should stay silent about it, the same way
it already stays silent when the name is only an import.

Worth checking while in there: whether the same confusion reaches the **full** path in the other
direction — a local shadowing an import that really is the wrong type would then go unreported. A
test that pins both would be one program in `spec/cases`.

## What it costs until then

Every push. Two stopgaps, and I have taken neither, because both belong to somebody who has the
context:

- **Rename the four locals in `hsdescgen_test.wac`** — one word each, greens master immediately, and
  removes the only file in the corpus that exercises the pattern. The next person to write it hits
  this again with no test to catch it.
- **Fix the slice** — correct, and it is `packages/wacc/src`, which is being actively ported.

If nobody is mid-change in the checker, the second is not large: the condition is "this name is a
local *and* was imported", and the answer is to emit nothing.
