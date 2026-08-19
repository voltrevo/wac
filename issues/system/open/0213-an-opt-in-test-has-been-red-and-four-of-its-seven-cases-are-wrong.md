# 0213 — an opt-in test has been red, and four of its seven cases are wrong

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** wrong answer

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
