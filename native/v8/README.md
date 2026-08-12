# native/v8 — a wac host on V8, driven from Rust

```
cargo build --release
deno run -A packages/platform/native.ts native/v8/example/args.wac -o /tmp/args
./target/release/wacv8 /tmp/args alpha beta
```

```
argc 2
arg 0: alpha
arg 1: beta
and this went to stdout directly
wacv8: unanswered capabilities: Core.nowMillis, …, Cli.readFile, …
```

That is a wac program, compiled by wacc, running with no JavaScript layer and no runtime installed —
and its output is **identical** to the same program built by `deno task app:build`.

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

and the whole of `Pending<T>`, which is how every capability that takes time answers: a ticket
handed over, three funcrefs the guest calls with it, and a value marshalled back through the
module's memory. `argCount`, `arg`, `write` and `writeErr` go out this way and come back through
`.wait()`.

**Does not.** Files, sockets, children, stdin, the clock, and randomness. Each is listed by name on
exit rather than trapping in the middle of a program:

```
wacv8: unanswered capabilities: Core.nowMillis, …, Cli.readFile, Cli.connect, Cli.spawn, …
```

**And nothing here waits.** `native/src/tickets.rs` is 222 lines because a real capability finishes
on another thread and `waitAny` parks until one of a list does. Every answer this host gives is
already in hand when the ticket is issued, so the table is a `HashMap` and `settled` is always true.
That is the honest shape of *this* slice rather than a simplification of the next one — the first
capability that genuinely waits is what turns it into the real table.

**Grants are not enforced yet.** The manifest carries them and this host reads past them, which is
fine only while the capabilities it serves are `argv` and its own stdout. Nothing that touches the
filesystem or the network should be added here before the check is.

## The one line of JavaScript

`new WebAssembly.Instance(__mod, __imports).exports`. `WebAssembly.Instance` is a JS constructor and
V8 exposes no C++ equivalent — compilation is a plain API call (`v8::WasmModuleObject::compile`) and
everything after instantiation is a direct call to an exported wasm function. Nothing of the program
runs in that line.

## Building

The `v8` crate needs a prebuilt V8 static library, 196 MB. It lives in `~/.cache/rusty_v8/` on this
machine, which is where the crate looks by default, so a build here takes about 30 seconds and no
network. A machine without it downloads it once.
