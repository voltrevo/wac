# 0105 — twenty-five callers still compile with the reference, and the bundlers are the ones that block the binary

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-12
- **Kind:** task
- **Symptom:** not implemented

Step 3 of
[design/lang/0003](../../../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md).
`harness/wacBind.ts` binds with wacc by default now, so a package gets wacc's code, wacc's
description of its interface and wacc's generator. These call `wacCompile` directly and so still go
through the reference — which means none of them can handle a file using a feature only wacc has.

**Corrected 2026-08-12.** The first version of this issue said "five", from a `grep` I truncated with
`head -14` and did not notice. It is **25 files**. The shape of the answer is unchanged and the
priority is sharper, because two of the ones I missed are the bundlers, and they are what stands
between the `wac` binary and reproducing its own seed.

    harness/{ctTrace,wacBind,wacCoverage,wacTestRun}.ts
    packages/platform/{build,native}.ts
    packages/{tor/test/entries.test,wactest/test/assert.test,zstd/bench/corpus}.ts
    packages/wacc/tools/specCases.ts
    site/src/editor/{wac-compile,wac-lint}.ts   site/tools/{site.test,siteDeadline}.ts
    tools/{bindcheck,check,coverage,emitgen,fuzz,fuzzBoundary,mutate,programs.test,size,
           syncBootstrap,validate,wasmopt}.ts

`harness/wacBind.ts` is done — it binds with wacc by default now. The rest sort into the three kinds
below.

## The bundlers, which is where this bites

`packages/platform/native.ts:95` and `packages/platform/build.ts` compile with the reference and then
write a **manifest** describing what they compiled — the callback signatures, the structs, the
exports. The `wac` binary embeds that pair, and the pair has to agree with itself:

```
$ cp wacc-built-by-wacc.wasm native/seed/wacc.wasm && cargo build --release
$ ./wacland check x.wac
Error: no $bind$fnref_32
```

The manifest says 43 callback signatures because the *reference* found 43; wacc's module numbers them
differently, so a wacc-built module against a reference-built manifest is a module missing a function
the host asks for by name. **That is the whole of why the binary cannot yet rebuild its own seed** —
not the compiler, which produces a working module, but the bundler that describes it.

Moving `native.ts` to wacc means taking the manifest's three lists from `exportSigsFiles` and
`bindTypesFiles` rather than from `WacCompiled`, which is the same mapping `waccBindgen.ts` already
does. That is the next piece of design/lang/0003 step 4.

| caller | what it uses the compiler for | move? |
|---|---|---|
| `harness/wacCoverage.ts` | `{ coverage: true }`, then reads the counters | **yes** — wacc emits `__cov_init/_len/_get` and `covTableFiles` |
| `tools/coverage.ts` | the same, as a command | **yes**, with the above |
| `harness/wacTestRun.ts` | compiles a `.wac` test file, optionally with coverage | **yes** |
| `tools/wasmopt.ts` | bytes to hand to `wasm-opt` | **yes**, trivially |
| `harness/ctTrace.ts` | `{ ctTrace: true }` | **not yet** — the instrumentation exists only in the reference |
| `tools/fuzzBoundary.ts` | the reference's own bindgen | **no, deliberately** — see below |
| `site/src/snippets.ts` | compiles snippets for the site | blocked by `0103` — the glue is TypeScript |

## The two that should keep it

`tools/fuzzBoundary.ts` fuzzes the boundary **the reference's bindgen writes**; the wacc side of that
question is `packages/wacc/test/bindgen.test.ts`. Pointing both at one generator would leave the
marshalling with a single witness, which is the failure mode the file's own header says cost the most.
It is marked in the source.

`harness/ctTrace.ts` wants `{ ctTrace: true }`, and wacc has no equivalent. That is a real gap rather
than a preference — constant-time tracing is how `packages/crypto` is checked — and it is the one item
here that is a *feature* rather than a port. Worth its own issue when somebody takes it.

## Why this matters more than it looks

Each of these is a place where the answer to "can wacc build this repository by itself" is still
*no*, and each will fail in the same way on the day a package uses JSX: not with a diagnostic, but
with the reference refusing to parse a file it was never taught. The coverage three are the same
change three times over and should be done together.
