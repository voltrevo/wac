# rlp — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/rlp`: one file, 316 lines, the Ethereum execution layer's
serialisation. Two kinds of thing exist — a byte string and a list of items — and everything else is
length prefixes. Chosen because its header states a language limitation as the reason for its
central design, and because `abi` and `mpt` state the same one.

---

## The sticky error field, and the sentence that explains it

`decode` walks a recursive structure with a `Cursor` carrying an error string — **the shipped
package's own type, not `../../core/cursor.wac`'s**, which took the same name three days later and
has no error field at all — and the reason is written down:

> A struct rather than a return value threaded through every helper, because a failure has to stop
> the walk without unwinding — **wac has no exceptions**, and a recursive descent that returns an
> error tuple at every level is where the checks get dropped.

*wac has no exceptions* is **true** — checked against `spec/` today, along with sixty other claims of
that shape, and it is one of the ones that survives. What the shipped file did not have is `try`,
which is neither an exception nor a tuple: the propagation is one token per call, and a call whose
failure is not handled **does not compile**. So the thing the comment is afraid of stops being a
discipline and becomes a type error.

The cost of the sticky field, counted rather than described:

- `if (c.error != "") { … }` appears **five times** — an entry guard in `item`, twice after
  `longLength` in that same function, once after `item` inside `list`, once in `decode`.
- `item` needs an entry guard *at all* because it can be re-entered after a failure it cannot see,
  which is what an error channel the type does not mention costs.
- Each failure path has to invent an item to return, so `Item.Bytes(u8[0]())` is written **four
  times** as a value that means nothing and is never read. A function that must produce a value it
  does not have is a function whose return type is wrong.

## Two things wrong with a `string` error, and only one of them is the usual one

**The usual one.** Seven distinct rules, one type. The package's own README says the tests need them
apart — *"'one of twenty-six was accepted' is a bisect, `wrongSizeList was accepted` is a fix"* — and
gets it by naming the *fixture*, because the decoder's answer cannot say which rule fired. A
consensus client wanting to treat *ran off the end* differently from *not canonical* has the same
problem, and those are genuinely different: the first can be a short network read and the second is
a peer sending what no honest encoder produces.

**The one specific to this package: none of the messages says where.**

```
"a length prefix with a leading zero is not canonical"
```

In a 500-byte trie node with sixteen children, that is a sentence and a search. The cursor knows —
`c.at` is in scope on the line that sets the error — and the string does not carry it. Every member
of `RlpFault` here takes an `at`, and it costs nothing, because the position is already in the hand
that writes the fault. Worth separating from the first finding because the fixes are different and
only one of them needs a language feature: **the string could always have had the offset in it.**

Reordering one check buys a second number. `longLength` refuses a prefix of more than four bytes
*before* reading them, so its message says the same thing for 2^33 and for 2^63; reading up to eight
bytes into a `u64` first costs nothing — RLP's prefix is at most eight — and lets `TooLong` carry
what the input actually declared.

## The trap is in the wrong place

`bytesOf` traps for a list, and its doc is the best argument in the package:

> It used to answer the empty string for a list … `packages/mpt` had seven call sites that did not
> know, and each of them turned a list where the format requires a byte string into a *plausible*
> value. A list-valued leaf read as a present empty value, a list-valued branch terminal read as
> absence, a list-valued account balance read as zero.

Right about the empty string, and one step short. `Bytes? asBytes()` moves the assertion to whoever
is making it: a caller that knows writes `it.asBytes()!` and traps **on its own line**, and a caller
that does not writes a `match`. The shipped shape has the callee trap on the caller's behalf, so the
stack says `bytesOf` either way and the "check `isList` first" discipline is invisible at the site
that skipped it.

## What else changed

**`fromI64` becomes `fromU64`.** RLP has no negative numbers, so the trap on a negative guards a
value the type should not have admitted. Third instance in this exercise, after `tty`'s shift-shaped
byte count and `bignum`'s `shl(i32)`, and the cheapest of the three to fix.

**`Vec<Item>` replaces a doubling loop and a copy-down** — seventeen lines, and the fifth
hand-written grow this exercise has replaced. The original's reason for growing rather than counting
survives and is worth keeping: *"counting means decoding twice, and the members' lengths are only
known by decoding them."*

**`rlp` stops depending on `fmt`.** The import exists to build error strings with `itoa`; typed
faults carry numbers and whoever prints them formats them. A package dependency removed by making an
error a value.

## What could not be written

**`Item.Bytes(Bytes value)` is unwritable, so the variant is called `Str`.** RLP's two kinds are a
byte string and a list; the shipped enum is `Bytes(u8[] value)` and reads exactly right. Here the
payload is `core`'s `Bytes`, and the variant and the type would be the same name in one file. Second
collision in two packages — `tty`'s `Effect` wanted an arm called `Line` and the struct beside it has
the name — and **this one is worse**, because `tty`'s is between two of that package's own names and
either could move. This is between a package's natural vocabulary and a name `core` exports to
everybody. Promoted.

**A length-prefixed nested format is O(n·d) in both directions and there is no third option.** The
original copies every byte once per level of nesting, because a list concatenates what its children
built; this file walks every node once per ancestor, because a list asks each member how long it
will be. Neither is O(n). The O(n) answer is back-patching — reserve the header's space, write the
payload, fill it in — and a `Buf` cannot be written to twice.

The reservable-hole shape is writable (`i32 mark = out.hole(n)`, `out.patch(mark, bytes)`; an index
survives a reallocation where the `bytes()` view does not, which that method's own doc admits) —
**and RLP does not fit it**, because a hole needs a size and RLP's header is 1 to 9 bytes depending
on the payload it is measuring. The size of the hole is the unknown. A fixed-width prefix takes the
clean version; RLP is the format that does not. That is as far as this goes, and it is further than
"a `Buf` should be able to insert", which is the wrong request.

**The cursor's best operation is the one this package must decline.** *2026-09-05:* `decode.wac`
dropped its own `Reader` for `../../core/cursor.wac`, written the same day from a sweep of four
shipped byte readers. Three of that file's predicted costs came true, its member `Truncated` turned
out to be `core`'s `Overrun` field for field, and it caused one addition (`Cursor.need`). But
`Cursor.sub(n)` — a sub-cursor that **cannot** read past a length prefix, the thing that makes a
nested format safe by construction — is not used here, because it would make `ListOverrun`
unreachable: a member running past its list's declared end would come back as an overrun on the
inner cursor. RLP needs those apart, since one is a truncated network read and the other is an
encoder contradicting itself.

> **A bound enforced by construction cannot report which bound it was.** The same trade as trapping,
> from the other end: a stricter mechanism gives up the ability to say what happened.

The general question that leaves open is whose type `Cursor` is. It was derived from `tls`, `ssh`,
`fs` and `zstd`; of its eleven members this package uses six, declines two for reasons that are the
format's, and never reaches for three. **A sweep counts what exists and an adoption counts what is
used**, and there has been exactly one adoption.

**Two `try`s in one expression have no stated meaning.**
`Ok(Str(try c.take(try longLength(c, tag - 0xB7))))` is one line and two early returns,
and the second only runs if the first succeeded. `GRAMMAR.md` lists *`try` in expression position*
with two examples, both a single `try` at the head of a statement. Written nested on purpose rather
than split into locals, because the safe reading — left to right, short-circuit, outer construction
never started — is *what every other language with `?` does*, and that is the argument this directory
has refused elsewhere.

**Seven fault members share a field the type cannot say they share.** Every one carries `at`, which
is right, and a union of seven structs is seven declarations of it. An enum with a common payload, or
a `Positioned<T>` wrapper, would say it once — and the wrapper breaks `Err(is LeadingZero):`, since
the arm's type becomes `Positioned<LeadingZero>`. First place where two things this exercise has been
asking for pull against each other.

**A `Vec<Item>` inside a recursive enum is a struct in a cycle**, and the original's argument for why
`Item[]` is finite — *"an array is a reference"* — is about arrays. A `Vec<T>` holds one, so the
reasoning carries; nobody has written it down for the struct case, and it is the sort of thing that
is obviously fine until a compiler computes a size.
