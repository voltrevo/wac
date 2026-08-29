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

## The suite, chunk by chunk

**crypto was one file.** Timed one at a time: `constanttime_test.wac` **265s**, every other crypto
test 6s or below. That was `wac ctcompare` reading a journal's capacity rather than its contents —
`issues/system/0274b`, and the chunk went 334s → 195s. The 136s left after that was all
`p256PublicKey`, whose journal genuinely fills: 8.4 million host calls at ~1.6µs, and that µs is V8
crossing into wasm rather than anything the host wrapper does. That half is closed too — the module
folds its own journal now — and the file is **8s**, the chunk 25s. 0274b has the anatomy.

**wacc is not one file, and not compile overhead.** Its 81 non-heavy files are 274s warm, and the
top ten are 229s of it. The build cache works well — a wacc test is **1,990ms cold and 118ms warm** —
so "the suite recompiles everything" is not the story it looks like.

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

## What is left, in the order the numbers suggest

1. **`commandparity`'s 78s and the compile cost behind it** — `issues/lang/0153`.
2. **Process starts** — `issues/system/0197`, and **already being worked**, so read that before
   starting anything here. A built app costs ~107ms to spawn against 15ms for the native binary;
   `packages/box` spawns 1,701 of them and `coverage:platform` 159, for 44s. `harness/buildApp.ts`
   is the replacement builder, going through `wac app` at ~20ms, and `design/system/0009` is why
   `packages/platform/build.ts` is losing its `deno` and `node` targets altogether.

   Two of that issue's three "shapes worth measuring" are answered and can be skipped: the cache
   flags in the shebang are *not* the money (107ms → 90ms) and both have a written reason — a
   `v8_code_cache_v2` that reached 28 GB and a transpile cache that reached 23 GB, neither of which
   evicts. The live one is the third, the artefact's size, since start cost is ~50ms fixed plus
   ~43ms a megabyte.
3. **Crypto's own speed**, which is now a smaller number than it looked: the chunk is 25s and the
   ratchet driver 24s. `issues/system/0209` is one piece of it.

The ratchets' 216s is *not* a separate item: `coverage:platform` is 137s of it and that is 2, and no
schedule can beat one driver. Skipping them was measured and refused separately.

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
