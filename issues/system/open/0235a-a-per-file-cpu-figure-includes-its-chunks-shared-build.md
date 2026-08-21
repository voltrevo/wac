# 0235a — a per-file CPU figure in the wac lane includes its chunk's shared build

- **Status:** open
- **Claimed by:** agent-a, 2026-08-21
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** wrong answer — in an instrument, and it made me file a regression that is not there

## Corrected, an hour after filing. Read this first.

**I filed this as "compiling the corpus got several times slower on 08-20, and the gate logs say when".
That was wrong, and the way it was wrong is the useful part.**

`wac test` reports a per-file CPU table. A directory's files **share one build** since 2026-08-18
(`issues/system/0192`), the lane splits a large directory into chunks, and the chunk's build is charged
to **one file** — whichever the runner reports first. Measured directly:

    describewac_test.wac alone                     4.1s
    describewac_test.wac beside cases_test.wac    14.6s   (cases_test: 1.5s)

Same file, same machine, minutes apart. The 10.5s difference is the other file's build, charged to the
first one. So a per-file figure is **not that file's cost**, and two runs are comparable only if chunk
membership did not change between them.

That destroys the timeline I built. `describewac_test` going 1.6s → 15.3s on 08-20 is that file becoming
the first of its chunk — files were added to `packages/wacc/test/wac/` that evening — and its own cost
never moved: 1.6s then, about 1.6s of the 4.1s now. `corpuscheck_test` rose by **+13.5s** and
`describewac_test` by **+13.7s**, which I noticed and read as two multipliers when an additive constant
appearing twice is the signature of exactly this. `bindgenwac_test` bounces between 5.9s and 19.2s
run-to-run — ±13.3s — which is the same constant arriving and leaving, and I called it "bimodal" and
moved on.

**And the fix I recommended was built on the same mistake.** "Keep the last run's per-file table and print
the movers" would compare numbers that move when chunking moves. Any such check has to compare a
*directory or chunk total*, or run one file at a time.

## What survives

- **`packages/wacc/test/wac/names_test.wac` really is far over its declaration.** Declared `84s`,
  byte-identical since 08-19, run **alone** — so no chunk to share with — it did not finish within 900s
  of CPU on an idle box at 102% of one core. The bound fired, so 900s is a floor. That measurement has no
  attribution problem in it, and it is the one `issues/system/0230c` should be sized from.
- **Corpus growth still does not explain that.** Over what `loadCorpus` walks — every `.wac` under
  `packages/` and `tools/`, verified as what these tests take — it is 371 files at 08-04, 923 at 08-18
  when the declarations were written, 1003 now: +8.7% in files, +13% in bytes, +7.9% in `emit.wac` plus
  `check.wac`.
- **`api.wac`'s `indexOfPath` is a genuine O(files² × imports)** — a linear scan of `paths` per import of
  every file, with `resolveVia` inside it, so roughly 10⁷ string comparisons at 1000 files. `git log -S`
  dates it 08-21 01:26. A path-to-index map makes it linear. Worth fixing on its own merits; it is not
  tied to any step, because there is no established step.

## Two hypotheses tested and refuted, so nobody repeats them

- **`declinedExport` widening to every function** (08-20 18:38). Cleared by reading: the expensive
  `canEmit` re-run needs `!funcOk[at] || funcIndex[at] < 0`, and its own census found 0 of 1797. The
  commit's claim was right; the evidence it cited was about false alarms rather than cost.
- **The two `setType` calls `0174a` added** (08-20 18:54) — an unconditional `findName` per variable
  declaration, which was my best mechanism and fitted the window. **Measured and refuted:**
  `describewac_test` is 4098ms with them and 4082ms without. No seed rebuild was needed to find that out,
  because the corpus tests import `api.wac` from the working tree, so the current seed compiles whichever
  source is on disk — which is worth knowing for the next performance question here.

## What to do about the instrument

The runner already knows the difference between a file's own time and its chunk's build: the table prints
`Ns cpu ( Xs here, Ys in children)`, and the build is not in either column's favour — it lands in the
first file's `here`. Options, cheapest first:

1. **Report the chunk build as its own row** rather than charging it to a file. The number a reader wants
   from the table is "which test is expensive", and today the answer is "whichever one was built first".
2. **Print a directory or chunk total** beside the per-file rows, which is the only figure comparable
   across runs. The 08-21 logs have `done in Ns: packages/wacc/test/wac` per shard; older logs do not,
   which is why the step could not be checked against a total.
3. **Say in the table that the first row carries the build**, if neither of the above is worth the code.
   A caveat in the output is cheaper than a reader deriving a regression from it, which is what happened
   here.

## The original filing, kept because the argument in it is where the mistake lives

## The step, localised to 104 minutes

Every `push.sh` run leaves a log with a per-file CPU table in it, and there are seventy of them on this
box going back to 2026-08-12. Read in date order they are a longitudinal performance record that nobody
had read. Two corpus-sized tests step in **the same window** — last good 08-20 17:53, first bad 08-20
19:37:

    packages/wacc/test/wac/describewac_test.wac
      08-20 16:46  1.6s      08-20 19:37  15.3s
      08-20 16:52  1.5s      08-20 20:16  15.4s
      08-20 16:58  1.8s      08-20 21:14  15.8s
      08-20 17:07  1.7s      08-20 21:38  15.8s
      08-20 17:53  1.6s      08-20 22:34  16.1s
                             …flat at 15-17s ever since

    packages/wacc/test/wac/corpuscheck_test.wac
      …16-19s from 08-19 17:24 through 08-20 17:53
      …24-34s from 08-20 19:37 to now

**9.6× and 1.8×**, both CPU rather than wall, both a step rather than a drift, both in one 104-minute
window. One cause, almost certainly in the compiler: `describeFiles` and `diagnoseGraph` are what these
two call, and nothing else about either test changed.

## It is not the corpus growing

`issues/system/0230c` reads the same symptom from the heavy lane and names corpus growth as the likely
cause. Counted out of git, over the files `loadCorpus` walks — every `.wac` under `packages/` and
`tools/`, which is what all these tests take:

    2026-08-04    371 files    3.11 MB
    2026-08-18    923 files   11.01 MB     ← when the heavy declarations were written
    2026-08-21   1003 files   12.44 MB

**+8.7% in files and +13% in bytes** since the numbers were set, and `emit.wac` plus `check.wac` grew
+7.9% in the same period. None of those is 9.6×.

## What the heavy lane looks like from here

`packages/wacc/test/wac/names_test.wac` declares `84s`, was written with the file on 08-18 and is
byte-identical since 08-19. Run alone on an idle box — load 1.11, nothing else of mine on it, the process
at 102% of one core throughout, so wall is CPU — it **did not finish within 900 seconds**. The run was
killed by its own bound, so 900s is a floor and not a duration: `timeout` exited 124 and the test never
printed. **≥10.7×**, on a corpus 8.7% larger, for a file that has not changed.

Stated that way on purpose. `0230c`'s 1,166s has the same shape — a run that was stopped rather than one
that completed — and the difference between the two figures is not a measurement, it is two different
bounds. What both establish is a floor; neither is the cost.

So `0230c`'s 8× is real and is not a wall-versus-CPU artefact, which was the alternative I went looking
for. Its declarations are stale because *this* happened, not because the repository grew.

## Two suspects read and cleared, so the next person does not re-read them

- **`declinedExport` widening to every function** — 08-20 18:38, in the window, and its commit message
  says *"the census says that is free"* where the census it cites counted false alarms rather than cost.
  Cleared by reading: the expensive `canEmit` re-run happens only when `!funcOk[at] || funcIndex[at] < 0`,
  and the census found **0 of 1797** such functions, so the widened loop is a walk over declarations. The
  claim was right; its stated evidence was about the wrong quantity.
- **`indexOfPath` inside the import-edge loop** — `api.wac:627` and `:637` call a linear scan of `paths`
  once per import of every file, which is O(files² × imports): about 10⁷ string comparisons at 1000
  files, and `resolveVia` runs inside it. This is a real cost and worth fixing on its own — a map from
  path to index would make it linear — but it is **not this step**: `git log -S` puts it at 08-21 01:26,
  seven hours after the window.

## What is left, which is a bisect

The commits between 17:53 and 19:37 are mostly agent-b's coverage floors, which cannot touch this. The
ones that can are agent-a's: `0170a`'s export parity (cleared above), `0174a` at 18:54 — *"declare in
both walks, so a shadowed name has a type on each side of its declaration"*, which is the one whose
title suggests doubling a walk — and `0157` at 19:31.

Attributing it means building a seed at each of those commits, which is `deno task seed:bootstrap` per
step and is why this is filed rather than finished. **The measurement to reproduce is cheap**, though,
and does not need the heavy lane:

    wac test --allow-read --allow-write --allow-run --allow-env --allow-net \
      packages/wacc/test/wac/describewac_test.wac

1.6s before, 15s after, and the runner prints its own CPU.

