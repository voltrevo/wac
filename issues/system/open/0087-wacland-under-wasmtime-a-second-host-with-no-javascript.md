# 0087 — the native runtime: a second host, with no JavaScript and no WASI in it

- **Status:** open
- **Claimed by:** agent-a (2026-08-08) — in flight, see "Progress" at the end
- **Reported by:** agent-c
- **Date:** 2026-08-06
- **Kind:** missing feature
- **Symptom:** not implemented

Step 2a of [design/0001](../../design/0001-a-self-contained-system.md), where D9, D10 and D11 hold the
reasoning. This is the actionable slice.

## What

A runtime binary that runs wac programs: the peer of `packages/platform/host/{browser,node,deno}.ts`,
in the role Deno plays but Wasm-native, in **Rust on wasmtime**, with no JavaScript in it and no WASI
reaching the guest.

It is the only host that tests the portability claim at all — the other three are JavaScript and share
the transport, the worker model and the event loop.

## What it has to do

Six things, and the list is shorter than the JavaScript host's:

1. load a wac-compiled module — **no bundle**, since there is no JavaScript to bundle;
2. supply the capability funcrefs as host functions;
3. a **ticket table**: request to id, completed from the runtime's own threads;
4. `waitAny(ids, timeoutMs)` — park the calling wasm thread until one is ready or the deadline passes;
5. **`spawn`** — instantiate into a new store on its own thread, with a world derived from the parent's
   grants, routing bytes between parent and child queues;
6. the operating system underneath, through `std::fs`, `std::net` and threads — never exposed to the
   guest, because it is the *implementation* of a capability and not a capability.

The `SharedArrayBuffer`, `Atomics.wait`, the sequence counters, the ring of slots and the responder are
expected to have **no counterpart here**. They exist to park a worker while an asynchronous host runs;
native code blocks the calling thread directly. If this finds itself reimplementing the ring of slots,
stop and say so — that would mean the interface and the transport are less separable than D9 assumes,
which is worth more than the runtime.

## Done when

With no JavaScript in the artifact and no WASI import in the module:

- a program issues **two** capability requests that complete **out of order**, `waitAny`s over both,
  and observes them settle independently — the later request first, each resolving its own value;
- a `waitAny` with neither ready returns on its **timeout**;
- the program **spawns a child** and `waitAny`s over one of its own tickets *and* the child's exit at
  the same time.

The third clause is the point. A runtime that cannot make a second instance is not a host for this
system, and a readiness table that only handles one kind of event fails there and nowhere else.

**A host that resolved every ticket immediately would pass the types and fail this**, which is why
out-of-order completion is in the criteria rather than a single request. Such a host would make every
program that overlaps requests silently sequential — `packages/tor`'s SOCKS proxy holds one outstanding
read per socket plus an accept and hands the list to `waitAny`, and it would still *work*, one
connection at a time, which is D6's shape.

## Why spawn is in scope here and the process table is not

`spawn` is the primitive; the table is step 3. But the primitive cannot be deferred: a wasm module
cannot instantiate another wasm module, so if the runtime cannot do it, nothing later can add it —
and the design would have been built on a host that could not carry it.

There is a second reason to want it early. `children.ts` is careful to say that today "the isolation is
the language's, not the runtime's": a wac child cannot escape its capabilities because wac has no
ambient anything, but arbitrary JavaScript in a spawned worker can, since Deno workers inherit the
process's permissions. Under this runtime a child instance gets **exactly the imports the host gives
it**. `spawn` becomes a confinement primitive rather than only a composition one, on this host first.

## The toolchain is in place (2026-08-06)

Settled, so nobody repeats it:

- **`rustc` and `cargo` 1.97.1, via rustup**, on the PATH in every shell. `~/.zshenv` and `~/.profile`
  source `~/.cargo/env`; the rustup shims are also symlinked into `/usr/local/bin`, because Claude
  Code's tool shells source a snapshot that pins `PATH` *after* `.zshenv` is read and would otherwise
  never see them.
- **Ubuntu's `rustc` 1.75 is not enough and has been removed.** It installs from `ports.ubuntu.com`
  with no allowlist change, and then cannot build wasmtime: current wasmtime (47.x) requires
  `edition2024`, which needs Rust 1.85+. `cargo fetch` fails with "the package requires the Cargo
  feature called `edition2024`". Two toolchains on the PATH is a trap, so there is one.
- **Proxy allowlist**, all five added by the operator and all five used: `index.crates.io` and
  `static.crates.io` for the registry and the downloads, `crates.io` for `cargo add`, and
  `sh.rustup.rs` with `static.rust-lang.org` for the toolchain itself.
- **Measured**, on a trivial wasmtime host: release build 1m28s at 401% CPU, a 17.2 MB unstripped
  binary with default features, and ~850 MB of toolchain on the shared home (`~/.rustup` 520 MB,
  `~/.cargo` 333 MB). A real runtime should trim wasmtime's features hard; the default pulls in the
  pooling allocator, profiling, `wat` and `wit-parser`, none of which this needs.
- **The two mechanisms D10 rests on are proven** by a probe: `Func::wrap` supplying a host function to
  the guest, and a second `Instance` created from the host with its own `Store` and only the imports
  that call handed it. That second one is `spawn`, and it is why `spawn` is a confinement primitive on
  this host and not on the others.

## Still an operator decision

**This repo has no compiled language today** — 371 `.wac`, 305 `.ts`, with Python and shell only as
tooling. Where the runtime lives is undecided: its own bare repo, or `native/`.
See 0001's open questions. Worth settling before code lands rather than after.

Only whoever *builds* the runtime needs the toolchain; everyone else needs a binary.

## Not in scope

No shell, no services, no image format, no process table. A `.wasm` and a manifest of grants is the
whole artifact; `buildApp` gains a target that emits it.

## D12: build the ticket table with a scheduler seam in it (operator, 2026-08-06)

design/0001 gained **D12 — a fully deterministic execution mode is a goal of the native runtime, and only
partly reachable before it.** It bears directly on items 3 and 4 above.

In the JavaScript hosts a test scheduler can own *which answer is delivered next* but not *which real call
has completed*, because that is the kernel's. A worker parked on two OS-backed tickets — one of which
cannot complete until something else is unblocked — is indistinguishable from one that is merely slow. So
the JavaScript mode can improve reproducibility and cannot guarantee it.

Wacland is where that boundary moves, because the runtime owns the ticket table, the threads and the
clock. Two consequences for the design of items 3 and 4:

- **the ticket table should be able to answer "who is runnable?" without asking the operating system.**
  Completion is recorded by the runtime's own threads, so it already knows; the seam is making that
  queryable and making delivery order a policy rather than an accident.
- **`waitAny` should take its choice from that policy** when more than one ticket is ready. The protocol
  permits returning either, and in a deterministic mode the choice has to be the scheduler's rather than
  whichever thread happened to finish first.

Neither is extra machinery — it is where the machinery is put. Adding a seam afterwards means retrofitting
it through every completion path, which is the shape of change this project keeps paying for elsewhere.

## D13: the clock too, not only the schedule (agent-b, 2026-08-06)

design/0001 gained **D13 — virtual time: the clock is a scheduling decision, not a measurement**, which
sits directly on top of D12 above and adds one requirement to items 3 and 4.

D12 makes a run reproducible; it does not make a run *fast*, and the tor stack's untested surface is
almost entirely things that take hours — a time period rolling, an introduction point expiring, a
consensus refresh firing. Advancing the clock when nothing is runnable turns those from untestable into
milliseconds.

The concrete ask for whoever builds the ticket table, and the reason it belongs in the same breath as
D12's seam:

- **the deadline in `waitAny(ids, millis)` has to be visible to the scheduler.** Today it lives inside
  `Atomics.wait`, in the worker's own memory, so the runtime can enumerate every ticket and still not
  know that a worker will give up in five seconds — which means it can neither answer "who is runnable?"
  honestly nor decide which time to advance to.
- **timer-as-ticket deserves re-deciding rather than inheriting.** `platform.wac` records that it was
  the original design and was replaced because `Atomics.wait` takes a timeout and a timer ticket cost a
  ring slot. Both reasons are JavaScript's; neither applies to a runtime that owns its own ticket table
  and threads. `core.sleepMillis` is still a ticket, so the inconsistency is confined to the deadline
  path.

Cheap now, and the same shape of change this project keeps paying for when it is left until later.

## Progress — 2026-08-08, agent-a

**Items 1 and 2 of the six are done, and a wac program prints through a Rust host with no JavaScript in
it.** `native/`, ~300 lines, and
`packages/platform/test/native.test.ts` runs the same program on both hosts and compares.

What the ABI turned out to be, since this is the part that decided the shape:

- **A compiled wac program has no imports of its own.** It asks for `wac.cb0`…`wac.cbN` — one
  dispatcher per funcref *signature*, taking a slot number first — and everything else a host does is
  calling exports. There is no bundle, no generated glue, and nothing to keep in step but a manifest.
- **The values cross as references**, so the module needs the function-references and gc proposals on.
  `$bind$fnref_N(slot)` hands back a real funcref, which goes straight into `Core.of` untouched.
- **Strings marshal through a staging buffer at offset 0** of `$bind$mem`, sized by `$bind$mem_ensure`.
  Four helper exports and no layout knowledge on the host side.
- The prediction in this issue held: the `SharedArrayBuffer`, `Atomics.wait`, the sequence counters and
  the ring of slots have **no counterpart here**. Nothing was reimplemented, so D9's assumption that the
  interface and the transport are separable survives its first contact.

`packages/platform/native.ts` (`deno task app:native`) emits the artifact: `<stem>.wasm` and
`<stem>.json`. The manifest carries the **field order of `Core` and `Cli`**, which is the thing a
runtime must not hold its own copy of — insert a capability in the middle of `platform.wac` and a host
with a hardcoded order builds a `Core` whose `log` is the previous field's function, and every call goes
somewhere plausible. `provider.ts` does hold such a copy, in a `Core.of(...)` bindgen generated for it.

### What is not done

Items 3, 4, 5 and 6: **the ticket table, `waitAny`, `spawn`, and the operating system underneath.**
Every capability returning a `Pending<T>` is registered, callable, and traps with its own name —
`Cli.argCount is not implemented in the native runtime yet` — rather than answering a plausible zero.
So none of the three "done when" clauses is met yet: they all need the ticket table, which is next.

D12's scheduler seam and D13's visible deadline are for that piece and have not been designed yet. They
should be built in rather than retrofitted, which is what those two decisions say.

### Where it lives — assumed, not decided

Put at the repo root in `native/`, still an operator decision. It went in
`packages/platform/host/native/` first — the interface it implements is defined beside it — and the
suite found the cost in one run: `packages/box`'s applet comparison walks `packages/platform` with
`find` and `du`, and cargo's 567 MB `target/` **changes while the build runs**, so `du` disagreed with
`du -sb` by 34 MB and the walk went from a second to fourteen. A build directory inside a package is a
cost every test that walks it pays. `target/` is gitignored either way.

### Cost, measured

Release build 68s cold and 1.4s warm; the binary is 12.6 MB with the feature set in `Cargo.toml`
(`cranelift`, `runtime`, `gc`, `gc-drc` — default features off). The test builds through cargo and
**skips loudly** if cargo is absent, with the Deno half still asserting, so a machine without the
toolchain gets a warning rather than a red suite or a silent pass.

## Progress — 2026-08-08 (second tick), agent-a

**The ticket table, and two of the three criteria.** Items 3 and 4 of the six. `native/src/tickets.rs`.

- ✅ **two requests completing out of order, each resolving its own value.** `example/wacland.wac`
  stage 3: two sleeps, the *longer* one submitted first, and `waitAny` answers index 1. Verified it can
  fail — gutting the sleep so every ticket settles at once makes the test say `native settled the two
  sleeps in submission order`, which is the failure this issue predicted.
- ✅ **a `waitAny` with neither ready returning on its timeout.** Stage 4, answering -1.
- ❌ **spawn.** Not implemented; item 5, and the last criterion.

**D12's seam is in rather than retrofitted.** When several tickets are ready, `waitAny` returns the
**first in the caller's own list**, not the first to finish. That is a policy in one place, and it makes
a program's behaviour independent of how the threads were scheduled — which is what a deterministic
mode needs somewhere to put. **D13**: the deadline lives in the table's `wait_timeout` rather than
inside a worker's `Atomics.wait`, so the runtime can see it. The clock is still the real one; advancing
it is not implemented, but it is no longer invisible.

The ring of slots has no counterpart, as predicted, and one consequence is worth recording: **there is
no ceiling on outstanding tickets here.** The JavaScript ring has four slots and `packages/relayd` can
exceed them (0091); a `HashMap` has no slots to run out of.

### Two bugs the second host found in the first hour

Both were mine, and both were found by running one program on both hosts rather than by reading:

- **`resolve` has to block.** `Pending.wait` is `return this.resolve(this.id)` and nothing else, so all
  of the waiting a program does happens in the host. A `resolve` that took an already-present outcome
  worked for every capability that finishes instantly and failed the moment one did not.
- **`sleepMillis` resolves to the monotonic nanoseconds at which it settled**, not to the millis asked
  for — `platform.wac` says "so `.wait()` is a sleep that tells you how far it overshot". Answering the
  argument back looked right in isolation and disagreed with Deno by three orders of magnitude.

Neither is a bug in the interface, which is the point worth taking: the contract was written down and
the second host is what made me read it.

## Progress — 2026-08-08 (third tick), agent-a

**`packages/sh` and all sixty of `packages/box`'s applets run on the native host**, and answer what the
Deno host answers. `sealedsh` — a session whose filesystem is in memory and which is granted nothing —
boots, runs pipelines, loops, functions, redirections, `/dev`, `/proc` and `ps`.

The remaining capabilities of item 6, added by following the refusals: `cwd`, `readStdin`, `readChunk`
with the `Read` enum, `env` (the first one with a **grant** behind it — without `env` in the manifest
it answers *absent* rather than reading the real environment), `pushChild`/`popChild` with the frame
that redirects argv, stdin, output and the working directory, and `openInput`/`openOutput`/
`outputError`/`closeFeed`.

**The evidence.** `packages/platform/test/native_shell.test.ts` runs the first 25 of `packages/sh`'s
differential corpus through both hosts and compares bytes and status; `deno task corpus:hosts` runs all
817. A hand run of the first 250 agreed on every one. The corpus is imported rather than copied, so
these hosts are compared on the cases somebody wrote because bash caught us out, not on scripts chosen
to pass.

That is design/0001's arrival test in substance for **shell behaviour and installed programs**. What is
left of the arrival test proper is *an image*: `imaged` needs the filesystem capabilities, which are
`std::fs` and a grant check, and are the obvious next tick.

### Still not implemented

`spawn` — the third criterion — the network, and the host filesystem (`readFile`, `writeFile`, `stat`,
`readDir`, `mkdir`, `remove`, `rename`). All trap by name.

### Worth recording

`pushChild` is the piece that makes the applets work, and getting it slightly wrong is invisible: the
JavaScript host's first version captured only `write` and lost `Core.log`, which is where thirty of the
applets send their output. Both hosts now route `log`, `warn`, `write` and `writeErr` through one
function for that reason.
