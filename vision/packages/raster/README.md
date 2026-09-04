# raster — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/raster`: 881 lines over five files, a pixel buffer and the three things
a desktop draws into one. Only `surface.wac` is rewritten — `grid.wac`, `desk.wac` and `hit.wac` are
built on it, `font16.wac` is generated, and the type changes here are what those would follow.

Chosen because it is the first package in this directory whose subject is neither bytes on a wire nor
a program's own structure. It turns out to be where the sentinel shape is densest.

---

## Three sentinels in 229 lines, and they have a reason in common

| where | the absent case | spelled as |
|---|---|---|
| the damage rectangle | *nothing has been drawn* | `(0, 0, -1, -1)` — corners the wrong way round, with `damaged()` to read it |
| `at(x, y)` | *outside the surface* | `0`, which is transparent black |
| `glyphIndex(cp)` | *the font has no such glyph* | `-1` |

`at` is the one worth pausing on. Its doc says *"Outside the surface answers 0"*, and `create` fills
the buffer with `u8[w * h * 4]()` — zeroes. **So on a fresh surface, every pixel inside it and every
point outside it answer the same value**, and the caller that cares about the difference is a hit
test, which is what `hit.wac` in that package is.

Two are replaced here — `Rect?` and `Rgba?` — and `glyphIndex`'s stays, because the font table is a
generator's output and the generator is not rewritten. Saying so is the point of listing three.

**What they have in common is the reason.** Every one is a *coordinate or a colour*: a value with no
spare room by construction, where every bit pattern already means something. The other packages'
sentinels — `search`'s `NO_MATCH`, `decode`'s `-2`, a negative socket handle — are in types with
plenty of room and were a choice. These had nowhere to put the absent case but into the range.

## Three rectangle conventions in one file

- `fill(x, y, w, h)`, `rect(…)` and `region(…)` take an origin and a **size**;
- `damage(x0, y0, x1, y1)` takes two corners, right and bottom **exclusive**;
- the `dx0, dy0, dx1, dy1` fields hold two corners, right and bottom **inclusive**.

So `damage` writes `this.dx1 = x1 - 1` on the way in and `damagedPixels` writes
`this.dx1 - this.dx0 + 1` on the way out, and the doc for the second says exactly what that is for:

> so a frame is "draw, send the damage, `undamage()`" with no arithmetic in the caller — **which is
> where the off-by-one would otherwise live, because the reported rectangle is *inclusive* at the
> right and bottom and a blit's width is not.**

A correct method, written to keep the caller away from a conversion the module performs twice
itself. One `Rect` with one convention removes the conversion instead of hiding it, and `clipTo` then
replaces the same four `x < 0 ? 0 : x` lines in `fill` and in `region`.

## A returned buffer whose dimensions are not in it

`region(x, y, w, h)` clips, and answers a bare `u8[]`. Its doc tells the caller how to recover the
shape: *"the answer is the size of the clipped rectangle: a caller that asks for a region hanging off
the edge gets what exists, and pairs it with the clipped origin that `damage` reported."*

That is a caller rebuilding, from a second source, what this function has already computed. `Tile` is
the pair — `Rect at` and the pixels — and `damaged()` then answers `Tile?`, so a frame is

```wac
Tile? t = s.damaged();
if (t !is null) { send(t!); s.undamage(); }
```

with the origin and the size read out of the value rather than out of four fields whose corners are
the other way round.

## What else changed

**`Rgba` instead of a packed `i32`.** The same four shift-and-mask lines appear in `fill` and in
`glyph`, and `at` writes the mirror of them — three statements of one layout, which agree today.
`Rgba.hex(0x46D9C0FF)` keeps the literal a person writes, because that is how every graphics API
takes a colour, and the drawing loops read fields.

**`i32 cellWidth() { return 8; }` becomes `const i32 CELL_W`** — fourth package, noted and not
argued.

## What could not be written

**A code point is an `i32` and the type that fixes it is one layer too high.** `text(i32[] cps, …)`
accepts a surrogate and `0x110000`; `glyphIndex` answers `-1` for both, and `glyph` reads that as
*advance a cell*, so an invalid code point and an unmapped one have the same outcome. That is right
for the font and wrong for the type: only one of the two is a value the caller should have been able
to build.

`@/packages/stream` found the same thing from the other end and named it — *"a `codepoint` can be a
surrogate; a `scalar` cannot — that is what the word means in Unicode"* — so `text(Slice<Scalar>)` is
what this wants. It is not written, because it makes a rasteriser depend on `@/packages/unicode` for
a type and nothing else, which is the dependency the shipped file avoided by taking `i32[]`.

**The general question is where such a type lives**, and `core` is the answer that already exists for
`Bytes` and has not been given for this. `Scalar` is not a container and not a capability; it is a
*refinement of an integer*, and nothing in `core` is one. Promoted.

**A host's limit decides a source file's layout.** The shipped README:

> **The glyph table is split across two constant arrays**, and that is not tidiness: V8 refuses
> `array.new_fixed` above 10,000 elements, and the font is 13,932 words. A single `const i32[]` does
> not compile — *"Requested length 13932 for array.new_fixed too large"*.

Nothing in `spec/` mentions a ceiling on a constant array. A program that grows one past ten thousand
entries finds out from V8, in a message about an instruction its author never wrote, and the split
stays in the source for every host — including `--host wasmtime`, which may well not have the limit.
That is a fact about one engine written into a language's programs, which is the thing
`design/system/0001` D9 exists to notice. Promoted.

**A `Tile` carries its width in a `Rect` beside its bytes, by agreement.** Every image type
everywhere does this and calls it a stride. What makes it worth a line here is that `Slice<T>`
already carries a `len`, so the value that would carry a `stride` exists and is one field short — the
same observation [`@/packages/ens/src/answer.wac`](../ens/src/answer.wac) makes about a
fixed-length address, arrived at from a different direction on the same day.
