# wacland — a host with no JavaScript in it

The fourth host. `browser.ts`, `node.ts` and `deno.ts` are the other three, and all three are
JavaScript: they share the transport, the worker model and the event loop, so agreement between them is
weak evidence that the interface is portable. This one is Rust on wasmtime, and it is the only host that
tests the claim at all.

design/0001 step 2a, tracked as [0087](../issues/open/0087-wacland-under-wasmtime-a-second-host-with-no-javascript.md).

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

`core.log` and `core.warn`, which return nothing, and the machinery around them: loading, dispatch,
string marshalling, and building the capability structs.

**Everything that returns a `Pending<T>` traps with its own name** — `Cli.argCount is not implemented in
the native runtime yet` — because a ticket table is the next piece and half of one would be worse than
none. A runtime that answered a plausible zero would make every program that used the capability wrong
in a way nothing could see, which is design/0001 D6.

So none of 0087's three criteria is met yet. All three need the ticket table:

1. two requests completing out of order, each resolving its own value;
2. a `waitAny` with neither ready returning on its timeout;
3. a spawned child, waited for alongside one of the parent's own tickets.

D12 (a scheduler seam in the ticket table) and D13 (the deadline visible to the scheduler) belong in
that piece rather than after it.

## Where this lives

The repo root, next to `tools/` and `harness/`, **assumed rather than decided** — see the issue. It was
inside `packages/platform` for an hour, which is how long it took the suite to point out that cargo's
567 MB `target/` is walked by every test that walks that package, and *changes while the build runs*.
`target/` is gitignored: all of it is reproducible from `Cargo.toml` and `Cargo.lock`.

`packages/platform/test/native.test.ts` runs `example/wacland.wac` on this host and on Deno and compares
them. It builds through cargo and **skips loudly** when cargo is absent, with the Deno half still
asserting — a silent skip is how a differential test comes to compare nothing.
