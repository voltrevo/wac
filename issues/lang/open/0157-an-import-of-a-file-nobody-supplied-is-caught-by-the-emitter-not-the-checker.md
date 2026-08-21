# 0157 — an import of a file nobody supplied is caught by the emitter, not the checker

- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** diagnostic
- **Status:** open — the single-file half is fixed (2026-08-20); the files-based half is not
- **Claimed by:** (nobody yet — add yourself before working it)
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

`packages/wacc/test/wac/specsingle_test.wac`'s single `KNOWN_MISSES` entry says of this case:

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

`specsingle_test.wac`'s `KNOWN_MISSES` goes empty — 304 of 304 illegal programs refused — and
`packages/wacc/README.md`'s type-check row stops carrying an exception.

## The single-file half is fixed, and the other half now has a measured blocker — agent-a, 2026-08-20

`checkProgram` — the surface `dumpTypeErrors` answers on — reports it. `C` gained a field rather than
a parameter (`unresolvedSpecs`), read off the **parse** rather than the text, which also keeps
`files.wac` out of `check.wac`'s imports: it imports `emit.wac`, and `emit.wac` imports `check.wac`.
One file supplied means every non-builtin specifier is unsatisfiable, so the list is every quoted
specifier `isBuiltinSpec` does not claim. The diagnostic is `errMissingImportFile` (77), at the
import's own token, with the path in the annotation.

`specsingle_test.wac`: **317 of 317** illegal single-file programs refused, `KNOWN_MISSES` **empty** —
the closing condition this issue named. Its comment said *"refusing it would mean refusing every
import, which is the opposite of right"*, the second wrong reading of this case in a row, corrected in
place: refusing an import naming a file **nobody supplied** is not refusing every import.

A bonus, because `isBuiltinSpec` is membership rather than a prefix: **a mistyped built-in path is
refused too.** There is no io.wac in the core tree and that was silent. Found by writing the new test's
own control wrongly.

### Why the files-based half is not done, which is now evidence rather than an estimate

The obvious implementation is the same rule in `checkFilesWith`, resolving each specifier with
`resolveFrom` against the path map it already holds — the way `edgesOf` does, which is also where the
gap comes from: `edgesOf` **drops** a spec that resolves to nothing, with a comment saying a missing
file is the caller's to report, and the caller that reports it is `example/wacc.wac`.

That is wrong, and four cases each in `mappedspec_test.wac` and `projectspec_test.wac` say so. A
**mapped** specifier (`dep/lib.wac` through a lock and cache) and a **project** specifier
(`@/src/inside.wac`) resolve through a `Res` that `checkFilesWith` does not carry — and so does a
plain `./a.wac` *inside a mapped subdirectory*, which is the case that shows a prefix test cannot
rescue it either. `resolveFrom` is simply not the resolver in use there.

So option 1's cost — thread the resolution context — is real and unavoidable for this half, and the
shortcut of resolving with the plain resolver is not a smaller version of it. `resolveFromIn` and
`resolveVia` exist; the entry points that carry a `Res` (`diagnoseGraphIn` and friends) could use
them, and the ones that do not would have to say they cannot answer rather than answer wrongly.

*(Two seed builds were spent on the wrong conclusion here: those tests drive the `wac` **binary**, so
they were still reporting the pre-revert compiler's behaviour. `deno task seed` before believing a
host test about a compiler change.)*

### That blocker is gone — agent-a, 2026-08-21

`issues/lang/0175a` threaded it, for its own reason: `diagnoseGraphIn` accepted a `Res` and never read
it, so `wac check` was silent about **any** mistake reached through a `@/` import and the build emitted
an invalid module instead of refusing. Fixing that required exactly the thread this section prices —
`edgesOfIn` resolving with `resolveVia`, and the `Res` carried down through `diagnoseFilesWithIn` into
`checkFilesWithIn`, which now resolves the entry's import list with `resolveVia` too.

So the paragraph above is still an accurate account of the cost, and it has been paid. What is left of
this issue is only the rule itself: **a specifier that resolves to a key no supplied file has should be
refused at its own token, the way the single-file half already does with `errMissingImportFile` (77).**
`checkFilesWithIn` now resolves correctly enough to know the difference between "resolved to a file I
was not given" and "did not resolve at all", which is the distinction that made the plain-resolver
shortcut wrong.

One caution for whoever writes it, learned expensively next door: a `Res` is four fields, and a test
that fills only `roots` passes while the real thing still fails — a project on disk has relative keys,
an absolute root, and `base` set. Build the fixture from what `gather` produces.

### And it exposed something else, which is fixed

Rung 3 of `corpuscheck_test.wac` reported **64 working files** while the files-based rule was in place,
and every one was true. The corpus walk read three fixed directories per package one level deep —
`src`, `test/wac`, `bench` — covering 741 of the 943 `.wac` files under `packages/` and none of
`tools/`, so 64 import edges pointed at files it does not supply: `box/src/applets/*` nested under
`src`, `bignum`'s `test/probe.wac` beside `test/wac` rather than in it, `tools/wac/covledger.wac`
outside the walk entirely. Those imports contributed no declarations, every name from them was
unknown, and unknown is silent — so the row asserting *imports in scope, no false alarm* was false on
both halves, as was the README's count of 541.

The walk is recursive now and covers `tools/`: **975 files**, and rung 3 is clean over all of them. The
fix outlives the rule that surfaced it, which is why it is kept even though the corpus path no longer
carries the diagnostic.

### Three oracles asserted the old single-file contract

`checkalone_test.wac`, `typecheck_test.wac`'s whole-repo rung 3 (**3890** sites — every relative import
in the repository) and its two shadowing cases all assert that a single-file check says nothing. Each
now drops code 77 **and counts it**, asserting the count is non-zero, because a filter that hides a
diagnostic looks exactly like a checker that stopped producing it. `ours` in `rung3_probe.wac` is left
alone and a sibling added: `ours` also counts what a rejection program *caught*, and dropping a code
there would quietly lower recall.
