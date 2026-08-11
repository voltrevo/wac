# 0093 — a capability import is dropped, and the file counted whole

- **Status:** closed — not a defect; I diagnosed it from a correlation
- **Claimed by:** agent-b, 2026-08-11
- **Reported by:** agent-b
- **Date:** 2026-08-11
- **Fixed in:** n/a — withdrawn
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
import { Read } from core;
export i32 f(Read r) { return 1; }
```

Through the linked path, over the whole corpus:

```
packages/fs/src/remote.wac:   blocked=""  imports=[]
packages/gzip/src/gzip.wac:   blocked=""  imports=[]
19 corpus files import from core; 17 of them are counted WHOLE
```

Expected: either a module that declares the host import, or `blockedFiles` naming
the capability as the reason it could not be emitted.

Actual: a module that validates, exports what the source exports, and **declares no
imports** — the capability is gone and nothing says so.

## Notes

`emit.wac` writes types, functions, memory, globals, exports, start, elements and
code. There is **no import section**, so a wasm import cannot be expressed at all;
`import { Read } from core` is a host function and has nowhere to go.

The single-file path is honest about it — `blocked` answers `"an import"` — and the
linked path is not, which is the same shape as `issues/lang/0090`: two paths
answering one question differently. The export check added there cannot catch this
one, because the exports are all present; it is the imports that are missing.

**This is a wrong answer rather than a missing feature.** A host handed one of these
modules gets something that instantiates and then behaves as though the capability
were unreachable. Rung 4's "336 whole" counts all 17.

Two things to fix, and they are separable:

1. Report it. The linked path should decline a file whose capability import it
   cannot express, exactly as the single-file path does — cheap, and it makes the
   corpus number honest again.
2. Emit it. An import section, the capability's signature, and the function index
   space shifting so imports come first — which moves every index the emitter
   computes today.

## Withdrawn — 2026-08-11, agent-b, within the hour

**A capability import needs no wasm import, and this issue was wrong.** The control
took one line:

    import { Read } from core;                    reference imports = []
    export i32 f(Read r) { return 1; }

    export i32 g(fn[i32(i32)] cb) { return cb(1); }   reference imports = ["cb0"]

`core`'s declarations ship inside the compiler — `Read` is a *type*, and using one
costs nothing at the boundary. The reference emits no import for the first program
and `cb0` for the second.

So the 17 files were correlated with `from core` and caused by something else
entirely: a **funcref parameter**, which needs a host callback dispatcher. That is a
real gap and it is `$bind$fnref_0` in the sweep's tally — two packages, not
seventeen — and it does need an import section, which this emitter has no code for.

Filed against the right cause as `issues/lang/0094`.

I wrote this issue from a correlation between "imports from core" and "emits no
imports", with no control for what else those files had in common. `issues/lang/0091`
was the same mistake ten hours earlier, and the discipline that catches it is the one
already written down in `spec/cases/README.md`: reduce it to the smallest program
first, and reduce the *negative* case too. One program with a capability and no
funcref would have refuted this before it was written.
