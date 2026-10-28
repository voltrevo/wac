# 0015 — a page runs a module it is given, and spawns on `file://`

- **Status:** agreed 2026-10-28 — each question was put to the operator in turn; the answers are under *Decisions*
- **Superseded in part:** decisions 1 and 2 by `0013` step 6 (operator, 2026-10-28). A module that sees
  the flat host ABI, with `Sys` as the standard way to use it, needs no exported page capabilities and
  no `load`-specific wiring. Decisions 3 and 4 stand; 4 is on master.
- **Raised by:** agent-c, from the desktop experiment's requests (items 4 and 5 of its note to wac): a
  terminal on a page that can run what is on its disk, and keep processes when opened from a file
- **Spans:** `packages/web/tools/build.wac` (the browser half), `packages/web/src/system.wac`,
  `std/platform.wac`'s `Cli.spawn` and `Cli.load`, design `0011`

## What a page cannot do today

`0011` made a page a host: a program in a worker, a `System` of browser calls, and `spawnSelf` starting
another copy of the page as a process with its own streams and a channel to its parent's filesystem. Two
capabilities stop short of what the other three hosts give.

- **`spawn` runs only what is compiled into the page.** The browser half's `spawn` is
  `new Worker(self.location.href)`: a copy of *this* page, running the export named by `--spawn`. A `.wasm`
  a program finds on its disk — through `$WACPATH`, as the shell finds `wc` — cannot run, although the same
  file runs under `wac`, Deno and Node.
- **`load` always refuses.** `system.wac` answers `LoadedModule.of(0 - 2, NOT_HERE)`, so a page has no
  `Cli.load` at all.
- **On `file://`, a worker cannot start a worker.** A page opened from a file has an opaque origin, and a
  worker there is refused: *"Script at 'blob:null/…' cannot be accessed from origin 'null'"*. The top-level
  page can still start one. The desktop sets `sh.externalSpawnable = false` and runs box's applets inside
  the shell's own worker, which works until one loops: `^C` cannot stop a program sharing your thread.

The first two are why the page is the one host where `wac run hello.wasm`, or `wac test`, has no answer —
`wac test` runs its tests through `load` (`packages/wac/src/testrun.wac`).

## Decisions

### 1. A spawned module's capabilities are the page's own, exported (operator, 2026-10-28)

A module the page has not compiled into itself imports its `Core` and `Cli` as callbacks its manifest
names. On Deno and Node those are JavaScript functions talking to the host's bridge
(`packages/platform/host/entry.ts`, `runAsWorkerEntry`), and `packages/platform/host/childWasm.ts` is the
worker that wires a module to them, through `driver.ts`, which reads the `wac.manifest` section and uses no
Deno or Node API — so the page can use it unchanged.

What the page cannot reuse is the other half: a page's `Cli` is not JavaScript. It is wac
(`packages/web/src/system.wac`), over a small browser `System` that does the file operation it is asked
and decides nothing. So **the page module exports its own capabilities**, through bindgen, and `driver.ts`
connects a spawned module's imports to those exports, marshalling strings and bytes between them as it
already does for Deno. One implementation of what a page's `Cli` means.

Rejected: a JavaScript `Cli` for spawned modules — a second copy of `system.wac`'s rules, which would
drift; and leaving the page able to start only copies of itself.

### 2. A page supports `load`, through the same wiring, in the caller's worker (operator, 2026-10-28)

`load` instantiates a module in the caller's process and calls it by handle, and **it is how `wac test`
runs tests** (`testrun.wac`: `cli.load`, then `cli.call` per test, and the coverage counters through the
same handle). In a page it is decision 1's wiring without a new worker: a worker may instantiate and call
synchronously, which `cli.call` needs. No isolation is promised, as on every host — a looping test hangs
its runner everywhere.

### 3. Every child is started by the page's main thread, and talks to its parent directly (operator, 2026-10-28)

On `file://` a worker may not start a worker, and the main thread may. So the main thread starts every
child — on `http(s)://` too — and **brokers rather than relays**: it makes a `MessageChannel`, hands one
port to the parent and one to the child, and the two talk directly, as they did over `Worker`. A port is
transferable whatever the origin, and has the same `postMessage`/`onmessage` shape the code uses now. The
main thread is involved twice per child: to start it, and to terminate it, since only the thread that
made a worker can — which is `^C`'s path.

One route everywhere, so the `http://` tests exercise what a `file://` page depends on. Rejected: brokering
only where a direct start fails (two routes, one exercised only from `file://`), and relaying every
message through the main thread (a hop per message, which is what made the fallback look necessary).

### 4. A page never blocks; an `async` program yields to it, and one that blocks aborts (operator, 2026-10-28)

A module `wac build` writes for a command line expects to block: `.wait()` sleeps until the host answers,
and even an `async` program's adapter ends in `core.waitAny`, which sleeps until something has. The Deno
and Node hosts do that with `SharedArrayBuffer` and `Atomics.wait`; a `packages/web` page has neither, by
`0011`'s design. The operator's rule: programs are written `async`, and **a program that asks a page to
block aborts** with a sentence saying so.

For that to be enough, the standard adapter learns to yield (option A of three — not JSPI, not a separate
`--page` build). A host that cannot wait answers `waitAny` with `HOST_CANNOT_WAIT` (`-2`); the scheduler
records it and returns; `Sys.__wacSettle` reports the program still running rather than stuck; and an
`async` program exports, beside `main`, `__wacStart` / `__wacAdvance` / `__wacDone` / `__wacStatus`, which
keep where it got to in a value the host holds — module statics are compile-time (spec ch27), so the state
cannot be a global. The host calls `__wacAdvance` when an answer has arrived. Hosts that can wait never
answer `-2` and call `main` as they always did, so **one `.wasm` runs on every host**. A `.wait()` on an
answer that has not arrived is still a block, and in a page it aborts.

## What it does not do

- **No module from the network.** The runner instantiates bytes a program already holds: read from its disk
  or compiled by it. Fetching is a separate capability and is not this.
- **No shared memory.** `0011` is unchanged: every call answers a ticket, nothing blocks.
- **No new grants.** A spawned module gets what its parent hands it, narrowed exactly as `spawnSelf`'s child
  is.

## Order of work

1. The page module exports its capabilities through bindgen, and `driver.ts` is something the page builder
   can inline. This is the piece the others need.
2. A spawned module in its own worker, with a live test: a page that writes a module to its disk, spawns
   it, and shows its output.
3. `load` and `call` through the same wiring, with `wac test`'s shape as the live test: load a module, call
   an export by name.
4. The main-thread broker for every child, with a live test that opens the page from `file://` and stops a
   looping child with `^C`.

## Not in this design

**What a page carries.** Whether a particular page ships the `wac` command, and how, is that page's
choice — the desktop experiment that asked for this is a separate project. This design is what makes it
possible: a page can run any module it holds.
