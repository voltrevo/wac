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

    suite                452s
    coverage ratchets   ~263s
    seed, doc checks, site, push
    ---------------------------
    about twelve minutes

The suite's own accounting, from its footer:

    1283s of work at 4 workers, of which 49s ran alone — the floor is 357s
      195s  packages/crypto/test/wac
      191s  packages/wacc/test/wac
      128s  packages/wac/test/wac

Perfect balance over 1283s would be 321s and the floor is 357s, so **the chunking is close to
optimal and the total work is the thing**. 452s against a 357s floor is about 95s of scheduling
loss, which is the smallest of the numbers here.

## The suite, chunk by chunk

**crypto was one file.** Timed one at a time: `constanttime_test.wac` **265s**, every other crypto
test 6s or below. That was `wac ctcompare` reading a journal's capacity rather than its contents —
`issues/system/0274b`, fixed, and the chunk went 334s → 195s. What remains of it is 136s, all of it
`p256PublicKey`, whose journal genuinely fills: 8.4 million host calls at ~1.6µs, and that µs is V8
crossing into wasm rather than anything the host wrapper does. 0274b has the anatomy and two ways
out, one of which needs no host API.

**wacc is not one file, and not compile overhead.** Its 81 non-heavy files are 274s warm, and the
top ten are 229s of it. The build cache works well — a wacc test is **1,990ms cold and 118ms warm** —
so "the suite recompiles everything" is not the story it looks like.

Its biggest is `commandparity_test.wac` at **78s**, and that file already explains itself: three
hosts each compile a 219-file program, up from 44 files when the command became one payload
(`issues/system/0257c`). Nearly all of its cost is those compiles, which is `issues/lang/0153` —
two emits and five front ends — from the other side.

## The ratchets, and why they are not skippable

263s on every push that is not documentation-only. The obvious narrowing is to run only the drivers
a change can reach, and the reach is computable. Measured over the last forty commits before
building it:

    11  documentation only — already skipped by tools/docsOnly.wac
    19  touched packages/wacc, the host, tools/ or harness/ — every driver's number can move
     5  confined to packages — a subset would have done

One push in eight, on the gate's safety path, and a push is a *batch* of commits, which makes it
rarer still. The comment beside the predicate in `tools/push.sh` now says this so the measurement is
not spent twice.

## The ratchets, taken apart

`coverage:crypto` is 100s standalone, and almost none of it is coverage:

    build the instrumented exercise      9s
    run it, and the two sweeps           1s   (145 trap cases + 35 probes)
    read counters, report, ratchet      <1s
    the exercise's own body             91s

So the ledger machinery is a tenth of it and **the driver is the package's tests, run a second
time**. `packages/crypto/test/cov_exercise.wac` enumerates the same 152 test functions the suite
runs, so crypto's expensive work happens twice per gate — 195s in the suite chunk, 91s again here.

What the 91s is *not*: external oracles. Under a shim that timed every child, the whole exercise
spawned **51 node, 5 deno and 1 openssl, for 3.4s in total**. The other 88s is wac computing crypto,
spread over the algorithms rather than pooled in one file the way `constanttime_test.wac` was — it is
about what the suite's per-file timings add up to, once the per-file process and compile overhead the
chunk pays is taken off. `issues/system/0209` is the nearest thing filed, though it is about one
ratio rather than about the total.

`coverage:platform` is 85s and splits differently: **159 `deno` spawns at 277ms each, 44s**, which is
`issues/system/0197` — a built app costs ~107ms to start and these also run one. The rest is the
builds those tests do.

**So there is no coverage-shaped win here.** The three costs are the three already filed, and the
only lever specific to the ratchets is the duplication above, which is not a small change: the
exercise is one serial module and the suite's crypto chunk is many files over four workers, so
running the exercise *as* the chunk would trade 90s of total work for a worse floor.

**And the phases cannot overlap.** Running the ratchets beside the suite is the obvious 263s, but
`nproc` is 5 and three agents share them; the suite already runs four workers. There is no idle
core to put them on, and taking one would slow the other two agents rather than this gate.

## What was cut, and what it bought

    total work   1490s -> 1283s
    floor         415s ->  357s
    suite         505s ->  452s
    crypto        334s ->  195s

Two changes: `ctcompare` bounded by the journal's cursor, and `Cli.call` caching the export it
resolves instead of building a `v8::String` per call. The second is 12% off *every* loop that calls
into a loaded module, which is why the total fell further than crypto did.

## What is left, in the order the numbers suggest

1. **`p256`'s 136s** — `issues/system/0274b`. Needs fewer host calls, not cheaper ones.
2. **`commandparity`'s 78s and the compile cost behind it** — `issues/lang/0153`.
3. **Process starts** — `issues/system/0197`. A built app costs ~107ms to spawn against 15ms for the
   native binary; `packages/box` spawns 1,701 of them and `coverage:platform` 159, for 44s.
4. **Crypto's own speed.** 195s of the suite and 88s of the ratchets, with no single file to blame
   now that `constanttime_test.wac` is fixed. `issues/system/0209` is one piece of it.

The ratchets' 263s is *not* on this list any more: the section above measures it, and every second of
it belongs to 2, 3 or 4. Skipping them was measured and refused separately.

## Two traps, because both cost me a measurement

**A plain `wac test <dir>` does not skip the heavy lane.** Two attempts at timing `packages/wacc`
spent their whole budget inside `corpusemit_test.wac`, which is declared at 1,204s. Pass `--ignore`.

**Cold and warm differ by 2×**, and a run taken seconds after a gate is neither: the gate rewrites
`native/v8/target/release/wac`, so a measurement started against it can be timing a binary that is
being replaced. Three of my first readings were of tests that never ran, and all three were fast.
Check for the test's own `N passed` line, not for a timing.

**Dropping a grant drops the work, so a subtraction across grants measures nothing.** `wac covdump`
on the built exercise took 3s and looked like proof that the sweeps were cheap; it was the same
mistake wearing a different hat, because covdump takes no grants and every test that shells out
failed in microseconds. The exercise's honest figure is 91s, and running it with `--allow-run`
removed gives 5s *and* `60 test(s) failed`. Read the failure count before believing a difference.
