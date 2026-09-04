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

So `itoa64` and `utoa64` exist twice, in `packages/fmt/src/itoa.wac` and
`packages/wactest/src/itoa64.wac`, and the duplicate survives because moving it touches forty files.
Everybody agrees it is a duplicate. The language has no way to say *this name is also available
here*.

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
