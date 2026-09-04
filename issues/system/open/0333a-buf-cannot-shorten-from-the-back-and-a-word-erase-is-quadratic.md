# 0333a — `Buf` cannot shorten from the back, and a word erase is quadratic

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** missing feature
- **Symptom:** performance

`packages/bytes/src/buf.wac` has `push`, `pushU16`, `pushU32`, `pushDecimal`, `pushBytes`,
`pushAll`, `pushCodepoint`, `pushRepeat`, `dropFront`, `take` and `bytes`. **`dropFront` is the only
one that removes anything, and it removes from the front.** Nothing shortens from the back.

## Reproduction

`packages/tty/src/line.wac`:

```wac
/** Drop the last byte of the line. */
void dropLast(this) {
  u8[] all = this.held.take();
  Buf keep = Buf.create();
  for (i32 i = 0; i < all.len() - 1; i++) { keep.push(all[i]); }
  this.held = keep;
}
```

One full copy of the line per **backspace**. And `^W`:

```wac
i32 from = this.wordStart();
i32 wide = this.widthFrom(from);
while (this.held.len > from) { this.dropLast(); }
```

— once per byte of the word, so erasing a ten-character word at the end of a 4,000-byte line copies
about 40,000 bytes to remove ten. `^U` is fine: it replaces the buffer.

## The fix

```wac
/** Keep the first `n` bytes and forget the rest. */
void truncate(this, i32 n) {
  if (n < 0) { n = 0; }
  if (n < this.len) { this.len = n; }
}
```

The array does not move; `len` does. `dropFront` is this operation from the other end and has been
there since the start, which is what makes the absence look like an oversight rather than a
decision — there is no note anywhere saying a `Buf` should only shrink from the front.

Then `dropLast` goes and its two callers become `this.held.truncate(this.held.len - 1)` and
`this.held.truncate(from)`.

## Notes

**Not urgent by the numbers a terminal produces.** A person types at ten bytes a second and lines are
short; nobody will feel 40,000 byte copies. It is filed because the shape is the interesting part:
`Buf`'s surface is eleven ways to add and one way to remove, and the one way is the one a connection
loop needed. The next consumer to want the other end wrote a loop instead of asking, which is how a
container ends up with an asymmetric API — and `packages/tty` is a package whose whole point is that
a person is waiting on the other end of it.

**It is alone, and the enumeration found a second gap.** Ten sites in `packages/` and `tools/` take
a `Buf`'s array and build a fresh one within eight lines; nine of them are building a *result*, not
shortening. `Buf` is imported by 150 files and `line.wac` is the only one that shortens from the
back.

The second gap is at the other end. `packages/url/src/url.wac:332`:

```wac
Buf re = Buf.create();
re.pushAll("%40".toBytes());
re.pushAll(buffered);
buffered = re.take();
```

That is a **prepend**, and `Buf` has no way to add at the front either — so it is `dropFront` with no
`pushFront` to match, and `push` with no `truncate`. Both ends are half-implemented, in opposite
directions. The URL one is one-shot on a userinfo component and costs nothing; it is here because it
is the same shape and would be missed by anyone grepping for the erase case.

(`packages/box/src/lib/trset.wac:134` also rebuilds, and is a genuine splice — inserting padding in
the middle — which no end-operation would help.)

Found while rewriting the package for `vision/packages/tty`, which writes `truncate` into its own
`Buf` and says so. Not added to the shipped one here: `packages/bytes` is under everything and the
suite gate has had no memory to run in all day (1.9 GB available against `minAvailableMb()` of
4,000), so this would be an untested change to the most-imported package in the tree.
