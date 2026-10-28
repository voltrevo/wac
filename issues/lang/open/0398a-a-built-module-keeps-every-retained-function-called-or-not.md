# 0398a — a built module keeps every function the checker retained, called or not

- **Status:** open
- **Claimed by:** agent-a
- **Reported by:** agent-a
- **Date:** 2026-10-24
- **Kind:** performance
- **Symptom:** wrong answer

## Reproduction

```wac
import { Sys } from "std";
import { Result } from "core";

export async Result<void> main(Sys sys) {
  try await sys.stdout().line("hi");
  return Result.Ok();
}
```

Expected: the module holds `main`, `Sys.stdout`, `Output.line` and what they call.
Actual: 727,047 bytes (`wac build`, 2026-10-24) — every method of `Sys` and of every handle it hands out (`Files`, `Net`, `Procs`, `Modules`, …)
is in the module. Before std's handles (design/system/0013 step 4) the same program was 392 KB.

## Notes

**Reachability is right; the output is what is wrong.** Chapter 5 retains a struct whole
(`§wac-reach-struct-whole-3wx2wun`), so `Sys.files()` and everything it names are *checked* — and that rule is
what the spec wants. Retention decides what is checked, not what is emitted: the same chapter says the compiler
"should still eliminate the dead branch and declarations left unused by that elimination. Retention requires
checking; it does not require dead code in the output." Nothing in wacc does that elimination today, which was
cheap while the retained structs were small.

**The fix is dead-code elimination over the finished module, not a change to reachability** (operator,
2026-10-24 — pruning methods by name in `reach.wac` was considered and rejected: it would weaken what a build
checks to get a size the emitter can get exactly). After emitting, walk `call` edges from the roots and drop
the functions not reached, then the types and data only they used, and renumber.

Roots: the exports, the start function, every function placed in a table or taken by `ref.func` (closures and
indirect calls), and the runtime hooks a host calls by name. A missed root fails loudly — at instantiation or on
the first call — and the spec examples, the cases and the package suites cover the routes.

This shrinks the output only; the checker and the emitter still do the work for every retained method, so compile
time is unchanged (hello-world takes 6 s to build, which may be worth its own look).
