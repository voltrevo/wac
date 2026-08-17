# 0174 — `nativeShare` has run out of subjects, and may be measuring a real gap rather than a bad one

- **Status:** closed — by agent-b, within the hour, and better than either thing I tried
- **Claimed by:** agent-b
- **Fixed in:** `dbc6126f` — "the driver has to be readable by the tooling that reads it"
- **Reported by:** agent-c
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer — a red suite whose message is about profiles and whose cause may not be

## What happens

`tools/mutate/nativeShare.test.ts` names three single-registration wrappers as its subjects. All three
are gone, and so were the three before them:

| set | subjects | fate |
| --- | --- | --- |
| original | `packages/quic/test/varint_wac.test.ts`, and two others | deleted with the first forty-four wrappers |
| mine, an hour later | gzip's huffman, bytes' buf, std's map | deleted with the next batch, within the hour |

So the file reads a path that does not exist and both of its comparisons fail with `NotFound` — a
failure about the filesystem wearing a message about profiles.

## Why the obvious fixes are both wrong

**A fourth set of names** breaks on the next batch. Two sets in one afternoon is the measurement.

**Finding them instead** — "the first single-registration wrapper per package, in sorted order" — picks
subjects that are not subjects. It chose `packages/crypto/test/aead_wac.test.ts`, and three of its five
tests need a host oracle and are skipped under `wac test`, so the test reported:

```
the native profile names 2 test(s), the Deno one 5. Missing natively: aead: rfc_8439_aead, …
```

That is the test working — on the wrong question. The judgement the hand-written list encodes is
*every one of this file's tests runs on both paths*, and it cannot be derived without running them.
Choosing subjects that happen to agree would make the test tautological; choosing them blindly makes
it noise.

## And then the one verified subject failed too

I ran every remaining single-registration wrapper's entry under `wac test` and kept the ones that
skipped nothing. `packages/crypto/test/kdf_wac.test.ts` was the only survivor of 24. It fails as well:

```
kdf_wac.test.ts: the native profile names 4 test(s), the Deno one 6.
  Missing natively: kdf: expand_chains_across_blocks, kdf: the_key_length_boundaries
```

**Which is why this is filed rather than fixed.** Two tests missing from the native profile is either a
third bad subject or the thing this test exists to catch. The second failure in the same run points the
same way:

```
a pure single-registration wrapper was not taken natively. Either the binary is not where
`buildProfile` looks, or the file stopped qualifying — both leave the whole profile on the Deno
path with no message.
```

That message is about the *runner*, not the subjects. If wrappers have stopped qualifying as the
collapse changes their shape, then `buildProfile` is quietly leaving everything on the Deno path — the
exact silence that test was written to break — and the subject churn is masking it.

## What I would want to know first

1. Does `kdf_wac`'s native run genuinely skip those two tests, and if so why — a grant, an oracle, or a
   name the native reader cannot resolve? `wac test packages/crypto/test/wac/kdf_test.wac` says.
2. Is any wrapper still *taken natively* by `buildProfile`? The third failure suggests not, and it is
   the one with consequences beyond this file: a mutation run would narrow mutants on evidence the
   native path never contributed.
3. When the collapse finishes, is per-wrapper profile sharing still a thing to test? If every wac test
   is registered one way, the sharing this compares may not exist, and the file is then a deletion
   rather than a fix.

I reverted my own two attempts at (1) and (2) — a named set and a found set — because both were
guesses at a moving target and the second produced a failure that reads like a defect. Left as it is,
which is red, rather than patched into a green that means nothing. `issues/system/0154` has the note
about a killed suite; this one is separate and is not memory.

## Closed: the subject was wrong, not the runner — 2026-08-17

agent-b fixed it while this was being written, and the answer is the one neither of my attempts
reached: **the subject is the wac entry, not the wrapper that registers it.** In their words, that is
"what both sides were really profiling all along" — so a wrapper being deleted stops mattering, which
is the churn this issue is about, and the file names entries now.

They hit the oracle trap independently and wrote it down: *"An oracle-supplying wrapper is not a usable
substitute, which was the next thing tried: its tests are skipped natively — that is what 'needs an
oracle from the host' means — so the two profiles cannot match and the comparison has nothing to say."*

**And it answers the third question, which was the one with consequences.** I read
*"a pure single-registration wrapper was not taken natively"* as possible evidence that `buildProfile`
had stopped taking anything natively — the silence that test exists to break. It had not: all five
tests pass on their change, so that failure was the bad subject too. Worth recording because the
message reads like a claim about the runner and was a claim about what it was pointed at.

My two attempts — a named set, then a found set — are reverted and stay reverted. The useful residue is
in this issue rather than in the tree: a fourth set of names would have broken on the next batch, and
finding subjects automatically picks ones whose tests do not run on both paths, which produces a
failure that looks exactly like a defect.
