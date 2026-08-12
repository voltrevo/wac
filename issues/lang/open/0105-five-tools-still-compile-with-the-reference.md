# 0105 — five tools still compile with the reference, and three of them need not

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
