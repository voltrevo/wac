# bytes — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/bytes`: 364 lines over two files. Only `Buf`'s answer types changed —
its shape is performance work and stays.

---

## `bytes()` was a copy, and `server` paid for it per request

`Buf.bytes()` answered `u8[]`, and `data` is over-allocated, so it had to copy the filled prefix out
on every call whatever the caller did next. `server`'s connection loop calls it once per pipelined
request:

```wac
match (serve(pending.bytes(), sys.now())) { … }
```

so a client sending three requests in one packet paid for three copies of the whole buffer, to read
a prefix of it three times. Answering a `Bytes` is the same information with no copy — one small `struct.new` in place of a
copy of the whole prefix, since a struct is heap-allocated and a slice is not free. This is the case
`core/slice.wac` was written for, found after the fact rather than used to justify it, and it is the
one where the trade is most clearly worth it: the thing avoided grows with the buffer and the thing
paid for does not.

**And the honest part: the view has a hazard the type does not carry.** `reserve` replaces `data`
when the buffer grows, so a `Bytes` taken before a `push` points at the old array — stale rather
than unsafe, since the collector keeps it alive. Nothing in the signature says *read this before you
write again*. That is why `take` still exists and still hands over an array: when a caller is going
to keep the bytes, it should own them.

## `slice.wac` is deleted

It held `slice(u8[] s, i32 lo, i32 hi)`, which **copies** — the function `core/slice.wac` replaces
with a view, and the reason every parser in the tree was passing triples in the first place. The
barrel does not offer it and nothing here needs it.

## Two smaller ones

**`push` takes a `u8`.** It took an `i32` and truncated, and every call site was already handing it
a byte.

**`get` traps with a message.** The original writes bare `trap;`, which carries nothing — and a
buffer read is the least helpful place in a stack to arrive with no message.

## What could not be written

**Nothing new.** `trap "message";` is not a gap — `spec/spec/grammar.md` has
`trap_stmt = "trap" , [ expr ] , ";"` with *the expr is a string message*, and it compiles today.
This file had it as `trap("…")`, which is neither the spelling nor a missing feature.

What is genuinely missing is `trap` as an **expression** — `core/result.wac` wants one as a match
arm's value, which needs it typed `never` so the arms unify.

**And two things found on 2026-09-05, after `issues/lang/0347a`.**

`Buf` gained `pushStr` and `str`. The shipped one has `toStr` — two lines, `string.fromBytes(bytes())`
— and nothing in the other direction, and this rewrite had dropped `toStr` as well, so vision's `Buf`
had neither. What that costs is counted: **257 string accumulations inside a loop** across the
package sources and `tools/`, 142 of them in `packages/wacc`, each `out = out + …` where `+` on
strings is a call to the runtime's ` str_concat` and allocates the combined length.

**`pushStr` still copies, and that is the language part.** A `string` is an `i8[]` at the runtime and
`Bytes` is `Slice<u8>`, so no view spans them — `packages/wacc/src/emit.wac`'s `emitBytesCopy` exists
for exactly this and says so: *"`string` and `u8[]` hold the same bytes and are different types, which
is why this is a copy and not the no-op it looks like."* So a builder makes the accumulation linear
instead of quadratic and cannot make it free, and the third thing in the missing-features line is not
the builder at all.

**And `pushDecimal` was dropped too, which makes the pattern.** 0347a's 257 is a floor: the count
sees `x = x + …` and not `x = … + x`, and the second is what a hand-written integer-to-string is,
because digits come out least-significant first. Sixteen more, eight of them a digit loop — and a
`Buf` cannot help a prepend at all, since it appends and a prepend needs a reverse. The answer is
`pushDecimal`, which the shipped `Buf` has and eight files ignore, one of them `packages/fmt`.

So this rewrite had removed **both** methods the shipped tree's largest string duplication needs, and
neither removal was noticed until somebody counted the shipped tree rather than reading this file.
**A rewrite drops what its own callers did not happen to want** — which is the cost of choosing a
surface from a sample of use, and is the first time in this exercise the sample has been shown to be
the thing that was wrong.

**A doc comment cannot contain a path pattern, and cannot describe the rule that says so.** Writing
the count above broke `src/buf.wac` twice: once because a glob contains a star and a slash in that
order and ends a block comment, and once because the sentence explaining that quoted the closing
delimiter. The first is a nuisance a checker could catch; the second is why the rule keeps being
rediscovered, since the natural place to write it down is the one place it cannot be written.
