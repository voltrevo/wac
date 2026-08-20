# 0220 — twenty-six copies of `struct Rng`, in five variants

- **Status:** closed
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-20
- **Kind:** task
- **Symptom:** wrong answer

## Re-measured on 2026-08-20, and four of the five figures below were wrong

The table further down was produced by grepping for `struct Rng` and reading a six-line window after
it. That counts prose as code and misses a body whose operators are spaced differently, and it did
both. Corrected by parsing each declaration's brace-balanced body and keying on **`next`'s declared
return type** rather than on whether `as@ u32` appears anywhere inside — which is how
`packages/url/test/wac/fuzz_test.wac` was filed as unsigned when its `next` returns `i32` and the
cast is in `upto`.

**33 declarations, not 26** — and one of the 34 files matching `struct Rng` is a header quoting this
issue, which is the same mistake one layer up.

**25 of them are one byte-identical generator**, including the `& 0x7FFF` that makes the signed `>>`
behave like a logical one:

    this.x = this.x ^ (this.x << 13);
    this.x = this.x ^ ((this.x >> 17) & 0x7FFF);
    this.x = this.x ^ (this.x << 5);

split **13 with `u32 next` and 12 with `i32 next`** — not 13 and 5. The other 8 are genuine one-offs:
four LCGs with different shifts, a 64-bit mix, and three with no `next` at all.

## The two families disagree on 37% of draws, and that is measurable rather than arguable

The split is not "whether the result is cast". It is two different `upto`:

    u32 family:  return (this.next() % (n as@ u32)) as@ i32;      // unsigned remainder
    i32 family:  i32 v = this.next() % n; return v < 0 ? v + n : v;   // signed, then corrected

Both land in `[0, n)`. They do not land on the same value: for a state of `0xC6E5747A` and `n = 10`
the first gives 0 and the second gives 4. Over 20,000 states at four moduli they differ on **37% of
draws**. So unifying moves one side's corpus substantially — this is not a cosmetic refactor, and the
"convert one file and check the numbers" advice below is the whole of the method.

**The first attempt at establishing that was the wrong test.** Looking for a bare `next() %` found ten
files, all of them in the u32 family and none in the i32 family, which read as "the difference has no
instance in the tree". It has 7: the divergence is *inside* `upto`, not at its call sites. Six of the
seven are `cov_exercise.wac` coverage drivers, whose corpora move only ratcheted numbers, and one is a
real test — `packages/unicode/test/wac/unicode_test.wac`.

## Thirteen of them claimed to match a generator that does not exist

Seventeen `Rng` declarations said, in their own doc comment, "matching the host-side generator so the
corpus is the same one". **Twelve of those packages have no host-side generator at all**:
`issues/system/0161` deleted the TypeScript drivers and the sentence outlived what it described. A
thirteenth, `packages/gzip/test/wac/fuzzcorpus.wac`, refers to "the host-side version" as history
rather than asserting parity, and is left alone.

The four with a real subject are all in `packages/fmt`, against
`packages/fmt/tools/sweep.ts` — and all four are in the **u32** family, whose unsigned remainder is
what that generator's `x >>> 0` produces. So every claim that still has something to be true of is
true.

The twelve are corrected — but **not the way this section first said, and the correction is the
interesting part.** The first attempt wrote "there is no host-side generator to match", which is true
of the filesystem and false about the constraint: `issues/system/0161` deleted the drivers and left
the **expectations recorded against them**, so the draw those drivers made is still the one that has
to be reproduced. A claim that is no longer checkable by looking is worse than one that is wrong,
because nothing fails.

Another agent found that the hard way, in the same hour and in a file this pass had already touched:
`packages/datetime/test/wac/datetime_test.wac` returned the signed `i32`, its `next() % 4000000` was
a signed remainder, and `spreadMillis` was drawing from a wider range than it documents. Their commit
names the deleted `cov.ts` and its `x >>>= 0; return x` as the thing that was being matched. That
merge conflicted with this pass's comment edit and their version was kept, because it is right and
this one was not.

**So the cast split is not a preference between two self-consistent corpora.** The deleted drivers
returned unsigned, so the unsigned family reproduces what the expectations were recorded against and
the signed family does not. That makes the twelve signed copies suspect rather than merely different,
and each wants checking the way datetime's was.

## Re-checked after the merge: no copy produces a signed draw any more

Measured over *code* with comments stripped, which the previous census did not do — it counted a
comment describing the fold that had just been **removed** as an instance of the fold, in
`packages/unicode/test/wac/unicode_test.wac`. That is a pattern failing to tell a citation from a
repudiation, which is written down in `tools/wac/readmefigures_test.wac`'s header as the reason a
different guard was rejected, and was repeated here within the hour of writing it.

Of the 24 canonical copies remaining:

- **zero** use the signed fold `v < 0 ? v + n : v`. Every one was swept;
- 8 still declare `i32 next`, and **none of them draws signed**: one uses `next` alone, so the bits
  are identical either way, and the other seven cast at the use site —
  `((this.next() as@ u32) % (n as@ u32)) as@ i32`.

**So the correctness half of this issue is closed.** What is left is mechanical: 24 declarations
become one import, with no corpus moving anywhere, because every copy already draws what the deleted
host drivers drew. That is a different and much duller job than the one filed this morning, and it is
duller because two agents measured the same thing from opposite ends within an hour.

## Done — 2026-08-20

**25 files import `packages/wactest/src/rng.wac`; 8 declarations remain and they are the ones this
issue always said to keep** — two LCGs, a 64-bit mix, and five differently-shaped generators, none of
which claims to match anything.

No corpus moved. Every converted copy already drew what the shared one draws: 13 returned `u32`, and
the other 12 either used `next` alone — where `as@` reinterprets, so the bits are identical — or cast
at the use site, `((this.next() as@ u32) % (n as@ u32)) as@ i32`, which is what the shared `upto` is.
`coverage:all` is 21/21 with no ledger re-pointed.

The extras stayed with their callers as free functions over `Rng`, because a wac struct's methods
cannot be extended from another file: `bit` twice, `nextDouble` twice, `pick` once, and `next64` once.
Each carries the draw order in a comment, since reversing high and low gives the same distribution and
a different corpus.

### What the compiler caught that no plan would have

Four sites where `next` changing from `i32` to `u32` mattered, every one a type error rather than a
silent difference:

| site | fix |
|---|---|
| `fmt/cov_exercise.wac` `doubleOf(r.next(), r.next())` | `as@ i32` on both halves — a reinterpret, so the same thirty-two bits |
| `fmt/cov_exercise.wac` `f32.fromBits(r.next() as~ u32)` | the cast became `u32` to `u32`; dropped |
| `codec_test.wac` `out[i] = rng.next() & 255` | mask in `u32`, reinterpret the result |
| `fmt/bigint_test.wac` `rng.next64()` | a method the conversion had dropped, because the regex listing methods was `([a-zA-Z]+)\(this` and cannot match a digit |

That last one is why this went file by file rather than as one sweep. The other three are the argument
for `u32` being a *type* change and not a formatting one.

### And three misplaced imports

The `cov_exercise.wac` drivers do not import `assert.wac`, so the script anchoring on that import
failed on six of them — loudly, and without writing. Anchoring on the last `import` line then put the
new one *inside* a multi-line import statement in three files, which is another parse-by-line mistake
of the kind this issue has collected all day. Anchoring on a complete statement — one ending in `";` —
is the version that works.

## What to do, revised

Unify on the **u32** family — the one the deleted host drivers returned, the one
`packages/fmt/tools/sweep.ts` still returns, and the one whose `upto` needs no sign correction. A
signed copy is not an alternative convention; it is a corpus that stopped matching its expectations
when nobody was looking. One `packages/wactest/src/rng.wac` exporting `next` and `upto`; the
extras stay local, as free functions taking an `Rng`, because a wac struct's methods cannot be
extended from another file. The interfaces are: 13 files want exactly `next` and `upto`, two want
`bit`, two want `nextDouble`, one wants `pick`, and six use `next` alone.

Twelve files' corpora will move. Six are coverage drivers behind a ratchet, which will report a
different number and need the ledger re-pointed rather than re-recorded. One is
`packages/unicode/test/wac/unicode_test.wac`. Convert one, run that package, look at the numbers,
then sweep.

## The original report follows, with its figures as filed

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

### The four drivers, and where the sweep now stands

The remaining four — `bignum`, `http`, `regex`, `url` coverage drivers — took the same one-liner, and
**only in `upto`**: `((this.next() as@ u32) % (n as@ u32)) as@ i32`, leaving `next()` returning `i32`.
That is the shape `regex_test.wac` already uses, and it is the smaller change: casting at the point of use
fixes the corpus without changing the interface, so no other call site moves. `datetime` and `unicode`
went the other way — `next()` returns `u32` — because their `next()` is used directly as well, and each
of those cost two compiler errors to sweep.

Both idioms are correct and the tree now has both, which the shared module this issue asks for would
settle. Worth saying plainly rather than leaving as an inconsistency somebody finds later.

**Numbers.** All four coverage tasks exit 0, so no floor moved, and two measured against a stashed
baseline are identical either way:

| package | branch points | covered | baseline |
|---|---:|---:|---|
| `bignum` | 230 | 226 | 226 — same |
| `url` | 727 | 712 | 712 — same |
| `http` | 447 | 404 | floor held |
| `regex` | 649 | 573 | floor held |

With `datetime` (123/123) and `unicode` (105/108) that is **six packages converted and none whose coverage
moved**. A corpus that changed by about half its draws changed no coverage anywhere — because these are
differentials against a host oracle, so which inputs they draw moves and what they assert does not.

**What is left.** Every file with a *live* signedness difference is now correct. The plain files that
remain — `codec/test/wac/codec_test.wac`, `fmt/test/cov_exercise.wac`, `url/test/wac/fuzz_test.wac` — take
no bare `%`, so their variant makes no difference to what they draw; and the thirteen cast copies were
already right. So what is left of this issue is the **deduplication** it was filed for: one
`packages/wactest/src/rng.wac` and twenty-odd imports. The correctness half is done, and that was the
half that could silently be wrong.
## Two agents did the sweep at once — agent-a, 2026-08-20

I did this deduplication independently and in parallel, and agent-b's landed first. The designs agreed
on everything that mattered, including the choice of the unsigned family, which is reassuring rather
than wasteful — but three things came out of the other attempt that are not in the tree yet, and they
are what this note is for.

### The shared module had no test, and now has one

`packages/wactest/test/wac/rng_test.wac`. It keeps **verbatim copies of both deleted bodies** — the
unsigned `Local` and the signed `Folded` — and walks each against the shared one, because a
differential whose halves run the same code can only report agreement, so the thing being replaced has
to be kept once as the oracle for having replaced it.

It also turns this issue's own claims into assertions rather than prose:

- the two families disagree — **3984 of 20000** draws over five widths, seeded 7;
- signed and unsigned remainders on the same draws differ in **21 of 40**, which is the canary: both
  differentials would still pass if the shared body and its verbatim twin were changed together;
- dropping `& 0x7FFF` changes more than 150 of 200 draws, so the header's "the mask is the algorithm"
  is measured;
- `upto(0)` answers 0 and does not advance the state.

Canaried: `<< 5` to `<< 6` in the shared generator fails three of the six tests.

*(One correction to a figure while doing it. The header cites a state of `0xC6E5747A` at `n = 10`
giving 0 one way and 4 the other. Seeding an `Rng` with that value gives 7 both ways — the number is
the state **after** a step, not a seed, so the test checks the arithmetic on the value itself rather
than the example as written. Worth knowing before anyone else tries to reproduce it.)*

### The `n <= 0` guard is dead in all four files it came from

The shared `upto` inherited the guard as "the superset". It was never reached. Removing it from all
four files that had it — `zstd/encode_test`, `zstd/fseenc_test`, `zstd/fse_test`, `http/fuzz_test` —
left every lane unchanged at 10, 3, 10 and 2 tests, and *unguarded* `upto(0)` traps on `% 0`, so a
still-passing lane is a lane that never called it. That includes `upto(left)` in `fse_test` where
`left` counts down and `upto(bytes.len())` in `http`, the two that look most like they need one.

Removing a guard is a strange canary and a real one. **Not** removed here, because twenty-one further
call sites now share that function and the measurement only covers four — so what is owed is the same
removal run against all twenty-five lanes. Recorded because the argument in the docstring ("answering
0 is what the majority of the guarded copies chose") is about provenance, and this is about whether it
fires: a silent 0 from a drawing on an empty range is a caller's bug going unreported.

### The xorshift64* pair is done too

`tls` and `tor` each carried a copy of an xorshift64\* with `i64` state, as free functions rather than
methods, differing from each other only by a temporary variable — `i32 v = …; return v;` against
`return …;`. That is the state a duplicate reaches before it drifts somewhere that matters. Now
`packages/wactest/src/rng64.wac`, exporting `Rng64`, `rng`, `next` and `randomBytes`; lanes 8 and 11,
unchanged. Named for its width so a file importing both modules is not importing two things called
`Rng`.

So what still declares a `struct Rng` is six copies of two LCGs, in four shapes — `bytes(n)`,
`block()`, `upto(n)`, `next()`. The top of this issue rules them fine and that still holds for the
reason it gave: nothing claims they match anything, so there is no wrong answer available.
