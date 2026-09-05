# 0357a — `pack.wac` copies every compressed object to bound it, and the bound it needs is already imported

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** performance
- **Symptom:** an allocation and a full copy of every compressed object on every read, plus a field and a binary search that exist only to enable them

Two paths in `packages/git/src/pack.wac` need the same fact — where an object's compressed bytes end
— and answer it two different ways. One of the answers stopped being necessary and was not removed.

## The two sentences, in one file

The header:

> Nothing in the object header says how long the compressed bytes are, and `packages/gzip`'s
> `inflate` does not report what it consumed. So an object's stream is bounded by **the next object's
> offset**, taken from the index — which is why `openPack` sorts the offsets and keeps them.

Line 329, in the section that indexes a pack arriving without one:

> because nothing records where each object's compressed bytes end, ask the inflater.
> `packages/gzip`'s `inflateAt` reports that, which is **the export this needed and the reason it
> exists**.

`inflateAt` was added for the path with no index to consult. The path that *has* an index was never
migrated, and the header still states the limitation as current.

    packages/gzip/src/inflate.wac:678
    export struct Inflation { u8[] bytes; i32 end; }   // "the offset just past the stream's last byte"
    export Inflation inflateAt(u8[] data, i32 start)   // "Inflate the stream at start, and say where it ended"

Both are imported at `pack.wac:41`.

## What the un-migrated path costs

`Pack` carries a third field for it:

    export struct Pack {
      u8[] bytes;
      PackIndex idx;
      /** Every object's offset, ascending — what bounds each compressed stream. */
      i64[] byOffset;
    }

`endOf` at `:142` binary-searches it for the next offset above a given one. `rawAt` at `:193` calls
that, then:

    u8[] slice = u8[upto - from]();
    for (i32 i = 0; i < slice.len(); i++) { slice[i] = p.bytes[from + i]; }
    u8[] data = inflate(slice);

So reading one object allocates an array the size of its compressed form and copies into it, because
`inflate` takes a whole buffer and the bound has to be applied by slicing.

`inflateAt(p.bytes, from)` needs none of it: no copy, no allocation, no search, no field, and no
sorting of the offsets in `openPack`.

## Scope, checked rather than assumed

- `endOf` has **exactly one caller**, `:193`.
- `byOffset` is read **only** by `endOf`.
- `packages/git/src/receive.wac` also declares an `endOf` — a different function over a pkt-line
  payload, unrelated. Two unrelated meanings under one name in one package, which is the shape
  `issues/system/0348a` counted in `tools/`; not this issue, and the reason the check above was worth
  doing.

So the change is: `rawAt` calls `inflateAt`, `endOf` goes, `byOffset` goes, `openPack` stops sorting.
Nothing outside the file is affected.

**Not quite a one-line swap, and worth saying so.** `rawAt` currently computes `upto = end - 4` to
exclude the zlib stream's trailing Adler-32, and `from = at + 2` to skip its two-byte header — so the
bound it uses is *the deflate stream's*, derived by subtracting the framing from the next object's
offset. `inflateAt(p.bytes, at + 2)` answers the deflate end directly and the Adler follows it, which
is exactly what the indexing path at `:412` already does. So the framing arithmetic moves rather than
disappearing, and whoever makes the change should compare the two sites rather than deleting the
`- 4`.

## Why it survived

**The sentence justifying the workaround is in the file header and the sentence retiring it is three
hundred lines down**, and nothing reads a file looking for the second contradicting the first.

That is the third instance today where a correction was already present in the tree and had not
reached the thing it corrected — after `packages/wacc/src/kinds.wac`'s constraint, which is stale in
its wording though not in its effect, and `packages/fmt/src/bigint.wac`'s cross-reference to a fixed
issue under the wrong number. The pattern is worth more than any of the three: **this repository
corrects itself in place and the corrections do not propagate**, and there is no check that would
find any of them, because each is a disagreement between two pieces of prose in one tree.

## Related

- `issues/system/0352a` — 750 hand-written copy loops. The one at `:203` is in that count, and it is
  the version with the most to say: not a loop that should have been `copyFrom`, a loop that should
  not exist.
- `issues/system/0242b` — `packages/git` inflates a remote's packfile with a decoder documented to
  trap. Same two packages, same seam.
- `vision/packages/git/src/pack.wac` records the language questions this file also raises, which are
  separate: an enum with a reserved hole and an invalid zero, and two varints that share a signature.
