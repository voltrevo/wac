# fmt — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/fmt`: 1,195 lines over four files. `atof.wac` and `bigint.wac` are
arithmetic and are not rewritten — the algorithms did not move because the language did.

---

## What is actually new here, which is narrower than I first wrote

`itoa.wac`'s header opens:

> wac has no number-to-string conversion and `string + i32` is **deliberately** a compile error.

And `vision/IDIOMS.md`'s *A number in a string* says interpolation is sugar for `+` and `+` takes the
scalars. I read that as vision reversing the header's decision, and half of it is not a proposal at
all.

**Interpolation already exists.** `spec/spec/strings.md` describes it in almost the entry's words —
*"It is exactly sugar for `+` … there is no formatting language — the expression is whatever `+`
accepts on the right of a string"* — with three tagged examples. The IDIOMS entry is a description of
a shipped feature, and it is marked **Not yet**.

**What does not exist is `+` accepting a scalar.** Measured:

```
error: operands have mismatched types
 1 | export i32 f(i32 n) { string s = "n=\{n}"; return s.len(); }
   |                                  ^
```

So the contradiction is real and it is one clause wide: vision proposes widening `+`, and the `fmt`
header says that narrowness is deliberate. The word is in the original and the reason behind it is
recorded nowhere I could find, which is still worth asking before the entry moves — but it is a
smaller question than *does interpolation reverse a decision*, and the entry's marker is wrong
either way.

**And it settles something the entry does not mention.** If `\{x}` is `+`, then `"\{0.1 + 0.2}"` is
`"0.30000000000000004"`, because that is the shortest decimal that reads back. Right for a log line,
not what somebody writing `"total: \{amount}"` expects, and *no formatting language* — which is the
spec's phrase, not the entry's — means there is no other spelling for them.

## What changed

**`atoi` answers `i32?`.** It returned `0` for `""`, for `"hello"` and for `"0"` — three different
facts sharing one answer, with no way to ask which. The original's own comment records what that
costs: `box`'s `seq` failing as `seq 10 -3 1`, *"refusing a step of zero it had invented itself"*,
because the sign was not being read and garbage scans as zero. Reading the sign fixed that instance;
the type is what removes the shape.

It is also now strict about trailing rubbish — `atoi("12kg")` was `12`, which is right for a
tokeniser and wrong for a caller checking input. A tokeniser wants a different function, and it
should say so.

**`Decimal.Digits` lost its `count`.** It was `(u8[] digits, i32 count, i32 exp10, bool neg)`: an
over-allocated array beside the number of it that means anything, which is a slice written as two
fields. A caller reading `digits` without `count` gets trailing zeroes that are not part of the
number, and nothing stops one.

**`LIMBS()` is a module constant** rather than a function returning `40` — which the language has
always allowed. Three READMEs called that a gap before anyone read `spec/spec/grammar.md`.

## What could not be written

**Re-export, and the real package already has an issue open about it.** `fmt.wac` is a barrel — the
thing that lets a caller write `from "fmt"` rather than `from "fmt/src/itoa.wac"` — and it cannot be
written. The original's header says why and what it costs:

> wac has no re-export — importing a symbol from a file that merely imports it is a compile error —
> so unifying them means editing the import line of all forty-odd wac test files that use them […]
> wac-mono 0072.

So `itoa64` and `utoa64` exist twice in library code, and the duplicate survives because moving it
touches forty import lines. The language has no way to say *this name is also available here*.

**And the duplication is not merely untidy, measured.** `itoa64` has five definitions, not two: the
three outside library code are separate re-derivations and **none handles `i64` minimum**. All three
write `i64 n = neg ? 0 - v : v;`, which at the minimum overflows back to itself, so the loop never
runs and the answer is the sign alone — `itoa64(0x8000000000000000).len()` is **1**, against 3 for
`-42` in the same program. `issues/system/open/0325a`.

That is the same shape `f8d9b489` found in `dirOf` — five copies, four different answers at `/a`,
none reachably wrong — and it is the argument for re-export that the citation I first reached for
did not actually make.

This is the first gap in seven packages that the repository had **already filed an issue about**,
which makes it a different kind of finding from the rest: not something this exercise noticed, but
something it can say is worth fixing at the language level rather than with a mechanical edit
waiting for a quiet moment.

**A span was three arguments, and now there is a type for it.** `atofSpan(u8[] src, i32 start,
i32 end)` in the original, `isValidTarget(s, lo, hi)` in `http`, `slice(query, at, eq)` in `server` —
and `packages/bytes`'s `slice` copies, so the alternative to the triple is an allocation per token.

`vision/core/slice.wac` is the answer and it is **invented rather than agreed**: two arguments that
must travel together and must not be swapped is a struct. `url/query.wac` uses it.

The effect is smaller than the first draft of this paragraph claimed. A struct is heap-allocated, so
a slice is one `struct.new` — an O(1) allocation replacing an O(n) allocation and a copy, which is a
win against `packages/bytes`'s copying `slice` and a **loss** against `atofSpan`'s triple, which
allocates nothing. The case for the type is that a triple can be handed the bounds of one buffer and
the bytes of another, and that is a correctness argument rather than a cost one.

**A sentinel that is right, which this directory had not found before.** Added with
[`src/atof.wac`](src/atof.wac). The fast path signals *I decline, use the exact fallback* by
returning NaN — *"no JSON number can produce it, so it cannot be confused with a real answer"* — and
that one sentence discharges the whole obligation. It is the tenth row in
[`../../QUESTIONS.md`](../../QUESTIONS.md)'s sentinel table and the only one that clears it, which
turned a rule into a two-part rule: a sentinel is sound when the value's range provably excludes it
**and** something says so where a caller reads it. A `Result` here would be *worse* — the decline is
a dispatch, not a failure, and wrapping it spends a `try` on control flow with no error in it. First
time today the answer came out against the habit.

**`FixedBig` has two capacities and one type.** `zero()` is 40 limbs and `withLimbs(160)` is 160,
each justified by a correct proof in a comment, and they are mutually assignable. `atof`'s `Cmp`
holds five fields that must all be 160-limb and says `FixedBig` five times; `FixedBig.zero()`
compiles in any of them and fails at a bounds check inside `shiftLeft`, in a third file. **This is
the case the fixed-length-array ask does not cover** — `FixedBig<160>` needs a type parameter over a
literal, which is where const generics begins and where that ask stopped. Worth knowing before the
small feature is built and this is expected to follow. The part needing no language change is the
naming: `zero()` reads as *an empty bignum* and is *an empty bignum with `ftoa`'s capacity*.

**A stale language claim that the tree's own cleanup missed.** `bisect32` says *"the two return
different types and wac has no generics"*; wac has generic functions, spec'd, with a shipped example.
Seven files carry in-place corrections of exactly this shape and there are 38 such corrections across
23 files — so the practice exists and this is a straggler, along with `wacc/src/kinds.wac`'s *"no
module-level constants"*. `packages/gzip/src/tables.wac` shows what the practice is for: it corrected
the same claim, **measured** the conversion at thirty nanoseconds per gzip operation, declined it as
churn, and wrote the reason — *"a false constraint in a comment is worth more than the thirty
nanoseconds: the next person to need a table at file scope reads this and believes they cannot."*
`issues/lang/0354a` has been rewritten down to the two comments — and to the fact that
`kinds.wac`'s is **not stale**: `packages/wacc` must compile on wac-L5, which refuses a top-level
`const`, so its 265 sites are forced rather than drifted and sweeping them would break the
bootstrap. **Two things the count does not carry:** a line-oriented grep finds neither
survivor, because both claims wrap mid-phrase, so any real instrument has to read comments as
paragraphs and "two" is a floor. And **the conclusion survives its false reason** — generics
monomorphise, so `bisect<T>` would work, except that the body calls `f64.fromBits` and there is no
way to write `T.fromBits`. Correcting the comment and merging the two functions would produce a body
that does not compile.

**An aliasing precondition, which `const` gets close to and does not reach.** Added with
[`src/bigint.wac`](src/bigint.wac). `mulU64(this, v, scratch)` and `setSum(this, a, b)` both take a
`FixedBig` they must not be; `x.mulU64(v, x)` and `x.setSum(x, y)` compile and corrupt `x`
mid-operation, unchecked and unmentioned. Marking four of the five parameters `const` is legal today,
free, and worth doing — but it says *not written*, not *not the receiver*: `x` can be const-as-`a`
and mutable-as-`this` in one call with nothing relating the two, and `scratch` genuinely is written
so `const` cannot apply at all. The ask is aliasing, which is larger and less popular than anything
else on this list; recorded, not proposed.

**An invariant, not a precondition — and the cheap fix is also unavailable.** *"Limbs above `n` are
always zero"* is maintained by hand across thirteen mutators, and `shiftLeft` and `mulSmall` **read**
it rather than merely preserve it. Fifth thing here true of a value and unsayable about its type, and
the first that is an invariant: a smart constructor discharges a precondition once, an invariant needs
every method checked on exit. The smaller answer — make the fields private so there are thirteen
enforcers rather than unboundedly many — is also missing, because wac has no visibility inside a
struct. That is the likelier ask.

**And a cross-reference pointing at the wrong issue.** The header warns that *"two structs with the
same name in one program compile to invalid wasm"*, citing `issues/lang/closed/0006` — which is about
`break` in a `match` arm. The issue meant is `lang/closed/0041`, **which is closed and fixed**. Stale
twice. A mechanical check over every issue citation in `packages/*/src` and `tools/` says **856
citations, 852 good** — and **does not find this one**, because the number exists, in the right tree,
in the right state, and is about something else. Four it does find, all one-word fixes. Filed as
`issues/system/0356a`; the interesting half is what a structural check cannot see.
