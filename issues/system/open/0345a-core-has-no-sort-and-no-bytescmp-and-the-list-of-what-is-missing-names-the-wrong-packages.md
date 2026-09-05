# 0345a — `core` has no `sort` and no `bytesCmp`, and the list of what is missing names the wrong packages

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** missing feature
- **Symptom:** none today — duplicated code, and one decision that is expensive to undo

`core/README.md`'s *What is not here yet* says:

> **`sort`.** A generic sort over a `fn[bool(T, T)]` comparator belongs here. `gzip` and `bignum`
> both sort by hand today.

Both named packages are wrong now. `packages/bignum/src` contains no sort at all — `rg -i sort`
finds nothing. `packages/gzip`'s is a **counting sort** inside Huffman table construction
(`inflate.wac:379`, *"symbols sorted by (len, symbol)"*), which has no comparator and which a generic
`sort` would not serve.

Meanwhile, swept over `packages/*/src`: **thirteen functions whose name contains `sort`, and eleven
insertion-shift loops (`while (j >= 0 && …)`), across eight packages.**

```
packages/wac/src/testrun.wac:448     sortedNames            + shift loop at 454
packages/fs/src/image.wac:379        sortedNames
packages/fs/src/fs.wac:1434          sortNames              + shift loop at 1438
packages/wacpkg/src/lock.wac:341     sortedByName           + shift loop at 347
packages/tor/src/vote.wac:85,101     sortedStatusEntries, sortedDescriptors  + shift loop at 110
packages/tor/src/hsdir.wac                                  + shift loop at 166
packages/git/src/pack.wac:78,549     sortOffsets, sortByName
packages/git/src/repo.wac:705,945    sortLines, sortListing + shift loops at 709, 950
packages/box/src/lib/lines.wac:64    mergeSortWith
packages/sh/src/exec.wac                                    + shift loops at 2766, 4386
packages/sh/src/arith.wac                                   + shift loop at 111
packages/wacc/src/asynclower.wac                            + shift loop at 608
```

## And three of them share a comparator that is also written three times

```wac
packages/tor/src/vote.wac:120     export i32 compareBytes(u8[] a, u8[] b)
packages/tor/src/hsdir.wac:127    export i32 compareIndex(u8[] a, u8[] b)
packages/box/src/lib/lines.wac:38 export i32 cmpBytes(u8[] a, u8[] b)
```

Identical eight lines apart from parentheses and one temporary, and **two of the three are in one
package**. `core/hash.wac` exports `bytesEq` and there is no `bytesCmp`, so equality is shared and
ordering is not.

**A fourth is not a duplicate and must not be swept up with them.**
`packages/crypto/src/weierstrass.wac:269`'s `cmpBE` is big-endian, assumes equal lengths, and is
**branch-free** — two masked accumulators, no `return` inside the loop — so it takes the same time
whatever the bytes are. Nothing in either signature says which of the two a caller needs.

## Why this is a decision and not just a chore

**Stability.** Almost every sort above is an insertion sort and `box`'s is a merge sort; all of them
are stable, and three of them are user-visible orderings — `box`'s `ls` and `sort`, and `git`'s tree
listing. A `core` sort that is not stable would compile at every one of those call sites and change
what they print. So the contract has to be decided before the function exists, not after nine
adoptions.

**The comparator's type.** The README proposes `fn[bool(T, T)]`; every one of the fifteen comparison
functions in this tree answers `i32` three-way, and `box/src/lib/lines.wac` already exports
`mergeSortWith(u8[][] xs, i32 n, fn[i32(u8[], u8[])] cmp)`, which is this function for one element
type. A `bool` comparator cannot express a key, which `lines.wac` needs for `sort -u` — its
`cmpNumeric` and `cmpNumericThenBytes` are a key and an order and the relation between them is what
makes `sort -nu` correct.

## Notes

Smallest useful step is `bytesCmp` in `core/hash.wac` beside `bytesEq`, deleting three copies and
touching two packages. That one needs no decision. The generic `sort` needs the two above answered
first, and `mergeSortWith` is the closest thing to a prototype — it is stable, takes a three-way
comparator, and is generic in nothing.

Found while writing `vision/core/order.wac`, which is a sketch of the same two functions and has no
bearing on this beyond having prompted the sweep.
