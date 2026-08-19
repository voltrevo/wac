# 0165a — importing a name straight from `coretext.wac` overflows wacc's stack, re-exporting it does not

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** the compiler traps

## Reproduction

In `packages/wacc/test/wac/graph.wac`, one import line. Everything else in the file identical.

**Traps:**

```wac
import { importSpecs, resolveFrom } from "../../src/files.wac";
import { isBuiltinSpec } from "../../src/coretext.wac";
```

**Works:**

```wac
import { importSpecs, isBuiltinSpec, resolveFrom } from "../../src/files.wac";
```

where `files.wac` holds `export bool isBuiltinSpec(string spec) { return coreIsBuiltinSpec(spec); }`
over the same import. Then:

    $ wac test --allow-read --allow-write --allow-run --allow-env \
        packages/wacc/test/wac/manifest_test.wac
    wac: packages/wacc/example/wacc.wac trapped
    wasm://wasm/003a7f22:215590: Uncaught RangeError: Maximum call stack size exceeded
    wasm://wasm/003a7f22:524394: Uncaught RuntimeError: dereferencing a null pointer

The second spelling gives `2 passed, 0 failed`. Toggled back and forth twice, with no rebuild of the
seed in between — `graph.wac` is a test file, so the only thing that changed is that line.

## What is not the difference

- **Not the module set.** `wac check packages/wacc/test/wac/manifest_test.wac` says
  `37 file(s), no diagnostics` for *both* spellings. `coretext.wac` is already in that graph either
  way, reached as `files.wac` → `path.wac` → `coretext.wac`; the failing spelling adds a second edge
  to a module that is already there, and adds no file.
- **Not the function.** It is the same `isBuiltinSpec` in both, one of them through a one-line
  wrapper.
- **Not `wac check`.** Only the `wac test` build trapped, which compiles a generated wrapper around
  the test file — a bigger entry than the test alone.

## Why it matters

**A legal import makes the compiler die**, and the failure names neither the file nor the import: it
is a stack overflow inside `wacc.wac` with a wasm offset. Nothing points at `graph.wac`. I found the
line by bisecting an edit I had just made and knew was innocent; somebody who did not write the line
would have no thread to pull.

It is also the kind of bug that gets misattributed. The first thing I concluded was that the *check*
I had added was too expensive, which was wrong — the check is one call.

## Where to start

`coretext.wac` is generated and it is now **174 KB**, a fivefold jump on 2026-08-19 when
`design/lang/0009` D4 put `std/platform.wac` in it beside `core`. Its two functions are each a single
expression: one `+` per source line, so `stdFile` alone is a right-nested concatenation about 2,900
operands deep. A recursive walk over that is already deep, and the plausible story is that the second
import edge adds a frame or two to whatever the compiler does per edge and tips it over.

That is a guess about the *cause*; the two spellings above are the fact. Worth checking whether the
depth is what matters by chunking `asWac` in `tools/genCore.ts` to emit several statements rather
than one expression, and seeing whether the failing spelling then compiles.

**Related but not the same:** `issues/lang/0147` (closed) is about a `trap` message being dropped.
Here the message came through — `Maximum call stack size exceeded` is V8's, and it is the only useful
thing in the output.
