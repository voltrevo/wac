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

**Which plain copies use a bare `%`.** I first wrote nine here; that count matched inside *comments* —
`regex_test.wac` was flagged on a docstring reading "`next() % n` there is a modulo of a…". With comments
stripped, and after the two conversions below, the plain files with a real bare `%` in code are **four,
and every one is a coverage driver**:

    bignum/test/cov_exercise.wac    regex/test/cov_exercise.wac
    http/test/cov_exercise.wac      url/test/cov_exercise.wac

and the plain files with no bare `%` are `codec/test/wac/codec_test.wac`, `fmt/test/cov_exercise.wac`,
`url/test/wac/fuzz_test.wac`, and `regex/test/wac/regex_test.wac` — which is **already correct**: it casts
at the point of use, `((this.next() as@ u32) % (n as@ u32)) as@ i32`, and its docstring is the clearest
statement of this issue's whole point anywhere in the tree:

> `x >>> 0` in the host-side generator was not decoration: `next() % n` there is a modulo of a 32-bit
> unsigned, and a signed remainder corrected into range afterwards picks different atoms. The corpus would
> still be a corpus, and it would not be the same one — so a seed named in a failure would no longer
> reproduce it.

So the remaining four are drivers whose `upto` is the `v < 0 ? v + n : v` fold that docstring describes:
corrected into range, and not the host's sequence.

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

### Which of the two variants is *right*, measured against the thing they claim to match

The table at the top calls the eighteen "one generator split by whether the result is cast", which reads
as a tidying job. It is not symmetric: one of the two matches the host-side generator and the other does
not, and four files that use the wrong one **say in a comment that they use the right one**.

The host-side generators, recovered from git history because the files are deleted —
`packages/{regex,unicode,datetime,url}/cov.ts` — are all:

```js
x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x;    // unsigned
```

The wac copies' **state evolution is a faithful port**: `(this.x >> 17) & 0x7FFF` is a signed shift masked
to fifteen bits, which is bit-for-bit `x >>> 17` on a 32-bit value either side of zero. The only
difference is the *return* — the host hands back an unsigned value, `as@ u32` reproduces that, and plain
does not.

So **the cast variant is correct and the plain one is wrong**, and these four carry the claim while being
the wrong one:

| file | claim | bare `%` |
|---|---|---|
| `regex/test/wac/regex_test.wac` | "matching the host-side generator so the patterns are the same" | yes |
| `unicode/test/wac/unicode_test.wac` | "…so the corpora are the same ones" | yes |
| `datetime/test/wac/datetime_test.wac` | "…so the corpus is the same one" | yes |
| `url/test/wac/fuzz_test.wac` | "…so the corpus is the same one" | no |

Three of the four read the draw through a bare `%`, where signedness decides the answer — and the
measurement above says **21 of 40 draws differ**. So those three test a corpus that is about half new,
while saying it is the recorded one.

**And nothing in the tree can check any of it**, which is the sharpest form of this issue's point: the
host-side files those comments refer to were deleted by the port. The claim's referent exists only in git
history, so it is not stale — it is unverifiable from HEAD.

That gives the sweep a direction it did not have: converge on the **cast** form, and the three bare-`%`
tests are the ones whose numbers should be expected to move.

### First conversion done, with its numbers — `datetime`

The guidance above is to convert one file, run that package, and check the numbers before the sweep. Done
for `datetime`, which needed **both** of its files: they were internally consistent as plain, so converting
only the test would have created the split this issue is about.

- `test/wac/datetime_test.wac` — `next()` returns `as@ u32`, and `spreadMillis`'s `% 4000000` is unsigned.
  That restores the range its own comment documents: with an unsigned draw the spread is 1963.7–1976.3,
  which is what *"about 1963 to 1976"* says; signed, it was roughly 1951–1976.
- `test/cov_exercise.wac` — same, and **the fold came out**. `upto` was
  `i32 v = this.next() % n; return v < 0 ? v + n : v;` — a compensation for the signed return that did not
  restore the host's sequence either, since `(-k) % n + n` is not `(unsigned x) % n`. With the draw
  unsigned there is nothing to fold, and `upto` is the one-liner the cast-variant files already use.

**Numbers after:** the wac lane is 12 of 12, and `deno task coverage:datetime` is **123 of 123, 100.0%** —
unchanged. So a corpus that moved by about half its draws did not move the coverage, which is worth knowing
before the sweep: these are differentials against a host oracle, so *which* inputs they draw changes and
what they assert does not.

Two packages remain with a bare `%` on the plain variant — `regex` and `unicode`, both with driver and test
in the plain group, so both want converting as a pair the same way.

### Second conversion — `unicode`, and it found a hole in a test's premise

Converting `unicode`'s pair the same way went red, and the failure is the interesting part of this whole
issue:

    whole strings: lower "…ⱤΣ": got "…ɽσ", host says "…ɽς"

**Greek final sigma.** `Σ` lowercases to `σ` per code point and to `ς` at the end of a word, which is
Unicode's `SpecialCasing` contextual rule. The host's `toLowerCase` applies it; this package does *simple*
case mapping and says so — `packages/unicode/README.md` names final sigma as a contextual form it does not
do and lists full case mapping as out of scope. So **wac is right and the test's oracle was wrong.**

The test's own docstring is where the hole is: *"Only code points this package's table leaves unmoved or
moves to a single code point can be used, and the case sweep has already established that those are exactly
the ones the host maps singly"*. `Σ` satisfies that — it maps singly in isolation, on both sides — and
still differs inside a string. Per-codepoint agreement does not imply string agreement for a contextual
mapping, and the premise did not know it.

**The old corpus never drew a string ending in `Σ`.** That is not luck about one code point: the signed
draw walked a different half of the space, so a whole class of strings was unreachable. Fixed by excluding
`0x03A3` from the string corpus rather than tolerating it at the comparison, so a difference still means
something.

Two interface costs, both named by the compiler rather than found later: `next()` returning `u32` broke
`b[i] = r.next() & 0xff` in each file, which is the sweep cost this issue warns about arriving one call
site at a time.

**Numbers, before and after:** `deno task coverage:unicode` is **105 of 108, 97.2%** with the same three
unexecuted branch points in `utf8.wac` either way — measured by stashing the change and re-running. Lane
13 of 13.

So both conversions so far moved the corpus by about half its draws and moved no coverage. `regex` is the
remaining bare-`%` pair.