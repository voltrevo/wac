# wacland — a host with no JavaScript in it

The fourth host. `browser.ts`, `node.ts` and `deno.ts` are the other three, and all three are
JavaScript: they share the transport, the worker model and the event loop, so agreement between them is
weak evidence that the interface is portable. This one is Rust on wasmtime, and it is the only host that
tests the claim at all.

design/0001 step 2a, tracked as [0087](../issues/closed/0087-wacland-under-wasmtime-a-second-host-with-no-javascript.md).

```
deno task app:native packages/platform/example/wacland.wac -o /tmp/wacland
cargo build --release
./target/release/wacland /tmp/wacland.json one two
```

## What a wac program's ABI turned out to be

Worth stating first, because it decided the shape of everything here and it is much less than the
JavaScript host needs.

**A compiled wac program has no imports of its own.** It asks for `wac.cb0`…`wac.cbN` — one dispatcher
per funcref *signature*, each taking a slot number as its first argument — and everything else a host
does is calling exports. There is no bundle to build, no generated glue, and nothing to keep in step
except the manifest.

The rest:

- **Values cross as references.** A wac string, a struct and a funcref are all one reference, so the
  function-references and gc proposals are on. `$bind$fnref_N(slot)` hands back a real funcref, which
  goes straight into `Core.of` untouched.
- **Strings marshal through a staging buffer at offset 0** of `$bind$mem`, sized by `$bind$mem_ensure`
  and filled by `$bind$str_to_mem` / read back by `$bind$str_from_mem`. Four helpers, and no layout
  knowledge on this side.
- **The field order of `Core` and `Cli` comes from the manifest**, not from a copy here. That is the
  one thing a host must not hold its own opinion about: insert a capability in the middle of
  `platform.wac`, and a runtime with a hardcoded order builds a `Core` whose `log` is the previous
  field's function, and every call goes somewhere plausible.

The `SharedArrayBuffer`, the `Atomics.wait`, the sequence counters and the ring of slots have **no
counterpart here**, which 0087 predicted and made a criterion: they exist to park a *worker* while an
asynchronous host runs, and native code blocks the calling thread. Nothing was reimplemented, so D9's
assumption that the interface and the transport are separable has survived its first contact.

## What is implemented

The machinery — loading, dispatch, marshalling, the capability structs built from the manifest's field
order — and **the ticket table** (`tickets.rs`), with the capabilities that need no operating system
beyond a clock and a thread: `argCount`, `arg`, `write`, `writeErr`, `nowMillis`, `monotonicNanos`,
`sleepMillis`, `randomBytes`, `exitCode` and `waitAny`.

**Two of 0087's three criteria are met**, and `example/wacland.wac` is what demonstrates them:

1. ✅ two requests completing out of order, each resolving its own value — two sleeps, the longer one
   submitted first, and `waitAny` answers the *second*;
2. ✅ a `waitAny` with neither ready returning on its timeout;
3. ❌ a spawned child, waited for alongside one of the parent's own tickets. `spawn` is not
   implemented.

The first one is not decoration. A host that resolved every ticket as it was submitted would pass every
type check and make every program that overlaps requests silently sequential; gutting the sleep in this
runtime makes the test say `native settled the two sleeps in submission order`, which is the failure
0087 predicted.

**`packages/sh` and all sixty of `packages/box`'s applets run on it.** `sealedsh` — a session whose
filesystem is in memory and which is granted nothing — boots, and the first 25 of the shell's
differential corpus answer byte-for-byte what the Deno host answers:

```
deno task corpus:hosts          # all 817, both hosts, compared
```

That took `cwd`, `readStdin`, `readChunk` with the `Read` enum, `env`, `pushChild`/`popChild`, and
`openInput`/`openOutput`/`outputError`/`closeFeed`. `env` is the first capability with a **grant**
behind it: without `env` in the manifest it answers *absent* rather than reading the real environment,
which is not a refusal but the honest answer to "what does this world's environment say".

**The arrival test passes.** `packages/platform/test/arrival.test.ts`: an image written by the Deno
host is the same system here and back again, and a session that changes nothing writes a byte-identical
image on either host. All 817 of the shell's corpus agree across the two. That took the filesystem —
`readFile`, `writeFile`, `stat`, `linkStat`, `readDir`, `mkdir`, `remove`, `rename` — each `std::fs`
behind a **grant check**: without `--allow-read` a program finds `FAULT_NOT_GRANTED`, which
`platform.wac` keeps separate from the operating system's own `FAULT_DENIED` so that a caller can tell
"this build cannot" from "this file will not".

**`spawnSelf` works**, and with it all three of 0087's criteria. A child is a fresh `Store` on a fresh
thread, built from the engine, the module and the manifest — the only things that cross. Nothing from
the parent's store does, and the type system says so: a `Val` is not `Send`. Grants are intersected
with the parent's rather than trusted, so this is a **confinement** primitive here in a way it cannot
be in a JavaScript host, where a Deno worker inherits the process's permissions.

**The network works**, over `std::net` behind the net grant — and with it `packages/ssh`'s `sshd` runs
here, and a real OpenSSH client logs in. That is what completes design/0001's arrival test: the
JavaScript host writes an image with two users, this host serves it, and each key lands in its own home
with the other's private file refused.

Where the interface has a value for "not here", this answers it rather than trapping — `Child.handle
== -2` means "this world has no `spawn` at all", and a negative `Socket` handle carries its reason. The
trap is the thing a caller cannot act on. Nothing traps now. A runtime that
answered an empty file or a closed socket would make every program that used it wrong in a way nothing
could see, which is design/0001 D6.

## Where this lives

The repo root, next to `tools/` and `harness/`, **assumed rather than decided** — see the issue. It was
inside `packages/platform` for an hour, which is how long it took the suite to point out that cargo's
567 MB `target/` is walked by every test that walks that package, and *changes while the build runs*.
`target/` is gitignored: all of it is reproducible from `Cargo.toml` and `Cargo.lock`.

`packages/platform/test/native.test.ts` runs `example/wacland.wac` on this host and on Deno and compares
them. It builds through cargo and **skips loudly** when cargo is absent, with the Deno half still
asserting — a silent skip is how a differential test comes to compare nothing.
