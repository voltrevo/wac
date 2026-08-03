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

### What is followed, and what is not

Every struct and enum named in an exported signature is bound, and so is every type *their* fields
name — but only through a field the boundary can carry. `[§wac-bind-struct-5kqn2wj]` A field whose
type is an array of structs is not a route to anything, because nothing binds one yet: following it
would put a package's private types into its public surface as classes nobody could use.

This costs less than it sounds, and running it over `json` is what showed why. A container reaches
its contents through **methods**, and methods bind: `JsonArray` arrives with `push`, `len` and
`get(i)`, so a JSON tree is walkable from JavaScript without an array of structs ever crossing.

### A host function is passed in, never ambient

An exported function may take a `fn[R(P…)]` parameter, and JavaScript passes an ordinary function
for it. `[§wac-bind-callback-7pqm4wk]`

```wac
export i32 fold(fn[i32(i32,i32)] f, i32[] xs) {
  i32 acc = 0;
  for (i32 i = 0; i < xs.len(); i++) { acc = f(acc, xs[i]); }
  return acc;
}
```

```ts
import { fold } from "./sum.wac.ts";
fold((a, b) => a + b, [1, 2, 3, 4, 5]);   // 15
```

**Passing it is the only way in.** wac's `import` reads another `.wac` file and does nothing else — there is no `extern` and no declaration form — so nothing a program can write names a
host function; what it can call is a value it was handed, for as long as it holds it. A module that
takes no `fn[…]` parameter has no imports at all — that is checkable on the binary, and the test
checks it. Capability, not ambient authority: the host decides what a module can reach by deciding
what to pass.

How it works: the module imports one *dispatcher* per signature — never per parameter — which takes
a slot number ahead of the wac arguments. Each registered function gets a distinct wasm function
standing for it, because a JS closure is not a wasm function and `ref.func` needs one that exists at
compile time. Sixteen per signature can be live at once; registration is by identity, so passing the
same function in a loop costs one slot, and running out raises a `RangeError` naming the signature
rather than reusing a slot.

A registered function is held for the life of the module. wac cannot say it has dropped one, and
freeing a slot the module still holds a funcref for would turn a live call into a call on whatever
took its place.

The parameters and return of a callback marshal exactly as an export's do: primitives, strings,
arrays, structs and enums all cross, and a callback returning a struct hands back the reference.

### Arrays of references

`string[]`, an array of structs, and a nested array are one mechanism: per-element accessors, since
none of them has a memory representation to copy in bulk. `[§wac-bind-arr-ref-4jkq8wn]` A primitive
array keeps its bulk path — one copy through the staging buffer rather than a call per element.

```ts
sumOf([one(1), one(2), one(39)]);   // 42 — structs go in
mk(3).map((p) => p.x);              // [7, 7, 7] — and come back as classes
deep([new Int32Array([1, 2])]);     // nested arrays nest
```

Building one wasm-side needs a value to fill it with, because a non-null reference has no default.
Where the element type allows null the array is filled with it and every slot is written before wac
sees it; where it does not — `string[]` — the first element is the fill, and an empty array comes
from `array.new_fixed` with no elements, which is the only way to make one when there is no value to
repeat.

### Static methods, and how a struct gets built

A static method — one declared without `this` — binds as a static class member. `[§wac-bind-static-6wnq3kv]`
It is how a struct with an invariant is constructed from JavaScript, since there is no other
constructor, and it composes with callbacks:

```ts
const m = Map_i32_i32.create((k) => k * 2654435761 % 2147483647, (a, b) => a === b);
m.set(1, 99);
m.get(1).toObject();     // { tag: "Some", v: 99 }
```

That is `std`'s generic `Map`, built and driven entirely from JavaScript with host functions for
hashing and equality.

**`export struct` is a reachability root.** A struct built only by its own static is mentioned by no
exported function, so without this it was bound nowhere even though the language had already been
told it is public. A bound struct's *method signatures* are followed too — `Map.get` returns
`Option<V>`, and without following it the one accessor a map exists for was missing from its class.

A member the boundary cannot carry is named in `__bindgenSkipped` like a skipped export, rather than
dropped in silence.

### Nullable primitives

`i32?` crosses as `number | null`. `[§wac-bind-opt-prim-8mkq5wn]` It is a one-field struct wasm-side —
a box, so that a nullable i32 keeps all 32 bits rather than the 31 a `ref.i31` holds — and the host
reads and writes it through accessors rather than receiving a reference it can do nothing with.

### Functions handed back

A funcref *returned* from an export or a method arrives as an ordinary JavaScript function.
`[§wac-bind-fnref-out-2pkq9wm]` JavaScript cannot call a wasm function reference, but it can call an
export that does the `call_ref`, so the value is a closure holding the reference — the mirror of a
host function going the other way.

```ts
pick(true)(21);              // 42
Ops.of(1).chosen()(21);      // a method returns one too
higher((g) => g(21));        // wac hands a wac function *to* a host function
```

The two directions compose: a host function may receive a wac function as an argument and call it.
That holds whether or not any export happens to return that signature, because a function inside a
callback's signature gets a helper too.

### Nullable references

`string?` and `T[]?` cross as `string | null` and `T[] | null`, in both directions and
through callbacks. `[§wac-bind-opt-prim-8mkq5wn]` A struct or enum already did; these did
not, which meant anything fallible at the boundary had to invent a result struct to say
"absent" — a `readFile` capability being the case that made it worth fixing.

### Not yet supported in bindgen

- Arrays of functions (`fn[i32(i32)][]`) and nullable functions (`fn[i32(i32)]?`) — the element and
  null cases have no conversion yet.

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

## The name section

`[§wac-name-section-2mkq6wp]` Compiled modules carry a custom `name` section
mapping each function index to its source name, unless `names: false` is passed.

Without it every tool that reads a wasm module can only say
`wasm-function[67]`: V8 `--prof`, Chrome DevTools' wasm frames, `perf`,
`wasm-objdump`, `wasm-opt`. A V8 stack trace from a trap goes from

```
at <anonymous> (wasm://wasm/270ce1b6:wasm-function[0]:0x168)
```

to

```
at m$divide (wasm://wasm/011c4d1a:wasm-function[0]:0x168)
```

Names are the mangled form, `file$function`, so two private `helper`s in
different files are tellable apart. Imported callback dispatchers, the builtin
string and math helpers and the bindgen helpers are all named too — a profile
that stops at the module's own functions attributes string concatenation to
whichever function called it.

It costs about 17% of module size on a large program, and it is a custom
section, so `names: false` changes nothing about how the module runs.
