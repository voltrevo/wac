# 0212 — the mutation recall floor is decided by filenames, not by the checker

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** wrong answer

## What happens

`packages/wacc/test/corpusMutate.test.ts` rung 3 breaks each corpus file one way and requires the
checker to report at least 97% of them. Which way a file is broken is

```ts
const [, mutate] = MUTATIONS[i % MUTATIONS.length];
```

over a corpus that `packages/wacc/test/corpus.ts` sorts by path. So the mutation a file receives is a
function of **its index in an alphabetical list** — and inserting one file anywhere shifts every
alphabetically-later file onto a different mutation.

Measured, by adding a single trivial `packages/aaa/src/probe.wac` that sorts before everything:

| | broken | reported | misses |
|---|---:|---:|---|
| baseline | 182 | 179 (98.4%) | `crypto/src/rsagen.wac`, `tor/src/hsdir.wac`, `wacc/test/wac/i31trap_test.wac` |
| one file added | 189 | 186 (98.4%) | `fs/src/wire.wac`, `git/src/index.wac`, `tls/src/hybrid.wac` |

**Not one file in common.** The whole measurement moved; the percentage happening to land on 98.4%
twice is a coincidence of the two sets being the same size.

## What it costs

The percentage is gated at a floor, so this is not only noise in a number — it decides pushes. Two
gate runs failed on it today while porting tests to wac:

```
recall on the repository's own broken code is 194/202 (96.0%), and the floor is 97%
recall on the repository's own broken code is 183/190 (96.3%), and the floor is 97%
```

Both times the diagnosis looked like a stale seed, because reseeding and re-running made it pass —
and reseeding also happened after a `git pull` that had changed the corpus. The seed was a real
factor once and a coincidence the second time; what actually moved was the file list. That is an hour
of two agents' time, and the failure names the checker rather than the harness, so it sends you to
the wrong place.

`packages/*/test/wac/` is in the corpus, so this fires on ordinary work: **every test file added or
renamed re-pairs the corpus.** `issues/system/0161` is moving the whole suite into `test/wac/`, which
means this will keep firing for as long as that work lasts.

## What it probably wants

The pairing should be a property of the *file*, not of its position — a hash of the path modulo the
mutation count would give a stable assignment that survives an insertion, and would keep the same
"one mutation per file" cost.

Better still, and more work: apply **every** mutation to every file. The current design exists to
keep the sweep to one compile per file, and the comment about closures says that cost was already cut
from two minutes twenty. Seven mutations over 694 files is a different scale and probably belongs in
`deno task mutate` rather than the gate — but then the gate's floor would be over a complete
measurement rather than a sample nobody chose.

Whichever, the floor should not be a gate until the number under it is stable. A floor over a metric
that moves when a file is renamed is a coin toss written as a threshold.

## Notes

The recall figure itself is not in doubt — 98.4% is a real reading of the checker against the
reference, and the misses it names are real misses each time. What is wrong is that *which* real
misses you get is decided by an accident, and that a gate says yes or no on the strength of it.
