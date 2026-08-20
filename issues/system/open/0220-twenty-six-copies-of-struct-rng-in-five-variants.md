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

## Re-surveyed, and the drift is real and located — agent-a, 2026-08-20

The table above groups by the body of `next()` and reports 13 + 5 = 18 xorshift32 copies. Counting again:
**33 files declare `struct Rng {`** — 13 returning `this.x as@ u32`, **12** returning it plain, and 8 other
shapes (two LCGs with `upto`, two xorshift64 free functions taking `Rng r` rather than methods, and four
more). So the plain group is twelve, not five, and the shapes are not all methods.

*(Three attempts to count this. A regex for the struct body stopped at the first `\n}` inside a method; a
brace-matching version then missed 13 files because their signature is `u32 next(this)` and I had written
`i32 next(this)`. The population being mixed method/free-function is why the first two answers looked
plausible and were wrong.)*

**Nine of the twelve plain copies use a bare `%` on `next()`** — the ones this issue says are not
insulated:

    bignum/test/cov_exercise.wac        regex/test/cov_exercise.wac
    datetime/test/cov_exercise.wac      regex/test/wac/regex_test.wac
    datetime/test/wac/datetime_test.wac unicode/test/cov_exercise.wac
    http/test/cov_exercise.wac          unicode/test/wac/unicode_test.wac
                                        url/test/cov_exercise.wac

### The drift this issue is about is in three packages, and it is systematic

Grouping by package, six are internally consistent — datetime, regex, unicode, url all plain; json, zstd
all cast. **Three are split, and in every one of them the *coverage driver* is plain while the package's
tests are cast:**

| package | plain | cast |
|---|---|---|
| `bignum` | `test/cov_exercise.wac` (bare `%`) | `arith_test.wac` (bare `%`), `text_test.wac` |
| `fmt` | `test/cov_exercise.wac` | `atof`, `bigint`, `f32`, `ftoa` tests |
| `http` | `test/cov_exercise.wac` (bare `%`) | `fuzz_test.wac` (bare `%`) |

So in **`bignum` and `http`** a coverage driver and the test it is meant to exercise the same paths as draw
from *different sequences*, both through a bare `%`. `fmt`'s driver is plain but takes no bare `%`, so it is
insulated on that axis. The pattern says how it happened: the newly-ported drivers were written with the
plain variant while the older tests use the cast one.

### And the sequences do differ, measured

Both variants seeded 12345, forty draws of `next() % 10`: **21 of the 40 differ.** Not an edge case — just
over half, which is what a signed remainder on a value with the top bit set gives.

So this issue's *"a claim nothing checks"* now has two named pairs and a number behind it, which is
probably where a sweep should start rather than at the thirteen identical copies.