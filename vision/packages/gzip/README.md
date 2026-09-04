# gzip — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/gzip`: 2,029 lines over seven files. `inflate.wac`'s surface,
`window.wac` and a fault set are written out; the Huffman decoder, the bit reader and the whole
compressor are unchanged and not copied here, because nothing in this proposal touches them.

---

## Why this package

Because its own issue names the construct.

`issues/system/closed/0102` is about `gunzipStream` promising a report it cannot deliver — a caller
cannot tell a failed disk read from a corrupt archive, both arrive as a trap. It closed on the
smallest honest move, withdrawing the promise, and then wrote down what a real fix would take:

> **`inflateInto` returns a result rather than trapping on a source failure only** — corruption keeps
> trapping — and every read site propagates it. That is a refactor of the decode loop, not a line.
>
> Not trapping means threading a status back through every symbol read. A decoder that keeps going
> after a failed read with a status nobody checked is how silent corruption gets written, and this
> file decodes other people's bytes.

Both sentences describe `try`. The threading is what `try` *is*, one keyword per site; and a status
nobody checked is not expressible, because a discarded `Result` is a type error rather than a
missing `if`. **The refactor `0102` sized as a refactor is `try` in front of eleven calls.**

**It does not reopen the issue**, and saying so is the point. `0102` was decided on *"it should be
done for a reason better than closing an argument about an unreachable branch"*, which is about
whether the work is worth doing and is untouched by any of this. What changed is the price — and the
price is what the issue wrote down as the obstacle. That is a narrower claim than *vision fixes this*
and it is the true one.

## What changed

| shipped | here | why |
|---|---|---|
| `gunzipBytes` and `gunzipStream` | one `gunzip`, and a four-line `gunzipBytes` calling it | a buffer is a one-chunk source |
| `fn[Read()] read`, `fn[bool(u8[])] write`, `i32` status | `async gen<Bytes> Result<void, Fault>` | two callbacks and a status are one signature |
| trap on corruption, trap on a source failure | `Err(Corrupt)` and `Err(SourceFailed)` | the distinction `0102` is about |
| `emit` allocates and copies 96 KiB | `take` answers a `Bytes` view | one allocation per 96 KiB is free |
| absolute positions and `i32`s in the match loop | **unchanged** | measured; see below |

## What it cost, which a rewrite that only lists wins is not measuring

**The buffer path loses its pre-sizing.** The shipped README says the trailer is *why* there are two
entry points: a buffer decode reads CRC and length from the last eight bytes before it starts and
allocates the output once, at the right size. A generator has no last eight bytes until it reaches
them. Collapsing the two entry points throws that away, and `gunzipBytes` here grows a `Buf`.

Recoverable, but by the caller: a program holding the whole member can read its own trailer and
size its own buffer. The knowledge was never the decoder's — it was the decoder's *because* the
decoder owned the allocation.

## The trap is argued two ways and only one survives

Worth separating because the file and the issue give different reasons for the same line.

The **file** says safety: *"returning data that failed its own checksum would defeat the point of
carrying one."* That does not distinguish a trap from a `Result`. A caller cannot reach the bytes
inside an `Err` any more than it can reach past a trap, so `Result<Bytes, ChecksumMismatch>`
withholds exactly what the trap withholds.

The **issue** says cost, and that one was real: the risk is a status threaded by hand and not
checked, which is a property of the threading rather than of the return type.

So with `try` the surviving argument is the one that goes away, and this decoder returns a fault for
corruption too — with `Corrupt` as a distinct arm, so a caller that wants the shipped behaviour
writes `r.orTrap("corrupt gzip member")` and has chosen it.

## A view type, offered and declined, on a number

The first time that has happened in this directory.

`window.wac` is where a sliding window meets `Slice<T>`, and every instinct says this is what a view
type is for. The shipped file already knew otherwise from the other side:

> `push` runs once per byte of output, so anything it does per call is the cost of the decoder.
> Wrapping a `Buf` put a second call in that path and measured **14-23% slower** on a whole-buffer
> decode.

That measures a *call* per byte. [`../../bench/slicecost.wac`](../../bench/slicecost.wac) measures an
*allocation* per call, and the two agree: 2.6 ns for a fresh view, 45% of an eight-byte call and
nothing at a kilobyte. **A DEFLATE match is 3 to 258 bytes and mostly short.**

So the rule, which is general rather than about gzip: **a view for what leaves, indices for what
stays.** `take` hands over 96 KiB and a view there is strictly better than the copy. `push` and
`pushMatch` take `i32`s and always will — not pending a better compiler, because the allocation is
per call and the benefit is per byte and this loop's calls are short.

**A proposed type that a package declines is a result about the type.** It also answers something
`slice.wac` left open: that file concluded the case for a slice is correctness rather than cost, and
correctness is exactly what indices into one private array, never handed out, do not need.

## The new failure mode, which is the opposite of the one that was written down

Taking the copy out of `emit` introduced a bug, in the first version of this file, and the bug is
the finding.

`take` returned a view of `data[0..n]` and then compacted — `copyFrom(data, n, 0, keep)` — in the
same call. That overwrites the array the view points into, so the caller got 96 KiB of the *next*
window's bytes. Silently: right length, right type, and the first 32 KiB even look plausible.

The shipped code cannot have this bug, and not because it is more careful. It copies, so nothing
aliases `data` and there is nothing to invalidate. **The safety is a side effect of the cost.** Take
the copy away and an aliasing rule appears with nothing in the type system holding it.

`slice.wac` has a section on when to hold a view and it is about the *other* failure: retention,
holding a megabyte to remember six bytes. This is the mirror image — not keeping something too long
but overwriting it too soon — and it is not in that file's list. **A view type has two failure modes
and the vision page names one.**

What fixes it is worth more than the bug. The compaction moves into a separate `released`, called
after the `yield` returns, and **a coroutine is what makes that a rule rather than a hope**: the
caller holds the chunk for exactly as long as the machine is suspended, and a resumed generator is a
place where the chunk is provably finished with. A callback pair has no such point — `sink(out)`
returns before the callback's caller is necessarily done with the bytes — so the shipped design
could not have taken this route even if allocation had been what it cared about.

## What could not be written

**`try` inside a generator, and what the consumer sees.** `gunzip` is `async gen<Bytes> Result<void,
Fault>` and its body writes `try await br.byte()`. So a `try` inside the machine ends the machine and
becomes its *return*, which the consuming `try await for` then propagates in turn. Two `try`s at two
levels for one failure. That has to be what happens, and nothing in `vision/` says it — the
coroutine entries are about `yield` and the ticket, and `try`'s rule is about a function's error set.
A generator has both a yield type and a return type and the interaction is unwritten.

**A one-chunk source.** `gunzipBytes` needs `AsyncGen.of(gz)` — a generator over one value already in
hand. Trivial to write and absent from `vision/core`, which is a gap in the barrel rather than in the
language, but every collapse-two-entry-points argument in this directory needs it.

**`return Ok;` with no payload.** `Result<void, Fault>` relies on `0014` D5, *"`void` becomes usable
as a type argument"*, and then on `Ok` being writable with nothing in it. D5 gives the first; the
second is a spelling nobody has chosen. `Ok(void)` and `Ok()` are both worse.

**Whether the tail should be emitted before the checksum is checked.** This one does, so a caller
that traps on the fault has still seen every byte the member contained; the shipped decoder traps
with the tail unemitted. It is only defensible because the fault is the *return* and a caller cannot
finish the loop without meeting it — which is an argument that depends on `try await for` binding the
generator's return, i.e. on the first item above. Flagged rather than settled.

**`zstd` has the same shape**, which `0102` item 4 already says: `packages/zstd/src/stream.wac` traps
on `Read.Failed` with no `broken` equivalent at all. Everything here applies to it unchanged, and it
is not rewritten because it would find nothing new.
