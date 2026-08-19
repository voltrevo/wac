# wacland — a host with no JavaScript in it

> **The platform is a Rust host on V8, decided 2026-08-12** — see `spike-v8/` and
> design/lang/0003. This wasmtime host is shelved as a target and kept as a host, and its role is now
> load-bearing in a way it was not before: with the Rust host on V8 too, this is the **only** thing in
> the repository that is not V8, and `design/system/0001`'s portability argument rests on there being
> one. Its tests are expected to keep passing.
>
> The measurements that decided it: `wacc` compiling itself is 1.0s on V8 and
> 3.4s here, after the collector fix that took it from 12.3s (`issues/system/0138`), and
> `deno compile` gives the same single-binary toolchain at the V8 number. So nothing is aimed at
> making this the primary runtime. It stays because it is the only host with no JavaScript in it, and
> design/system/0001 makes that a portability requirement rather than a nicety: agreement between
> browser, Deno and Node is weak evidence, and this is the second opinion. Its tests run on every
> suite pass and are expected to keep passing. See
> [design/lang/0003](../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md).

The fourth host. `browser.ts`, `node.ts` and `deno.ts` are the other three, and all three are
JavaScript: they share the transport, the worker model and the event loop, so agreement between them is
weak evidence that the interface is portable. This one is Rust on wasmtime, and it is the only host that
tests the claim at all.

design/0001 step 2a, tracked as [0087](../issues/system/closed/0087-wacland-under-wasmtime-a-second-host-with-no-javascript.md).

```
deno task app:native packages/platform/example/wacland.wac -o /tmp/wacland
cargo build --release
./target/release/wacland /tmp/wacland.json one two
```

## A compiler inside it

With `seed/wacc.json` and `seed/wacc.wasm` present at build time, this binary *is* a wac toolchain:

```
deno task app:native packages/wacc/example/wacc.wac --allow-read --allow-write -o native/seed/wacc
cargo build --release
./target/release/wacland compile packages/wacc/src/api.wac out.wasm     # 3.2s, no JavaScript
./target/release/wacland check main.wac
```

The first argument decides: a readable `.json` is a program bundle, as before; anything else is
arguments for the built-in compiler. Without a seed the binary is exactly what it was and says so.

It compiles wacc's own sources to a module **byte-identical** to the Deno-hosted build. What it
cannot yet do is rebuild the seed *it contains*, and the reason is not the compiler —
`issues/lang/0105` has the demonstration: the seed's manifest is written by
`packages/platform/native.ts`, which still compiles with the reference, so it describes 43 callback
signatures that a wacc-built module numbers differently. The compiler is fine; the bundler is what
has to move.

The compiled-module cache follows the seed into the temporary directory, keyed by the wasm's hash
and this wasmtime's version — otherwise a command-line tool recompiles 411 KB on every invocation.

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

**All three of 0087's criteria are met**, and `example/wacland.wac` is what demonstrates them:

1. ✅ two requests completing out of order, each resolving its own value — two sleeps, the longer one
   submitted first, and `waitAny` answers the *second*;
2. ✅ a `waitAny` with neither ready returning on its timeout;
3. ✅ a spawned child, waited for alongside one of the parent's own tickets — `spawnSelf`, which is
   the form of spawning this host has (see below). This line said ❌ and "`spawn` is not implemented"
   for as long as it took someone to read it next to the paragraph four below, which says all three
   are met.

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

**The arrival test passes.** `packages/platform/test/wac/arrival_test.wac`: an image written by the Deno
host is the same system here and back again, and a session that changes nothing writes a byte-identical
image on either host, with 65 applets run over it in between. The shell's corpus is a separate
claim and a separate test: `native_shell_test.wac` runs the first 25 scripts through both hosts on
every suite run and says so in the file, and `deno task corpus:hosts` sweeps the whole corpus by
hand — whose size is stated in [`packages/sh`'s README](../packages/sh/README.md#the-oracle-is-bash)
and, deliberately, nowhere else. That took the filesystem —
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
trap is the thing a caller cannot act on. Nothing traps by accident.

**One thing traps on purpose**, and it is the only one: a child whose parent called `closeSocket`.
The engine runs with `epoch_interruption`, a ticker advances the epoch every 5 ms, and each child's
store has a deadline callback that turns its stop flag into a trap wherever the guest is. That is
what terminating a program means for wasm — a guest leaves a loop when it decides to — and it is what
the JavaScript hosts were already doing by terminating a worker. The parent sees -1 from `exitCode`,
which is what a terminated worker answers there too; it does not see a trap, because it asked for it
([0123](../issues/system/closed/0123-closesocket-stops-a-child-outright-on-one-host-and-cooperatively-on-the-other.md)). A runtime that
answered an empty file or a closed socket would make every program that used it wrong in a way nothing
could see, which is design/0001 D6.

## Where this lives

The repo root, next to `tools/` and `harness/`, **assumed rather than decided** — see the issue. It was
inside `packages/platform` for an hour, which is how long it took the suite to point out that cargo's
567 MB `target/` is walked by every test that walks that package, and *changes while the build runs*.
`target/` is gitignored: all of it is reproducible from `Cargo.toml` and `Cargo.lock`.

`packages/platform/test/wac/native_test.wac` runs `example/wacland.wac` on this host and on Deno and compares
them. It builds through cargo and **skips loudly** when cargo is absent, with the Deno half still
asserting — a silent skip is how a differential test comes to compare nothing.
