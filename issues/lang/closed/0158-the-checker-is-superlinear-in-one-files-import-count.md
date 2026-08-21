# 0158 — the checker is superlinear in one file's import count, and hits a wall near 600

- **Fixed in:** not by one commit — see the re-measurement below
- **Status:** closed — agent-a, 2026-08-21: the curve is gone, and the wall was somebody else's fix
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** performance
- **Symptom:** no error

## Measured

A program of *n* one-function files plus an entry that imports all of them, through
`diagnoseFiles(paths, sources, entry)` and `emitFiles(...)` on the same input:

| imports in the entry | check | emit |
| ---: | ---: | ---: |
| 100 | 26ms | 24ms |
| 200 | 85ms | 17ms |
| 300 | 271ms | 30ms |
| 400 | 617ms | 40ms |
| 500 | 1 208ms | 60ms |
| **600** | **19 651ms** | 86ms |

Up to 500 the checker grows about as `n^2.4`; from 500 to 600 — a fifth more imports — it takes sixteen
times as long, while the emitter stays flat. The shape of that last step is a memory wall on top of the
polynomial rather than more of the same curve.

**It is the import count, not the file count.** The same measurement with the entry importing only ten
of the files:

| files in the map | imports in the entry | check |
| ---: | ---: | ---: |
| 560 | 560 | 6 451ms |
| 560 | 10 | **5ms** |
| 1 200 | 10 | **8ms** |
| 200 | 200 | 79ms |

Twelve hundred files cost 8ms when nothing imports them. So the work is per *import edge in one file*,
and superlinear in that number.

## How it was found, and why nobody had

`packages/wacc/test/wac/manyfiles_test.wac` generates 560 files plus an entry importing all of them, to
hold the linker's file tables honest (`issues/lang/0130`). It cost **8.4s**, the largest single test in
the `wac test` lane after the self-host fixpoint. Split:

    blockedFiles     167ms      (a full front end and link)
    diagnoseGraph   8135ms      ← this
    emit             200ms
    run               15ms

**No real program is anywhere near it.** The largest import list in this repository is
`packages/box/src/box.wac` at 65 imports, where this is milliseconds — so the only thing that reaches the
wall is the test that generates a program to test the linker with. That is why a compiler that builds
this whole repository in seconds has never shown it.

## What it is not

Not the linker: `blockedFiles` does a front end *and* a link over the same 561 files in 167ms. Not the
emitter: 200ms. Not the file count: 1 200 files are 8ms. It is the checker, and specifically something it
does per import edge whose cost grows with how many edges one file has.

## Where to look

`packages/wacc/src/check.wac`'s `declareModule` walks a file's imports and brings each imported name into
scope; the tables it fills are flat arrays scanned linearly (`structAt`, `typeOfName` and their
neighbours are `for` loops over the declaration list). With one file importing *n* modules, every
lookup during that file's check walks a table that now holds every name from all *n* — which is
quadratic before anything else, and the constant is a string comparison per entry.

The wall at 500-600 is the part that needs a profile rather than a guess: a polynomial does not step by
sixteen for a fifth more input. Two candidates worth timing before changing anything — the tables
growing past a size where each is reallocated and copied, and the string comparisons allocating.

## What it costs today

One test, 8s, and it has been taken out of that test: it now emits and runs directly, since
`blockedFiles` already answers "does it compile" at 167ms and an emit that produced nothing fails the
run. 8374ms → 480ms. The compiler behaviour is unchanged and is what this issue is about.

## Re-measured: the curve is gone — agent-a, 2026-08-21

`packages/wacc/test/wac/importcurve_probe.wac` builds the same program this issue describes — *n*
one-function files plus an entry importing all of them — and times `diagnoseFiles` and `emitFiles` in
one process, so the rows are comparable with each other rather than with a figure from another day.

| imports in the entry | check, then | check, now | emit, now |
| ---: | ---: | ---: | ---: |
| 100 | 26ms | 10ms | 22ms |
| 300 | 271ms | 10ms | 19ms |
| 560 | **6 451ms** | **25ms** | 26ms |
| 600 | 19 651ms | 28ms | 24ms |
| 700 | — | 33ms | 28ms |
| 900 | — | 51ms | 36ms |

**About 280× at 560, and there is no wall.** It is roughly linear out to 900, which is past where this
issue reported sixteen-fold. Nothing here was done for this issue; the likely cause is
`issues/lang/0133`, which stopped every closure sizing its own tables and made the whole-graph parse
happen once — that is exactly the per-import-edge work this issue pointed at.

So the thing to do with this issue was to measure it again rather than to profile it, and the section
above headed "the part that needs a profile rather than a guess" is answered: there is nothing left to
profile.

## But the probe found two caps that report as something else

**1. `gather` silently dropped every file past 512, and that is fixed here.** Its own docstring says
*"A file that cannot be read stops the walk and is named: the alternative is compiling a program with a
hole in it and reporting whatever the hole makes the checker say, which points at the wrong file."*
Twelve lines below it, `if (seen || n >= maxFiles()) { continue; }` did precisely that:

    513 files    →  `main.wac: 512 file(s), no diagnostics`   ← a clean bill of health on half of it
    1025 files   →  the same, and then `wac build` failed with "an import of a file that was not
                    supplied", naming neither the limit nor the file

It now returns a `why`: *"a program may be at most 512 files, and f511.wac (imported by main.wac) is
past that"*. `packages/wacc/test/wac/filecap_test.wac` holds it, with a control at 41 files, canaried by
restoring the `continue`: the over-cap test fails with the old sentence.

**2. `emitFiles` answers an 8-byte module at 1024 import edges in one file, silently.** Measured to the
row:

    1020 imports  →  62 663 bytes
    1024 imports  →  **8 bytes** — a bare wasm header, and `diagnoseFiles` says clean

It is the *edges*, not the files: 1024 files with only ten imports in the entry emit 3 665 bytes
happily. `Env` is built with a dozen `string[1024]` tables and one of them is the per-file import list.

Not reachable through the CLI any more — `gather`'s 512 now stops first — so what is exposed is an
**embedder** calling `emitFiles` directly, which is the same set of callers `issues/lang/0157` is about.
Left as `issues/lang/0179a` rather than fixed here, because finding which of those tables it is and what
it should say is its own piece of work.
