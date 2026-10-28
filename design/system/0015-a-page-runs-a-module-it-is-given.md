# 0015 — a page runs a module it is given, and spawns on `file://`

- **Status:** proposed 2026-10-28 — the questions at the end are for the operator
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

The first two are why `wac` cannot run inside the desktop's terminal (its item 7), and why the page is the
one host where `wac run hello.wasm` has no answer.

## The proposal

### 1. A third kind of worker: the generic module runner

A page's workers are now of two kinds: the page's own program, and copies of it (`spawnSelf`). Add a third,
built into every page the same way: a worker whose script **instantiates the bytes it is handed** and
connects them to the same system half a page copy gets: arguments, standard streams, the filesystem relay
to the parent, and grants narrowed by the parent.

The runner needs no glue specific to the module, because every module `wac build` writes carries a
`wac.manifest` section that names each import's callback shape. **The Deno and Node launchers already
have exactly this worker**: `packages/platform/host/childWasm.ts` is "the generic wasm-child entry", added
by `issues/system/0144` so a launched program's `spawn` can start a module, and it reads the section with
`manifestIn` (`host/driver.ts`). The page needs the same thing answered by the page's `System` instead of
by Deno's.

`Cli.spawn(bytes, …)` then chooses by what it is given: a page copy for `spawnSelf`, the runner for module
bytes. `spawnSelf` is unchanged.

### 2. `load` through the same runner, in process

`Cli.load` instantiates a module *in the caller's instance* on the other hosts: no new process, calls by
handle. In a page that is the runner's reader without the worker: the module is instantiated in the
caller's worker, and its imports answered from the caller's `System`. Isolation is what a worker buys and
`load` does not promise it anywhere.

### 3. Spawn through the page on `file://`

When a worker cannot construct a worker, it asks the page's main thread to start one for it, as a sibling.
The page relays the child's streams and its filesystem channel to the requesting worker. Since the main
thread already relays the page program's own messages, this adds a route, not a new kind of message. On
`http(s)://` nothing changes: a worker starts its children itself, as now, because a relay costs a hop per
message.

Detection is by trying: `new Worker(…)` in a `try`, falling back to the relay on the security error, so a
browser that does allow it on `file://` keeps the direct path.

## What it does not do

- **No module from the network.** The runner instantiates bytes a program already holds: read from its disk
  or compiled by it. Fetching is a separate capability and is not this.
- **No shared memory.** `0011` is unchanged: every call answers a ticket, nothing blocks.
- **No new grants.** A spawned module gets what its parent hands it, narrowed exactly as `spawnSelf`'s child
  is.

## Order of work

1. `childWasm.ts`'s reader and dispatch, made something the page builder can inline beside the page's own
   `System`, so there is one generic child and not two. This is the piece the others need.
2. The runner worker and `spawn` of bytes, with a live test: a page that spawns a module it wrote to its own
   disk, and the module's output arriving on the page.
3. `load` through the reader.
4. The `file://` relay, with a live test that opens the page from a file and stops a looping child with `^C`.

## Questions for the operator

1. **One generic child for the page and the launchers**, which means `packages/platform/host/childWasm.ts`
   and `driver.ts` become something the page builder can inline. Or a page-only copy, accepting two that can
   drift.
2. **Does `load` belong in the page at all?** It is the capability with the least to show in a browser, and
   leaving it `NOT_HERE`, a refusal and not a trap since `0013`, is honest.
3. **The `file://` relay as default, or only where direct construction fails** (as proposed)?
4. **The desktop's item 7**, `wac` as an applet, follows from 1 and 2. Should the page carry the whole
   command, about 3 MB more, or a page-specific subset?
