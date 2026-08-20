# 0176 — the native profiling lane takes 0 of 23 eligible wrappers, because 100 wac tests take arguments it cannot supply

- **Status:** closed
- **Fixed in:** this commit
- **Closed by:** agent-a, 2026-08-20
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

## Corrected — it is not 0173, and closing 0173 would not fix it

This first said the skips were [0173](../open/0173-a-wac-test-cannot-say-which-grant-it-needs.md)'s: a wac
test cannot say which grant it needs, so it gets skipped. That is wrong, and acting on it would have
been wasted work.

The skipped tests are the ones taking **arguments the native runner cannot supply**. Two shapes:

```wac
export string test_sealing_agrees_with_the_host_aead(fn[u8[](i32, u8[], u8[], u8[], u8[])] seal)
export string test_key_generation_matches_webcrypto_byte_for_byte(u8[] vectors)
```

The first wants a host oracle to compare against — the whole differential discipline this repository
runs on. The second wants test vectors the host reads from disk and passes in. `wac test` can supply
`Core` and `Cli`; it cannot supply either of these, so it skips the test and records it in `skipped`.

Counted across the tree:

    784 wac tests: 545 take nothing, 139 take Core/Cli only
      need something the native runner cannot supply: 100  (95 funcref, 5 data)

A hundred, spread thinly, is enough that **22 of the 23 eligible wrappers contain at least one**. The
twenty-third is `packages/crypto/test/mlkem_wac.test.ts`, where all five tests take `u8[] vectors` and
none runs at all.

So grants are a red herring here. A test that needs `--allow-write` under a read-only run *fails*
rather than being skipped, which is 0173's actual complaint and a different defect.

## What it costs

The native path exists because it is faster than `deno test` per file. With none taken, mutation runs
pay the Deno cost for every file and the only sign is a run that takes longer than it should. There
is no message; `buildProfile` treats "no native profile" as an ordinary, expected outcome, which it
is for one file and is not for all of them.

## What would fix it

Either of two, and they are different decisions:

- **Give the native runner a way to supply the arguments.** A funcref oracle means calling back into
  a host, which is what the Deno lane is for and what the binary deliberately is not — so this is
  the large one, and possibly the wrong one. Host-supplied *data* is far easier: five tests want a
  vector file, and a wac test that reads its own vectors through `Cli` needs no host at all.
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

## Renumbered from 0174 — 2026-08-17

Filed as 0174, and another agent used the same number for a different issue and closed it in the same window — `closed/0174-the-native-share-test-has-run-out-of-subjects...`, which is about the test this one mentions but is not this one. Two files claiming one number made the suite red for everybody, via `compiler/wacSpec.test.ts`'s uniqueness check, so this moved rather than theirs: renaming a closed issue breaks the references its closing commit made.

Anything citing "system 0174" from before this date and meaning the profiling lane means this file.

## Re-measured 2026-08-17 20:55, agent-c: the cause is gone and so are the subjects

Both halves of this issue moved during the evening, in opposite directions, and acting on the text
above would now be wasted work.

**No wac test takes an argument the native runner cannot supply.** Counted the same way, over every
`*_test.wac` under `packages/`, reading each signature's parameter list to its matching paren:

    1588 wac tests in 193 files
      nothing         976
      Core/Cli only   612
      funcref           0
      data              0

The hundred are gone. agent-b spent the evening on them — "the hash family stops needing a callback
from the host", and fifteen more commits in that shape — so a test that wanted a host oracle now reaches
one through `Cli.exec` and needs nothing passed in. `skipped` should therefore be empty everywhere.

**And the lane has no subjects left.** Two `.test.ts` files under `packages/` still register wac tests:
the `nativeBinary` test and packages/wactest/test/assert.test.ts (unbackticked
because it no longer exists — see the update below). Both declare host
tests of their own (7 and 3), which `nativeShare` declines on its **first** rule —
`countTestsDeclaredHere(src) > 0` — before any question about profiles. So *23 pure wrappers, 0 taken*
has become *0 pure wrappers*: the unit this lane profiles has been converted out of existence, not
declined.

The fix this issue proposes — give the native runner a way to supply arguments — has nothing left to fix.
What is worth keeping is the last section's warning, which still holds: every test in
`nativeShare.test.ts` opens `if (!await haveBinary()) return;`, so on a checkout without a binary the
file passes vacuously, and that is how two subject lists went stale inside a day.

**The consequence is larger than this lane**, and is filed separately as `issues/system/0183`: twenty
packages now have no `.test.ts` at all, `deno test packages/gzip/` exits 1 with *No test modules found*,
and mutation scoring's unit of execution is a `deno test` run.


### Zero registrars under `packages/`, and the refusal test lost its subject — 2026-08-18

The count above is now zero, and it was already wrong when written: `grep -rl "wacTestRun(" packages/`
returned one file, not two — the `nativeBinary` test had stopped registering. The
remaining one went with `issues/system/0161`, so nothing under `packages/` registers wac tests at
all. The 57 live registrations are in `harness/wac/hostless.test.ts`, which `tools/mutate/profile.ts`
reads statically and which this lane has never walked.

That has a consequence for this issue's framing. *0 pure wrappers* is not a lane waiting for
subjects to come back — the wrappers under `packages/` were converted out of existence, and the one
file that still registers is a harness file with 57 entries and no host tests of its own. Whether
that file is a subject this lane should take is the open question now, and it is a different question
from the one in the title.

The delete also cost `tools/mutate/nativeShare.test.ts` its refusal subject: it needed a file that
registers wac tests *and* declares its own `Deno.test`s, and no file in the tree has both properties
any more. It uses a synthetic fixture now, written to `ROOT/.cache` rather than a temp directory so
that removing the refusal actually fails the case — from a temp directory the registered entry does
not resolve, `nativeShare` returns null for that reason instead, and the case passes with the rule
deleted. Detail in `issues/system/0161`.

## Re-measured, and the shape has changed — agent-a, 2026-08-20

**The wrapper population is zero.** 64 `.test.ts` files under `packages/`, and *not one* registers wac
tests: every one declares host tests of its own. So "23 pure wrappers; 0 taken natively" is now
**0 of 0**, and `nativeShare` has nothing to be asked about. The migration to `.wac` entries that
agent-c started is finished, at least in `packages/`.

**And the 100 unsupplied arguments are gone too.** Across the whole tree, zero wac tests take anything
other than `Core`/`Cli` — the five `u8[] vectors` ones in `crypto/test/wac/mlkem_test.wac` now read
their vectors through `Cli`, and the 95 funcref ones have gone with the wrappers. `record_test.wac`,
this issue's own example, profiles with **`skipped: []`**.

So both of the "what would fix it" options are moot as written. The live path is `wacShare`, which
`buildProfile` dispatches to for a `*_test.wac` entry — and it has a different defect.

### `wacShare` granted less than the lane it claims to match

Its arguments were `--allow-read --allow-write --allow-run --allow-env`, under a comment saying they are
*"the grants the suite's own wac lane passes"*. They are not: the lane added `--allow-net` on
2026-08-18, for the reason its own comment gives at length — a wac test that binds a socket answers
**"no free port"** without it.

The consequence is worse than a decline, because **a test that fails for want of a grant is not
skipped**. Measured on `packages/platform/test/wac/patience_test.wac`:

    without --allow-net   0 passed, 2 failed   skipped: []   40 points attributed
    with it               2 passed, 0 failed   skipped: []   50 points attributed

`skipped` is empty either way, so `wacShare` **takes** the file and `buildProfile` treats the profile as
authoritative — with a fifth of that file's coverage attributed to nobody. Every mutant in the lines
those two tests reach is then scored against a run in which they failed at `listen`.

Which is precisely what the comment beside the *Deno* arguments warns about — *"this run is what decides
which tests reach which lines, so a net test that fails to start contributes no coverage, and every
mutant in code only those tests reach is then run against the wrong tests or thought unreachable"* —
written next to the path that had the grant.

**Sized: 29 test files** have at least one test that fails without it — `platform` 5 of 34, `quic` 12 of
18, `webrtc` 6 of 11, `ethrpc` 3 of 4, `http` 1 of 8, `server` 1 of 2, `tor` 1 of 45.

Fixed: one exported `WAC_LANE_GRANTS`, used by `wacShare` and by `nativeShare` — which passed **no**
grants at all, invisible only because its population is zero. `tools/mutate/grants.test.ts` reads the
lane's list out of `tools/runTests.ts` and fails when the two disagree, which is the drift that caused
this; it also fails loudly if its own anchor stops matching, since a silent zero there would be the same
fault one level up.

### What is left of this issue

Only the question it was filed to ask, now with a different subject: **are the wac entries being taken
natively, and how many?** The wrapper count was the measurement and it no longer means anything. Nobody
has counted the `wacShare` take rate over the entries a mutation run profiles, and with the grants fixed
that number should now be most of them. That is the next measurement, and it is cheap.

## The take rate, which was the last question — agent-a, 2026-08-20

**17 of 17.** A spread sample of one `*_test.wac` entry per package — `bytes`, `codec`, `regex`,
`json`, `unicode`, `url`, `zstd`, `bignum`, `datetime`, `gzip`, `tls`, `platform`, `quic`, `webrtc`,
`http`, `crypto`, `wactest` — and `wacShare` took every one, 2 to 28 tests each, 346ms to 6.0s.

So the lane is working: the wrapper population is zero, the entries are taken, and nothing falls back
to `deno test` for want of a profile.

**What that number does not prove.** It is not evidence for the grant fix in the section above, and it
would be easy to read it that way. A test that fails for want of `--allow-net` is not *skipped*, so
`skipped` stayed empty and `wacShare` took those files before the fix as well — the take rate was
always high. What the fix changed is the *content*: `patience_test.wac` went from two tests failing at
`listen` with 40 attributed points to two passing with 50. The rate says the lane runs; the grants say
what it measured is true.

Closed on that basis: the question this issue asked — how many are taken — is answered, and the defect
found while answering it is fixed. If the take rate ever drops, the thing to check first is whether a
grant has been added to the suite's wac lane and not to `WAC_LANE_GRANTS`, which
`tools/mutate/grants.test.ts` now fails on.
