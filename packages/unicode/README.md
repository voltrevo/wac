# unicode

UTF-8 as code points, simple case mapping, and whether a code point is printable.

```wac
import { Scalar, decode, isValid } from "../../unicode/src/utf8.wac";
import { toLower, toUpper, fold, foldEqual } from "../../unicode/src/case.wac";
import { isPrintable } from "../../unicode/src/printable.wac";

bool same = foldEqual("ΣΊΣΥΦΟΣ".toBytes(), "σίσυφος".toBytes());   // true
i32 lower = toLower(0x0130);                                       // İ has no simple lowercase
bool word = isPrintable(0x2014);                                   // true; U+2028 is false
```

## The tables come from the host

The host already carries a Unicode database — that is what `toLowerCase` consults — so
`packages/unicode/tools/gentables.ts` enumerates every code point, asks it, and emits `src/tables.wac`: three
sorted arrays of the ~1,450 code points whose mapping differs from themselves, and a binary search
over them.

Printability is generated the same way into a *separate* file, `src/printable.wac`. It is a
predicate that 292,464 code points answer yes to, so it is stored as 733 sorted ranges rather than as
entries, and `isPrintable` binary searches for the last range starting at or before the code point.

**The separate file is the point, not tidiness.** A constant array becomes one immutable global whose
initialiser lists every element, and every constant in a module is emitted once that module is
linked. While the ranges shared a file with the case tables, `box`'s `wc` — which wants printability
and no case mapping at all — carried their 8,790 entries: 503 KiB against 464 once they were
separated, for 12 KiB of actual table.

This is the same move as `packages/codec`, where RFC 4648's own vectors are the oracle: **derive
the data from the authority, then check the result against that authority from the other
direction.** It also means there is no `UnicodeData.txt` in the repo to go stale — regenerating is
`wac task gen:unicode`, and the tests fail if the generated tables and the host disagree.

Checking generated tables against the generator's source looks circular, and for the mapping
*values* it partly is — and where it was fully circular, it hid a wrong answer for a year. See
**Folding** below. What the tests establish beyond the values is not circular:

- **the lookup is right.** A binary search over 1,481 sorted pairs is exactly the code that is
  off by one at the ends, and the generator has no opinion about it;
- **the boundary is where it is claimed to be.** The test enumerates every code point the host maps
  to *more than one*, and requires simple mapping to leave each alone — rather than assuming there
  are none;
- **UTF-8 is right**, judged by `TextEncoder` and a `fatal: true` `TextDecoder`, neither of which
  the generator touched;
- **folding is right**, judged by a `u`-mode `RegExp`, which canonicalizes by simple case folding —
  a table the generator does not consult and cannot influence.

Every code point, 0 to 0x10FFFF, on every run.

## Simple mapping only

One code point in, one out. Full mapping — `ß` to `SS`, `ﬁ` to `FI`, the Turkish dotted and
dotless `i` — changes the length of the text and depends on locale and context. A function that
silently did some of that and not the rest would be worse than one that does none.

So where the host's mapping is more than one code point, the code point is left alone, and the
tests say exactly which ones those are.

## Folding is not case mapping, and the difference is one code point

The candidate for a fold is `lower(upper(x))` rather than `lower(x)`, and that much is not a
detail: Greek `Σ` lowercases to `σ` at the start of a word and `ς` at the end — a *contextual*
form — so a fold derived from lowercase alone leaves `ς` as itself and `ΣΊΣΥΦΟΣ` compares unequal
to `σίσυφος`. Going up first collapses both sigmas.

**But that is a candidate, not the answer.** Case mapping and case *folding* are two Unicode
tables, and `lower(upper(x))` gets one class wrong: `ı` uppercases to `I`, which lowercases to
`i`, so dotless `ı` and `i` came out equal — the exact Turkish conflation the paragraph above says
this package does not do. It said it in the same file as the code that did it.

Nothing caught it because everything asking the question asked it the generator's way. The test
asserted "two code points with the same uppercase fold together", which is the generator's rule
restated, so it could only ever agree; the random sweep used uppercase equality as its oracle, the
same rule again.

A `u`-mode `RegExp` canonicalizes by **simple case folding**, and is built from a different table
than `toLowerCase`. `new RegExp("\u{131}", "iu").test("i")` is `false`, which is the whole finding.
The generator now proposes `lower(upper(x))` and keeps it only if that oracle agrees, and the test
asks the oracle about every entry from both directions: every fold we perform is one the host
calls the same letter, and every pair the host calls the same letter folds together.

## UTF-8 is strict

An over-long encoding, a surrogate, or a value past U+10FFFF is a decoding **error**, not a
U+FFFD. The argument is `codec`'s: a decoder that substitutes turns "these bytes are not UTF-8"
into "these bytes are some other text", and two systems that both substitute disagree about what
the text was. `isValid` is checked against a `fatal: true` `TextDecoder` over hand-picked
malformations and 5,000 random byte strings.

`wac task coverage:unicode` reports 98%.

## What this closed, and what it did not

**`regex` now has an `i` flag**, agreeing with `RegExp` over ASCII. The folding is done at
*compile* time — each literal and class range is expanded to cover both cases — so the machine is
untouched and the hot path has no table lookup.

It is ASCII only, and that is a real limit rather than an oversight: `regex` matches **bytes**, so
folding a non-ASCII letter would mean folding half of a multi-byte scalar. The tables here are
what a code-point-aware matcher would use, and that is a different engine.

**`url`'s IDNA gap is still open.** UTS-46 needs a mapping table this could generate, but it also
needs NFC — see below.

## Not here yet

- **Normalization (NFC/NFD).** The host exposes `String.normalize`, so decomposition mappings can
  be generated the same way. What it does *not* expose is the canonical combining class, and the
  canonical ordering algorithm needs it. It can be derived — normalize pairs of combining marks and
  see which ones swap — but that is a real piece of work and an O(n²) derivation, not an
  afternoon. Nothing else here depends on it; IDNA does.
- **Full case mapping**, which needs one-to-many tables and a locale argument.
- **Compatibility normalization** (NFKC/NFKD), a much larger table for a much rarer need.
- **Character properties beyond printability** — category, script, `isAlphabetic`. Generatable the
  same way, and worth doing when something asks. `isPrintable` is here because something did:
  `box`'s `wc -w` counts a run as a word only if something printable is in it, and applying that to
  bytes cost 110 words on `spec/tour.wac` (issues/system 0143).

  It is defined as "assigned, and not a control, a surrogate, or a line/paragraph separator", which
  is `iswprint` in a UTF-8 locale. Checked against glibc's under `C.UTF-8`: over 1.1 million code
  points the two disagree on **5,185**, every one a character this host knows and that glibc's
  older Unicode calls unassigned, and **none** in the other direction. So it is never more
  permissive than the C library on this machine, and is ahead of it by exactly the characters
  added since.
