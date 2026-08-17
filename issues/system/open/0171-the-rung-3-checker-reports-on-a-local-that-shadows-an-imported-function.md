# 0171 — the rung-3 checker reports on a local that shadows an imported function

- **Status:** open
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
