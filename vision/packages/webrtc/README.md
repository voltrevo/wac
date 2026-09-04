# webrtc — the one place a value type takes an operator away

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/webrtc`: 3,556 lines, and a live SCTP association against Chromium —
SDP, ICE, DTLS, DCEP, congestion control, gap blocks, Karn's rule, a three-chunk shutdown and an
ABORT path. Two files are written out. The rest is left where it is, which is the third time this
directory has reached that conclusion after [`@/packages/zstd`](../zstd/README.md) and
[`@/packages/tls`](../tls/README.md), and for the same reason: **the difficulty is the protocol, and
a protocol says the same thing in wac that it says anywhere.**

- [`src/tsn.wac`](src/tsn.wac) — a counter whose ordering is not the one `<` gives
- [`src/flight.wac`](src/flight.wac) — five parallel arrays and a count

---

## Every other finding here adds a check; this one removes an operator

SCTP numbers every DATA chunk with a 32-bit TSN that wraps, and `packages/webrtc/src/sctp.wac` gets
it right:

> TSNs are unsigned 32-bit and **wrap**, so `a < b` on the numbers is wrong twice over: held in an
> `i32` half of them are negative to begin with, and even unsigned the comparison inverts when a
> sequence crosses 2^32.

```wac
export bool tsnBefore(i32 a, i32 b) { return (a - b) < 0; }
```

Ten call sites on nine lines of one file, all correct — checked — and six of the ten are written
`!tsnBefore(…)`. At every one of them **`a < b` was available and would have compiled**, on a value whose type says nothing
about which comparison is right. The comment exists because the wrong one is one character shorter.

A `Rect`, a `Chunk`, a `Gindex`, a `Tile` — every value type this directory has proposed makes
something *checkable* that was not. `Tsn` does the opposite: comparison operators are not defined on
structs, so `a < b` on two `Tsn`s **does not compile**, and the only ordering in scope is the RFC's.

The generalisation is worth having. `i32` is not dangerous here because it is imprecise; it is
dangerous because **it comes with an ordering, and the ordering is wrong**. Any wrapping counter has
that shape — a sequence number, a version, a slot in a ring — and the language attaches wrapping and
the comparison operators to one type when they are two facts.

### And wrapping arithmetic is the feature here, in the one file where it is

`../../QUESTIONS.md` has *wrapping is the only arithmetic, and at 64 bits there is no way to notice*,
which is about a bug that hides. `tsnBefore` requires exactly that behaviour: the subtraction wraps
the same way the counter does, and a language that trapped on overflow would need a second spelling.
The entry cuts both ways and only one way was written down.

## Five parallel arrays, a count that is none of their lengths, and a compaction that copies five

```wac
i32[] flightTsn;   u8[][] flightPacket;   i64[] flightSentAt;
i32[] flightTries; i32[] flightMissing;   i32 flightCount;
```

The invariant is that the first `flightCount` entries of all five describe the same chunks in the
same order. It holds — the append writes five consecutive lines and the compaction copies five, and
both are correct. What it costs is that the compaction is five lines that must all be present, all
say `kept` on the left and `i` on the right. Omit one and that array is shifted against the other
four from then on: one chunk's TSN beside another's retransmission count, no crash, no wrong length,
and an association that resends the wrong thing or takes an RTT sample it should have discarded under
Karn's rule.

A sixth field would be six lines. **The rule against parallel arrays is not that they are ugly; it is
that the cost of the invariant grows with the number of fields and is paid somewhere else.**

## What could not be written

**A bounded `Vec`.** The shipped `noteSent` opens `if (this.flightCount >= this.flightTsn.len()) {
return; }` — the arrays are fixed and a full flight silently drops the record of a chunk that was
sent. A `Vec` removes that by growing, which is *not obviously* an improvement: an unbounded
in-flight list is a memory ceiling removed rather than a bug fixed, and the congestion window is
what is supposed to bound it. Nothing in either version says which of the two is the limit that
matters, and the shipped one at least has a number.

**`i32 haveCumulative` and `i32 shutDown` are booleans.** `Association` has `bool established` four
lines from `i32 haveCumulative`, and `bool closed()` is `return this.shutDown != 0;`. Not a language
gap — `bool` is in the same struct — and worth a line only because it is *a closed set spelled as an
integer* at the two-element case, in a file that spells it correctly elsewhere.

**`u16` is a scalar here and the primitive table has no row for it.** The same absence measured for
`u8` — sixty-one scalar uses against a table that lists `i8` and `i16` as *array element only* and
omits `u8` entirely. `Ssn` is the first `u16` written as code here — the only other mention is inside
a *proposed* `packed struct Entry` in `@/packages/zstd/src/sequences.wac` — so it is one more row
rather than a new question.

**Nothing stops `Tsn(0)`, and that is why this file is short.** Any 32-bit value is a legal TSN, so
there is no validity check to write and no constructor to hide — the difference between this and
`@/packages/ssz`'s `Chunk`. A wrapper that buys only the operator removal has one method, and it is
still worth having, which is the smallest useful version of the claim this whole directory is making.
