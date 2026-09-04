# regex — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/regex`: 1,545 lines over five files. `compile.wac`, `basic.wac` and
`posix.wac` are the pattern parser and are not rewritten — the syntax of a regex did not change
because the language did.

---

## The decision that was to leave something alone

`Program` holds every character class's ranges in flat parallel arrays — `classLo`, `classHi`,
`classStart`, `classCount`, `classNeg` — and the original explains itself:

> because wac has no generics-free way to hold a list of structs without writing the container
> again, and the ranges never need to be addressed as a group

That reads like a language gap, and after seven wrong claims of exactly that kind this exercise
checked instead of assuming. **`Vec<Range>` compiles today** — three lines, measured. What the flat
pair actually buys is not expressiveness but layout: a `Vec<Range>` boxes a struct per range, in the
inner loop of a matcher. So it is a representation choice, a rewrite that tidied it would be slower,
and it stays.

Third time the answer was to leave something alone, after `json`'s lazy object index and `Buf`'s
field layout. **A comment that reads as a workaround is worth checking before it is treated as one**
— and this one is written in the language of a limitation.

## Three outcomes, and why they stay three

`search` returns an `i32`: the match start, `NO_MATCH` at `-1`, or `BUDGET` at `-2`. Its comment is
already right about the design —

> which is deliberately not the same answer as "no match", so a caller can tell a refusal from a
> result

— and the encoding is what puts that one careless `>= 0` away from being lost. It is an
`enum Searched { Found(Match), None, Budget }` now.

Collapsing to `Result<Match?, Budget>` is available and is the wrong shape, for the same reason
`http`'s `Parsed` keeps three cases: *no match* and *gave up* are both "no result", so sharing a
constructor lets a caller handle one and silently treat the other as it. Which is the bug the
original's comment exists to prevent. Twice now the redesign's pull toward `Result` has been wrong
in the same way.

## What else changed

**Thirteen `OP_*` became an enum with payloads.** They were `export i32 OP_CHAR() { return 0; }` —
functions returning literals, numbered by hand, in a file whose other integers are program counters
and capture slots. The payloads move with them: `Split(i32 first, i32 second)` instead of an `a` and
a `b` field on every instruction whatever it is.

**`WordBoundary` stopped being four meanings in an operand.** It was `a: 1 \b, 0 \B, 2 \<, 3 \>` in a
trailing comment, with `0` for the negated case, so a zeroed operand reads as `\B` rather than as
nothing.

**Captures come back instead of going in.** `search` took an `i32[] caps` for the callee to fill and
the caller had to size it with `slotCount(p)`; too short and the fill runs off the end of what it
was given. A `Match` holds the whole span and a `Vec<Span?>` of groups, where the `?` says what
`-1`-in-an-`i32[]` was saying in the same range as a position: a group that did not participate is
not a group that matched empty.

**`Program? compile` became `Result<Program, PatternFault>`.** One null for six distinct ways a
pattern is malformed, in a compiler that knows which one it hit. A caller reporting *bad regex* to
someone who typed `[z-a]` is the cost.

## What could not be written

**Nothing new.** Every construct this package wanted — an enum with payloads, `Result`, `T?`,
`Bytes`, a barrel — is already filed or already invented. The tenth package produced no new hole,
which is the second time that has happened and is the clearer signal now than any individual
finding.
