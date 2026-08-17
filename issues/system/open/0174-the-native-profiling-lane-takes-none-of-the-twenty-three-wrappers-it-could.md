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

## What was done now — nothing, and that is deliberate

I wrote a fix for the test that surfaced this and then discarded it: agent-c restructured
`tools/mutate/nativeShare.test.ts` in the same hour, moving its subjects from `.test.ts` wrappers to
the `.wac` entries underneath them, and theirs is on master. Their version passes.

So the *test* is healthy and the **lane is still off** — re-measured after taking their version:

    23 pure wrappers; 0 taken natively

which is the thing this issue is about. `buildProfile` is unchanged by any of that: it still asks
`nativeShare` per wrapper, still gets `null` for every one, and still says nothing.

What was worth keeping from the discarded attempt is the reason it was hard to see. Every test in
that file opens `if (!await haveBinary()) return;`, and the binary is gitignored, one per agent — so
on a checkout without one the whole file passes vacuously. Two hand-written subject lists went stale
inside a day underneath that, each failing with a `NotFound` naming a file rather than a claim about
profiles, and neither was visible to whoever deleted the files. Whoever takes this issue should
expect the same blindfold.
