# 0214 — two build pipelines differ by 18 bytes, and nobody has decided whether they should

- **Status:** closed
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** wrong answer

## Closed — the difference does not reproduce, 2026-08-19

`packages/platform/native.ts` and `wac build` emit **byte-identical** artefacts, module and manifest
both, on `packages/platform/example/wc.wac` (233,661 bytes) and on `packages/wac/example/wac.wac`
(960,311). So there is no decision to take: the question this issue existed to ask has no subject.

**Why the old number was not a pipeline difference.** `tools/seed.sh` already recorded that the output
*name* is embedded in the module, so a comparison across two names always fails. The grants are in
there too, and that is what this measurement missed: building `wc.wac` with two grants and with four,
through one compiler, gives files two bytes apart. Hold the name and the grants equal and the two
pipelines agree. The 18 was that, or a drift since fixed — the two-derivation test existed because
these two derivations have parted before, once over a trailing comma on the `net` line, and it is what
keeps them together.

The first version of my own check reproduced a "difference" of six bytes and I nearly reported it. It
was two different `-o` stems.

## The test this was filed about is gone — 2026-08-19

This began as *"an opt-in test has been red, and four of its seven cases are wrong"*, about
the `nativeBinary` test. The four defects were fixed the day it was filed, and the
file has since been **deleted** — the operator's call, and the right one. Its cases held the native
runner up against the Deno harness, or re-asserted a fixpoint that `tools/seed.sh` already refuses a
seed for. Deno-driven testing is being removed, not kept on as the oracle that validates what replaces
it. `wac sh` was the one thing it covered that nothing else did, and that moved to
`tools/wac/sh_test.wac`, against the binary we already have rather than a freshly built one.

**What survives is section 1**, which was never about the test: the two build pipelines differ and
nobody has decided whether that is a bug. That is the issue now, and the title says so.

The lesson the original title carried is worth keeping in a sentence: a test that must be asked for
is a test that reports on nothing, and four wrong cases sat in that one for long enough that nobody
could say how long.

## What happens

```
$ WAC_V8_SEED=1 deno test -A packages/wacc/test/nativeBinary.test.ts
FAILED | 4 passed | 3 failed (2m7s)
```

Nothing has noticed, because the file is opt-in behind `WAC_V8_SEED=1` and the gate never sets it. It
is not one failure with two knock-ons — they are unrelated, three are defects in the test rather
than in what it measures, and a fourth appears only once the first three are fixed.

## 1. It compares two pipelines that are known to differ

```
Error: assertEquals failed — the binary's own payload came out a different size
  got:  847296
  want: 847278
```

The assertion reads `wac build`'s output against the artefact `buildNative` wrote, and its comment
says why: *"the payload above was written by `app:native`, so a byte-identical answer says the
TypeScript bundler is no longer in the loop."*

`tools/seed.sh` already knows this cannot hold, and says so in its header:

> **The Deno path and the binary path are different pipelines.** `packages/platform/native.ts` and
> `wac build` do not emit byte-identical artefacts from identical sources — **18 bytes apart when I
> measured it** — so comparing one against the other measures the two toolchains rather than the
> compiler's fixpoint.

847296 − 847278 = **18**. The same difference, still there, met from the other direction by a test
that did not have the note.

**This one needs a decision rather than a patch.** Either the two pipelines *should* agree and the 18
bytes are a defect worth chasing, or they should not and the test should make the comparison
`seed.sh` makes — binary against binary, which is the fixpoint claim and is the one that means
"the bundler is out of the loop" anyway. Nothing here says which, and the 18 bytes have never been
attributed to anything.

## 2. It expects an exit code that changed

```ts
const bad = await run(wac, ["test", "packages/wactest/test/wac/fixture_failing.wac"]);
assertEquals(bad.code, 1, "the deliberately failing fixture passed");
```

`wac test` exits **3** for a file that ran and failed; 1 means it did not compile. Measured:

```
$ wac test packages/wactest/test/wac/fixture_failing.wac ; echo $?
3
$ wac test packages/bytes/test/wac/buf_test.wac ; echo $?
0
```

So the canary fires on every run, and **its message says the opposite of what happened** — "the
deliberately failing fixture passed" when the fixture failed exactly as designed. A canary that
cries wolf in the wrong words is worse than none: it trains a reader to disbelieve it.

## 3. It re-implements the runner, and the copy is missing a rule

```
Error: packages/bytes/test/wac/bounds_test.wac: native 16/0, Deno 4/12
```

Read as a disagreement between the two test runners. It is not. Both runners implement
`test_traps_*` — an export whose *trap* is the pass — `harness/wacTestRun.ts:193` and
`native/v8/src/main.rs:2247`. What does not is the loop inside this test, which is a third
implementation of the convention:

```ts
try {
  if ((fn as () => string)() === "") pass++;
  else fail++;
} catch {
  fail++;          // a trap is a failure, unconditionally
}
```

`bounds_test.wac` has twelve `test_traps_*` exports, so the copy scores 4/12 where both real runners
score 16/0. The file it names is right and the direction is backwards: the *test* is wrong, and the
two runners agree.

## 4. And a fourth, visible only after the first three

With 1–3 fixed the file goes 6/1, and the last is the same shape again:

```
Error: not reported: 4 test(s) want a capability this run was not granted: … — try `wac test --allow-read …`
```

The assertion looks for the words **"need an oracle"**. That is what the runner said when the test was
written; it names the capability now. Three of this file's four defects are a string it was told once
and never asked about again.

## Why all four survived

The opt-in is for disk — each run rebuilds the crate and writes 67 MB — and that is a good reason to
keep it out of the gate. But nothing else runs it either, so "opt-in" has meant "never", and three
independent defects accumulated in one file without a single red run to show for it.

`packages/wacc/test/wac/binary_test.wac` is opt-in for the same reason (105 MB) and was **also**
green only because nobody ran it; it passes, but that was luck rather than evidence. Whatever is done
here, the class needs an answer: an opt-in test that is never opted into is a test that has been
deleted without anybody deciding to.

## Notes

Found while assessing the file for `issues/system/0161` — the port was not attempted, because porting
a red test moves the failure rather than the coverage. 2 and 3 are mechanical. 1 is the interesting
one and is really a question about `native.ts` and `wac build`.
