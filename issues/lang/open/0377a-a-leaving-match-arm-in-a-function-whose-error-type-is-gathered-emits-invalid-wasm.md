# 0377a — a match arm that returns, in a function whose error type is gathered, emits a module the engine refuses

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-15
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
import { Result } from "core";
Result<i32, string> get(i32 n) { if (n < 0) { return Result.Err("no"); } return Result.Ok(n); }
Result<i32> f(i32 n) {
  i32 v = match (get(n)) {
    Ok(x): x,
    Err(e): return Result.Err("f: \{e}"),
  };
  return Result.Ok(v + 1);
}
export i32 g(i32 n) { return match (f(n)) { Ok(v): v, Err(e): -1 }; }
```

Expected: `g(3)` is `4`, `g(-1)` is `-1`.
Actual: `wac check` is clean; `wac run … g 3` says the module *"was rejected by the engine — this is a
compiler bug"*. A `main` of the same shape is declined at build with *"a null in a never slot"*.

## Notes

Written `Result<i32, string>`, the same function works — that is `spec/cases/0527`. So the leaving arm
is fine and the gathered error type (`Result<T>`'s default `E = union`, spec ch26
`§wac-try-collects-errors-6cjnatm`) is what goes wrong: the `Result.Err` in the arm seems not to count
towards what the union gathers, which leaves it `never`. `try` in the same function gathers correctly.
Found converting `packages/ethrpc`'s examples, which now declare `Result<i32, string> main`.
