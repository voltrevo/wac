# 0221 — `covdump` runs `main` with no world and stops at the first trap, so seven coverage drivers cannot move

- **Status:** closed
- **Reported by:** agent-b
- **Date:** 2026-08-20
- **Kind:** missing feature
- **Symptom:** not implemented

`tools/wac/covreport.wac` builds an exercise with `--coverage` and reads its counters with
`wac covdump`. That has moved seven `cov.ts` drivers to wac (`issues/system/0161`) with every number
preserved. The remaining ones stop on two properties of `covdump`, and both are properties of the
*command* rather than of the packages.

## 1. No world, so an exercise has no capabilities

`counters_of` in `native/v8/src/main.rs` instantiates with an **empty imports object** and calls
`main` with no arguments. So an exercise whose `main` takes a `Cli` cannot be instantiated at all:

```
covreport: … prog.wasm did not instantiate — an import it wants is missing
```

That is not a grant problem — building with `--allow-read` changes nothing, because the imports are
absent rather than refused. (I added grant pass-through to `covreport` before establishing this and
reverted it: a flag the tool cannot honour is worse than no flag.)

**What it blocks**, in every case a driver that reads a corpus off disk:

| package | what its exercise has to read |
|---|---|
| `json` | `test/jsontestsuite/*.json` by directory listing, and `test/vendor/json5.json` |
| `fs`, `wacpkg` | fixtures and a filesystem to act on |
| `gzip`, `zstd` | their fuzz corpora |
| `crypto`, `ssh` | vectors |

## 2. One trap per run, and it must be last

A trap in `main` aborts it. The counters *survive* — `covdump` prints them and exits 0, with the
engine's message on stderr — but nothing after the trap runs. Measured on the smallest case:

```wac
i32 side(i32 n) { if (n > 0) { return 1; } return 2; }
export i32 main() {
  i32 seen = side(1);
  i32[] a = i32[2]();
  seen = seen + a[5];        // traps here
  seen = seen + side(-1);    // never runs
  return seen;
}
```

```
0  1     entry     side
1  1     then      side       ← side(1) ran
2  0     else      side       ← side(-1) did not
3  1     entry     main
4 counter(s)
```

So an exercise may contain at most one trapping case, at the very end. `packages/bytes`'s driver has
**seven** (`getPastEnd`, `getNegative`, `pushRepeatBeforeStart`, …), `packages/bignum`'s four, and
`json`'s reads them out of `bounds_test.wac` by name. The TypeScript called each one from the host in
its own `try`, which is exactly what a bare `main` cannot express.

## What would fix both

`wac covdump <module.wasm> [export…]`:

- **run the module the way `wac prog.wasm` does** — the world built from the manifest — so an exercise
  can declare and be granted what it needs. `run_as_with` already does this, and `AsChild.cov` exists
  for precisely this purpose: `wac test --coverage` runs instrumented tests in a full world and reads
  the counters out before the instance goes. So the machinery is present and `covdump` is the one path
  that does not use it.
- **call each named export in turn, catching a trap per call**, defaulting to `main` when none are
  named. That is `runTestExports` and the trap loops, in the host, where the counters are.

With those, the remaining drivers are ordinary ports rather than blocked ones.

## Notes

`wac test --coverage` is *not* a substitute. It prints an aggregated `covered / total` per file, not
the per-point list, so it cannot answer "which points did nothing reach" or filter to one package's
prefix — which is the whole output `covreport` exists to produce.

Two drivers need neither fix and are the next ones to move: `packages/stream` (its transform takes
funcref callbacks, which wac can supply) and `packages/sh` — the latter belongs to another agent.

## Closed 2026-08-20

`wac covdump <module.wasm> [export…]` runs through `run_as_with` — the world from the manifest, grants
as the manifest declares them — and calls each named export after `main`, each trap caught.

Both halves shown rather than argued: an exercise whose `main(Core, Cli)` reads a file succeeds built
with `--allow-read` and answers *Not granted to this application* built without, which needs the world
to exist in order to refuse; and `packages/bytes` moved with its twelve trapping cases as exports,
going from the TypeScript's 54 covered to 73 of 80. The nineteen extra branches are all in
`slice.wac`, which the hand-written list of seven probe names never reached.

Three things fell out of it that were not in the plan above:

- **`covdump`'s exit status is about the dump, not the program.** The world path returns what `main`
  returned, and an exercise returns an accumulator; `packages/codec`'s came back as 205 and read as a
  failed dump.
- **A trap wrapper must not answer a `string`.** A wac `string` is a WasmGC reference and cannot cross
  into JavaScript: the call raises `TypeError: type incompatibility when transforming from/to JS`,
  which is not a missing export and was reported as one.
- **A `TryCatch` per call**, for the reason `validate_command` has one per module: a throw leaves an
  exception on the isolate and the next operation meets V8's own null-result-versus-pending-exception
  check. Its comment said "nothing else in this file needs one because nothing else compiles twice" —
  twelve deliberate traps are that, for calls.

`covreport` also prints covdump's stderr on a *successful* run now, because what covdump says on a
good run is that a name is not an export — which reads as a package whose trapping branches are simply
uncovered.
