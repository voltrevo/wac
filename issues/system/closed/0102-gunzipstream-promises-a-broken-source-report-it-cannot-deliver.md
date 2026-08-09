# 0102 — gunzipStream promises a broken-source report it cannot deliver

- **Status:** closed
- **Date:** 2026-08-07

## What

`packages/gzip/src/inflate.wac:786` ends `gunzipStream` with:

```wac
  // The member decoded and checked out. If the *source* broke along the way, that is a separate
  // fact — one that a caller which just wrote the output somewhere needs before it reports success.
  return br.broken == "" ? 0 : 1;
```

The `1` appears to be unreachable, which would make the comment above it a promise the code cannot keep.

The argument: `BitReader.fill` asks the source only once `data` is spent, and on `Failed` it sets `drained`
along with `broken`. From that point the reader holds at most the 32 bits already in `bitBuf` and can never
take another byte. Every path to line 786 still has an eight-byte trailer to read, which cannot come out of
32 bits — so the read traps and the line is not reached. A source that fails *earlier* traps in the mid-block
refill at `inflate.wac:152`, which is reachable and now covered.

So the distinction the comment draws — "this is your data compressed" against "this is the first part of
your data compressed" — is real and worth drawing, and `gunzipStream` cannot draw it. Either outcome is a
trap, and the caller cannot tell a disk error from a corrupt archive, which is the diagnosis-of-the-wrong-
thing that `fill`'s own comment says it exists to avoid.

Recorded in `packages/gzip/cov.ts` as an argument rather than a construction, which is the weaker of the two
claims that list makes.

## The decision this needs

Not something to quietly change: it is about what a reader owes a caller after a failed refill.

1. **Keep enough to finish.** `fill` could hold the unconsumed bytes it already has rather than marking
   `drained` and dropping them — but on `Failed` the buffer is spent by construction, so this really means
   the *caller* buffering a trailer's worth ahead, which changes the reader's shape for one case.
2. **Report through the trap instead.** The information exists at the moment of failure; what is missing is
   a way to carry it out past a trap. `broken` is a field precisely because there is no other channel.
3. **Say plainly that it cannot be told.** Delete the `? 0 : 1` and the comment, and document that a source
   failure and a corrupt archive are indistinguishable to `gunzipStream`. Honest, and the smallest change —
   but it gives up something a caller writing to disk genuinely wants.
4. **Give `unzstdStream` the same treatment either way** — `packages/zstd/src/stream.wac` traps on
   `Read.Failed` with no `broken` equivalent at all, so whatever is decided here should settle both.

(3) is the smallest honest move and (1) is the one that keeps the promise. It wants a decision rather than a
preference, which is why it is here.

## Done when

`gunzipStream`'s return contract and its comment agree, and `unzstdStream` follows the same rule.

## 2026-08-08 — decided: (3), and why not (1) or (2)

The promise is withdrawn. `gunzipStream` ends `return 0;` and says, where the `? 0 : 1` was, that a
source failure and a corrupt archive are indistinguishable from there. `packages/zstd/src/stream.wac`
says the same thing at its `case Failed(why): { trap; }`, which is item 4 — the two are stated in both
places rather than in neither.

**Why not (1), "keep enough to finish".** It is not a change to `fill`: on `Failed` the buffer is spent
by construction, so keeping a trailer's worth means the *caller* reading ahead, and a reader that holds
eight bytes back changes what every other caller sees at the end of input for the sake of one case.

**Why not (2), "report through the trap".** There is no channel out of a trap, and the two places that
run out of input — `skip`, and `copyBytes`'s inner loop — are inside the decoder. Not trapping means
threading a status back through every symbol read. A decoder that keeps going after a failed read with a
status nobody checked is how silent corruption gets written, and this file decodes other people's bytes.

So the shape a real fix has, for whoever wants it: **`inflateInto` returns a result rather than trapping
on a source failure only** — corruption keeps trapping — and every read site propagates it. That is a
refactor of the decode loop, not a line, and it should be done for a reason better than closing an
argument about an unreachable branch.

`packages/gzip/cov.ts` loses its entry for line 786, which was the weakest claim in that list: it
excluded the line "as an argument rather than a construction". There is no branch there now to argue
about.
