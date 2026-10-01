# 15 — Arrays

`T[]` is an array of `T`. An array is a reference to a bounds-checked sequence whose length is fixed
when it is created. The length is not part of the type: two arrays of different lengths have the same
type.

Array elements use [variadic widening](../5-inference/32-widening.md), with
[placeholder inference](../5-inference/33-placeholders.md) and
[numeric literal inference](09-numeric-literals.md).

## Array literals

```wac
// fragment — inside a function
i32[] values = [1, 2, 3];
i64 n = 4;
auto inferred = [1, n];       // i64[]; 1 adopts i64

auto explicit = [1, 2, 3] as u8[];
// The target constrains the literal's elements before an array is constructed.
// This is not an element-by-element conversion of an existing array.

auto empty = i32[]();         // explicitly typed empty array
i32[] contextualEmpty = [];  // element type supplied by context
// auto unknown = [];        // ERROR: no element type
// auto numbers = [1, 2];    // ERROR: no concrete numeric type
```

```wac
// expect: answers third = 3
// expect: answers adopted = 1
// expect: answers byteCount = 3
// expect: answers emptyLengths = 0
export i32 third() {
  i32[] values = [1, 2, 3];
  return values[2];
}

export i64 adopted() {
  i64 n = 4;
  auto inferred = [1, n];                  // i64[]: 1 adopts i64
  return inferred[0];
}

export i32 byteCount() {
  auto bytes = [1, 2, 3] as u8[];          // the elements are u8 from the start
  return bytes.len();
}

export i32 emptyLengths() {
  auto empty = i32[]();
  i32[] contextualEmpty = [];

  // ERROR: no element type
  // auto unknown = [];

  // ERROR: no concrete numeric type
  // auto numbers = [1, 2];

  return empty.len() + contextualEmpty.len();
}
```

`[§wac-arr-fixed-v6p97qy]` `[1, 2, 3]` is an array of length 3 whose elements are `1`, `2` and `3`.

`[§wac-array-literal-inference-pcefu3r]` An array literal's element type comes from its context, or from
widening its elements. A literal with neither — `[]` alone, or only untyped numbers — is refused.

`[§wac-array-literal-as-bgvgukc]` `[…] as T[]` gives the literal's elements the type `T` before the array is
built. It is not a conversion of an existing array.

`T[]` remains the array type. There is no typed `T[a, b]` literal syntax. `T[]()` is the empty
constructor. `T[N]` is neither a fixed-size type nor a size-taking construction form:

```wac
// expect: emits
export void sizedForms() {
  // ERROR: T[N] is not a construction — use i32[].filled(N, value)
  // i32[] a = i32[5]();

  // ERROR: T[N] is not a type
  // i32[5] b = [1, 2, 3, 4, 5];
}
```

`[§wac-arr-no-sized-form-4qxmse3]` `T[N]`, with a size in the brackets, is neither a type nor a construction.

The element type may be any type, including a named one, a nullable one or another array:

```wac
// expect: answers nestedValue = 7
struct S { i32 v; }

export i32 nestedValue() {
  S[]   c = [S(1), S(2)];
  S[][] d = [[S(7)]];
  S?[]  e = [S(1), null];
  return d[0][0].v;
}
```

`[§wac-array-literal-named-9mzq4rt]` An array literal may have a named element type, a nested array type,
or a nullable one.

Packed numeric elements follow their ordinary literal range rules; array syntax does not silently
truncate literals:

```wac
// expect: answers firstLetter = 104
export i8 firstLetter() {
  i8[] word = [104, 101, 108, 108, 111];   // "hello"

  // ERROR: literal outside i8 range
  // i8[] bad = [300];

  // ERROR: expected i8, got f64
  // i8[] alsoBad = [1.5];

  return word[0];
}
```

`[§wac-arr-i8-lit-3fqjy2m]` A packed array literal holds its elements' values: `[104, 101, 108, 108,
111]` as `i8[]` has `104` first.

`[§wac-arr-literal-range-yrj6aqu]` An element literal outside the element type's range is refused; it is not
truncated.

## Construction and mutation have distinct names

```wac
// fragment — inside a function
i32[] zeros = i32[].filled(5, 0);
zeros.fill(7, 1, 3);          // mutate three elements starting at index 1
// zeros is now [0, 7, 7, 7, 0]
```

`T[].filled(count, value)` allocates a fresh array and copies the supplied value into each slot.
Arguments are evaluated once. Reference-valued elements share the supplied reference.

```wac
// expect: answers filledAt(1) = 7
// expect: answers filledAt(4) = 0
// expect: answers sharedWrite = 5
struct Point { i32 x = 0; }

export i32 filledAt(i32 i) {
  i32[] zeros = i32[].filled(5, 0);
  zeros.fill(7, 1, 3);                     // [0, 7, 7, 7, 0]
  return zeros[i];
}

export i32 sharedWrite() {
  Point point = Point { x: 1 };
  Point[] shared = Point[].filled(3, point);
  shared[0].x = 5;                         // shared[1] is the same object
  return shared[1].x;
}
```

`[§wac-arr-fill-7kqm3xz]` `T[].filled(count, value)` creates an array of `count` elements, each holding
`value`. A reference value is shared by every slot, not copied.

```wac
// fragment — inside a function, with Point as above
Point[] separate = Point[].defaulted(3);
// Independently default-initialise each element.
// separate[0] is separate[1]: false

// i32[].defaulted(3);        // ERROR: i32 has no default value
```

`T[].defaulted(count)` preserves construction from per-element defaults without suggesting numeric zero
defaults. Counts are runtime values; their integer type and invalid-count behaviour follow the ordinary
array length rules. Neither factory uses labelled arguments.

```wac
// expect: answers distinct(3) = 0
// expect: answers nullDefault = true
struct Point { i32 x = 0; i32 y = 0; }

export i32 distinct(i32 n) {
  Point[] ps = Point[].defaulted(n);
  ps[0].x = 99;
  return ps[1].x;                          // 0: a separate Point
}

export bool nullDefault() {
  Point?[] maybe = Point?[].defaulted(10); // nullable elements default to null

  // ERROR: i32 has no default value
  // i32[] nums = i32[].defaulted(10);

  return maybe[0] is null;
}
```

`[§wac-arr-struct-xo3j05c]` `T[].defaulted(n)` builds each element separately from `T`'s default: writing
one never shows in another.

`[§wac-arr-struct-runtime-w4kf2nq]` That holds for a count computed at run time: `distinct(3)` answers `0`.

`[§wac-arr-nullable-tbpzqk1]` A nullable element type's default is `null`.

`[§wac-arr-defaulted-needs-default-8kbgqzf]` `T[].defaulted(n)` is refused when `T` has no default
([08](08-primitives.md), [12](12-structs.md)).

## Access

```wac
// expect: traps outOfBounds
export i32 outOfBounds() {
  i32[] a = [1, 2, 3];
  a[0] = 10;                               // write
  i32 x = a[0];                            // read: 10
  i32 n = a.len();                         // 3
  return a[5];                             // traps: out of bounds
}
```

`[§wac-arr-oob-7jby7f8]` Reading or writing outside an array's bounds traps.

```wac
// expect: answers aliased = 99
export i32 aliased() {
  i32[] a = [1, 2, 3];
  i32[] b = a;
  b[0] = 99;
  return a[0];
}
```

`[§wac-arr-alias-co33gnn]` An array is a reference: assigning one shares it.

Arrays of arrays are arrays of references, so each inner array may have its own length:

```wac
// expect: answers ragged = 6
export i32 ragged() {
  i32[][] grid = [[1, 2, 3], [4, 5, 6], [7]];
  return grid[1][2];
}
```

`[§wac-arr-nested-l8rdntl]` `grid[1][2]` is `6`, and the inner arrays need not share a length.

Iterating:

```wac
// expect: answers sum([10, 20, 30]) = 60
export i32 sum(i32[] arr) {
  i32 total = 0;
  for (i32 i = 0; i < arr.len(); i++) {
    total += arr[i];
  }
  return total;
}
```

`[§wac-arr-sum-5r0hbqg]` `sum([10, 20, 30])` answers `60`.

`for (T x in xs)` iterates the elements themselves ([25](../3-expressions/25-control-flow.md)).

## Bulk copy and fill

`copyFrom` moves a range between arrays of the same element type, and `fill` writes one value across a
range:

```wac
// expect: answers copiedAt(0) = 9
// expect: answers copiedAt(3) = 2
// expect: answers copiedAt(5) = 4
// expect: answers copiedAt(7) = 0
export i32 copiedAt(i32 i) {
  i32[] src = [1, 2, 3, 4, 5];
  i32[] dst = i32[].filled(8, 0);
  dst.copyFrom(src, 1, 3, 3);              // src[1..4) into dst[3..6)
  dst.fill(9, 0, 2);                       // 9 into dst[0..2)
  return dst[i];                           // [9, 9, 0, 2, 3, 4, 0, 0]
}
```

`[§wac-arr-bulk-7kmq4wn]` `dst.copyFrom(src, srcStart, dstStart, count)` copies `count` elements from
`src[srcStart…]` to `dst[dstStart…]`; `a.fill(value, start, count)` writes `value` to `count` elements
from `start`.

The receiver is the destination. Element types must match exactly. Overlapping ranges are safe, and
behave as if the source were read before any element is written. A range outside the array traps, as an
index does; a `count` of zero does nothing.

## Packed elements

An array of `u8`, `i8`, `u16` or `i16` stores each element in one or two bytes. An element is an
ordinary value of its packed type ([08](08-primitives.md)):

```wac
// expect: answers unsignedByte = 255
// expect: answers signedByte = -1
// expect: answers short = 1000
export i32 unsignedByte() {
  u8[] bytes = [255];
  return bytes[0] as i32;
}

export i32 signedByte() {
  i8[] signed = [(255 as u8) as@ i8];      // the same byte, read as signed
  return signed[0] as i32;
}

export i32 short() {
  u16[] shorts = [1000];
  return shorts[0] as i32;
}
```

`[§wac-arr-i8-k3fn7wp]` A `u8[]` element holding the byte `0xFF` is `255`; an `i8[]` element holding the
same byte is `-1`.

`[§wac-arr-i16-m8qj4xf]` A `u16[]` element written `1000` reads back `1000`.

```wac
// expect: answers wideByte([200]) = 200
export i64 wideByte(u8[] bytes) { return bytes[0] as i64; }
```

`[§wac-arr-packed-cast-nfe1ha9]` A packed element converts like its type: `bytes[0] as i64` on a byte of
`200` is `200`.

Compound assignment and `++` on a packed element compute in the element's type and wrap at its width:

```wac
// expect: answers orByte = 255
// expect: answers wrapByte = 4
// expect: answers orShort = 65535
// expect: answers incremented = 2
export u8 orByte() {
  u8[] bytes = [0xF0];
  bytes[0] |= 0x0F;
  return bytes[0];
}

export u8 wrapByte() {
  u8[] wrap = [250];
  wrap[0] += 10;                           // wraps at 8 bits
  return wrap[0];
}

export u16 orShort() {
  u16[] shorts = [0x00FF];
  shorts[0] |= 0xFF00;
  return shorts[0];
}

export u8 incremented() {
  u8[] count = [1];
  count[0]++;
  return count[0];
}
```

`[§wac-arr-i8-compound-t7btdiv]` `|=` on a packed element works in place: `0xF0 | 0x0F` is `255`.

`[§wac-arr-i8-cwrap-8qsspoh]` `+=` on a packed element wraps at the element's width: `250 + 10` in a `u8`
is `4`.

`[§wac-arr-i16-compound-6i4h16a]` The same holds for `u16`: `0x00FF | 0xFF00` is `65535`.

`[§wac-arr-i8-incr-tlkmjp0]` `++` on a packed element increments it in place.

### A character literal is not a byte past 127

A character literal is a codepoint, and below 128 a codepoint and a UTF-8 byte coincide. Nowhere else do
they: `'é'` is `233` while `"é"` is the two bytes `195 169`. So a character literal of 128 or more is
refused where a byte is expected — an element, a store or a comparison — since a byte could never equal
it:

```wac
// expect: answers asciiByte = true
export bool asciiByte() {
  u8[] b = ['A'];                          // 65, and a byte is 65

  // ERROR: 'é' is a codepoint past 127, not a byte
  // u8[] bad = ['é'];

  // ERROR: 'é' is a codepoint past 127, not a byte
  // bool same = b[0] == 'é';

  return b[0] == 'A';
}
```

`[§wac-arr-byte-codepoint-v8kq3nw]` A character literal whose codepoint is 128 or more is refused as a
`u8` or `i8` — as an element, a stored value or a comparison operand. An ASCII character literal is
accepted.

A wider element is not making this claim: an `i16` or `u16` can hold a codepoint, subject to its range.
