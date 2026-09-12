# stream — rewritten

Written 2026-09-04, against coroutines, `union`, nested `T?` and `try`.

The real package is `packages/stream`: one file, 96 lines, two transforms. Read
[../README.md](../README.md) first — none of this is vetted, and it is a redesign rather than a
translation.

---

## What the original is

Each transform takes a `read` that hands back the next chunk and a `write` that takes output and
answers whether to keep going, and returns an `i32`: the byte count, `-1` for input that was not
text, `-2` for input that broke. Each carries its own `held` tail across chunk boundaries, and the
header says why that is the hard part.

## Half of this ships, and the half that does not is `yield`

Written against the original's callback pair, which was the wrong comparison for the same reason
`server`'s was: `async` and `await` are in production — `packages/tor/src/relayd.wac` runs async
pumps, landed 2026-08-30 — so *the transform is written as a straight loop and the language does the
suspending* is not a proposal.

Measured: a transform that awaits its source builds today.

```wac
async i32 total(fn[Pending<i32>()] next) {
  i32 n = 0;
  while (true) { i32 v = await next(); if (v < 0) { break; } n = n + v; }
  return n;
}
```

**So the line is exactly `yield`.** `async` lets a transform *consume* a stream. Only a generator
lets it *be* one — and that is what every claim below rests on:

- **`upperCase(scalars(src))`** needs `scalars` to be a source, not just a consumer.
- **Backpressure being the consumer's** needs the consumer to drive the producer, which is what
  stepping a generator is. With callbacks the producer drives and the boolean return is how it is
  told to stop.
- **The chunk boundary solved once** needs `scalars` to hand out one scalar at a time, which is a
  `yield` per scalar.

`gen` and `yield` are both in `../../GRAMMAR.md`'s list of what the syntax adds, and `yield` is there
because this package wanted it. What is *not* new is the awaiting, and this file claimed it.

## What changed, and what did the changing

**A transform takes a stream and is a stream.** No `read` to pull with, no `write` to push to.
Composition is `upperCase(scalars(src))` rather than two closures wired to each other by whoever
owns the loop. This is coroutines and nothing else — the transform is written as a straight loop
and the language does the suspending.

**Backpressure stopped being a return value.** `fn[bool(u8[])] write` answered whether to keep
going, and every transform had to thread that answer back out through a `going` flag. A consumer
that stops stepping the generator *is* the backpressure now, it needs no cooperation from the
transform, and it applies up the whole chain rather than one link.

**The chunk boundary is solved once.** `scalars()` turns a byte stream into a scalar stream, and a
scalar cannot straddle anything. `upperCase` has no `held`, no manual join and no tail — the
difficulty the original header calls out is not in this file. Adding a second text transform costs
a loop rather than another correct-by-inspection carry.

**Three outcomes in an `i32` became a `Result`.** `-1`, `-2` and *any other number* is the original
answer, and the header explains that `read()` answering `u8[]` could not tell end from failure, so
the function "used to return a plausible total for half a stream and the bridge closed it cleanly".
That is the bug the type now cannot express.

**A transform never names the source's failure.** `E` is whatever the stream fails with, passed
through untouched, and the answer is `union<E, NotText>` — the source's error set plus the one
thing this code can be wrong about. No caller writes `E`; it comes from the argument.

**`passthrough` has no body.** Copying a stream to itself is `src`. What it was really doing was
counting bytes and distinguishing a broken input from a short one, so it is `count` now.

## `try await for` checked against the lowering

The third proposal read against the machinery, after the two import ones and `Slice`, and the first
that came out stronger.

**A suspension inside a loop already lowers.** `packages/wacc/src/asyncplan.wac` is explicit that it
is designed for: *"an `await` inside a loop needs the loop's back edge as a state"*, and *"with loops
it cannot: a suspension inside a loop …"*. Measured too — an `async` function awaiting a capability
inside a `for` body builds today. So `try await for` needs no new lowering, only a desugaring.

**And the planner constrains what that desugaring can be.** It refuses `await` in an `if` condition,
a `while` condition, a `for` initialiser, condition or update, and nested inside a larger expression.
Stepping a generator is conceptually the loop's *condition*, which is exactly the refused position —
so the shape has to be

```wac
while (true) {
  Step s = await src.nextStep();     // in the body, because a condition may not suspend
  if (s is Done) { break; }
  u8[] chunk = s.value;
  …
}
```

**The loop variable joins the hoist list**, for the reason the planner already writes about the
induction variable: *"leaving it a plain local would reset it on resume — the loop would run its
first iteration for ever."* `chunk` is read after a suspension in exactly the same way.

So the cost is a desugaring and one more name in an existing hoist, against machinery that was built
for this. What is genuinely new in `try await for` is the **generator**, not the loop — and the
three keywords are still three keywords.

## What could not be written

**`for … in` has no failing form.** *Writing an iterator is writing a loop* says `for … in` steps
a `Generator<T, void>`, and a stream that can fail is a `Generator<T, Result<void, E>>`. There is
no loop for it. Letting `for … in` take any `R` and drop it would be exactly the thing
`vision/README.md` refuses — a convenience that is right in the common case and silently wrong in
the rest. So this file writes `try await for (u8[] chunk in src) { … }`, which does not exist. Every loop
here needs it, which is as strong a signal as this exercise can produce — and the `await` is not
decoration: these sources are `async gen`, so a plain `for … in` over one reads as synchronous and
is not.

**And `try` inside a generator has no stated meaning.** `try for` in an `async gen` propagates the
source's `Err` as *this generator's return value*, not as a yield. That reads as the only sensible
answer and it is written down nowhere.

**`decode` answers a sentinel drawn from its own range.** `s.code == -2` means truncated and
`s.code < 0` means malformed, in the field that otherwise holds a code point. `scalars` is written
against a `union<Scalar, Truncated, Malformed>` instead. That is a change to `packages/unicode`,
so the rewrite of one package immediately wanted a second.

It read as a `unicode` defect and sat here as one. It is the third instance of a shape `vision/std`
has twice — `In.read` says *end* with an empty array where `Socket.recv` says it with a sum — and the
one that shows it is not a question about capabilities: `decode` is ordinary code, and its sentinel
is a whole reserved *subrange* rather than one value. Promoted to
[../../QUESTIONS.md](../../QUESTIONS.md).

**Two spellings used here are not on the pages.** `held + chunk` for array concatenation, and
`Buf.pushScalar`, which is only a method somebody has to write.

**That last clause is wrong in an interesting direction, found 2026-09-04.** The shipped equivalent
exists — `Buf.pushCodepoint` — and it is not trivial:

> **Anything that is not a Unicode scalar becomes U+FFFD**: negative, above U+10FFFF, or in the
> surrogate range D800..DFFF, which UTF-8 cannot encode at all. **It used to encode them anyway** —
> `0x110000` produced a five-byte-shaped sequence and a surrogate produced the CESU-8 form that
> strict decoders reject — so a `Buf` could end up holding bytes that are not text.

Three classes of invalid input, a replacement rule, and a bug that had to be fixed before the rule
existed. *"Only a method somebody has to write"* is the same dismissal `@/packages/page` made about a
renderer and was wrong about for the same reason.

**And the name this file reached for is the better one, which is the finding.** A *codepoint* can be
a surrogate; a *scalar* cannot — that is what the word means in Unicode, and it is why the shipped
method has to check at run time what its name does not promise. `@/packages/unicode` here declares a
`Scalar` type, and `scalars()` above yields only that arm of `union<Scalar, Truncated, Malformed>`.
So `pushScalar(Scalar)` **cannot be handed a surrogate**, and the replacement rule that took a bug to
discover becomes unreachable rather than enforced.

That is one of the few places in this directory where the proposal deletes a runtime check instead of
losing one — and it happened by accident, because a file naming a method it never wrote happened to
name it after the type that makes the check unnecessary.

(`const i32 CHUNK = 4096;` was listed here too, and it was wrong: `spec/spec/grammar.md` has
`const_decl` in `program`, and it compiles today.)
