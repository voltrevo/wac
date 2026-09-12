# datetime — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/datetime`: 270 lines over two files, the proleptic Gregorian calendar
and RFC 3339 timestamps. `civil.wac` is **not** rewritten and that is the finding about it; almost
everything below is about one distinction the parser could not carry, and the five things that grew
out of it.

---

## The distinction that was lost, patched, probed, and lost again

`Parsed` is `(bool ok, i64 millis, i32 offsetMin, bool offsetKnown)`. The fourth field's doc says
why it exists:

> RFC 3339 §4.3 gives `-00:00` a meaning of its own: the instant is known and the local offset is
> *not*. `Z` and `+00:00` both assert an offset of zero. **All three arrived here as
> `offsetMin == 0` and were indistinguishable**, so the one piece of information this field exists
> to preserve — the offset as written, because it cannot be recovered from `millis` — was exactly
> the piece lost.

A `bool` beside the `i32`, to carry a third case the `i32` could not hold. Then:

1. **A struct cannot cross the host boundary**, so `test/probe.wac` exports one function per field:
   `accepts`, `parseMillis`, `parseOffset`, `parseOffsetKnown`.
2. **Each has to invent a value for a failed parse.** `parseMillis` and `parseOffset` answer `0` —
   `return p.ok ? p.offsetMin : 0` — and for `parseOffset` that is the same `0` that `+00:00` gives.
   The distinction of step one, reintroduced one layer out.
3. **`parseOffsetKnown` answers an `i32`**: `-1` for *did not parse*, `1` and `0` for the bool. A
   two-valued answer became three-valued with a sentinel, because a `bool` had nowhere to put a
   failure.
4. **And nothing called it.** From the package README:

   > `wac task coverage:datetime` reports 100% — and did not when that line was last checked. It said
   > 92% … **neither of them ever called `parseOffsetKnown`** — a probe export written for GitHub
   > wac-mono#15, with a nine-line rationale on the field it reports, called by nothing.

Every link is a local decision that is hard to argue with on its own. What the chain shows is that
**a distinction lost at the bottom is re-lost at every layer that tries to carry it**, and the bill
arrives as fields, exports, sentinels and a coverage number that was wrong for months.

`enum Offset { Utc, Unknown, At(i32 minutes) }` removes the first two links. The rest are the host
boundary and are untouched — said plainly in `rfc3339.wac` rather than left for a reader to notice.

## Eighteen rejections, one `false`

`parse` is a 74-line function with eighteen `return bad;` in it, where `bad` is
`Parsed(false, 0, 0, true)` and the doc says *"the fields are then meaningless"*. The tests
distinguish them the only way left: forty malformed fixtures, named. Third package with this shape
after `rlp` and `abi`, and one member here carries more than a message.

**`LeapSecond` is the change with the most in it.** The shipped package rejects `:60` too, and
argues the decision at length:

> Representing one faithfully needs a leap-second table, which is maintained by hand, goes stale, and
> would have to ship with the package. The alternatives are worse: mapping `:60` onto `:59` makes two
> distinct instants equal, and mapping it onto the next second makes a timestamp that is not what was
> written. **Rejecting says so at the point of use.**

Every word right about what the *package* should do, and one step short. Rejecting says so at the
point of use only if the point of use can hear it — and `ok: false` is the same answer as a stray
comma. A caller reading a log written by something that emits leap seconds has to pick one of the
three bad options that README lists, and cannot tell it is facing the choice.

As a named member the package still refuses and the decision moves to whoever has the context. Same
argument as `abi`'s fault union, and stronger: there the disagreement was between two other
implementations, here it is written into this package's own README as three options and a regret.

## What else changed

**A cursor, so an offset is a position.** The shipped parser's `at` is a mixture — `s[4]`, `s[7]`,
`digits(s, 11, 2)` are literals because the prefix is fixed width, and a running cursor appears once
the fraction starts. Both are correct and a reader cannot tell, at `s[16]`, whether 16 is a position
or a length. `Scan` makes them one kind of thing, and `try` lets each step answer a fault instead of
falling through to the eighteenth `return bad`.

**`digits` answers `Result<i32, TimeFault>` where it answered `-1`.** The sentinel was safe — digits
are non-negative — and it is the fourth package running.

## `civil.wac` is not rewritten, and that is worth a line

74 lines of Hinnant's algorithms: shift the year so March is month 0, which puts the leap day at the
end and makes the month-length pattern one linear formula instead of a twelve-entry table with a
special case. No tables, no loops, exact for any year an `i32` holds including negative ones.

Nothing in this exercise applies to it. **Sixth time the answer was to leave something alone**, after
`json`'s lazy object index, `Buf`'s field layout, `regex`'s flat class arrays, `bignum`'s `u32[]`
limbs and `raster`'s pixel layout — and the first where the reason is not a performance argument.

The reason is worth having: it is the only file in this exercise whose **input is already validated
by its own caller and whose output is total**. Every other package's difficulty has been at a
boundary — bytes from a stranger, a schema from a call site, a capability from a host. A pure
function over three integers has no boundary to get wrong, and the six packages this directory has
left alone are not a coincidence: five were about layout and this one is about not having a
boundary at all.

## What could not be written

**Six of this file's sixteen `try`s are statements, and no page states that form.**
`try c.expect('-');` has no value and exists entirely for the early return.
[../../GRAMMAR.md](../../GRAMMAR.md)'s two examples are both `x = try f()`, where the unwrapped value
is the point; here there is none, and `try` is *check or propagate*.

Second unstated thing about `try` in two days, after `rlp`'s two in one expression, and they are the
same gap from opposite sides: **`try` is documented as an expression, and a third of the uses in the
first parser to need it have no slot to be an expression in.** Promoted, with the narrower question
it raises — what `Result<void, E>` is, since `Ok` at `T = void` is a variant whose payload is
nothing and no page says whether `return Ok;` spells it.

**The offsets in the faults are literals, and the cursor knows them.** `OutOfRange(11, hour, 23)`
says *hour, at byte 11*, and 11 is a constant because the prefix is fixed width — which is the thing
`Scan` was supposed to end. The honest version has `digits` answer where it read from, which means
every step answering a pair, which is a tuple. `issues/lang/0074` is open and
[../../QUESTIONS.md](../../QUESTIONS.md)'s first entry is why. So the faults carry a position that is
correct and is written twice: once by the grammar, once by hand.

**A `Timestamp` cannot cross to a host and neither can a `Result`.** The chain at the top is what
that produced in the shipped package, and this rewrite does not touch it: `parse` answers a
`Result<Timestamp, TimeFault>` and a host still gets an `i64` at a time. `@/packages/bignum` met the
same wall — *"it is a GC reference and cannot cross the bindgen boundary"* — and concluded that the
constraint had produced a good test design. Here it produced four exports, three invented failure
values and a probe nobody called, which is the other outcome and the one worth having beside it.
