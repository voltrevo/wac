# zstd — nothing rewritten, and that is the finding

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/zstd`: 7,115 lines. **Nothing here is rewritten.** One file exists, and
it exists to hold a note about a struct in `src/sequences.wac`.

Reached by the same search as the last two — every mid-file doc comment of 150 words or more in the
un-rewritten packages, sorted. `Fused` is 224 words defending a *struct*, which is a different shape
from the parsers and validators the search has been turning up, and the difference is the point.

---

## The seventh thing left alone, and the first for a reason outside the language

`Fused` folds five arrays into two, and says why:

> Decoding one code used to be five loads … Three codes per sequence made thirteen loads to produce
> three numbers, and **the sequence loop is over half of decode time**. … Six loads per sequence
> rather than thirteen. This is what zstd's own decoder does.

A layout decision, measured, with a citation to the reference implementation. Nothing improves it.

The other six left alone were `json`'s lazy object index, `Buf`'s field layout, `regex`'s flat class
arrays, `bignum`'s `u32[]` limbs, `raster`'s pixel layout and `datetime`'s calendar. Five were
layout, one was *having no boundary to get wrong*. **This one is different: the shape is forced by
the runtime, and no language change reaches it.**

## The packing is a workaround for WasmGC, not for wac

`info` is three fields in an `i32`:

```wac
info[s] = (codeBits[c] << 24) | (t.nbBits[s] << 16) | t.newState[s];
```

with the proof that they fit in prose — *"extra bits reach 31 (offsets), state bit counts reach the
accuracy log of 9, and a next-state base is under 512."* Three widths, argued in a comment, checked
by nothing. Everywhere else in this exercise, that is the moment a type appears.

Here the type is **slower**. A WasmGC array of a struct is an array of *references*: one indirection
per read, in the loop this file exists to take indirections out of. An array's elements are packed
primitives or references and never inline structs, so there is no third option to reach for.

Which means [`@/packages/bls`](../bls/)'s trade does not transfer, and it is worth saying why, since
the two look alike. There the wrapper was one `struct.new` per *operation* — bounded at 0.7% by
numbers already in the tree. Here it would be one dereference per *read*: three per sequence,
thousands of sequences a block, in over half of decode time. **Same proposal, opposite answer, and
the discriminator is per-operation against per-access.**

## What could not be written

A language cannot make `Entry[]` fast — that is the finding above, and it is about WasmGC rather than
about wac. What could not be written is the packing **as a declaration**:

```wac
packed struct Entry { u8 extraBits; u8 nbBits; u16 newState; }   // lowers to one i32
```

The prose proof becomes the declaration, a fourth field cannot silently overflow into the third, and
`info[s] >> 24` stops being a number a reader checks against a comment four screens up.

**This is not `issues/lang/0074`.** That issue is values with no identity *exploded into locals* —
ChaCha20 at 4.7x, `packages/bls` at −64%, both from moving array elements into registers, with the
crux that *"the spec text has to say the compiler is required to keep these in locals"*. An array of
a hundred thousand entries cannot be in locals. Same want, different lowering, and 0074's answer does
not reach this case. Promoted to [../../QUESTIONS.md](../../QUESTIONS.md).
