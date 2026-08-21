# 0175a — `diagnoseGraphIn` accepts a `Res` and never reads it

- **Fixed in:** f043e393
- **Status:** closed
- **Closed by:** agent-a, 2026-08-21
- **Reported by:** agent-a
- **Date:** 2026-08-20
- **Kind:** bug
- **Symptom:** no error — it answers exactly what the root-less variant answers

## Measured

`packages/wacc/src/api.wac`:

```wac
export string diagnoseGraphIn(string[] paths, string[] sources, Res res, string entry) {
```

Its body is 39 lines and mentions `res` **zero** times, comments stripped. So it is `diagnoseGraph`
with a parameter, and a caller that resolves a project root and hands it over gets the same answer it
would get from passing nothing.

Counted across the family: of the **8** `Res`-taking entry points in `api.wac`, six use it and two did
not — this one and `emitFilesCoveredIn`, whose body was character-for-character its root-less sibling's.
The second is fixed (`emitLinkedCoveredIn`); this one is not, because it is not a one-line pass-down.

## Why it is not one line

`diagnoseGraphIn` builds each file's closure with `closureOf(paths, sources, paths[i], seen)` and then
calls `diagnoseFilesWith(...)`, and **neither takes a `Res`**. So honouring the parameter means:

- resolving import specifiers in the closure walk through the same route the linker uses
  (`resolveFromIn`/`resolveVia`) rather than by text, or a mapped specifier is not even in the closure;
- threading a `Res` into `diagnoseFilesWith` and then into `checkFilesWith`, which is the change
  `issues/lang/0157` is still open for and gives the cost of.

So the two issues meet here: 0157's files-based half wants the checker to *report* an unresolved
import, and it cannot resolve one properly until this parameter means something.

## What to do about it meanwhile

**Either implement it or delete it.** A `Res`-taking variant that ignores its `Res` is worse than no
variant: `design/lang/0009` D7 is what these `In` entry points exist for, so a caller reads the name and
reasonably concludes the resolution context is being honoured. `emitFilesCoveredIn` had a doc comment
saying exactly that while dropping it.

Deleting it is cheap and honest if nobody calls it — `diagnoseGraph` is right there.

**And that sentence, as first written, said "nothing in this repository calls `diagnoseGraphIn` today,
which is the only reason this has cost nothing yet." That was false, and it was the whole of why this
was filed as tidiness.** `packages/wacc/example/wacc.wac:695` calls it, and that is `wac check` — so
the one caller is the command whose entire job is to report what is wrong with a program. It had cost
something the day it was filed; nobody had looked.

## How it was found

Chasing GitHub issue 21's `@/` failure, which turned out to have a different cause
(`issues/system/0228a` item 5). Looking for "which entry point drops the root" was the wrong question
for that bug and the right one for this file: two of eight, one of them documented as doing the
opposite.

## What it actually cost — measured, 2026-08-21

A `wac.json5` project, two files, the entry a directory below the root so that `@/src/stats.wac` and
`./src/stats.wac` are different paths. One call with the wrong number of arguments, written twice:

    import { mean } from "../src/stats.wac";   →  error: wrong number of arguments, with a caret
    import { mean } from "@/src/stats.wac";    →  app/bad.wac: 2 file(s), no diagnostics

Same mistake, same two files, same rule, and the second is silent. `wac build` on the silent one then
wrote a module and the engine refused to load it:

    wac: the build wrote /tmp/badfix.wasm.wasm and the engine will not load it, so the compiler
         emitted something invalid rather than refusing the program

So the cost was not a misleading parameter name. **Every mistake reachable only through a `@/` import
was invisible to `wac check`, and the build emitted an invalid module instead of refusing** — which is
the one outcome `docs`, `0118`, `0163` and `0170a` all exist to prevent.

## The fix

Three resolution sites, each of which alone kept the silence — all three canaried by backing them out
one at a time against the arm of the test that covers them.

1. **`edgesOfIn`**. `edgesOf` resolved every specifier with plain `resolveFrom`, so a `@/` spec landed
   on a key no supplied file has and the edge was *dropped*: the importing file's closure did not
   contain the file it imports. `edgesOfIn` resolves with `resolveVia`, and `edgesOf` is now the
   `Res.empty()` wrapper over it.
2. **`checkFilesWithIn`**. The checker resolved the entry's own import list by text too, so even a file
   present in the closure contributed no declarations. `diagnoseFilesWithIn` carries the `Res` down to
   it.
3. **`resolveVia` and not `resolveImportIn` at that site.** The first attempt honoured
   `res.rootAt(paths, entry)` and dropped `res.base` and the mappings. A project found on disk has
   *relatively*-keyed paths and an *absolute* root, so the join is mapped back through `base` — and
   resolving with the root alone gives `/abs/p/src/lib.wac` for a file keyed `src/lib.wac`, which is
   not the file, which is silence one step further along. This cost a cycle: the unit test went green
   while `wac check` on the real project still said "no diagnostics", because the `Res` the test built
   filled one of four fields and the failure needed two.

**And `diagnoseGraphIn` is now the only body.** It had been a copy of `diagnoseGraph`, so besides
ignoring its `Res` it had also missed `issues/lang/0133` — it walked the graph from the text, resolving
each specifier per closure, which is the cost that issue removed. `diagnoseGraph` is now the
`Res.empty()` wrapper. The path-domain closure walk (`closureOf`/`closureOfIn`, 39 lines) existed
because "`edgesOf` resolves with plain `resolveFrom`, so a `@/` or a mapped specifier is not an edge
there at all"; that is fixed one level down, so it had no callers and is deleted.

## Tests

`packages/wacc/test/wac/checkgraph_test.wac`, three arms, in the file whose own header says the pair of
assertions matters more than either alone:

- the relative import and the `@/` one on one graph, which must report **the same** diagnostic — the
  relative arm is the control that proves the rule fires here at all, so the other arm is evidence
  about resolution rather than about the rule;
- a correct `@/` graph, which must stay silent, or "reached the file" and "complains about every file
  it suddenly reached" would look alike;
- the `Res` shape a project on disk actually produces — relative keys, absolute root, `base` set —
  which is the one that fails when only the root is honoured.

## What is left, and it is 0157

An import that resolves to a file **nobody supplied** is still not refused by the checker; it
contributes no declarations and every name from it is unknown. That is `issues/lang/0157`, and its
recorded blocker — "it cannot resolve one properly until this parameter means something" — is now gone.
