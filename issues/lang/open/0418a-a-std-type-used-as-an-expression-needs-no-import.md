# 0418a — a `std` type used as an expression needs no import

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-10-28
- **Kind:** bug
- **Symptom:** accepted program

## Reproduction

```wac
import { Sys, ChildEnv } from "std";
export i32 main(Sys sys) {
  auto r = sys.procs().exec("true", string[](), u8[](), ChildEnv.inherited(), Launch.plain()).wait();
  return 0;
}
```

Expected: *undefined name — no Launch in scope*, which is what a file checked on its own says, and what
`Launch l = …;` says about the written type.
Actual: `wac check` is clean, and the program builds and runs.

## Notes

Found by `typecheck_test.wac`'s rung 3, which checks each file alone: step 5's migration wrote `Launch.plain()`,
`Launch(…)` and `Exists(…)` into nineteen files that never imported them, and the whole-graph checker accepted
every one. A static call and a construction both resolve the name through the graph rather than the file's
imports.
