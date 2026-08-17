# 0174 — the native profiling lane takes 0 of 23 eligible wrappers, because every one has a skipped test

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** no error

## The measurement

Every `.test.ts` under `packages/` that registers wac tests, resolves cleanly and declares no host
tests of its own — the files `nativeShare` exists to take — asked one at a time:

    23 pure wrappers; 0 taken natively, 23 declined

`tools/mutate/profile.ts` is doing the right thing. It declines a file when the profile the binary
wrote lists anything in `skipped`, because a partial profile scores a mutant against tests that never
ran and calls it survived. The problem is that **every** wrapper now has at least one:

```
$ WAC_PROFILE=$d wac test --coverage packages/tls/test/wac/record_test.wac
entry:   packages/tls/test/wac/record_test.wac
tests:   7      all: 426
skipped: ['test_sealing_agrees_with_the_host_aead', 'test_the_header_is_authenticated']
```

So `buildProfile` falls back to `deno test` for all of them and says nothing, which is the exact
silence `nativeShare.test.ts`'s own comment describes paying forty minutes to notice once already.

## Why it is here rather than in 0173

[0173](0173-a-wac-test-cannot-say-which-grant-it-needs.md) is why the tests are skipped: a wac test
cannot say which grant it needs, so the runner leaves it out. This is the *consequence* — that the
native lane is off entirely — and it is worth its own number because closing 0173 does not
automatically restore it, and because the lane being off has a cost of its own that nothing reports.

## What it costs

The native path exists because it is faster than `deno test` per file. With none taken, mutation runs
pay the Deno cost for every file and the only sign is a run that takes longer than it should. There
is no message; `buildProfile` treats "no native profile" as an ordinary, expected outcome, which it
is for one file and is not for all of them.

## What would fix it

Either of two, and they are different decisions:

- **Close 0173** so a wac test can declare the grant it needs and stops being skipped. Then the
  profiles are complete and the lane takes files again. This is the real fix.
- **Let a file with skips be taken, carrying the skip list forward**, so the mutant scorer knows which
  tests did not run and does not count them as passing. That is a larger change to the scoring than
  it sounds, and it trades a silent fallback for a silent partial — worth saying no to unless the
  first is far off.

## What was done now

`tools/mutate/nativeShare.test.ts` named three wrappers by hand and all three had been deleted —
twice in one day, because the wac lane is retiring them in batches (`42ce27e7` took forty-four). It
discovers them now, and it distinguishes the two failures rather than reporting `NotFound`:

- no wrapper qualifies **and none is taken** — this issue, reported without failing, because a red
  shared gate for a filed state stops everybody's push for something they did not do;
- a wrapper qualifies and is *not* taken, or the binary is missing — still a failure, which is the
  regression the test was built for.

That split is the part to re-examine when this closes: the first branch should go back to being a
failure the moment the lane can take anything at all.
