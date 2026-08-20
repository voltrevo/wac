# 0220 — twenty-six copies of `struct Rng`, in five variants

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-20
- **Kind:** task
- **Symptom:** wrong answer

Twenty-six `.wac` files declare their own `struct Rng`. Grouped by the body of `next()`:

| files | generator |
|---:|---|
| 13 | xorshift32, `return this.x as @u32` |
| 5 | xorshift32, `return this.x` |
| 6 | no method called `next` — differently named or shaped |
| 1 | LCG, `return this.s` (`packages/crypto/test/wac/aead_test.wac`) |
| 1 | LCG, `return this.s >> 8` (`packages/gzip/test/wac/fuzzcorpus.wac`) |

The two LCGs are deliberate and fine — nothing claims they match anything. The eighteen xorshift32s
are one generator split by whether the result is cast, and several of them carry a comment saying
they match "the host-side generator so the corpora are the same ones", which is a claim nothing
checks.

## Why it matters, which is narrower than it looks

Not that the copies disagree today — mostly they do not. It is that **a corpus is an oracle's input**,
and a fuzz test whose generator quietly differs from the one its expectations were recorded against
tests a different thing than it says. `packages/datetime`'s driver and its test had already drifted
in exactly this way for a different reason, and the README claimed 100% while the tool said 92
(recorded in `packages/datetime/test/cov_exercise.wac`'s header).

The cast is the live difference: `as @u32` and no cast give the same *bits*, but `next() % n` on the
result is a signed remainder in one and not the other, so the same seed walks a different half of the
space. Files that use `upto()` are insulated; files that use a bare `%` are not.

## What to do

One `packages/wactest/src/rng.wac` exporting the xorshift32 and `upto`, and the eighteen copies
import it. Two things to be careful of, which is why this is filed rather than done in passing:

- **The interfaces differ**, not only the bodies: some copies carry extra helpers (`byte`, `upto`,
  package-specific draws). The shared one needs the union, or the extras stay local.
- **Changing a generator changes a corpus.** Any file whose expectations were recorded against its
  own variant will move. Convert one file, run that package, and check the numbers before the sweep —
  a green suite after a mass edit here would mean the corpora were not being read.

Found while porting `cov.ts` drivers to wac (`issues/system/0161`), where a new exercise needed a
generator matching an existing test's and there was no shared one to take.
