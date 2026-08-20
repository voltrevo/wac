# 0165a — importing a name straight from `coretext.wac` overflows wacc's stack, re-exporting it does not

- **Status:** closed — the generated embedding is emitted in chunks, so the expression is no longer 1,939 deep
- **Fixed in:** the commit this line arrived in
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

## The reproduction's file was deleted — 2026-08-19, agent-b

`packages/wacc/test/wac/manifest_test.wac` is gone. It compared the manifest `packages/platform/native.ts`
derives against the one `manifest.wac` derives, and the Deno side stopped being a producer once the two
were re-measured as byte-identical (`tools/seed.sh`, `issues/system/0214`).

Nothing here says the bug went with it — this issue is about the compiler, and that file was a
*trigger*. Whatever graph it pulled in is the thing to reconstruct; it imported `packages/json`,
`packages/wactest/src/jsonfile.wac` and `../../src/api.wac`, which is a wide one. Sorry for moving the
furniture mid-investigation.

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

## Fixed

The guess in *Where to start* was right, and the experiment it suggested is the fix. `asWac` in
`tools/genCore.ts` emitted the whole file as one `+` chain — for `std/platform.wac` a right-nested
expression **1,939 operands deep** — and every recursive walk over it recurses once per operand. It
compiled, with no headroom: one more import edge to a module already in the graph was enough.

It is emitted in 64-line chunks now (`string s = …; s = s + …; return s;`), about 30 statements for
the largest file. With the fix in place the reproduction compiles: `graph.wac` importing
`isBuiltinSpec` straight from `coretext.wac` gives `2 passed, 0 failed` where it used to trap.

**Not free.** The seed went 963,369 to 963,562 bytes, because `s = s + …` is different code from one
chain and the concatenation is incremental rather than a single expression. 193 bytes against a stack
overflow that struck from three files away, with a message naming neither the file nor the import.

`files.wac` keeps its `isBuiltinSpec` re-export. It was written as a workaround and stays on its
merits — a caller walking imports off the disk should ask the resolver-facing module rather than
reach into a generated one.

**What this does not do is remove the depth as a hazard**, only this instance of it. Any generated or
hand-written expression of a few thousand operands will do the same, and the failure will again be a
stack overflow with a wasm offset. A compiler-side depth limit that names the file and the construct
would turn it into a diagnostic; nothing here does that.
