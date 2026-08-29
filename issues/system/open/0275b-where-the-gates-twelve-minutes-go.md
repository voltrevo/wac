# 0275b — where the gate's twelve minutes go, measured

- **Status:** open — a map rather than a defect; each row names the issue that owns it
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-29
- **Kind:** performance
- **Symptom:** no error — the gate is what everyone waits for

## Why this exists

Every measurement below was taken because somebody asked why the gate is slow and there was no
answer written down — only per-file guesses and a `— 140s, measured` in a comment that had been
wrong for a fortnight. The point of the page is that the next cut starts from numbers.

## The budget

**Measured by the gate itself, 2026-08-29**, which now prints this on every run that reaches the
push — the three-line lump at the bottom of the old estimate was never measured and turned out to be
24 seconds:

    run 1          run 2
    pull+seed      1s             0s
    suite        469s           394s
    docs          14s            13s
    site           9s             9s
    ratchets     129s           130s
    --------------------------------
    total        622s           546s

So it is **nine to ten minutes, not twelve**, and the suite is about three quarters of it.

**The two runs are not a before-and-after and must not be read as one.** Run 2 is the first with the
suite queue ordered by measured cost, but it also carried 1076s of work against run 1's 1260s — the
machine was quieter. Against each run's own floor: 469/362 = 1.30, then 394/318 = 1.24. Suggestive,
not conclusive, and the way to settle it is two runs adjacent in time rather than two an hour apart. The estimate this page
opened with is kept below for the record:

    suite                452s   (before 0274b; crypto's chunk has since gone 195s -> 25s)
    coverage ratchets    216s
    seed, doc checks, site, push
    ---------------------------
    about twelve minutes

The suite's own accounting, from its footer:

    1283s of work at 4 workers, of which 49s ran alone — the floor is 357s
      195s  packages/crypto/test/wac    (25s since 0274b closed)
      191s  packages/wacc/test/wac
      128s  packages/wac/test/wac

Perfect balance over 1283s would be 321s and the floor is 357s, so **the chunking is close to
optimal and the total work is the thing**. 452s against a 357s floor is about 95s of scheduling
loss, which is the smallest of the numbers here.

*That conclusion did not survive the work being cut — see "the loss moved into the schedule" below.
The 95s was small because one chunk was large enough to hide the tail behind.*

## The suite, chunk by chunk

**crypto was one file.** Timed one at a time: `constanttime_test.wac` **265s**, every other crypto
test 6s or below. That was `wac ctcompare` reading a journal's capacity rather than its contents —
`issues/system/0274b`, and the chunk went 334s → 195s. The 136s left after that was all
`p256PublicKey`, whose journal genuinely fills: 8.4 million host calls at ~1.6µs, and that µs is V8
crossing into wasm rather than anything the host wrapper does. That half is closed too — the module
folds its own journal now — and the file is **8s**, the chunk 25s. 0274b has the anatomy.

**`packages/wac` is one file, and it is `buildcache_test.wac` at 105s.** Timed one at a time, the
package's seventeen files:

    105.7s  buildcache_test.wac        6 tests
     12.2s  app_test.wac
      8.1s  testcli_test.wac
      7.3s  covdump_test.wac
      ...the other thirteen under 5s each

8.6x the next file and more than half the package. The cost is per *test* and uniform — 15.7s, 15.8s,
20.3s for the three measured alone — because each one points `WAC_HOME` at a fresh directory, which
is the whole point (it is testing a build cache, so it must start without one) and also means
`wac run … wacc.wac` recompiles the compiler-as-a-program every time.

**Left alone deliberately.** Its header explains why it runs the checkout's `wacc.wac` rather than
`wac build`: the binary carries a *seed*, so `wac build` would test the compiler the change under
test is not in. Sharing the wacc compile across the six tests while keeping each subject's cache
fresh is possible and is somebody's careful decision to make, not a passing optimisation — and at
~70s of 1076s of suite work it is worth less than it looks, since the suite's floor is set by total
work over four workers rather than by any one file.

**wacc is not one file, and not compile overhead.** Its 81 non-heavy files are 274s warm, and the
top ten are 229s of it. The build cache works well — a wacc test is **1,990ms cold and 118ms warm** —
so "the suite recompiles everything" is not the story it looks like.

Timed one at a time, its 82 non-heavy files rank:

    71.7s  commandparity_test.wac
    27.6s  collide0234_test.wac
    27.0s  latearray0271_test.wac
    24.8s  manyfiles_test.wac
    23.1s  bootstrapemit_test.wac
           ...and a tail of 77 more

One outlier at 2.6x the next and then nothing — so unlike `packages/crypto` and `packages/wac`,
there is no second file to find here.

**Those figures sum to 585s where the suite spends about 234s on the same files**, and the gap is not
a contradiction: a chunk of twelve shares one `wac test` invocation and one aggregate compile, while
timing a file alone pays that per file. It works out at roughly 4s of fixed cost per invocation,
which is the number behind `chunkSize()` being 12 rather than 1 — and worth knowing before anyone
reads a per-file timing as a per-file cost.

Its biggest is `commandparity_test.wac` at **78s**, and that file already explains itself: three
hosts each compile a 219-file program, up from 44 files when the command became one payload
(`issues/system/0257c`). Nearly all of its cost is those compiles, which is `issues/lang/0153` —
two emits and five front ends — from the other side.

## The ratchets, and why they are not skippable

216s on every push that is not documentation-only. The obvious narrowing is to run only the drivers
a change can reach, and the reach is computable. Measured over the last forty commits before
building it:

    11  documentation only — already skipped by tools/docsOnly.wac
    19  touched packages/wacc, the host, tools/ or harness/ — every driver's number can move
     5  confined to packages — a subset would have done

One push in eight, on the gate's safety path, and a push is a *batch* of commits, which makes it
rarer still. The comment beside the predicate in `tools/push.sh` now says this so the measurement is
not spent twice.

## The ratchets, taken apart — and one wrong answer, corrected

**As measured after `issues/system/0274b` closed:** 37 drivers, **633s of work at 4 workers, 216s
wall**, and the floor is one driver:

    137.2s  coverage:platform
     41.9s  coverage:git
     35.0s  coverage:quic
     28.9s  coverage:tls
     24.2s  coverage:crypto
             ...31 more, all under 21s

`coverage:platform` is more than the perfect-balance figure of 158s all by itself, so **the ratchets
cannot go below it however they are scheduled**. Its 85s standalone splits as 159 `deno` spawns at
277ms — 44s — plus the builds those tests do, which is `issues/system/0197` and nothing else.

### The wrong answer, and the instrument that gave it

Before 0274b closed, `coverage:crypto` was 108s. I took it apart and reported that 91s of it was the
exercise's own body, that only 3.4s was external processes, and therefore that the remaining 88s was
**wac computing crypto** with no coverage-shaped win available. All three numbers were right and the
conclusion was wrong: it is **24.2s** now, and nothing about crypto changed.

The instrument is why. I measured the spawns with a `PATH` shim that timestamped `node`, `openssl`
and `deno` — the three external oracles — and `packages/crypto/test/cov_exercise.wac` imports
`constanttime_test.wac`'s tests, which spawn **`wac`**: `wac build --trace` twice and `wac ctcompare`
once per comparison. The subject's own binary was the one child the shim did not watch, so its time
was left in the residue and the residue was labelled "crypto".

The lesson is narrower than "shim everything": **a shim over the tools you thought of measures the
ones you did not as zero**, and a residue is only evidence when the enumeration was complete. Asking
the exercise what it imports would have taken one grep and would have named `ctcompare` immediately.

### What still holds

The duplication does: `cov_exercise.wac` enumerates the same test functions the suite runs, so those
packages' work happens twice per gate. It is still not worth undoing — the exercise is one serial
module and the chunk is many files over four workers — but it is why a fix to a *test's* cost shows up
twice, which is exactly what 0274b did here.

### One thing was schedulable, and it was the dispatch order

`tools/coverageAll.ts` pulled packages off an **alphabetically sorted** list, so the longest driver
started around the halfway mark and every other worker finished waiting for it. A run's best possible
wall is `max(longest driver, work / workers)`; measured back to back on 2026-08-29:

    alphabetical    696s of work, longest 94s  ->  ideal 174s, actual 204s   (17% over)
    longest-first   471s of work, longest 89s  ->  ideal 118s, actual 119s   ( 1% over)

Compare the ratios rather than the walls — the second run had a third less work in it, so 204 against
119 flatters it. What the change bought is the distance from each run's own bound: 30s to 1s. The
order comes from a `.cache/` file of the previous run's times, so it corrects itself and a fresh
checkout behaves exactly as before.

**The suite already does this**, by a weaker proxy: `chunksOf` in `tools/runTests.wac` sorts chunks by
file count, biggest first. Whether the proxy is good enough is worth asking again once the suite has
been re-measured with crypto at 25s — every chunk figure on this page predates that.

**And the phases still cannot overlap.** Running the ratchets beside the suite is the obvious 216s,
but `nproc` is 5 and three agents share them; the suite already runs four workers. There is no idle
core to put them on, and taking one would slow the other two agents rather than this gate.

## What was cut, and what it bought

    total work   1490s -> 1283s -> ?
    floor         415s ->  357s -> ?
    suite         505s ->  452s -> ?
    crypto        334s ->  195s -> 25s

Three changes: `ctcompare` bounded by the journal's cursor; `Cli.call` caching the export it resolves
instead of building a `v8::String` per call; and then `issues/system/0274b`'s second half, where the
module folds its own journal so a comparison is four host calls rather than 8.4 million. The middle
one is 12% off *every* loop that calls into a loaded module, which is why the total fell further than
crypto did the first time.

The last row is the one to read: `constanttime_test.wac` was **265s** when this page was started,
136s after the cursor fix, and is **8s** now. The three unknowns above are the gate's to fill in —
they come from the suite's own footer and only a gate run produces them honestly.

## The loss moved into the schedule, and that is now fixed too

Re-measured after `issues/system/0274b` closed, from the suite's own footer:

    before   1283s of work, floor 357s, wall 452s   ->   95s of loss
    after    1045s of work, floor 299s, wall 450s   ->  151s of loss

**238s came out of the work and 2s came off the wall.** All of it went into idle workers, which is
the answer to a question this page had got wrong: the "95s of scheduling loss" it called *"the
smallest of the numbers here"* was small only because one chunk was big enough to hide behind. Take
the big chunk away and the tail is the whole story.

Both queues ordered by a proxy. `tools/coverageAll.ts` pulled packages off an alphabetically sorted
list; `chunksOf` in `tools/runTests.wac` sorted chunks by file count, which its own comment called
"a weak proxy for cost". A file count cannot see that twelve `packages/wacc` files are 183s and
another twelve are 79s. Both now order by the previous run's measurements — `.cache/coverage-times.json`
and `.cache/suite-times`, both written after failing runs too, both falling back to the old behaviour
when absent.

Measured on the ratchets, back to back, against each run's own bound of
`max(longest driver, work / workers)`:

    alphabetical    696s of work, longest 94s  ->  ideal 174s, actual 204s   (17% over)
    longest-first   471s of work, longest 89s  ->  ideal 118s, actual 119s   ( 1% over)

Compare the ratios rather than the walls: the second run had a third less work in it.

**The ratchets are done: 216s to 129s.** `coverage:all`'s own footer on that run reads *128s (511s
of work at 4 workers)*, and 511/4 is 128 — so the packing is exact and there is nothing further to
win by scheduling them.

**The suite's wall is the number that has not been re-measured since the ordering changed

**What to check next time this page is read.** The suite's wall is the number that has not been
re-measured since the ordering changed — the 450s above is the *old* scheduler on the new workload.
The gate prints its own budget now, so the next green run answers it without anybody arranging a
measurement.

## What is left, in the order the numbers suggest

**Scheduling is done.** Both queues now order by measured cost and both are close to their floors —
the ratchets within 1% and the suite 362s against 319s — and the section below shows there is nothing
in merging them. Every item here is *work reduction*, and each belongs to an issue that already
exists.

1. **`commandparity_test.wac`, 71.7s**, and the compile cost behind it — `issues/lang/0153`. The
   largest single file in the suite, and 2.6x the next in its package. Three hosts each compile a
   219-file program. That issue now also carries a profile of the compiler and, more usefully, the
   retraction of what the profile first appeared to show.
2. **`buildcache_test.wac`, 105.7s**, more than half of `packages/wac`. Per *test*, because each
   points `WAC_HOME` at a fresh directory — which is the point of a build-cache test and also makes
   `wac run` recompile the compiler-as-a-program six times. Sharing that compile while keeping each
   subject's cache fresh is possible and is a decision about what the test proves; see the section
   above for why it was left.
3. **Process starts** — `issues/system/0197`, and **already being worked**, so read it before
   starting anything here. `harness/buildApp.ts` is the replacement builder, going through `wac app`
   at ~20ms against ~107ms, and `design/system/0009` is why `packages/platform/build.ts` is losing
   its `deno` and `node` targets. Two of that issue's three shapes are answered and can be skipped:
   the shebang's cache flags are not the money (107ms → 90ms) and both have a written reason — a
   code cache that reached 28 GB and a transpile cache that reached 23 GB, neither of which evicts.
   The live one is the artefact's size, since start cost is ~50ms fixed plus ~43ms a megabyte.
4. **Crypto's own speed**, now a smaller number than it looked: the suite chunk is 25s and the
   ratchet driver 24s. `issues/system/0209` is one piece of it.

The ratchets are not a separate item. They are 133s against a floor of 131s, `coverage:platform` is
the largest driver, and that is item 3. Skipping them entirely was measured and refused separately.

## One queue instead of two saves nothing, and the arithmetic says so — withdrawn

**This section proposed merging the suite's queue and the ratchets' and costed it at 110 seconds. It
is worth zero and the mistake is instructive.**

Both phases are pools of independent jobs at four workers, run one after the other. Write `W` for the
suite's work, `A` for the part that must run alone, `C` for the ratchets':

    serial     (W - A)/4 + A     +     C/4
    merged     (W - A + C)/4 + A

Expand the first and it *is* the second. Two queues that each already pack to their own floor add
their floors, and one queue over the union has the same floor — there is nothing in the algebra for a
merge to recover. With today's numbers both come to **450s**.

**Where the 110s came from.** I compared the merged *floor* against the two measured *walls*, and a
wall is a floor plus whatever the packing wastes. So what I costed was not the merge at all: it was
the packing slack, which is real but belongs to whichever queue has it and is recoverable without
merging anything. `tools/coverageAll.ts` and `chunksOf` are exactly that work, and it is already
done — the ratchets are within 1% of their floor, and the suite is 362s against 319s.

**What a merge could still buy is that remaining 43s of suite slack**, and only some of it: a single
queue has more small jobs to fill the gaps a long chunk leaves at the end. That is a much smaller
prize than this section claimed, against a change to the gate's core, and it shrinks every time the
suite's own ordering improves. Not recommended.

The measurement that would settle it is cheap and nobody needs to write the merge for it: the suite's
footer already prints work, alone and floor, and `coverage:all` prints work and wall. Watch the gap
between the suite's wall and its floor over a few green runs. If it stays near 40s the merge is worth
at most that; if it collapses, there is nothing there at all.

## Two traps, because both cost me a measurement

**A plain `wac test <dir>` does not skip the heavy lane.** Two attempts at timing `packages/wacc`
spent their whole budget inside `corpusemit_test.wac`, which is declared at 1,204s. `--ignore` takes
a comma-separated list of paths rather than acting as a switch, so it is
`--ignore packages/wacc/test/wac/corpusemit_test.wac,packages/wacc/test/wac/names_test.wac`; passed
bare it swallows the directory that follows it and the run does nothing, quickly.

**Cold and warm differ by 2×**, and a run taken seconds after a gate is neither: the gate rewrites
`native/v8/target/release/wac`, so a measurement started against it can be timing a binary that is
being replaced. Three of my first readings were of tests that never ran, and all three were fast.
Check for the test's own `N passed` line, not for a timing.

**Dropping a grant drops the work, so a subtraction across grants measures nothing.** `wac covdump`
on the built exercise took 3s and looked like proof that the sweeps were cheap; it was the same
mistake wearing a different hat, because covdump takes no grants and every test that shells out
failed in microseconds. The exercise's honest figure is 91s, and running it with `--allow-run`
removed gives 5s *and* `60 test(s) failed`. Read the failure count before believing a difference.

## The largest thing left is that the gate runs two queues instead of one

Both phases are a pool of independent jobs run at four workers, and they run **one after the other**:

    suite      1260s of work, 62s of it alone   ->  floor 362s, wall 469s
    ratchets    511s of work                    ->  floor 128s, wall 129s
                                                    ------------------------
                                                    598s of the gate's 622s

Neither can go much below its own floor now — the ratchets are packed exactly, and the suite's floor
is `work/4 + alone`, which is a *work* number and not a scheduling one. But the two floors are added
together only because the phases are sequential, and nothing makes them so: a coverage ratchet is an
independent check, not something that reads the suite's result.

One queue over both:

    (1260 + 511 - 62) / 4 + 62  =  489s

against 598s, so **about 110 seconds, or 18% of the gate** — larger than anything else left on this
page, and it needs no test to get faster.

**What it costs.** `tools/runTests.wac` owns the queue and `tools/coverageAll.ts` owns the drivers;
merging means the ratchets become queue items with a `Chunk`-shaped label and their failures reported
the way a lane's are. The ordering file already generalises — a driver is just another key. The real
question is whether an instrumented build competing with four test chunks makes both slower than the
arithmetic says, which is a measurement rather than an argument.

**The objection that is not CPU.** Memory is what this container runs out of — `issues/system/0266c`
is thirty-five refusals in a day from the suite gate's memory floor, and push.sh counts OOM kills
around every run. But the arithmetic above is *one* queue at four workers, not two queues at four
each, so the peak is what it already is: four jobs. A version that ran `coverage:all` beside the
suite instead of merging the queues would be 4+4 and is the one to refuse.

**And a reason it might be refused.** Failures currently arrive in phases, so "the suite passed and
the ratchets are red" is two sentences a reader can act on separately. One queue makes that one
sentence with two kinds of failure in it, and the gate's output is the thing everyone reads when
something is wrong.

## `pull+seed` was two things, and one of them is not the gate's — agent-c, 2026-08-29

The `1s / 0s` above is real but it is the lucky case. `$SECONDS` runs from the top of `push.sh` and
`tPre` was read *after* the lock, so that row also counted every minute spent waiting behind another
agent's `--queue`. Both runs above happened to take the lock immediately and to have a fresh seed,
which is exactly when the conflation is invisible.

A run that did neither:

    lock wait    360s      22 `waiting for the gate: agent-b started one Nm ago` lines, 4m to 10m
    pull+seed     14s
    suite        409s
    docs          14s
    site          10s
    ratchets     132s
    total        939s

Reported as one row that is `pull+seed 374s` — the largest line in the budget and larger than the
suite. I read it as the seed rebuild and started looking there before checking the log.

`push.sh` now prints `lock wait` as its own row above `pull+seed`, so the rows below it can be read
as work. It is the one line here that no change to the suite, the docs or the ratchets can move.

### Two floors worth adding to the map

- **The ratchet lane is work-bound, not long-pole-bound, and is already packed.** 37 tasks, 520s of
  work, 4 workers, **131s** wall against a 520/4 = 130s floor. So scheduling has nothing left to
  give, and — the part worth stating because it is the tempting move — **splitting `coverage:tor`
  buys nothing**, even though at 103.8s it is a fifth of the lane on its own. It is *below* the
  130s floor, so the workers are saturated either way. Only making that task cheaper moves this row.
- **The suite's floor was 331s against 409s wall** on the run above, with the longest single chunks
  175s (`packages/wacc/test/wac`, 12 files) and 143s (`packages/wac/test/wac`, 9 files).
