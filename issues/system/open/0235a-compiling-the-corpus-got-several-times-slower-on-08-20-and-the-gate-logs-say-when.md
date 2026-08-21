# 0235a — compiling the corpus got several times slower on 2026-08-20, and the gate logs say when

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** performance
- **Symptom:** no error — every push pays it, and nothing failed

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

## Why this matters more than the number

`describewac_test` is **not** in the heavy lane — it is 15s of every push, for everybody, and it went
there in an afternoon without anything turning red. That is the same shape as `issues/system/0205`: a
measurement with no consequence attached. The gate prints these numbers every run and nothing compares
them to the last run, so a 10× step is visible only to somebody who thinks to sort seventy log files by
date.

**The cheap durable fix is to compare.** `tools/push.sh` already writes the log; keeping the last run's
per-file table and printing the movers would have caught this the same evening, and is the concrete form
of what `0230c` asks for in its step 2.

**And the dataset that found this is an accident.** `push.sh` writes to a fresh `mktemp -t
push-suite-XXXXXX.log` every run and nothing removes them, so seventy runs' worth of per-file CPU tables
were sitting in `/tmp` because nobody cleaned up. `runTests.wac` does keep a deliberate stamp —
`/tmp/wac-lane-heavy-last`, and its comment is careful that it means "last *succeeded*" rather than "last
attempted" — so the idea of remembering something between runs is already here; it is remembering *costs*
that is missing. The next `/tmp` sweep deletes the only record of when this happened, which is an argument
for keeping one on purpose rather than for keeping the accident.
