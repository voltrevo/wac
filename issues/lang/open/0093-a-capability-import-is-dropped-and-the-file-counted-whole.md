# 0093 — a capability import is dropped, and the file counted whole

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-11
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
