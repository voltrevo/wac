# 0370a — `await` in a `match` subject, inside a larger expression, or in a `for (x in xs)` body is refused, and the spec writes all three

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-03
- **Kind:** missing feature
- **Symptom:** compile error

## Reproduction

```wac
import { Sys } from "std";
async void copy(Sys sys) {
  match (await sys.readFile("a.txt")) {
    Ok(bytes): { sys.log("\{bytes.len()}"); }
    Err(why):  { sys.log(why); }
  }
}
```

Expected: Compiles — spec ch44's `copy` fragment and ch26 write `match (await …)` and `try await sys.readFile(…)`.
Actual: *an `async` function this compiler cannot lower — an `await` in a `match` subject*. `u8[] b = try await sys.readFile(…)` gives *an await inside a larger expression*, and an `await` in a `for (x in xs)` body gives the same *larger expression* message, which names the wrong reason.

## Notes

Hoisting the `await` into a local first works in each case, so the lowering exists and these are positions it does not reach; an indexed `for (;;)` loop with the same body compiles. Several `vision/` entries and two spec fragments are blocked only on this.
