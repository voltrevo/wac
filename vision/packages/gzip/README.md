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
*allocation* per call, and the two agree: 2.6 ns for a fresh view on the v8 host, 45% of an eight-byte call and
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

**A struct the compiler may lay out inside one `i32`.** Added with
[`src/huffman.wac`](src/huffman.wac), which pulls the decoder out of `inflate.wac` and then declines
to change its fast table. `(len << 16) | sym` is the **fastest** of the four representations in
[`../../bench/dispatchcost.wac`](../../bench/dispatchcost.wac) — 65 ms against 72 for a three-field
record and 77 for three lanes — so the rewrite this directory has applied everywhere else would make
the hottest loop in the package 10% slower. wasm GC has no packed struct, so the type is the thing
that got dropped in exchange. Promoted to [`../../QUESTIONS.md`](../../QUESTIONS.md).

**Splitting the decoder out means splitting `BitReader` out, and the file cannot.** `BitReader` is a
`struct` inside `inflate.wac`, and `Decoder.decode` peeks, decides a length and skips exactly that
many bits — one mechanism in two types. Moving `Decoder` up to `huffman.wac` makes `BitReader` a
name two files need, so it must become a third file, and `./bits.wac` is invented. This is the
second time in this package: an earlier draft of `src/inflate.wac` imported `BitReader` from a
`./bitreader.wac` that was never there. **A struct declared inside its only user is invisible as a
dependency until something else wants it**, and nothing in the source distinguishes it from a module.

**A comparator cannot promise not to write.** `const` is deep in this language and travels through
fields, returns and copies, and `spec/spec/variables.md` records that *"there is nothing to write for
a funcref, whose type has no place for it."* That lands on `../../core/order.wac`'s `SortSpec` and on
every capability struct in the platform design. Promoted.

**What makes a method `async` is not always visible in the method.** Added with
[`src/bits.wac`](src/bits.wac). The shipped `BitReader` takes `fn[Read()]? source`, a synchronous
callback, so `peek` is a plain `i32`. This directory's `inflate.wac` already replaced pull sources
with `AsyncGenerator`, so the field's type changes, so filling awaits, so **six of eight methods
change colour and none changes meaning** — including `huffman.wac`'s `decode` and every caller of
it. Nothing became concurrent. The colour propagated *through the struct*, along a path no signature
mentions.

**`broken` is a status nobody checks, in the file that rejects `Result` for producing one.** The
shipped reader writes a host error message into a `string broken` field — *"so a caller can say why
it stopped"* — while `peek` goes on answering zero-padded bits indistinguishable from real ones, and
the closing comment of the same file refuses to return a status because *"a decoder that keeps going
after a failed read with a status nobody checked is how silent corruption is written."* Same design;
only the returned one can be made mandatory. The field has **two writes and zero readers** across the
repository — the one reader was deleted when its branch was shown unreachable, and the doc comment
stayed. Filed as `issues/system/0353a`. Also: `broken == ""` is a sentinel drawn from the value's own
range where `string?` would have cost nothing, a reference type having a null already — so unlike
`i32?`, this one was habit and not price.

**A prediction from shape, falsified within the hour.** [`src/huffman.wac`](src/huffman.wac) said
returning a `Result` would widen *"`BitReader`'s every method"*. It widens four of eight: `peek` and
`alignByte` are total, and `peek` is total **deliberately**, because a legal final code is shorter
than the lookahead window. The fault attaches to consuming, not to reading. Left in place and
corrected rather than edited away.

**A binding computed once, before `main` — the case `const` cannot reach.** Added with
[`src/crc32.wac`](src/crc32.wac). `crc32(data)` rebuilds a 2048-entry slicing table on every call
above a 512-byte threshold; [`../../bench/crcthresh.wac`](../../bench/crcthresh.wac) puts that at a
constant **3.9 µs per call at every input size, with no residual**, and shows the table path is
**1.7× slower than the bitwise path it just abandoned** at exactly the threshold. Eight times the
useful work for a 512-byte input. A `const` initialiser must be a compile-time constant expression
and this is two nested loops, so there is nowhere in the language to put the value. Filed as
`issues/system/0355a`; the language ask is promoted.

**Which makes the pair with `issues/lang/0354a` the finding.** That one says 658 constants spelled
as function calls should be `const`, and measures the cost of not doing it at **zero**. This one is
the same syntax gap costing 3.9 µs, because `const` inlines a scalar and cannot express a computed
array. *"Spell your constants `const`"* is correct advice that does not reach the one site where it
mattered — the second time today a measurement inverted the recommendation.

**`crc32Finish` is an involution and nothing says so.** `crc ^ 0xFFFFFFFF` twice is the identity, so
finishing a register twice returns the pre-inverted value: a `u32`, in range, wrong, silent. `Crc`
gives each phase its own type, which is the fifth time in this directory a phase error is fixed that
way — after the cursor, the bit reader, `Freqs` and `Table`.

**And a second implementation that is not a duplicate.** *"The bitwise one is kept because it is the
definition, and the tests check the table against it over random input rather than only against
fixed vectors."* `CLAUDE.md`'s *when nothing needs a thing, delete it* does not reach it, and it puts
this table in a better position than every other generated table in the tree: its contents can be
checked against a definition rather than against themselves.
