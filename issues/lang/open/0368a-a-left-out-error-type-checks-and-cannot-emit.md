# 0368a — `Result<T>` with its error type left out passes check and then cannot be built

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-03
- **Kind:** bug
- **Symptom:** check clean, build exit 1

## Reproduction

```wac
import { Sys } from "std";
import { Result } from "core";
export Result<i32> main(Sys sys) { return Result.Err("no input"); }
```

Expected: Exits 1 having printed `no input` — spec ch07's `Result` main.
Actual: *cannot emit — text from a union<string>, which has no `[toString]`*. A sync `Result<i32> example(Sys sys) { return counted(sys).wait(); }` gives *a return between related reference types*. With `Result<i32, string>` written out, both run.

## Notes

Also `vision/SHOWCASE.md`'s *passing a failure on* with the error type left out: with the `await` hoisted, it traps at run time with *requested new array is too large*. The collected error union satisfies the checker and not the emitter in each case.
