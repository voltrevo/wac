# spike-v8 — is V8 from Rust as fast as V8 from Deno?

Sixty lines, one question, and the answer is yes.

```
cargo build --release
./target/release/wac-v8-spike ../../<a>.wasm escapingStructs 20000000
```

Measured on the module in `issues/system/0138`'s reproduction — the same file, the same exports, the
same iteration counts as the Deno and wasmtime runners there:

| workload | Deno (V8, TypeScript host) | this (V8, Rust host) | wasmtime, copying collector |
|---|---|---|---|
| `compute` | 0.08s | 0.08s | 0.08s |
| `mutateArray` | 0.08s | 0.08s | 0.09s |
| `escapingStructs` | 0.16s | 0.16s | 0.33s |
| `escapingArrays` | 0.19s | 0.19s | 0.97s |
| `strings` | 0.05s | 0.06s | 0.24s |

Binary: **63 MB**, against 105 MB for `deno compile` and 12.9 MB for `native/`.

## What it establishes, and what it does not

**Establishes:** V8's speed is available to a Rust host — no JavaScript layer needed to get it, and no
compromise for dropping one. Module compilation is a plain API call, `v8::WasmModuleObject::compile`.

**Does not:** anything about capabilities. This spike runs a module with no imports. A real host has
to build `Core` and `Cli`, answer `wac.cb<j>` dispatchers, and carry the ticket table — which is what
`native/src` is, 2,936 lines of it, against a wasmtime engine. Porting that is the project; this only
says the engine underneath it would be the right one.

**One JavaScript line is unavoidable.** V8 exposes no C++ equivalent of `new WebAssembly.Instance`,
so instantiation goes through a six-line script. Nothing of the program runs in it: every call after
that is `v8::Function::call` on an exported wasm function. Imports would be `v8::FunctionTemplate`s,
which is the same shape `native/` already builds from the manifest.

Kept as a spike rather than grown: if nobody takes the port, this is sixty lines to delete.
