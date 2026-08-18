# 0157 — an import of a file nobody supplied is caught by the emitter, not the checker

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** diagnostic
- **Symptom:** no error

## Measured

```wac
import { foo } from "./b.wac";
export i32 f() { return foo(); }
```

with `b.wac` supplied by nobody:

| asked | answer |
| --- | --- |
| `dumpErrors` (single source) | 0 diagnostics |
| `dumpTypeErrors` (single source) | 0 diagnostics |
| **`diagnoseFiles(["main.wac"], [src], "main.wac")`** | **0 diagnostics** |
| `blockedFiles(…)` | `"an import of a file that was not supplied"` |
| `emitFiles(…)` | 8 bytes — a wasm header and nothing else |
| the reference's `wacCompile` | refuses: `file not found in programs map: 'b.wac'` |

So wacc does catch it, one phase later, with **no position and no file name** — `blockedFiles` infers the
message from a linker sentinel (`emit.wac`'s `linkFailure`, which answers from `starts[0] == 1`). A caller
that asks the checker is told the program is fine.

## What this corrects

`packages/wacc/test/specSingle.test.ts`'s single `KNOWN_MISSES` entry says of this case:

> A single-file runner has no `b.wac`, so it cannot refuse it … The miss is the runner's scope rather
> than the checker's, which is why it is known rather than fixed.

**The second sentence is wrong**, and it is the reason nobody looked again: the files-based entry point has
the whole map and still reports nothing. The scope is not the runner's. That comment is corrected in the
same commit as this issue.

## The rule is safe to add, and that is measured too

Over the 744 recorded cases in `packages/wacc/test/specCases.json`:

- **688 are single-file, and 0 of the legal ones import a relative path.** So a rule that refuses an
  import naming a file the caller did not supply cannot make a legal program illegal anywhere in the
  corpus — which is what the worry behind the `KNOWN_MISSES` comment was ("refusing it would mean
  refusing every import").
- 4 illegal ones import a relative path, and the reference refuses all four with
  `file not found in programs map`.

## The decision

Where the rule belongs, because the checker cannot see what it needs today.

`C` carries neither the path of the file being checked nor the list of files in the compilation —
`checkModule(C c, Program prog)`. Making the checker report this means threading both through `C.create`
and every entry point in `api.wac`, which is a change to the compiler's public surface rather than a fix.

Three ways, and the third is the one the spec's own words point at:

1. **Thread the path and the map into `C`.** The rule then sits beside the other import rules in the
   `Import` case, which already reports `unknown module` and `no such export`. Costs a signature change
   on the entry points and a wider `C`.
2. **Report it from `api.wac`**, which already has `paths` and `sources` in hand when it builds the
   fronts. Cheapest, and it puts a diagnostic in a layer `spec/spec/errors.md` says diagnostics must not
   come from: *"These fields are populated by the compiler phases (lex, parse, resolve, typecheck) — not
   added after the fact by a formatting layer."*
3. **Give wacc a resolve step.** The reference has four phases and wacc's wire has three — `lex`, `parse`,
   `check`. An import that names a file nobody supplied is exactly a resolve-phase complaint, and so is
   `no such export` from another file, which the checker currently answers for. This is the largest of
   the three and the only one that leaves the phase field honest.

Whichever it is, the diagnostic should name the file and sit at the import's own token: the emitter's
sentence names neither, and `§wac-diag-parse-bad-type-n7qm3xf`'s annotation is the house standard for
saying which name was not found.

## What closes when it lands

`specSingle.test.ts`'s `KNOWN_MISSES` goes empty — 304 of 304 illegal programs refused — and
`packages/wacc/README.md`'s type-check row stops carrying an exception.
