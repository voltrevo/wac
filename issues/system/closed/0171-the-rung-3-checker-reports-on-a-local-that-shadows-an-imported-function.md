# 0171 — the rung-3 checker reports on a local that shadows an imported function

- **Status:** closed, 2026-08-17 — fixed as `issues/lang/0143`
- **Fixed in:** `0d02efad`
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

A local whose name is an imported function's, initialised by calling it:

```wac
import { cert, factor, periodNum } from "./fixture.wac";

// ...
u8[] cert = cert(cli);                       // the local shadows the import from here on
t.eqI32(descriptorDocument(0, cert, 42, sup, seed).len(), 0, "...");   // the local, u8[]
```

The reference type-checks this cleanly and so does the full wacc pipeline — `wac run` and `wac test`
both compile it. The **rung-3 checker slice** reports diagnostics on it, which
`packages/wacc/test/typecheck.test.ts` catches as a false alarm:

    rung 3: the whole repo stays silent, which is the property a subset checker can lose ... FAILED
    we report diagnostics in 1 file(s) that type-check cleanly:
      packages/tor/test/wac/hsdescgen_test.wac: 200:15, 369:19, 370:22, 372:21, 376:28, 417:15

Every one of the six positions is the same shape: a local declared `T name = name(...)`, then `name`
used later in the same scope as a value.

## What it is not

Not `issues/system/0170`, which is `wac build` skipping the type check entirely. This is the
opposite direction — a check that fires when it should not — and it is in the slice rather than in
the shipped compiler, so no artefact is affected.

## State

The file that surfaced it has been renamed around the problem: `cert` → `certBytes`, `factor` →
`blindFactor`, `periodNum` → `period` and so on, so the shared suite is green for everyone. That is a
workaround and it is worth saying that it is one — the original code was correct, and the checker was
wrong about it.

The rename is not *only* a workaround, which is the honest caveat. Shadowing an import and then
calling it in the same scope cost three rounds of compile errors while renaming, because a reader
cannot tell `cert` the value from `cert` the function by looking. So the file is better this way
regardless of the bug, and the bug is still a bug.

## Where to start

`packages/wacc/src/check.wac`, wherever a name is resolved to a declaration. The reference resolves
`cert` in that scope to the *local*; the slice appears to reach the import. The initialiser is the
interesting case — at `u8[] cert = cert(cli)` the right-hand `cert` **is** the import, because the
local is not in scope until the declaration completes, so a resolver that adds the local too early
would get exactly this pattern wrong and nothing else.

## Closed 2026-08-17 — the same defect, fixed under `issues/lang/0143`

Filed independently within hours of each other, from opposite ends: this one from the corpus sweep
going red, `issues/lang/0143` from the same sweep blocking a push. Both are one bug.

The cause is not the rung-3 slice. `[§wac-param-shadows-func-5nkq2wp]` gives call position to a local
or parameter **of funcref type** before any function, and `checkCallee` was applying that rule with
the funcref condition dropped — so an `i32` local captured the call, and `naturalTypeOf` then
correctly said an `i32` is not callable. It showed only in the single-file slice because a *same-file*
function is found by `funcAt` first; an imported one is not, which is why the corpus went years
without hitting it and `hsdescgen_test.wac` tripped it the day it landed.

`checkCallee` now defers when the name is bound more than once — an import puts the name in the same
table, so a local of that name makes two entries, and that count is the only thing available to
separate *shadowing an import* from *a local and nothing else*. `i32 x = 1; x()` with no `x` anywhere
is still reported, because the reference reports it too.

This issue's own reproduction, run against the fixed checker, is silent:

```wac
import { cert, factor, periodNum } from "./fixture.wac";

export i32 f(i32 cli) {
  u8[] cert = cert(cli);
  i32 periodNum = periodNum(cli);
  return cert.len() + periodNum + factor(cli);
}
```

Guarded by a case in `packages/wacc/test/typecheck.test.ts` on the single-file path that broke, plus
`spec/cases/0195` and `0196`. The cases alone do **not** catch it — they run the full path, where the
import is visible — which is worth knowing before trusting them for anything adjacent.

**Where this belongs.** A wacc checker defect is `issues/lang/`; `issues/system/` is the packages and
the tooling. Not a criticism of the filing — the symptom arrived through `packages/tor`, which is
exactly where the split is hard to call.
