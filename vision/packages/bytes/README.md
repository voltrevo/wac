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
a prefix of it three times. Answering a `Bytes` is the same information with no copy. This is the
case `core/slice.wac` was written for, found after the fact rather than used to justify it.

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
