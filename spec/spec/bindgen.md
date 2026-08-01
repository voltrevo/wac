## Bindgen

`wacx bindgen` generates a self-contained `.ts` file with the wasm binary
base64-encoded inline and typed wrapper functions. No separate `.wasm` asset
needed.

### Primitive type mapping

| wac type | TypeScript type | Notes |
|----------|----------------|-------|
| i32      | number         | |
| i64      | bigint         | |
| f32      | number         | |
| f64      | number         | |
| bool     | boolean        | |
| string   | string         | copied in/out as UTF-8 |
| void     | void           | |

### Array type mapping

Arrays are copied across the boundary — the JS side gets a typed array, not a
live reference to the GC array.

| wac type | TypeScript type | Notes |
|----------|----------------|-------|
| i8[]     | Uint8Array     | |
| i16[]    | Int16Array     | |
| i32[]    | Int32Array     | |
| i64[]    | BigInt64Array  | |
| f32[]    | Float32Array   | |
| f64[]    | Float64Array   | |

### Structs cross as classes

A struct is not a value JavaScript can hold, so it crosses as an **opaque reference** wrapped in a
generated class. Every struct reachable from an exported signature — and every struct *its* fields
name, transitively — gets one:

```ts
export class Point {
  constructor(readonly ref: unknown) {}      // wrap a reference you already have
  static of(x: number, y: number): Point;    // build a fresh one
  get x(): number;  set x(v: number);
  distanceSq(other: Point): number;          // methods, with the receiver passed for you
  toObject(): { x: number; y: number };      // a plain-data snapshot, when that is what you want
}
```

`[§wac-bind-struct-5kqn2wj]` The reference **is** the value, not a copy of it. So identity survives
the boundary — two wrappers over one reference are one object, and a write through either is
visible to the other and to wac — and a cyclic structure crosses at all. A copying boundary would
be easier to read in a debugger and could represent neither.

`toObject()` is generated on top of the accessors for the cases where plain data is what is wanted.
It is one level deep and leaves a struct-typed field as its wrapper, so a `Node? next` that loops
back on itself does not hang.

A `const` field gets a getter and no setter. A nullable struct crosses as `T | null`, which is what
JavaScript already means by an absent object. A generic instantiation is named for what the author
wrote: `Vec<i32>` binds as `Vec_i32`, never as its mangled name.

### Enums cross as a class with a tag

The same shape as a struct — a reference, methods, `toObject()` — with a discriminant on top:

```ts
export class Shape {
  static Point(): Shape;
  static Circle(r: number): Shape;
  get tag(): "Point" | "Circle" | "Rect";
  get Circle_r(): number;             // throws unless this is a Circle
  area(): number;                     // the enum's own methods
  toObject(): { tag: "Point" } | { tag: "Circle"; r: number } | { tag: "Rect"; w: number; h: number };
}
```

`[§wac-bind-enum-3nqk7vm]` `toObject()` is the discriminated union a JS caller can `switch` on, and
`tag` alone is enough to branch without unpacking. Reading the payload of a variant the value is
not is a cast that fails — the same protection `match` gives, arriving as an exception rather than
a wrong answer.

A class rather than a bare tagged object, so an enum crosses on the same terms as a struct: by
reference, with its methods, and without a copy per crossing. A generic enum binds under the name
its author wrote — `Option<i32>` is `Option_i32`.

An enum whose variant is called `tag`, `ref` or `toObject` is skipped rather than mangled: the
generated member would collide, and a renamed variant would no longer be the name in the source.

### Not yet supported in bindgen

- Arrays of structs
- Function references
- Nested arrays

Functions using unsupported types in their signature are omitted from the
generated file with a comment explaining why, and the reasons are exported as
`__bindgenSkipped` so a missing export is not mistaken for a build failure.

### Example: math.wac

Input:

```wac
// math.wac
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

Generated `math.wac.ts`:

```typescript
const _wasm = Uint8Array.from(
  atob("AGFzbQEAAAA..."),
  (c) => c.charCodeAt(0),
);

const _instance = await WebAssembly.instantiate(_wasm);
const _exports = _instance.instance.exports;

export function gcd(a: number, b: number): number {
  return (_exports.gcd as CallableFunction)(a, b) as number;
}

export function fib(n: number): number {
  return (_exports.fib as CallableFunction)(n) as number;
}

export function circle_area(radius: number): number {
  return (_exports.circle_area as CallableFunction)(radius) as number;
}
```

Generated TypeScript names match the wac export name exactly.

`[§wac-bind-prims-k4fn8wp]` Bindgen for `math.wac` produces a `.ts` file where
`gcd(48, 18)` returns `6`, `fib(20)` returns `6765`, and
`circle_area(5.0)` returns `78.53981633974483`.

### Example: arrays

Input:

```wac
// sort.wac
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
  for (i32 i = 0; i < arr.len(); i++) {
    total += arr[i];
  }
  return total;
}
```

Generated `sort.wac.ts`:

```typescript
const _wasm = Uint8Array.from(
  atob("AGFzbQEAAAA..."),
  (c) => c.charCodeAt(0),
);

const _instance = await WebAssembly.instantiate(_wasm);
const _exports = _instance.instance.exports;

export function bubbleSort(arr: Int32Array): Int32Array {
  const wasmArr = _arrayToWasm_i32(arr);
  const result = (_exports.bubbleSort as CallableFunction)(wasmArr);
  return _arrayFromWasm_i32(result as object);
}

export function sum(arr: Int32Array): number {
  const wasmArr = _arrayToWasm_i32(arr);
  return (_exports.sum as CallableFunction)(wasmArr) as number;
}
```

`[§wac-bind-arr-m7qj3xf]` Bindgen for `sort.wac` produces a `.ts` file where
`sum(new Int32Array([10, 20, 30]))` returns `60`.

`[§wac-bind-arr-mut-p3kn7wp]` `bubbleSort(new Int32Array([5, 3, 1, 4, 2]))`
returns `Int32Array([1, 2, 3, 4, 5])`.

### Example: strings

Input:

```wac
// greet.wac
export string greet(string name) {
  return "hello, " + name + "!";
}

export i32 countBytes(string s) {
  return s.len();
}
```

Generated `greet.wac.ts`:

```typescript
const _wasm = Uint8Array.from(
  atob("AGFzbQEAAAA..."),
  (c) => c.charCodeAt(0),
);

const _instance = await WebAssembly.instantiate(_wasm);
const _exports = _instance.instance.exports;

export function greet(name: string): string {
  const wasmStr = _stringToWasm(name);
  const result = (_exports.greet as CallableFunction)(wasmStr);
  return _stringFromWasm(result);
}

export function countBytes(s: string): number {
  const wasmStr = _stringToWasm(s);
  return (_exports.countBytes as CallableFunction)(wasmStr) as number;
}
```

`[§wac-bind-str-r8jm4xf]` Bindgen for `greet.wac` produces a `.ts` file where
`greet("world")` returns `"hello, world!"`.

`[§wac-bind-strbytes-w5hd3jk]` `countBytes("hello")` returns `5`.

### Example: i64 / bigint

Input:

```wac
// big.wac
export i64 add64(i64 a, i64 b) {
  return a + b;
}
```

Generated `big.wac.ts`:

```typescript
export function add64(a: bigint, b: bigint): bigint {
  return (_exports.add64 as CallableFunction)(a, b) as bigint;
}
```

`[§wac-bind-i64-k3fn9wp]` `add64(100n, 200n)` returns `300n`.

### Example: skipped exports

Input:

```wac
// mixed.wac
export i32 simple() { return 42; }
export i32 viaFunc(fn[i32(i32)] f) { return f(1); }
```

Generated `mixed.wac.ts`:

```typescript
export function simple(): number {
  return (_exports.simple as CallableFunction)() as number;
}

// skipped: viaFunc() — parameter 'f: fn[i32(i32)]' not yet supported in bindgen

export const __bindgenSkipped: readonly string[] = [
  "viaFunc() — parameter 'f: fn[i32(i32)]' not yet supported in bindgen",
];
```

`[§wac-bind-skip-h9pd5wn]` Functions with unsupported types are omitted with a comment,
and the reasons are also exported as `__bindgenSkipped`.

The export matters more than it looks. A skipped function is simply *absent*, so the
first sign of it is `mod.getOrigin is not a function` at the call site — which reads like
a typo rather than a boundary a struct cannot cross. And a module whose every export is
struct-typed binds without complaint and exports nothing whatsoever, which reads like a
failed build. The comment explaining it was in a generated file that nobody opens while
asking where their export went. `[§wac-bind-skip-h9pd5wn]`

Omitting them is still the right behaviour: a struct is not a value JavaScript can hold,
and inventing a representation would be worse than leaving the function out. The fix is
only to say so where it will be read.

### Unsigned returns

wac's `u32` and `u64` are wasm's `i32` and `i64` — signedness lives in the instruction, not the
type. WebAssembly's JS API hands those back as a *signed* `number` and a *signed* `BigInt`, so a
wrapper has to reinterpret them or the caller sees `want - 2**width`:

```typescript
export function u32High(): number {
  return ((_exports.u32High as CallableFunction)() as number) >>> 0;
}
export function u64High(): bigint {
  return BigInt.asUintN(64, (_exports.u64High as CallableFunction)() as bigint);
}
```

`[§wac-bind-unsigned-5wqk3np]` A `u32` returning `0xFF000000` reaches JS as `4278190080`, and a
`u64` returning `0xFF00000000000000` as `18374686479671623680n`. `i32` and `i64` are untouched,
since signed is what they mean.

`u8` and `u16` never appear here: packed types are array elements only and cannot be a return
type. Unsigned *array* elements are already handled by the copy helpers, which use `array.get_u`.

### Array copy semantics

Arrays are copied into wasm at the call boundary — the JS caller's typed
array and wasm's GC array are separate copies, not a shared reference. There
is no shared memory between JS and a wasm GC array, so bindgen never mirrors
mutations back to the caller automatically: a `void`-returning function's
array parameter is copied in, and whatever it does to that copy inside wasm
is simply discarded once the call returns.

### How the copy happens

Arrays and strings move through a linear-memory staging buffer, exported as
`__bind_mem`. Going in, the caller writes the whole array with one
`TypedArray.set` and a single call copies it into a GC array wasm-side; coming
out, the reverse. So a transfer costs a constant number of boundary crossings
rather than one per element, which for a 1 MiB byte array is the difference
between three calls and two million.

The buffer starts at zero pages and grows on demand, so a module that never moves
bulk data pays nothing for it. Growing detaches the previous `ArrayBuffer`, which
is why the generated code re-reads `__bind_mem.buffer` after every grow rather
than caching a view.

The buffer is reused by every transfer, so a returned typed array is always a
copy rather than a view onto it.

```wac
export i8[] echoBytes(i8[] data) { return data; }
```

`[§wac-bind-bulk-70zh5tg]` `echoBytes` round-trips byte arrays unchanged at 0, 1, 65535, 65536 and 65537 bytes — the sizes either side of a wasm page — and a previously returned array is unaffected by a later call.

A function whose caller needs to observe a mutation must return the array
explicitly — see `bubbleSort` above, which returns `arr` rather than being
`void`. This applies uniformly regardless of how many array parameters a
function takes: each array the caller needs back must appear in the return
type, the same as any other value. (wac does not have multiple return
values — a function needing to hand back more than one array should return
a struct wrapping them, or expose multiple exported functions.)

`[§wac-bind-arr-copy-j4wk7pm]` Array parameters are copied into wasm. The
original typed array passed by the caller is never modified, regardless of
what the wasm function does with its parameter.
