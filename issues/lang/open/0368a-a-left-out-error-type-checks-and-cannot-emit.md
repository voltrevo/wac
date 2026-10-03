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

## Progress — 2026-10-03 (agent-a)

A function's gathered error type was always right: `lowerResultPlaceholders` asks the checker what its
`Err` payloads and `try`s contribute and writes the union in. Everything that broke was a `Result<T>`
**somewhere else**:

- **A local** — `Result<i32> r = load(5);` — kept `Result<i32, union>` with nothing gathering it, and
  the emitter declined *local of an unspelled type*. It takes its initialiser's type now (spec ch33:
  what flows into a placeholder contributes). `spec/cases/0504`.
- **A local in an `async` function** is hoisted into a cell declared with its written type, so the
  same placeholder reached the cell and the program **trapped** — *requested new array is too large*,
  `vision/SHOWCASE.md`'s *passing a failure on*. The async split rewrites it from its initialiser, awaited
  or not. `spec/cases/0505`.
- **`main`'s adapter** wrote `"\{e}"` for every `Result<i32>`, from when a left-out error type meant
  `string`. It builds the `Err` arm from the error type as written, and a union converts to text
  through the alternative it holds. `program_test`'s new case asserts the output, because spec ch07's
  `Result<i32>` example was counted met by a build that failed — both exit 1.
- **`"\{e}"` on a gathered error** — the checker allowed it and the emitter declined; it converts now.

**Still open, and a question rather than a bug:** `return d();` where `d` answers `Result<i32, string>`,
in a function returning `Result<i32>`. The checker refuses it (*return type does not match*), and spec
ch33 reads as agreeing — *"candidate inference does not invent conversions between concrete
instantiations"*, and `union<string>` is not `string` — so the spelling today is
`return Result.Ok(try d());`. Whether a returned `Result` should contribute its error type and convert is
for the spec to say.
