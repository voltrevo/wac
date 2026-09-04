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

**Three spellings used here are not on the pages.** `held + chunk` for array concatenation,
`const i32 CHUNK = 4096;` for a module-level constant, and `Buf.pushScalar` — the first two are
language, the third is only a method somebody has to write.
