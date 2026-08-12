# native/v8 — a wac host on V8, driven from Rust

```
cargo build --release
deno run -A packages/platform/native.ts native/v8/example/hello.wac -o /tmp/hello
./target/release/wacv8 /tmp/hello
```

```
hello from a Rust host on V8
and this goes to stderr
wacv8: unanswered capabilities: Core.nowMillis, Core.monotonicNanos, Core.sleepMillis,
       Core.randomBytes, Core.waitAny, Core.askInterrupt
```

That is a wac program, compiled by wacc, running with no JavaScript layer and no runtime installed —
the capability path end to end.

## Why this and not `native/`

[`native/`](../README.md) is the same idea against wasmtime and is **shelved**. wasmtime's GC costs
2–6× on the workloads wac programs actually run, and switching its collector recovered only part of
it ([`issues/system/0138`](../../issues/system/open/0138-wasmtimes-default-collector-costs-25x-on-escaping-allocation.md)).
V8 driven from Rust matches V8 driven from Deno exactly — [`native/spike-v8`](../spike-v8/README.md)
measured five workloads and every one is within 0.01s. So the engine is not the trade; only the
embedding is. [design/lang/0003](../../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md)
records the decision: **rusty_v8 is the primary platform.**

## What runs, and what does not

**Runs.** The whole shape of a capability, which is the same for every one of them:

1. an import object built in Rust — one dispatcher per callback signature, each carrying its index
   as external data, because a V8 callback is a bare `fn` pointer and closes over nothing
2. `$bind$fnref_<j>(slot)`, the module turning a slot number into a funcref of that signature — the
   one operation a host cannot do for itself
3. `$bind$sm_Core_of(…)`, the module building its own capability struct from those funcrefs, in the
   field order the manifest gives — never an order this host holds a copy of
4. `wac.cb<j>(slot, …)` arriving back in Rust, and a wac `string` read out of the module's memory
   through `$bind$str_len` / `$bind$mem_ensure` / `$bind$str_to_mem`

**Does not.** `Cli` — files, sockets, children, stdin — and the ticket table that makes `.wait()`
mean anything. A program whose `main` takes it is refused **by name**:

```
wacv8: main(Core, Cli) needs a capability this host does not build yet — Core only, for now
```

and a `Core` capability this host has no answer for is listed on exit rather than trapping in the
middle of the program. `native/src` is 2,936 lines against wasmtime and most of it is that ticket
table; porting it is the work, and it is worth doing in slices that each run something.

## The one line of JavaScript

`new WebAssembly.Instance(__mod, __imports).exports`. `WebAssembly.Instance` is a JS constructor and
V8 exposes no C++ equivalent — compilation is a plain API call (`v8::WasmModuleObject::compile`) and
everything after instantiation is a direct call to an exported wasm function. Nothing of the program
runs in that line.

## Building

The `v8` crate needs a prebuilt V8 static library, 196 MB. It lives in `~/.cache/rusty_v8/` on this
machine, which is where the crate looks by default, so a build here takes about 30 seconds and no
network. A machine without it downloads it once.
