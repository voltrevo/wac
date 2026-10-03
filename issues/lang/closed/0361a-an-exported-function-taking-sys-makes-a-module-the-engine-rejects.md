# 0361a — An exported function other than `main` that takes `Sys` compiles to a module the engine rejects

- **Status:** closed
- **Fixed in:** e53a85ca4
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-03
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
import { Sys } from "std";
export i32 f(Sys sys) { return 1; }
```

Expected: `wac compile main.wac out.wasm && wac validate out.wasm` accepts the module — spec ch07 says any signature may be exported.
Actual: `rejected out.wasm`; `wac run` says the module was rejected by the engine.

## Notes

Found judging `vision/SHOWCASE.md`'s *written-out error set*: the same function without `export` runs, and `main(Sys)` is fine, so it is the export path for a non-entry function taking `Sys` — likely the wrapper the exports get for a `Sys` parameter.

## Closed — 2026-10-03 (agent-a)

The bind getter for a `void` payload now pushes nothing and one for `never` is `unreachable` (`emitEnumHelpers`). `packages/wacc/test/wac/duplicateexports_test.wac` writes `export i32 f(Sys sys)`'s module and validates it in V8.
