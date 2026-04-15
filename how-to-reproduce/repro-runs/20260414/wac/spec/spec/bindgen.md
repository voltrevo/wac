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

### Not yet supported in bindgen

- Struct params/returns (for later: JSON<->struct glue)
- Nullable types
- Function references
- Nested arrays

Functions using unsupported types in their signature are omitted from the
generated file with a comment explaining why.

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

export function circleArea(radius: number): number {
  return (_exports.circle_area as CallableFunction)(radius) as number;
}
```

`[§wac-bind-prims-k4fn8wp]` Bindgen for `math.wac` produces a `.ts` file where
`gcd(48, 18)` returns `6`, `fib(20)` returns `6765`, and
`circleArea(5.0)` returns `78.53981633974483`.

### Example: arrays

Input:

```wac
// sort.wac
export void bubbleSort(i32[] arr) {
  for (i32 i = 0; i < arr.len(); i++) {
    for (i32 j = 0; j < arr.len() - 1 - i; j++) {
      if (arr[j] > arr[j + 1]) {
        i32 tmp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = tmp;
      }
    }
  }
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
  // copy Int32Array into wasm GC i32 array
  const wasmArr = _arrayToWasm_i32(arr);
  (_exports.bubbleSort as CallableFunction)(wasmArr);
  // copy back — sort mutates in place
  return _arrayFromWasm_i32(wasmArr);
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
struct Point { f64 x; f64 y; }

export i32 simple() { return 42; }
export Point getOrigin() { return Point(0.0, 0.0); }
```

Generated `mixed.wac.ts`:

```typescript
export function simple(): number {
  return (_exports.simple as CallableFunction)() as number;
}

// skipped: getOrigin() — struct return types not yet supported in bindgen
```

`[§wac-bind-skip-h9pd5wn]` Functions with unsupported types are omitted with a
comment.

### Array copy semantics

Arrays are copied at the boundary in both directions. The JS caller owns its
typed array; the wasm module owns its GC array. Mutations inside wasm are not
visible to JS unless the array is returned (copied back).

For functions that mutate an array parameter (like `bubbleSort`), the bindgen
returns the mutated copy. The original JS typed array is not modified.

`[§wac-bind-arr-copy-j4wk7pm]` Array parameters are copied into wasm. The
original typed array is not modified by wasm mutations.
