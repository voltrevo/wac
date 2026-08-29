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
2. **The ratchets' 263s** — not by skipping. Nobody has asked whether the *drivers* are slow for the
   reason the tests were: `coverage:crypto` is 108s and `coverage:platform` 82s, and neither has been
   taken apart the way the suite's chunks have.
3. **`commandparity`'s 78s and the compile cost behind it** — `issues/lang/0153`.
4. **Process starts** — `issues/system/0197`. A built app costs ~107ms to spawn against 15ms for the
   native binary, and `packages/box` spawns 1,701 of them.

## Two traps, because both cost me a measurement

**A plain `wac test <dir>` does not skip the heavy lane.** Two attempts at timing `packages/wacc`
spent their whole budget inside `corpusemit_test.wac`, which is declared at 1,204s. Pass `--ignore`.

**Cold and warm differ by 2×**, and a run taken seconds after a gate is neither: the gate rewrites
`native/v8/target/release/wac`, so a measurement started against it can be timing a binary that is
being replaced. Three of my first readings were of tests that never ran, and all three were fast.
Check for the test's own `N passed` line, not for a timing.
