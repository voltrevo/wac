# codec — two closed sets spelled as `i32`, holding the same two values

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/codec`: RFC 4648 base16, base32 and base64, 365 lines in three files,
checked against the RFC's normative §10 vectors. It is strict where the platform is lenient and its
README argues that decision better than most specifications do.

- [`src/alphabet.wac`](src/alphabet.wac) — the six alphabets as one enum, and `Padding`
- [`src/rfc4648.wac`](src/rfc4648.wac) — one `encode` and one `decode`
- [`src/fault.wac`](src/fault.wac) — the five refusals the README documents as four
- [`src/codec.wac`](src/codec.wac) — the barrel

---

## The collision

```wac
base64.wac:15  export i32 ALPHABET_STANDARD() { return 0; }   // A-Za-z0-9+/
base32.wac:15  export i32 ALPHABET_STANDARD() { return 0; }   // A-Z2-7
base64.wac:17  export i32 ALPHABET_URL()      { return 1; }   // A-Za-z0-9-_
base32.wac:17  export i32 ALPHABET_HEX()      { return 1; }   // 0-9A-V
```

Two closed sets, both `i32`, the same two values, the same first name. So
`base64.encode(data, base32.ALPHABET_HEX(), false)` type-checks and produces base64url, and a caller
importing both files — which `@/packages/url` and `@/packages/http` both would — has four names in
scope holding two values between them.

`../../QUESTIONS.md` has *a closed set spelled as a string or an integer gives up a check the
language already makes*. This is the sharpest form of the consequence: not a value **outside** the
set, but a value from **another set** that happens to be the same integer. An enum per base would
fix the collision; one enum across the three fixes the argument as well, because there is no such
thing as base32 with a base64 alphabet and three `encode`s exist to enforce by separation what one
type enforces by construction.

## `encode(data, ALPHABET_URL(), false)`

The `false` is `pad`, and the call is the first line of the shipped README. A `bool` parameter is the
two-element case of the same entry, and this is where it costs most: the line a reader meets first is
the one that says least. `Padding.Unpadded` is not shorter and is not a proposal — the language has
enums and the package has integers.

## Fifteen exports become five

Three `encode`s, an `encodeUpper`, three `decode`s, a `decoded`, three `digitValue`s at two different
arities — `digitValue(i32 c)` in `hex.wac` and `base64.wac`, `digitValue(i32 c, i32 alphabet)` in
`base32.wac` — and four `ALPHABET_*`. One RFC, one construction at three widths: cut the input into
`bits`-wide digits and pad the last group. The three copies differ in the alphabet, the group size,
and nothing else.

## What the `null` was hiding

The shipped README lists **four** counts on which decoding refuses, and argues hardest for the
fourth: without the unused-bits check, *"`QQ==`, `QR==`, `QS==` and thirteen more all decode to `A` —
so a signature over the text says nothing about the bytes, and two systems can disagree about whether
two messages are the same. It costs one comparison."*

Four documented refusals, plus the undocumented obvious one — a character that is not a digit — and
all five answer `u8[]?`. A caller cannot tell *this is base64 and it is malformed* from *this is not
base64*, and those lead to different next steps. Third package in this directory to make that change;
what is different here is that the distinction the type was hiding is one the README spends two
paragraphs on.

## What could not be written

**Generalising the three replaced a table with a formula, and that is a real loss.**
`packages/codec/src/base32.wac` has `PAD_FOR` and `DIGITS_FOR` indexed by leftover bytes, and says
why: *"Those numbers are not a pattern anyone remembers, so they are a table rather than
arithmetic."* RFC 4648 §6 states those four numbers **in a table**, so a reader checks four lines
against four lines. `Alphabet.groupDigits()` computes them, and a formula agrees with the RFC or does
not, all at once.

Both decisions are right and neither is a spelling. The shipped one optimises for the check a person
can perform; this one optimises for there being one implementation rather than three. The deciding
fact is *which document the code is checked against*, which nothing in a signature can carry — and
every *"a table rather than arithmetic"* in this repository is the same bet.

**`Alphabet.digit(v)` takes an `i32` in `0 .. 2^bits` and the bound depends on the receiver.** Not a
type any parameter could have. The shipped code has the same hole and hides it better, because a
per-base function has a per-base range a reader can see — the generalisation's cost in a second
place, and *where does a refinement of an integer live?* again.

**`Padding` means nothing at base16 and the type cannot say so.** `Padded` and `Unpadded` produce
identical output for `Base16Lower`, because a byte is exactly two digits. Nothing rejects it and
nothing warns. The shipped per-base signature gets this right by construction and pays for it three
times over — which is the honest summary of the whole rewrite, not just this line.

**The enum has six variants and the RFC has five sections.** `Base16Lower` and `Base16Upper` are both
§8, which defines base16 as *uppercase*; the lowercase variant exists because `hex.wac`'s `encode`
uses `lowerDigit` and its `encodeUpper` is the RFC's. So the type encodes what the package does rather
than what the RFC says, in the one place they disagree. Naming them for the RFC would have hidden a
real behaviour, which is worth knowing before the next enum is named after a specification.
