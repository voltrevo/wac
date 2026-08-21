# 0235a — corpus-wide compilation stepped about +13.5s on 2026-08-20, and one shared stage did it

- **Status:** open
- **Claimed by:** agent-a, 2026-08-21
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** performance
- **Symptom:** no error — every push pays it, and nothing failed

## Filed, withdrawn, reinstated. The withdrawal was the mistake.

**The regression is real.** I withdrew it on a measurement that was a failed run, and the failure was
mine: this shell is zsh, which does not word-split an unquoted `$G`, so a helper of the form

    G="--allow-read --allow-write --allow-run --allow-env --allow-net"
    wac test $G $FILE

passed all five grants as **one argument**. Every run through it exited 2 in about four seconds with
`unknown flag '--allow-read --allow-write ...'` — and I never captured the exit status, so I read 4.1s as
"describewac_test alone is cheap" and built a withdrawal on it. Measured with the arguments passed as a
list:

    describewac_test.wac alone                     17.7s   exit 0, 1 passed
    describewac_test.wac beside cases_test.wac     14.4s   (cases_test 1.6s)

**No alone-versus-grouped discrepancy exists.** The file costs about 15-18s either way, and the gate has
been reporting ~15s all day. Against 1.6s before 08-20 17:53. So the step stands.

The withdrawal's other pillar was that per-file figures include a chunk's shared build. That is *also*
wrong as stated: `native/v8/src/main.rs` computes `built[group_of[i]]` **before** the timed loop, so a
group's build is outside the per-file measurement. The 14.4s is run time.

**One thing the episode did establish**: the refusal that caught it is the one added for
`issues/system/0198` earlier the same day. Before that, an unknown flag was accepted silently — and a
silently-accepted bad flag is exactly how four failed runs read as four fast ones.

## What the shape of the step says

    describewac_test    1.6s → 15.3s     +13.7s
    corpuscheck_test   17.4s → 30.9s     +13.5s

**Equal absolute gains on very different baselines**, which is not what "the compiler got N× slower"
looks like — that would scale each. It is what a *shared stage* costing +13.5s more looks like, paid once
per whole-corpus pass. `describewac_test` makes one `describeFiles` pass and `corpuscheck_test` one
`diagnoseGraph` pass, and both cross the same front end: read the corpus, resolve every import, link.

I read those two numbers as two multipliers when I first filed this, and then as evidence of a shared
*build* when I withdrew it. They are evidence of a shared *stage*, which is a third thing and the one the
arithmetic actually supports.

## Ruled out, by measurement rather than by reading

- **The two `setType` calls `0174a` added** (08-20 18:54) — an unconditional `findName` per variable
  declaration, and the best-fitting mechanism I had. With the arguments passed properly:
  **17704ms with them, 17515ms without.** Not the cause.
- **`declinedExport` widening to every function** (08-20 18:38). Its expensive `canEmit` re-run needs
  `!funcOk[at] || funcIndex[at] < 0` and its own census found 0 of 1797, so the widened loop is a walk.
- **`api.wac`'s `indexOfPath` inside the import-edge loop** is a genuine O(files² × imports) — worth
  fixing on its own — but `git log -S` dates it 08-21 01:26, seven hours after the window.

## What is left, and it is one commit

Only two commits touched `packages/wacc/src` inside 17:53–19:37, and one of them is measured out above.
The window's boundary also brushes `cb6b29d2` at 17:47 — *"0161 closed: two spellings of one import are
one type"* — which is a change to **import identity**, i.e. to the shared front end the arithmetic points
at. A gate run takes about five minutes, so a log written at 17:53 may not contain a commit made at
17:47: it is inside the window in the sense that matters.

The experiment is the same one that cleared `setType`, and it needs no seed rebuild — the corpus tests
import `api.wac` from the working tree, so the current seed compiles whatever source is on disk:

    revert the candidate's change to packages/wacc/src, run
    wac test --allow-read --allow-write --allow-run --allow-env --allow-net \
      packages/wacc/test/wac/describewac_test.wac

15s says it is not the cause; 1.6s says it is. **Pass the flags as separate arguments.**

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


## Four mechanisms proposed, three measured out, and I am stopping — agent-a, 2026-08-21

Recorded so the next person does not spend the afternoon I did.

| mechanism | how it died |
|---|---|
| `declinedExport` widened to every function (0170a) | read: the expensive branch needs `!funcOk`, census found 0 of 1797 |
| the two `setType` calls (0174a) | measured: **17704ms** with, **17515ms** without |
| `0161`'s alias table, scanned by `canon` in five hot paths | measured: **17992ms** with `addLocalAlias`, **17687ms** without |
| the corpus growing in the window | 7 files added, 30 KB total, 0.24% of 12.4 MB |
| the test itself changing | byte-identical since 08-19 |

`0161` is also outside the window once the boundary is read properly: a log's mtime is when the run
*finished*, and a gate run takes about five minutes, so the 17:53 log reflects a tree from about 17:48 and
a 17:47 commit is on the good side.

**That leaves nothing in the window.** Only two commits touched `packages/wacc/src` between 17:48 and
19:32, and both are measured or read out above. So either the cause is not a source change — the runner,
the grouping, the engine — or my window is wrong in a way I have not found.

One measurement worth having before anybody resumes: `wac test packages/wacc/test/wac` as a **single
unit** ran past **20 minutes** with no output and was killed, where the gate covers the same directory in
about 150s of wall across four workers and six shards. So the whole-directory aggregate is dramatically
worse than the sharded arrangement, which is the opposite of what "sharding costs more builds" predicts
and is the thread I would pull next. The runner's two paths are the place to look: `native/v8/src/main.rs`
runs a file either from a pre-built aggregate (`Some(..) if carried.contains(&i)`) or by building inside
the timed call (`None => build_and_call`), and only the second puts a build inside a per-file figure.

### The method note, which is the transferable part

Every wrong turn here had the same shape: **I reasoned from code structure to a cost, when measuring the
cost was minutes of work.** `findName` looked quadratic and was not; `canon` looked hot and was not;
`indexOfPath` genuinely is quadratic and is irrelevant to this. The one thing that was cheap throughout —
edit, run one file, read the number — is what settled every question, and needed no seed rebuild because
the corpus tests import `api.wac` from the working tree.

And the measurement that misled me worst was the one I did not check the exit status of. Four runs at
"4.1s" were four failures at exit 2. **Capture the status, and pass the grants as separate arguments** —
this shell does not split an unquoted `$G`.
