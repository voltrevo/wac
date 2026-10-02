# 48 — Bindgen

`wac bindgen main.wac` writes `main.wac.ts`: one self-contained TypeScript file with the module inside it, base64-encoded,
and a typed wrapper for every export. There is no separate `.wasm` to ship beside it.

```wac
// expect: emits
// ---- math.wac ----
export i32 gcd(i32 a, i32 b) {
  while (b != 0) {
    i32 t = b;
    b = a % b;
    a = t;
  }
  return a;
}

export i32 fib(i32 n) {
  if (n < 2) { return n; }
  i32 a = 0;
  i32 b = 1;
  for (i32 i = 2; i <= n; i++) {
    i32 t = a + b;
    a = b;
    b = t;
  }
  return b;
}

export f64 circle_area(f64 radius) {
  return 3.14159265358979 * radius * radius;
}
```

```ts
// generated math.wac.ts, abridged
const _wasm = Uint8Array.from(atob("AGFzbQEAAAA..."), (c) => c.charCodeAt(0));
const _exports = (await WebAssembly.instantiate(_wasm)).instance.exports;

export function gcd(a: number, b: number): number {
  return (_exports.gcd as CallableFunction)(a, b) as number;
}
export function fib(n: number): number { /* … */ }
export function circle_area(radius: number): number { /* … */ }
```

`[§wac-bind-prims-k4fn8wp]` Bound from `math.wac`, `gcd(48, 18)` returns `6`, `fib(20)` returns `6765`, and
`circle_area(5.0)` returns `78.53981633974483`.

`[§wac-cli-bindgen-5tqm7wn]` `wac bindgen` writes the glue a host calls a module through, with `--js` for JavaScript instead of
TypeScript. Each exported function appears as a typed wrapper, so a host calls `gcd(48, 18)` rather than marshalling by hand.

A generated name is the wac export's name, exactly.

## Primitives

| wac | TypeScript | |
|---|---|---|
| `i8`, `u8`, `i16`, `u16`, `i32`, `f32`, `f64` | `number` | |
| `u32` | `number` | reinterpreted unsigned |
| `i64` | `bigint` | |
| `u64` | `bigint` | reinterpreted unsigned |
| `bool` | `boolean` | |
| `string` | `string` | copied in and out as UTF-8 |
| `void` | `void` | |

```wac
// expect: emits
// ---- big.wac ----
export i64 add64(i64 a, i64 b) { return a + b; }
export u32 u32High() { return 0xFF000000; }
export u64 u64High() { return 0xFF00000000000000; }
```

`[§wac-bind-i64-k3fn9wp]` `add64(100n, 200n)` returns `300n`.

`[§wac-bind-unsigned-5wqk3np]` `u32High()` reaches JavaScript as `4278190080` and `u64High()` as `18374686479671623680n`.
`i32` and `i64` are untouched, since signed is what they mean.

The engine hands back every 32- and 64-bit result signed, so the wrapper reinterprets the unsigned ones; without it the
caller would see the value less `2**width`. Packed types are ordinary types ([08](../2-types/08-primitives.md)), so `u8`,
`i8`, `u16` and `i16` cross as parameters and results like any other number.

```wac
// expect: emits
// ---- greet.wac ----
export string greet(string name) { return "hello, \{name}!"; }
export i32 countBytes(string s) { return s.len(); }
```

`[§wac-bind-str-r8jm4xf]` `greet("world")` returns `"hello, world!"`.

`[§wac-bind-strbytes-w5hd3jk]` `countBytes("hello")` returns `5` — `len()` counts UTF-8 bytes
([16](../2-types/16-strings.md)).

## Arrays of numbers are copied

| wac | TypeScript |
|---|---|
| `i8[]` / `u8[]` | `Int8Array` / `Uint8Array` |
| `i16[]` / `u16[]` | `Int16Array` / `Uint16Array` |
| `i32[]` / `u32[]` | `Int32Array` / `Uint32Array` |
| `i64[]` / `u64[]` | `BigInt64Array` / `BigUint64Array` |
| `f32[]` / `f64[]` | `Float32Array` / `Float64Array` |
| `bool[]` | `boolean[]` |

```wac
// expect: emits
// ---- sort.wac ----
export i32[] bubbleSort(i32[] arr) {
  for (i32 i = 0; i < arr.len(); i++) {
    for (i32 j = 0; j < arr.len() - 1 - i; j++) {
      if (arr[j] > arr[j + 1]) {
        i32 tmp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = tmp;
      }
    }
  }
  return arr;
}

export i32 sum(i32[] arr) {
  i32 total = 0;
  for (i32 x in arr) { total += x; }
  return total;
}
```

`[§wac-bind-arr-m7qj3xf]` `sum(new Int32Array([10, 20, 30]))` returns `60`.

`[§wac-bind-arr-mut-p3kn7wp]` `bubbleSort(new Int32Array([5, 3, 1, 4, 2]))` returns `Int32Array([1, 2, 3, 4, 5])`.

`[§wac-bind-arr-copy-j4wk7pm]` An array argument is copied into the module: the caller's typed array is never modified,
whatever the function does to its copy. A caller that needs to see a change gets it back as a result — which is why
`bubbleSort` returns `arr` instead of being `void`.

There is no memory a JavaScript typed array and a GC array share, so a binding that mirrored writes back would be
copying twice and calling it sharing. A function handing back more than one array returns a struct holding them.

```wac
// expect: emits
// ---- bytes.wac ----
export u8[] echoBytes(u8[] data) { return data; }
```

`[§wac-bind-bulk-70zh5tg]` `echoBytes` returns every byte array unchanged at 0, 1, 65535, 65536 and 65537 bytes — either side
of a page — and an array returned earlier is unaffected by a later call.

A copy costs a constant number of crossings, not one per element: the module exports a staging memory, `__bind_mem`, the
caller fills it with one `TypedArray.set`, and one call copies it into a GC array. The memory starts empty and grows on
demand, so a module that never moves bulk data pays nothing; and because every transfer reuses it, a returned typed array is
always a fresh copy, never a view.

## Structs are references

A struct crosses as an opaque reference wrapped in a generated class:

```wac
// expect: emits
// ---- point.wac ----
export struct Point {
  i32 x;
  i32 y;

  Point of(i32 x, i32 y) { return Point(x, y); }
  i32 distanceSq(const this, Point other) {
    i32 dx = this.x - other.x;
    i32 dy = this.y - other.y;
    return dx * dx + dy * dy;
  }
}
```

```ts
// generated, the class only
export class Point {
  constructor(readonly ref: unknown) {}       // wrap a reference you already hold
  static of(x: number, y: number): Point;     // a method without a receiver is a static member
  get x(): number;  set x(v: number);
  get y(): number;  set y(v: number);
  distanceSq(other: Point): number;           // the receiver is passed for you
  toObject(): { x: number; y: number };       // a plain-data snapshot
}
```

`[§wac-bind-struct-5kqn2wj]` The reference is the value, not a copy of it: two wrappers over one reference are one object, a
write through either is seen by the other and by wac, and a cyclic structure crosses at all.

`toObject()` is one level deep and leaves a struct-typed field as its wrapper, so a `Node? next` that loops back on itself
does not hang. A `const` field has a getter and no setter.

## Generics

A generic declaration has no single shape to bind, so bindgen binds instantiations. An instantiation exported by name
binds under that name; one reached only through a signature binds under a name spelled from its arguments:

```wac
// expect: emits
// ---- vecs.wac ----
import { Vec } from "core";

export { Vec<i32> as IntVec };
export Vec<f64> readings() { return Vec<f64>.create(); }
export struct Pair<T> { T a; T b; }
```

```ts
export class IntVec { /* … */ }        // the name the export gives
export class Vec_f64 { /* … */ }       // reached through readings(); spelled from its arguments
// skipped: Pair — generic; export an instantiation by name, e.g. export { Pair<i32> as IntPair }
```

`[§wac-bind-instantiation-name-dwptdfb]` An instantiation exported as `export { G<T…> as N }` binds as the class or
function `N`. One reached only through another export's signature binds as `G_T…` — `Vec<f64>` as `Vec_f64`.

`[§wac-bind-generic-skipped-biz4394]` An exported generic declaration that is not instantiated by name is not bound, and is
listed in `__bindgenSkipped` with the export list form that would bind it.

A generic export is ordinary code — `export { Pair };` lets other wac modules import `Pair` — so bindgen does not refuse
it. It says so where it will be read:

```sh
$ wac bindgen vecs.wac
warning: Pair is exported but generic, so it is not in vecs.wac.ts
  = help: export an instantiation by name: export { Pair<i32> as IntPair };
vecs.wac.ts: 2 classes, 1 function
```

`[§wac-bind-generic-warns-cg9p295]` `wac bindgen` warns once for each generic declaration the entry module exports — whether
by `export` on the declaration, an export list or a re-export — that has no instantiation exported by name, naming it and
the export list form that would bind it. Generics exported only by other modules of the program are not the host's
interface, and draw no warning.

The warning does not change the output or the exit status. A generic the entry exports *and* instantiates by name draws no
warning: its instantiations are the interface, and the template is there for wac importers.

`[§wac-bind-private-7kpcy8t]` A private field has no accessor and is left out of `toObject()`, a private method is not
bound, and a struct with a private field gets no `of`: JavaScript builds one through the struct's own static methods,
as wac outside its body must.

`[§wac-bind-static-6wnq3kv]` A method without a receiver binds as a static member of its class. It is how JavaScript builds a
struct with an invariant, since a struct has no other constructor.

**Which types are bound.** Every struct and enum named in an exported signature, every non-generic `export struct` and
`export enum` whether or not a function names it, every instantiation exported by name, every type their fields and method signatures name, to a fixpoint — through any field
the boundary can carry. A container reaches its contents through its methods, and methods bind, so a `JsonArray` is
walkable from JavaScript through `len` and `get(i)`.

## Enums are references with a tag

```wac
// fragment — shape.wac
export enum Shape {
  Point,
  Circle(f64 r),
  Rect(f64 w, f64 h),

  f64 area(const this) { /* … */ }
}
```

```ts
export class Shape {
  static Point(): Shape;
  static Circle(r: number): Shape;
  static Rect(w: number, h: number): Shape;
  get tag(): "Point" | "Circle" | "Rect";
  get Circle_r(): number;              // throws unless this is a Circle
  area(): number;
  toObject(): { tag: "Point" } | { tag: "Circle"; r: number } | { tag: "Rect"; w: number; h: number };
}
```

`[§wac-bind-enum-3nqk7vm]` `tag` names the variant, `toObject()` is a discriminated union a caller can `switch` on, and reading
the payload of a variant the value is not throws — the protection `match` gives, as an exception rather than a wrong answer.

An enum with a variant named `tag`, `ref` or `toObject` is skipped rather than renamed: a renamed variant would no longer be
the name in the source.

## Nullable values

`[§wac-bind-opt-prim-8mkq5wn]` `T?` crosses as `T | null` for every `T` the boundary carries — `i32?` as `number | null`,
`string?` as `string | null`, `Point?` as `Point | null` — in both directions and through callbacks.

```ts
const m = Map_i32_i32.create((k) => k * 2654435761 % 2147483647, (a, b) => a === b);
m.set(1, 99);
m.get(1);      // 99
m.get(2);      // null
```

A nullable primitive is a box wasm-side, so a nullable `i32` keeps all 32 bits.

## Arrays of references

`[§wac-bind-arr-ref-4jkq8wn]` `string[]`, an array of structs or enums, and an array of arrays cross as JavaScript arrays,
element by element; an array of numbers keeps its bulk copy.

```ts
sumOf([one(1), one(2), one(39)]);   // 42 — structs go in
mk(3).map((p) => p.x);              // [7, 7, 7] — and come back as classes
deep([new Int32Array([1, 2])]);     // nested arrays nest
```

## Functions

A host function is passed in, never ambient:

```wac
// expect: emits
// ---- sum.wac ----
export i32 fold(fn<i32(i32, i32)> f, i32[] xs) {
  i32 acc = 0;
  for (i32 x in xs) { acc = f(acc, x); }
  return acc;
}
```

```ts
import { fold } from "./sum.wac.ts";
fold((a, b) => a + b, new Int32Array([1, 2, 3, 4, 5]));   // 15
```

`[§wac-bind-callback-7pqm4wk]` An exported function may take a `fn<…>` parameter, and JavaScript passes an ordinary function for
it. Its parameters and result marshal exactly as an export's do.

Passing it is the only way in. wac has no `extern` and no declaration form for a host function, so nothing a program can write
names one; what it can call is a value it was handed ([07](../1-programs/07-programs.md)). A module that takes no function
parameter imports nothing, and that is checkable on the binary.

A registered function is held for the life of the module: wac cannot say it has dropped one, and freeing a slot the module
still holds a reference to would turn a live call into a call on whatever took its place. At most sixteen distinct functions
per signature may be registered; passing the same function again reuses its slot, and a seventeenth throws a `RangeError`
naming the signature.

`[§wac-bind-fnref-out-2pkq9wm]` A function returned from an export or a method arrives as an ordinary JavaScript function, and
one handed to a host function can be called by it.

```ts
pick(true)(21);              // 42
Ops.of(1).chosen()(21);      // a method returns one too
higher((g) => g(21));        // wac hands a wac function to a host function
```

## What does not cross

```wac
// expect: emits
// ---- mixed.wac ----
export i32 simple() { return 42; }
export i32 firstOf(fn<i32(i32)>[] fs) { return fs[0](1); }
```

```ts
export function simple(): number { /* … */ }

// skipped: firstOf() — parameter 'fs: fn<i32(i32)>[]' cannot cross the boundary
export const __bindgenSkipped: readonly string[] = [
  "firstOf() — parameter 'fs: fn<i32(i32)>[]' cannot cross the boundary",
];
```

`[§wac-bind-skip-h9pd5wn]` An export or member whose signature names a type the boundary cannot carry is left out, with a
comment where it would have been, and the reason is listed in the exported `__bindgenSkipped`.

A skipped export is absent, so the first sign of it is `mod.firstOf is not a function` at the call site — which reads like a
typo. And a module whose every export is skipped binds without complaint and exports nothing, which reads like a failed build.
`__bindgenSkipped` is where a caller looks.

The types that do not cross today are arrays of functions and nullable functions.

## The name section

`[§wac-name-section-2mkq6wp]` A compiled module carries a `name` section mapping each function to its source name, unless
`names: false` is passed. Without it every tool reading the module — a profiler, a debugger, a stack trace — can say only
`wasm-function[67]`.

## Open

- **Async exports.** Whether an exported `async` function binds as a `Promise`, and how a host drives the continuations it
  leaves ([35](../6-concurrency/35-tickets-and-await.md)), is not yet written down.
- **Hosts other than JavaScript.** Bindgen writes TypeScript. Bindings for other hosts are not specified.
