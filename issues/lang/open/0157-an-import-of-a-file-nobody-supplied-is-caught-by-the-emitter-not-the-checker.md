# 0157 — an import of a file nobody supplied is caught by the emitter, not the checker

- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** diagnostic
- **Status:** open — the single-file half is fixed (2026-08-20); the files-based half was attempted and reverted (2026-08-21)
- **Claimed by:** (nobody — agent-a attempted it 2026-08-21, see the last section)
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

## Attempted and reverted, 2026-08-21 — agent-a, and the blocker is now named exactly

`issues/lang/0175a` threaded the `Res` through `checkFilesWithIn` that morning, which is the cost this
issue priced. So the obvious rule became writable, and it is three lines in `api.wac`'s import loop:

```wac
string bare = quoted.len() >= 2 ? quoted.slice(1, quoted.len() - 1) : "";
if (bare != "" && !isBuiltinSpec(bare) && indexOfPath(paths, target) < 0) {
  c.addUnresolved(bare);
}
```

It reuses the single-file half's field, so the reporting stays in `checkProgram` at the import's own
token — one rule, not two. `missingimport_test.wac` passed, `corpuscheck_test`'s rung 3 was clean over
975 files, and every other checker lane passed.

**And it refuses three correct programs.** Found by the gate, not by me:

    mappedspec_test    test_a_mapped_subdir_cannot_import_outside_itself
                       "an import inside the mapped subdir was refused:
                        error: no file was supplied at that path"
    projectspec_test   test_the_root_is_the_importing_files_project_not_the_entrys
                       test_one_file_reached_two_ways_is_one_module

### Why, and this is the part worth keeping

A plain `./a.wac` **inside a mapped checkout** has no entry in the mapping table. The table is keyed by
`(importer, specifier)` and the reader recorded only the mapping that reached the checkout, so an import
*within* it resolves by ordinary path arithmetic — to a key the graph does not hold, because the file is
keyed under the cache. `resolveVia` is the right resolver and still cannot answer for that case.

So **membership in `paths` is not a sound test for "nobody supplied this"**. The section above priced
this half as "thread the resolution context, which is real and unavoidable"; that was true and it is
paid, and the remaining obstacle is a different one, which is worth stating plainly:

> The checker cannot distinguish *"this specifier resolved to a file nobody gave me"* from *"this
> specifier is one I cannot resolve, and the linker can"*. Both come back as a key not in `paths`.

Two ways out, and this is a decision rather than work:

1. **Have the reader record every mapping it followed**, not only the ones it was asked about, so a
   mapped checkout's internal imports are in `Res.mapFrom/mapSpec/mapTo` and resolve there. Then
   membership *is* sound. Cost: the reader walks the checkout, and `Res` grows with the graph.
2. **Ask the linker instead of re-deriving.** `emit.wac` already knows which imports it could not
   satisfy — that is where the "an import of a file that was not supplied" sentinel comes from. Give
   that answer a *position* and let the checker report it, rather than computing membership twice with
   less information. This is the smaller change and it inverts the issue's original framing, which
   assumed the checker should decide.

**Recommendation: option 2.** The linker resolves for real, with the mapping table it was built with;
the checker resolving again is the duplication that made this attempt wrong. The issue's title says the
diagnostic is the checker's — it should still be *reported* there, at the import's token, but the
*finding* belongs to the layer that already does the resolution.

### And a process note, because it is the same one this file already carries

The parenthetical above says: *"Two seed builds were spent on the wrong conclusion here: those tests
drive the `wac` binary, so they were still reporting the pre-revert compiler's behaviour. `deno task
seed` before believing a host test about a compiler change."*

I ran `mappedspec_test` and `projectspec_test` **before** reseeding, read 9 and 5 passed, and believed
them. Then reseeded for an unrelated reason and never re-ran them. The warning was in the file I was
editing, one screen above where I was typing.

## The emitter's half now names the file — agent-a, 2026-08-21

The complaint at the top of this issue is that the emitter catches it *"one phase later, with **no
position and no file name***, inferred from a linker sentinel". Half of that is fixed, and it was four
lines.

`linkFiles` decides it at one place — it reads each queued file's source and finds none:

```wac
string body = path == " core" ? coreSource() : sourceOf(paths, sources, path);
if (body == "") { return ""; }        // ← the path was right there
```

It records the key now, through `filePaths`, which is already an out-parameter that the caller discards
when a link fails, so the name travels without a new argument or a new channel:

    before   an import of a file that was not supplied
    after    an import of a file that was not supplied: /sub/deep/gone.wac

**The resolved key, not the specifier**, which is the useful half: `./b.wac` from `/main.wac` is
`/b.wac`, and the key is what the caller's map is keyed by, so it is the thing to go looking for.
`missingimport_test.wac` asserts it for a sibling and a nested path, canaried by dropping the record —
both fail with the old sentence.

This came out of `issues/lang/0179a`, which gave the same function's five *room* guards their own
sentinels; the missing-file case was the sixth refusal in the same function and the only one that could
name what was wrong.

### What is still open, and why the obvious version of it is unsound

The checker half — a diagnostic at the import's own token. The linker now knows *which key* was missing,
so the checker does not have to re-derive membership, which is what the reverted attempt got wrong. But
"the checker matches that key against its own import list" **is the same mistake in a smaller place**:
to know which import produced `/b.wac`, the checker has to resolve its specifiers, and resolution is
exactly what it cannot do soundly — a plain `./a.wac` *inside a mapped checkout* resolves to a key the
graph does not hold, which is how the attempt above refused three correct programs.

So matching by key is out. What is sound is matching by **specifier text**: if the linker records the
importing file and the specifier as written, the checker can find that import in that file by string
comparison and report at its token, resolving nothing.

The linker did not record it, and the reason is worth stating: the failure is detected while *loading a
queued path*, and the queue holds resolved targets — the specifier was in the importer's source two loop
iterations earlier. **Done now**: `queueSpec` and `queueFrom` run parallel to `queue`, written where a
target is queued and read where the load fails, which is one lookup because `qi` is the queue index.

    an import of a file that was not supplied: /shared/util.wac
      (/app/lib.wac imports it as "../shared/util.wac")

The three together are what a reader needs *and* what a position needs: the key says what to go looking
for, the importer says which file to open, and the specifier as written is the string to find in it — so
a token can be located by comparison, resolving nothing. `missingimport_test.wac` asserts all three, with
the bad import in the *second* file so the importer cannot be the entry by accident, canaried by dropping
the record.

### What is left

Only the wiring. Neither `checkFilesWithIn` nor `diagnoseFilesWithIn` calls the linker, so the linker's
answer has to reach the checker somehow.

**And the obvious objection to the checker asking turns out not to exist.** I wrote here that it would
invert a dependency because `emit.wac` imports `check.wac`; it does not. Checked:

    check.wac imports  lex, lit, coretext, kinds, ast
    emit.wac  imports  lex, coretext, lit, parse, path, ast, kinds
    check.wac is imported by  api.wac
    emit.wac  is imported by  api.wac, render.wac, files.wac

They are siblings, both under `api.wac`, and there is no path from `emit.wac` back to `check.wac` — so
`check → files → emit` would be acyclic too. `check.wac`'s own comment at the single-file fix says
otherwise (*"it imports `emit.wac`, and `emit.wac` imports this"*) and is wrong in its second clause;
corrected in place.

So both routes are open, and the choice is about what each layer should know rather than about cycles:

- **`example/wacc.wac` turns the emitter's named refusal into a positioned diagnostic.** It runs the
  checker and then the emitter, has the paths, the sources and the parse, and now has the file *and* the
  exact specifier to find. A few lines, no new dependency, and the position appears in the one place a
  person reads.
- **The checker asks the linker**, which puts the diagnostic where every embedder gets it rather than
  only the CLI — the set `0175a` was about. Costs `check.wac` a dependency on the resolver, which is
  allowed after all.

Recommendation: the first, then the second if an embedder ever wants it. The reason is not the dependency
graph — it is that the first needs no new resolution and cannot reintroduce the unsoundness that got the
original attempt reverted.

## The parts are answerable, and the CLI route is a fallback — agent-a, 2026-08-21

`missingImportFiles` / `missingImportFilesIn` answer `key\tfrom\tspec`, and `""` for any other reason a
link failed — so a caller can tell *this* cause from any other refusal without matching on English, and
has the three things a position needs. `example/wacc.wac` consumes it: it finds the specifier in the
importing file's source by **quoted string comparison** (so the same path written in a comment above the
import cannot win), counts to it for a line and column, and renders through `render.wac` — a diagnostic
with a caret instead of a sentence.

**And the honest part: `wac build` almost never reaches it.** The CLI's `gather` reads from disk, so a
file that is not there fails there first, with `wacc: cannot read shared/gone.wac`. The emitter's
"not supplied" means the map lacks the *key*, which for the CLI means gather succeeded and the linker
resolved to something else — a real case (it is what `twoKeysForOneFile` and `issues/lang/0163` are
about) but not the common one. So the renderer is a fallback for the CLI and the *seam* is the main
delivery: the callers that supply their own map get the parts, and they are the ones this issue was filed
about.

Tested at the seam rather than through the CLI, for that reason: `missingimport_test.wac` asserts the
exact three fields for a bad import in the second of two files, and `""` for a program that links. The
renderer is verified by construction and by the lanes staying green; a test that could drive it needs a
program where gather succeeds and the linker disagrees about the key, which is `0163`'s territory rather
than this issue's.

### What is actually left

The **checker** reporting it, which is what the title is about. Everything it needs now exists — the
parts, and a resolver it may depend on (there is no cycle, see above). What is not decided is whether
the checker should ask the linker at all, or whether the seam plus `wacc.wac` is enough for the callers
who care. That is a smaller and better-informed question than the one this issue opened with.

## And the message people actually see — agent-a, 2026-08-21

Having fixed the emitter's sentence and found that `wac build` almost never reaches it, the obvious next
question is what the common path says. `gather` reads from disk, so a file that is not there fails there,
and it said:

    wacc: cannot read shared/gone.wac

which names the file and leaves the reader to find which import asked for it — in a graph of a hundred
files, that is the whole of the work. The importer and the specifier are in scope where a path is queued
and gone by the time the read fails two hundred lines later, so the walk carries them, exactly as
`linkFiles`'s queue now does:

    wacc: cannot read shared/gone.wac (app/lib.wac imports it as "../shared/gone.wac")

`readfail_test.wac` drives the binary over a written tree, with the bad import in the **second** file so
the importer named cannot be the entry by accident, and a control for the entry file itself — which has
no importer, and where a sentence that always appends "(x imports it as …)" would be wrong. Canaried by
dropping the record: the first fails with the old sentence and the control still passes.

**So all three layers now name what they know**, and the order they were fixed in is the reverse of how
often they fire: the emitter's (rarely reached), then the reader's (the common one). That is worth
remembering — the layer whose diagnostic is worst is the one furthest from the code you happen to be
reading.
