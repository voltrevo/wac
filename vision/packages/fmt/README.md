# fmt — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/fmt`: 1,195 lines over four files. `atof.wac` and `bigint.wac` are
arithmetic and are not rewritten — the algorithms did not move because the language did.

---

## This package was chosen because vision contradicts it on purpose

`itoa.wac`'s header opens:

> wac has no number-to-string conversion and `string + i32` is **deliberately** a compile error.

And `vision/IDIOMS.md`'s *A number in a string* says:

> Interpolation is sugar for `+`, and `+` takes the scalars. No formatting language: what may appear
> in the braces is whatever `+` accepts.

**Those cannot both hold.** Whoever wrote the header made a decision and wrote *deliberately* into
it; the interpolation entry reverses it, and the entry has never been discussed against the reason.
That is not an argument that the entry is wrong — this file assumes it and is better for it — but
a reversal should know what it is reversing, and I could not find the reason recorded anywhere. It
is worth asking before the entry moves any further.

**And it decides something the entry does not mention.** If `\{x}` is `+`, then `"\{0.1 + 0.2}"` is
`"0.30000000000000004"`, because that is the shortest decimal that reads back as the value. It is the
honest answer and the right one for a log line — a shorter one would be a different number. It is
not what somebody writing `"total: \{amount}"` expects, and *no formatting language* means there is
no second spelling for them to reach for. That may well be correct; it has not been said out loud.

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

**`LIMBS()` is a module constant** rather than a function returning `40`. Fourth package.

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

**A span is still three arguments.** `atofSpan(u8[] src, i32 start, i32 end)`, and `packages/bytes`
has a `slice` function that copies. Nothing on the pages proposes a slice *type*, and every parser
in this rewrite — `json`, `http`, `url`, `fmt` — passes `(bytes, lo, hi)` triples around instead.
Four packages is enough to say it is a pattern rather than a habit.
