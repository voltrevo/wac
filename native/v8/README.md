# native/v8 — a wac host on V8, driven from Rust

```
cargo build --release
deno run -A packages/platform/native.ts packages/platform/example/wc.wac -o /tmp/wc --allow-read
./target/release/wacv8 /tmp/wc README.md
```

```
194 1474 9335 README.md
```

That is a program from this repository, compiled by wacc, running with no JavaScript layer and no
runtime installed — and its output is **byte-identical** to the same program built by
`deno task app:build`, which is the check that matters: two hosts, one program, one answer.

## Why this and not `native/`

[`native/`](../README.md) is the same idea against wasmtime and is **shelved**. wasmtime's GC costs
2–6× on the workloads wac programs actually run, and switching its collector recovered only part of
it ([`issues/system/0138`](../../issues/system/open/0138-wasmtimes-default-collector-costs-25x-on-escaping-allocation.md)).
V8 driven from Rust matches V8 driven from Deno exactly — [`native/spike-v8`](../spike-v8/README.md)
measured five workloads and every one is within 0.01s. So the engine is not the trade; only the
embedding is. [design/lang/0003](../../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md)
records the decision: **rusty_v8 is the primary platform.**

## What runs, and what does not

**Runs.** `packages/platform/example/wc.wac` end to end, and with it the whole shape of a
capability, which is the same for every one of them:

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
module's memory. Served so far:

| | |
| --- | --- |
| `Core` | `log`, `warn`, `nowMillis`, `monotonicNanos` |
| `Cli` | `argCount`, `arg`, `write`, `writeErr`, `readFile`, `env`, `cwd`, `openInput`, `readChunk`, `closeFeed` |

which is enough for three real programs:

```
$ ./wacv8 /tmp/wc README.md          →  194 1474 9335 README.md
$ ./wacv8 /tmp/sha README.md         →  b1c0b10dca90…6be03  README.md      (= sha256sum(1))
$ ./wacv8 /tmp/grep wasm README.md   →  the matching lines
```

`sha256sum` is the interesting one: it *streams* rather than reading whole files, so it exercises
`openInput` → `readChunk` → `Read.Data`/`Read.End` and the loop a program writes around them.

`readFile` is behind the **read grant** and `env` behind the **env grant**, and the difference
between them is worth stating. Reading without the grant is *denied* — `FAULT_NOT_GRANTED`, which
`platform.wac` keeps separate from the operating system's own `FAULT_DENIED` so a caller can tell
"this build cannot" from "this file will not":

```
$ ./wacv8 /tmp/wc-nogrant README.md
wc: README.md: Not granted to this application
```

`env` without the grant is *absent* rather than refused — the honest answer to "what does this
world's environment say" — and a program cannot tell an unset variable from an ungranted one. With
`WC_VERBOSE=1` in the environment, `wc` built `--allow-env` prints its timing line and `wc` built
without it does not, though both were run from the same shell. That is the capability model doing
its whole job: the grant decides, not the environment.

**`u8[]?` is not `u8[]`.** `cli.env` answers a nullable array and `wc` prints its timing line on
exactly the difference between *unset* and *set to nothing*. This host answered an empty array at
first, so the program took the wrong branch — found by diffing its output against the Deno-built
binary, which is why that comparison is the check this file leads with.

**Does not.** Writing, `openOutput`, `stat`, directories, sockets, children, and randomness. A capability that is reached says which one it was:

```
$ ./wacv8 /tmp/sha README.md
wacv8: packages/box/src/bin/sha256sum.wac trapped
Uncaught Error: Cli.openInput is not answered by this host yet
```

and `WACV8_CAPS=1` lists everything unserved on exit — a note for whoever builds the next slice,
behind a switch because a finished program printing thirty capability names it never reached is
noise on the stream a program's own diagnostics use.

**And nothing here waits.** `native/src/tickets.rs` is 222 lines because a real capability finishes
on another thread and `waitAny` parks until one of a list does. Every answer this host gives is
already in hand when the ticket is issued, so the table is a `HashMap` and `settled` is always true.
That is the honest shape of *this* slice rather than a simplification of the next one — the first
capability that genuinely waits is what turns it into the real table.

**Grants are enforced for what is served**, and every capability added here has to keep it that way:
the check is the whole difference between a capability and an ambient authority.

**One convention is hardcoded, and it should not be.** `Read` is an enum, and a host builds one by
calling `$bind$e_Read_Data_new` — a name spelled out here because the manifest describes struct
fields and methods but carries no enum variants at all. `native/src` spells the same three names.
That is the failure the manifest exists to prevent, and the wire already has what it needs:
[`issues/system/0140`](../../issues/system/open/0140-the-manifest-describes-structs-but-not-enum-variants.md).

## The one line of JavaScript

`new WebAssembly.Instance(__mod, __imports).exports`. `WebAssembly.Instance` is a JS constructor and
V8 exposes no C++ equivalent — compilation is a plain API call (`v8::WasmModuleObject::compile`) and
everything after instantiation is a direct call to an exported wasm function. Nothing of the program
runs in that line.

## Building

The `v8` crate needs a prebuilt V8 static library, 196 MB. It lives in `~/.cache/rusty_v8/` on this
machine, which is where the crate looks by default, so a build here takes about 30 seconds and no
network. A machine without it downloads it once.
