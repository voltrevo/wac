<p align="center">
  <img src="public/banner.svg" alt="wac — A C-family language for WebAssembly GC" width="640">
</p>

# wac

A C-family language for WebAssembly GC. Structs, methods, arrays, nullable refs, subtyping,
generics and enums.

**[Website](https://voltrevo.github.io/wac/)** · **[Language spec](spec/)**

## Pure TypeScript. Zero dependencies.

The entire compiler — lexer, parser, resolver, type checker, WasmGC emitter, and binary builder — is pure TypeScript with no native code, no LLVM, no binaryen, no wasm toolchain. It runs in the browser and in Deno/Node. The compiler, runtime, and bindgen total ~6,000 lines.

## Example

```wac
export struct Point {
  f64 x;
  f64 y;

  Point create(f64 x, f64 y) {
    return Point(x, y);
  }

  f64 distanceSq(const this, Point other) {
    f64 dx = this.x - other.x;
    f64 dy = this.y - other.y;
    return dx * dx + dy * dy;
  }
}

export f64 run() {
  Point a = Point.create(0.0, 0.0);
  Point b = Point.create(3.0, 4.0);
  return a.distanceSq(b);  // 25.0
}
```

## Language features

- Primitive types: `i32` `i64` `f32` `f64` `bool` `string`, and packed `u8`/`i8`/`u16`/`i16` in arrays
- Structs with methods, `const this`, static methods
- Struct subtyping via `struct Rect : Shape`
- Generics: `struct Vec<T>`, monomorphised — `Vec<i32>` and `Vec<Shape>` in one program
- Enums with payloads, and `match` over them — `enum Option<T> { Some(T v), None }`
- Nullable references with `?`, `!` unwrap, `is null` / `is not null`
- GC arrays: `i32[5]()`, `i32[](1,2,3)`, `.len()`
- Function references: `fn[i32(i32, i32)]`
- File-based imports with `import { x } from "./file.wac"`
- Full control flow: if/else, while, for, do-while, switch, ternary
- Four cast modes: `as` (lossless), `as!` (checked), `as~` (lossy), `as@` (raw)

## TypeScript bindgen

`wacBindgen` produces a self-contained `.ts` file with the wasm binary base64-encoded inline and typed wrapper functions. Zero runtime dependencies. Primitive arrays (`i32[]`, `f64[]`, etc.) automatically marshal between JS typed arrays and WasmGC arrays, and structs and enums cross as generated classes.

An export may take a JavaScript function — `export i32 fold(fn[i32(i32,i32)] f, i32[] xs)` is called as `fold((a, b) => a + b, [1, 2, 3])`. Passing it is the only way a host function becomes reachable: wac has no import syntax, so a module that takes no `fn[…]` parameter has no wasm imports at all and cannot call out. What a module can reach is what you hand it.

Arrays of references (`string[]`, arrays of structs, nested arrays), nullable primitives (`number | null`), static methods, and functions returned from wac all cross too — enough that `std`'s generic `Map` can be built and driven entirely from JavaScript:

```ts
const m = Map_i32_i32.create((k) => hash(k), (a, b) => a === b);
m.set(1, 99);
m.get(1).toObject();     // { tag: "Some", v: 99 }
```

## Building a program

`wacx build prog.wac` writes an executable file with a shebang: the wasm base64 inside it, the bindgen wrappers, and a runner that turns argv into the export's parameters.

```sh
wacx build fizz.wac -o fizz
./fizz 15          # 1 2 Fizz 4 Buzz Fizz 7 8 Fizz Buzz 11 Fizz 13 14 FizzBuzz
```

5K, no toolchain at run time, nothing bundled — Deno reads TypeScript from a file with no extension, so the generated module *is* the program. `--call` picks the export when there is more than one and no `main`; a parameter a command line cannot carry, such as an array, is refused at build rather than at run time.

That is the whole of it for a program that only computes. Anything wanting a clock, a filesystem or a socket needs capabilities passed in, which is [wac-mono's `platform` package](https://github.com/) rather than the compiler's business.

## Integer overflow

Integer arithmetic wraps, because half of what wac is used for requires it: SHA-256's `h0 += a` is addition mod 2³² by specification, and so are CRC-32, ChaCha20 and FNV-1a.

`wacx --checked` compiles a module that traps on overflow in `+`, `-` and `*` instead. It is a whole-module switch and experimental — the point is to find out what your own code depends on. Measured over wac-mono: 68 of 503 tests depend on wrapping, nearly all in `crypto`, while json, gzip, url, http, fmt and std pass with it on. The cost with nothing opted out was 5% on a JSON parse and 27% on gzip.

## Constant-time checking

`wacCompile(files, entry, { ctTrace: true })` records an ordered trace of every branch taken and every memory *index* used, with each event mapped to a source line. Run a routine twice with the same public input and different secrets, compare the traces, and the first divergence is where the secret became observable.

The index half is the part branch coverage cannot do: `SBOX[secret]` has no branch, so a counter-based tool reports it as uniform while the address bus does not. Applied to wac-mono's crypto package it confirmed two documented leaks, located them to the line, found a third that was not documented, and showed x25519's ladder uniform across 1.6 million events.

## What a wac module requires

MVP plus non-trapping float→int conversions, reference types, typed function references, and
garbage collection — Chrome 119+, Firefox 120+, Safari 18.2+, Node 22+, Deno. All shipped, none
behind a flag.

That is the floor, and it is deliberate: nothing is emitted from a proposal that is not broadly
supported. There are no bulk-memory, exception-handling, tail-call or SIMD opcodes in the emitter.
A feature that would cross this line — JSPI, for instance, which the callback design happens to
make available to a host that wants it — is a decision to take explicitly, not a convenience to
adopt because an engine you have to hand supports it.

## What has been built with it

[**wac-mono**](https://github.com/voltrevo/wac-mono) is the other half of this project: things
written in wac. It is the evidence that the language is finished enough to be boring — 24
packages, 41,000 lines of wac, 896 tests, and no TypeScript in any package's `src/`.

- **A busybox**: 59 applets in one program, each differential-tested against the real tool.
- **A shell**, checked against GNU bash script for script.
- **SSH, both ends** — a client that runs commands on OpenSSH, and a server that serves
  OpenSSH's own client, hosting that shell.
- **TLS 1.3**, interoperating with OpenSSL and rustls, and a **Tor client** with a SOCKS proxy
  on top of it.
- **Crypto**: SHA-2, SHA-3, HMAC, HKDF, AES-GCM, ChaCha20-Poly1305, X25519, Ed25519, P-256,
  P-384, RSA verification, ML-KEM-768.
- **gzip and Zstandard**, both compressing at or under the reference tools.
- **A capability world** — so a program can be an application, reading files and opening
  sockets, with no TypeScript of its own — which also targets **the browser**: the shell above
  runs in a tab, over a filesystem that survives a reload.
- **The wac compiler, in wac**, being ported so it can eventually compile itself.

Its [MAP.md](https://github.com/voltrevo/wac-mono/blob/master/MAP.md) is generated from the
tree and lists every package and every program.

## Development

```sh
npm install
npm run dev      # dev server with playground
npm run build    # production build
deno test -A     # run compiler tests (bindgen tests write to a temp dir)
```

## License

MIT
