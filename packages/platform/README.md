# platform

The hosts a wac program runs on, so a program can be written **entirely in wac** — no TypeScript of its
own — and still read files, tell the time and print output.

```sh
wac run --allow-read packages/platform/example/wc.wac README.md
```

`example/wc.wac` is the whole application. There is no `main.ts` beside it, and that command
**builds and runs** — a shortcut rather than a second runtime.

If you are here to **write a program**, the next section is what you need: what a program is handed, and
the table of what a host answers. If you are here to **ship one**, skip to
[*Building an executable*](#building-an-executable). If something behaves differently on one host than
another, [*The bridge*](#the-bridge) and [*The browser*](#the-browser) are where the surprises live.

A package of [wac](../../README.md) — see the root README for layout and how to run
things. All commands run from the repo root.

## The idea

wac has no ambient access. There is no import a program can name, no global reaching outside, so an
application can only touch what it is handed — a `Sys`, and the handles it gives out:

```wac
export i32 main(Sys sys) {
  Files files = sys.files();
  sys.log("hello");
  return 0;
}
```

`sys.files()`, `sys.stdout()`, `sys.stdin()`, `sys.clock()`, `sys.random()`, `sys.env()`, `sys.net()`,
`sys.procs()` and `sys.modules()` are the whole surface, and each operation that can fail answers a
`Result` whose error is a union of fault types — `NotFound`, `Denied`, `NotGranted` and the rest — so a
caller matches on what happened rather than on a host's English (design/system/0013, spec ch44).

A browser page is built with `packages/web`: it exports `main(Page page)`, and what it was granted —
files, with `--grant read,write` — is `page.sys`.

**Under the handles is one host call** (design/system/0013 step 6). A host serves numbered requests
whose arguments are ints, a string and bytes, and answers each in one shape —
`answered(id, fault, text, bytes, n, m, flags)`. Everything a handle does is std code over that, compiled
into each module, so a host builds no wac value: the program adapter hands `__wacHost` the host's four
calls — `request`, `waitAny`, `exitWith`, `interrupted` — and builds the `Sys` over what it answers. That
is what lets a host that answers one module answer another, and it took a log-only program from 860 KB to
598 KB, because the boundary was most of what touching `Sys` cost. This package holds the three
JavaScript hosts; `native/` holds the two Rust ones. They serve this table, which is std's `OP_*`:

| op | request | handle that asks | grant |
|---|---|---|---|
| 0 | `DROP` | `cancel` on any ticket the host answers | — |
| 1 | `NOW_MILLIS` | `Clock.nowMillis` | — |
| 2 | `MONOTONIC_NANOS` | `Clock.monotonicNanos` | — |
| 3 | `RANDOM_BYTES` | `Random.bytes` | — |
| 6 | `ARG_COUNT` | `Sys.args` | — |
| 7 | `ARG` | `Sys.args` | — |
| 8 | `ENV` | `Env.get` | `--allow-env` |
| 9 | `READ_FILE` | `Files.readFile` | `--allow-read` |
| 10 | `WRITE_FILE` | `Files.writeFile` | `--allow-write` |
| 11 | `READ_STDIN` | `Input.readAll` on `sys.stdin()` | — |
| 12 | `WRITE_STDOUT` | `Output.write` on `sys.stdout()`; `Sys.log` | — |
| 13 | `STAT` | `Files.stat` | `--allow-read` |
| 14 | `READ_DIR` | `Files.readDir` | `--allow-read` |
| 15 | `MKDIR` | `Files.mkdir` | `--allow-write` |
| 16 | `REMOVE` | `Files.remove` | `--allow-write` |
| 17 | `RENAME` | `Files.rename` | `--allow-write` |
| 19 | `READ_CHUNK` | `Input.chunk` on `sys.stdin()` | — |
| 21 | `CONNECT` | `Net.connect` | `--allow-net` |
| 22 | `LISTEN` | `Net.listen` | `--allow-net` |
| 23 | `ACCEPT` | `Listener.accept` | `--allow-net` |
| 24 | `RECV` | `Socket.recv`; a file stream's, a child's and the parent line's reads | — |
| 25 | `SEND` | `Socket.send`; a file stream's, a child's and the parent line's writes | — |
| 26 | `CLOSE_SOCKET` | `Socket.close`, `Listener.close`, `Child.stop` | — |
| 27 | `SPAWN` | `Procs.spawn` | `--allow-run` — and the child gets what you pass, never more |
| 28 | `EXIT_CODE` | `Child.exit` | — |
| 29 | `CLOSE_FEED` | `close` on `Child.input()` | — |
| 30 | `SLEEP_MILLIS` | `Clock.sleepMillis` | — |
| 41 | `CWD` | `Env.cwd` | — |
| 47 | `LINK_STAT` | `Files.linkStat` | `--allow-read` |
| 48 | `WRITE_STDERR` | `Output.write` on `sys.stderr()`; `Sys.warn` | — |
| 49 | `SPAWN_SELF` | `Procs.spawnSelf` | `--allow-run`, as `SPAWN` |
| 52 | `SET_EXECUTABLE` | `Files.setExecutable` | `--allow-write` |
| 53 | `BIND_DATAGRAM` | `Net.bindDatagram` | `--allow-net` |
| 54 | `RECEIVE_FROM` | `Datagrams.receive` | `--allow-net` |
| 55 | `SEND_TO` | `Datagrams.sendTo` | `--allow-net` |
| 57 | `CLOSE_SEND` | `Socket.closeSend` | — |
| 59 | `EXEC` | `Procs.exec` — a **host program**, which `spawn` is not; a page has no form of it | `--allow-run` |
| 60 | `CHMOD` | `Files.chmod` | `--allow-write` |
| 61 | `OPEN_FILE` | `Files.openRead`, `openWrite`, `openAppend` | `--allow-read` to read, `--allow-write` to write |
| 62 | `CLOSE_FILE` | `close` on a file's `Input` or `Output` | — |
| 63 | `CLOSE_OUTPUT` | `close` on `sys.stdout()` or `sys.stderr()` | — |
| 64 | `LOAD` | `Modules.load` | — (a module runs in this program, with what you hand it) |
| 65 | `CALL` | `Module.call` | — |
| 66 | `UNLOAD` | `Module.unload` | — |
| 67 | `VALIDATE` | `Modules.validate` | — (compiles, and nothing more) |

What each request carries in `a`, `b`, `text` and `bytes`, and what each answer puts in which field, is
the pair of tables in design/system/0013 — the contract a new host implements.

**An answer arrives only from inside `request` or `waitAny`.** A request the host can answer at once —
the clock, an argument, a write — is answered inside `request`; the rest wait until `waitAny` is asked
about them, and **`waitAny` delivers only the ids it was asked about.** That is what makes `cancel` honest:
a request nobody waited for is still the host's when it is dropped (`DROP`), so a dropped spawn stops
its child unless it was started detached, a dropped connect is closed, and a dropped read's bytes go back
to the stream (operator, 2026-10-28; `issues/system/0370a`). A request that *takes* something — a
connection, a child, a file, bytes off a stream — is never answered inside `request` for the same reason.

`packages/box` is the widest consumer of all this — 65 applets in one program, and the differential
suite that keeps them honest.

### When a request fails

**Anything that can fail says why, in a category.** A host answers a `fault` number from std's table
beside its own words, and std turns it into the fault type the handle's `Result` names. The categories are
deliberately few: what a program branches on is "was it already gone", and what a person reads is the
message. The classification is one file, [`host/faults.ts`](host/faults.ts), shared by the three
JavaScript hosts — Deno's typed errors, Node's `code`s and the browser's `DOMException` names are three
vocabularies for the same facts, and `rm -f` must mean the same thing on all of them.

**In a browser the message is the category's own short phrase**, not the `DOMException`'s. A browser
says "A requested file or directory could not be found at the time an operation was processed.", which is
prose for a developer console and names neither the path nor the operation; after `rm: cannot remove
'f': ` it reads as a defect. A fault the host *named itself* keeps its own words, because "filesystem read
not granted to this application" says the page withheld the capability and "permission denied" says a
filesystem refused an operation, and only one of those is true.

**A read answers a `Read`** — `Data(bytes)`, `End`, or `Failed(why)` — three states in the type, so a
caller cannot mistake a broken read for the end of the input. `Read` lives in `core`, because the
streaming transforms in `gzip` and `stream` name it too and wac's types are nominal: two declarations of
it could never be converted into each other.

### Output, input and streams

`sys.stdout()` and `sys.stderr()` are `Output`s: `write` puts *exactly* those bytes on the stream, and
`line` adds the newline. `Sys.log` and `Sys.warn` are lines, and work from a `const` holder. A write whose
reader has gone answers `OutputClosed`, and an `OutputClosed` that reaches `main` unhandled ends the
program quietly with status 0 — `yes | head`. The two streams are separate jobs: `warn` is the program
talking about itself; `stderr().write` is the program passing someone else's bytes through, which is what
`packages/ssh` needs to reproduce a remote command's two streams exactly (issue 0014).

**A file is a stream of its own.** `files.openRead(p)` answers an `Input` and `openWrite`/`openAppend` an
`Output`, any number at once, each closed when done — a browser commits a written file only at `close`.
Everything else answers with the whole of something, which is fine for a filename and wrong for a pipe.
Measured on one 300MB file, peak RSS: **94MB streaming (`wc`)**, against a 57MB floor for the Deno runtime
itself; before streaming `wc` peaked at **1.5GB**. What genuinely cannot stream is what has to see
everything before it can answer a single byte — `sort`, `tac`; each applet's header says which it is.

### Files and directories

`stat` follows symbolic links, so it describes what a name leads to; `linkStat` describes the name. Both
questions are real — `find` wants the first, `tar` wants the second.

**`mkdir`, `remove` and `rename` are one tier, not three conveniences.** `writeFile` alone cannot express a
safe update: it truncates and then fills, so a reader arriving in between sees a half-written file. With
`rename` an application can write beside its target and move it into place, which on every filesystem this
runs on is atomic — `packages/box`'s `lib/safe.wac` is that. Both recursive forms (`mkdir -p`, `rm -r`)
have to be asked for, because the recursive form is the one that can destroy something it was not pointed
at.

A `Files` is a struct of functions, so a program narrows one before handing it on — `readOnly()`,
`writeOnly()`, `relativeTo(dir)` — or builds one with no host behind it, `MemoryStore`, or `Files.mounted`
over several.

### Sockets

**`listen` takes the address to bind, and it is not optional.** It took a port alone until issue 0025, and
the host bound `0.0.0.0` — so every server written here was reachable from every interface. For
`packages/tor`'s SOCKS proxy that was the difference between serving the person at the keyboard and running
an open proxy. `"127.0.0.1"` is loopback, `""` is every interface — the old behaviour, spelled out rather
than defaulted into. `accept` answers with the peer's address, and `Socket.fromLoopback` is the check that
makes a wide bind survivable.

**`Socket.port` and `Listener.port` are what a socket was given**, which is what makes port 0 worth asking
for: a program that wants a free port cannot pick one, and `listen(…, 0)` answers which it got.

**Watching two at once is `Ticket.any`.** Every request is a ticket, and a wait on several asks the host
once with all their ids:

```wac
auto r = socket.recv();
Ticket.any(r, sys.clock().sleepMillis(5000)).wait();   // the read, or five seconds
```

A deadline belongs to the wait rather than to each request, so the same shape bounds a `connect`, an
`accept`, a `readFile` or a child's exit (issue 0018).

### Children

```wac
Authority given = Authority(sys.files().readOnly(), null, null, null);
auto started = sys.procs().spawnSelf(["sort", "-n"], given, Launch.plain()).wait();
```

**A child gets what you hand it and nothing more**, as an `Authority`: a `Files` — a host one, narrowed,
or one this program composed and serves the child itself — and the network, environment and processes,
each present or not. The host intersects that with its own grants, so a parent built without
`--allow-net` cannot hand the network to anyone. Spawning itself needs the `run` grant, yourself included
(operator, 2026-10-24).

**A child has two output streams and an input**: `output()`, `errors()` and `input()`, and `exit()` for
its status. Closing `input()` ends what it reads without stopping it; `stop()` stops it. A child stands
where its `Launch.cwd` says, and `inheritIn`/`inheritOut` give it this program's own streams instead of
queues.

**`spawnSelf` is how a page has programs at all.** A tab has no directory of programs, but every built
program carries its own module, so `spawnSelf(args, …)` runs it again with different arguments — and a
program whose `main` dispatches on argv is therefore 65 programs. That is what `packages/box` is.
`example/twin.wac` is the idea in forty lines, and issue
[0030](../../issues/system/closed/0030-a-page-cannot-spawn-so-the-browser-shell-runs-applets-in-process.md).

**`exec` is a host program**, which `spawn` is not: it needs `--allow-run`, a page has no form of it, and
its output comes back whole unless `Launch.inheritOut`.

**It is not a sandbox against arbitrary JavaScript.** A wac child cannot reach past what it was handed
because wac has no ambient anything; JavaScript in a spawned worker inherits the process's permissions.
So this is a composition and concurrency primitive, and the grants are meaningful for wac children and
advisory for anything else. issues/system 0015 has the reasoning.

## Building an executable

There used to be a separate `runApp` that compiled and spawned a worker by a route of its own,
which meant two launchers and two workers: a dev loop that could be green while the shipped
artifact was broken, and a change to the application contract that had to be made twice. Now
there is one path, and the dev loop exercises it — which is why `wac run` above and
`app:build` here are the same machinery.

```sh
wac task app:build packages/platform/example/wc.wac --allow-read -o wc
./wc README.md
```

27K, self-contained: the wasm is base64 inside it, and so are the bindgen wrappers and the
whole host. Nothing is read from this repo at run time, so the file can be copied anywhere
Deno exists.

**`--optimize` runs `wasm-opt` over the module**, which is 36–41% off a real program — `wc`'s
executable goes 274 KB to 219 KB and `box`'s shell 927 KB to 636 KB, for a second and nineteen
seconds respectively. It is a flag rather than the default (wac-mono 0094) because without it a built
artifact is *exactly* what the compiler emitted, and this repository debugs by comparing modules:
rung 4's canonical form, `wac task size`, `deadexports` and the coverage instrumentation all have to
say which side of an optimiser they are on. A coverage build refuses the flag outright — counters are
branch-indexed and an optimiser may renumber the branches they count.

The feature set handed to binaryen is named rather than `All`, and that is a runtime fact rather than
taste: with `All` it emits *exact* heap types, which no engine here accepts without a flag, and the
optimised `wc` died on its first instantiate saying so. A build flag must not produce an artifact that
needs an engine flag.

**Capabilities are granted at build, not at run.** The built program takes no permission
flags of its own and every argument goes to the application, so it behaves like any other
program. Whoever packages it decides what it may do; whoever runs it cannot widen that.
The same source built without `--allow-read` reports `filesystem read not granted` and
exits 1, and no argument can put the capability back.

**The shebang is exactly the grants.** A program granted nothing asks for nothing:

```
#!/usr/bin/env -S deno run                    # no capabilities
#!/usr/bin/env -S deno run --allow-read       # built with --allow-read
```

That is worth the trouble it took. The obvious way to spawn the worker is
`new Worker(import.meta.url)` — the file spawning itself — but that needs `--allow-read`
on the file, which put a permission in every shebang whatever the program could do, and
read as a filesystem grant to anyone auditing it. So a built program carries the worker's
source as a string and spawns it from a blob URL, which needs no permission at all.

The build is two passes for that reason: the worker bundle holds the application and the
wasm, and the launcher carries it as a string.

## Node

```sh
wac task app:build packages/platform/example/wc.wac --allow-read --target node -o wc
./wc README.md
```

The same wac, the same wasm, the same bridge and opcodes; a dozen closures and the thread
API differ. Node's `worker_threads` takes source directly with `{ eval: true }`, which
suits a bundled program better than a blob URL since there is no URL to make, and Node 22
runs an extensionless file as ESM with top-level await, so a built program is still `./wc`.
A test builds both targets and checks they print the same bytes.

**Node has no permission system, so the capability world is the whole boundary there.**
Under Deno a build that withholds the filesystem is enforced twice — by the world and by
the process — and under Node only once. The shebang is plain `#!/usr/bin/env node`,
because there is nothing for it to state. An application that is denied a capability still
gets `not granted` and exits 1; what is missing is the second line of defence if the
launcher itself were wrong.

The bundle spawns **itself**: a single file cannot reference a sibling worker module, so
`new Worker(import.meta.url)` re-runs it, and it notices it is on a worker and runs the
application rather than launching one. A shebang does not stop a file being loaded as a
worker module — that was checked, not assumed.

## The bridge

The JavaScript hosts run a program on a **worker**, because a worker is allowed to block, and answer its
requests on the main thread through a `SharedArrayBuffer`: a ring of `CALL_SLOTS` slots rather than one
mailbox — see `host/layout.ts`. `waitAny` is a wait on one completion counter followed by a rescan, which is
also exactly what `poll` over sockets is.

### Who owns a slot

Every state change on a slot is a compare-and-exchange, not a store, and every answer is
checked against the slot's **generation** before it is written. That is not defensive style; it
is four bugs, all the same shape — the host and the worker disagreeing about whose call a slot
holds — and all four were live in a bridge whose tests passed:

| what happened | how it showed |
|---|---|
| `claim` published a slot as pending before the opcode was written | `no handler for capability 0` |
| a cancelled call's answer written into the slot another call had claimed | issue 0023: a 30-second bound expiring after 15 |
| `take` overwrote a cancel with `RUNNING`, so nobody owned the slot | a slot lost for the life of the program |
| `reply` overwrote a cancel with `READY`, same result | a slot lost, and the answer unclaimable |

The last two are invisible until the ring runs out, and then the failure is a park in whatever
call happens to be next. The first was unhittable at four slots and appeared within three suite
runs at sixteen slots. Only the second was ever reported from the field, and only because a tor client
was dropping healthy relays.

So `test/fuzz.test.ts` exists: a seeded random sequence of submit, cancel, collect and waitAny
against a host that answers at delays and sizes the request itself specifies, so the whole thing
is deterministic and a failure replays from its seed. Every request carries a nonce the handler
echoes, which turns cross-talk from something you infer into something the harness catches, and
the run ends by checking that every slot came back free. It caught the third and fourth bugs and
catches all four when they are put back — each with its own signature. Eight seeds in the suite,
about a second; `WAC_FUZZ_SEEDS=250` for a deep sweep, which is what to run after touching
`call.ts`, `respond.ts` or `layout.ts`. The fourth bug was at the eighth seed.

### The ring's limits

**The slot count is also a ceiling on how many handles a program can watch**, since watching N
means N outstanding `recv`s holding N slots, and writing needs one more. It went four → sixteen
→ 128 for that reason: four meant three handles, and `pipe.wac` already watches three, so a
three-stage pipeline could not be written; sixteen meant a relay could not fan in more than a
dozen sockets. Exceeding it is worse than a limit — the held slots are RUNNING, not READY, so it
is indistinguishable from backpressure and parks silently.

**What paid for 128 slots is that a slot no longer owns a buffer.** Sixteen slots × 128KiB was
2MiB of shared memory per bridge whether a program made one call or none, and the natural way to
raise the slot count multiplies it: 128 would have been 16MiB, four times over for a shell with
four applets running. So the payload buffers are **pooled** — eight per direction, taken for the
length of one copy and handed straight back — and a slot is a 32-byte control record with a
4KiB inline area of its own. 2.5MiB against the old 2MiB, for eight times the fan-in.

The inline area is not an optimisation, it is the progress guarantee: **an answer can always be
written.** The first version of the pool deferred an answer that could not get a buffer, and
deadlocked — the buffers are held by answers the worker has not collected, and a worker parked on
one particular call collects nothing, so the answer it waits for never comes. With an inline
area, a pool that is empty costs round trips and nothing else.

How many round trips is the whole question, and 256 bytes — the size it was first written at —
made the fallback a cliff: `bench/ring.ts` measures 300 × 1MiB answers with 32 in flight, and at
256 bytes that cost seven times what 8 in flight did, because every answer past the eighth
crawled 256 bytes at a time. 4KiB is the knee of that curve (1694 → 384ms for +0.46MiB), and it
is why the inline area is sized against the pool's *absence* rather than against a typical
answer:

| inline | 256B | 1KiB | 2KiB | 4KiB | 8KiB |
| --- | --- | --- | --- | --- | --- |
| 300 × 1MiB, 32 live | 1694ms | 712ms | 512ms | 384ms | 300ms |
| bridge | 2.04MiB | 2.13MiB | 2.25MiB | 2.50MiB | 3.00MiB |

Pooling makes ownership shared, which is a new class of bug, and it produced one immediately:
handles were stored as an index with -1 for "none", in memory that starts at **zero**, so every
untouched slot claimed to hold buffer 0 and the first `release` of one handed that buffer back
while a live answer was still in it. The fuzzer read one call's answer out of another's —
`asked as 15, answered as 24` — on its first seed. Handles are one-based now, so zeroed memory
means "none" by construction, and `test/pool_model.test.ts` walks every reachable state of two
slots over one buffer with that bug and its mirror image as mutants.

**When the host stops, every wait raises rather than parking.** A worker in `Atomics.wait` is
waiting for the responder loop and nothing else, so a loop that has gone makes every one of those
waits permanent — and what that looks like from outside is a program that stops with no error
anywhere. Answering the outstanding calls is not enough on its own, because a worker can be parked
with nothing outstanding: waiting for a free slot, waiting for a request buffer, or holding a slot
it claimed and never published. So the host raises a `HOST_GONE` flag in the control block and bumps
the completion counter; every park checks the flag on both sides of its wait, and the call fails
with `the host stopped answering`. The flag is deliberately sticky — a bridge whose host has gone is
finished, and a half-restarted world is worse than a clear failure.

A ticket abandoned rather than cancelled still fills a slot, so the ring keeps its backstop:
`all 128 call slots hold answers that were never taken, from: RECV × 127, ACCEPT`.
A ready slot can only be freed by the thread that submitted it, so a submitter finding all
every slot ready is provably stuck rather than merely waiting — an error, not a park. It names
the opcodes because the call that discovers the full ring is rarely the one that leaked.

### Composing them

Two examples exist to show that handles compose without any further capability, and both were
written against the world unchanged:

`example/pipe.wac` — `stdin -> child -> child -> stdout`, a shell's `|` with no shell. Three
handles are live at once and the loop waits on whichever moves; it never asks which kind a
handle is, because standard input at handle 0 answers `recv` exactly as a child does.

```sh
printf 'b\na\nb\nc\n' | pipe box.worker.js sort uniq      #  a  b  c
```

Note the deadlock it cannot have: a shell pipeline needs an OS buffer between stages, and a
stage that stops reading while the one before it keeps writing wedges both. Here all three
reads are in flight, so a slow second stage parks the *pump* rather than the first child.
**Two things supply the backpressure**, and they are at different distances: the ring, whose
`CALL_SLOTS` an outstanding call holds one of — this said "four slots" long after the ring had
128, which is the mistake `CALL_SLOTS` exists to stop anyone making twice — and, nearer the
program, the child's own output queue, which holds 8 MiB before a writer waits (`QUEUE_CAP` in
`host/children.ts`, and the same number in `native/src/streams.rs`, which had no cap at all
until issue 0120). 5MB through `cat | cat` comes out byte-identical, checked by running it.

`example/inetd.wac` — accept a connection, spawn a program, relay bytes until either side
finishes. The handler knows nothing about networks: it reads standard input and writes standard
output. Serving `packages/sh`'s shell this way gives a remote shell whose every command runs
with grants the *server* chose:

```sh
wac task app:build packages/sh/src/sh.wac --worker -o sh.worker.js
inetd 9000 sh.worker.js
```
```
$ printf 'seq 1 20 | grep 1 | wc -l\necho $((6*7))\ncat /etc/hostname\n' | nc 127.0.0.1 9000
11
42
                     # nothing: the shell has no filesystem, though its parent does
```

That last line is the property worth having. It is the artefact issue 0015 predicted — "an SSH
server offering a sandboxed shell where every command is a wac program with grants the server
chose is a thing Unix cannot build" — reachable because a socket and a child are the same kind
of thing.

## What the boundary is, and is not

`Sys` and the handles it gives out are the complete list of what an application can reach, and
for a **wac** application that is enforced by the language: wac has no ambient anything, so
the only way out of a module is the host's four calls its adapter was handed. A wac program
cannot call `Deno.readFile` because there is no way to write it.

It is *not* enforced by the runtime. The launcher spawns its worker as
`new Worker(url, { type: "module" })`, which inherits the process's grants, so JavaScript
running in there could reach past the world. Nothing does — the code in the worker is
generated by this package — but the distinction matters if anything ever puts other
people's JavaScript on that thread. Dropping the permissions is possible on Deno
(`deno: { permissions: "none" }`, measured to work) but needs `--unstable-worker-options`,
which would put a non-capability flag in the shebang of every program; the shebang saying
exactly what a program can reach is worth more than closing a hole nothing is reaching
through.

Node has no permission model at all, and a browser worker has the origin's authority, so
neither could enforce it even in principle. The language is the boundary on all three.

## The browser

```sh
wac task app:build packages/platform/example/wc.wac --target browser -o wc.html
box httpd -8080 . -x        # -x sends the two headers a page needs
```

One self-contained page, 72K for `wc`: the launcher inline, the worker as a string inside
it, the wasm inside that. The bridge needed **no changes at all** — `layout.ts`, `call.ts`
and `respond.ts` are shared verbatim and contain no reference to any host, because a page
with a worker is exactly the shape they already assume: a thread that may block and a
thread that may not.

What the translation costs is the interesting part, and it is not the plumbing:

| capability | in a page |
|---|---|
| `NOW_MILLIS`, `MONOTONIC_NANOS`, `RANDOM_BYTES` | unchanged |
| `ARG`, `ARG_COUNT` | from the query string, `?a=first&a=second` |
| `WRITE_STDOUT` | appends the exact bytes to the page |
| `READ_FILE`, `WRITE_FILE`, `STAT`, `READ_DIR`, `MKDIR`, `REMOVE`, `OPEN_FILE` | the Origin Private File System |
| `RENAME` | **a copy and a delete, so not atomic** |
| `SET_EXECUTABLE` | **refused** — OPFS has no mode bits, so `FAULT_UNSUPPORTED`: the capability is here and the backing cannot |
| `CHMOD` | **refused**, for the same reason and with the same fault — a whole mode is no more expressible in OPFS than one bit of one |
| `READ_STDIN` | always empty |
| `ENV` | every variable unset — a page has no environment to withhold |
| `CONNECT`, `LISTEN`, `ACCEPT`, `RECV`, `SEND` on a socket | **refused** |

**A page has no TCP**, and that is the finding. `fetch` is not a socket and neither is a
WebSocket, so `connect` is absent rather than approximated — an application gets an error
it can report instead of one protocol that works by accident. `box get`, `box gets` and
`box serve` do not run here, and no amount of shimming would change that.

### Interactive pages

**A page is built with [`packages/web`](../web/README.md)**: `export async i32 main(Page page)`, run in a
worker (or with `--in-page` on the page's own thread) and waiting with `await`, with no
`SharedArrayBuffer` and no headers to serve — with `page.sys` holding what `--grant read,write` grants,
whose files are the browser's own storage. `example/{life,pixels,ripple,notes,procs}.wac` are those, and
so are the shell and the desktop in `packages/box/example/`.

This host's `Page` — a third profile served over the bridge, with `page(Core, Cli, Page)` as its entry
point — was deleted in design/system/0011 step 7, once nothing ran on it. `--target browser` still
builds a `main(Sys)` program into a page that shows its output.

## How an asynchronous host looks synchronous

`READ_FILE` is `await Deno.readFile` on the main thread. From wac it is a ticket that can be waited for:

```wac
auto read = sys.files().readFile(path).wait();
```

The application runs on a **worker**, because a worker is allowed to block. The host's `waitAny`
writes its request into a `SharedArrayBuffer` and calls `Atomics.wait`, which parks
the thread *with the wasm frame still on its stack*. The main thread is parked on the same
memory with `Atomics.waitAsync`, so it never blocks: it wakes, does the asynchronous work,
writes the answer back and notifies. The worker resumes and returns.

`packages/stream` proved this mechanism for a byte pipe; this generalises it to
request/response so any capability can use it. **Requests travel through the buffer, not
through `postMessage`** — a blocked worker cannot deliver a message, which is the deadlock
`stream`'s README warns about.

There is a test for the part that matters: a handler that takes 50ms of real asynchronous
time, with the main thread counting timer ticks throughout. The worker waits; the main
thread keeps running.

## Layout

```
host/ops.ts         the request numbers the bridge carries — std's `OP_*`, which a test holds them to
host/layout.ts      the shared-memory layout, in one place
host/call.ts        the worker side — hostCall, which blocks
host/respond.ts     the main-thread side — serves calls without blocking
host/provider.ts    `__wacHost`'s four calls over a bridge, and every answer in the one shape
host/deno.ts        Deno's implementations. Note how much of it is `await`
host/node.ts        the same table over Node's APIs
host/browser.ts     the same table over a page's
host/entryNode.ts   the launcher and worker halves for Node
host/entry.ts       the launcher and worker halves of a built program
../../native/       the fourth and fifth hosts: Rust on wasmtime and on V8, no JavaScript at all
build.ts            builds an application into one executable
app.ts              build and run, in one step
example/wc.wac      an application, entire
```

## Writing one

Export `main(Sys sys)` — or `main()` for a program that needs nothing — and return an exit code, `void`,
or a `Result`, `async` or not. The compiler adds the adapter a host calls (`packages/wacc/src/program.wac`),
so there is nothing to re-export and nothing to register.

**A worker may call it more than once**, which is how `harness/appRun.ts` runs a program per test case for
4ms instead of 67 (wac-mono 0076). wac has no module-level variables, so a program's whole state is
reachable from `main`'s frame and is gone when it returns. The constraint is the host's: **the four calls
are bound once per module**, because bindgen registers one wasm function per host function and [only
sixteen per signature can be live](../../spec/8-tooling/48-bindgen.md) — registration is by identity, so
binding new closures per run burns slots until it fails.

Testing needs no host: `packages/web`'s `system_test.wac` builds a `System` from wac closures that record
each request, answers them by hand with `answered`, and asserts on what the program did.

## Rules that are not style

**Requests return values; they never fill buffers.** Arrays *copy* across the boundary, so a host writing
into one the program passed writes into a copy.

**Requests are coarse.** Behind each is a thread parking and unparking: nothing per file read, ruinous per
byte. `readFile`, never `readByte`.

**One thing at a time.** While the application is parked in a request, nothing else can enter it.
Concurrency means more instances.

## The fourth host, which is not JavaScript

Three of the four providers are JavaScript — browser, Node, Deno — so they share the transport, the
worker model and the event loop, and a design flaw common to all three is invisible from any of
them. The fourth is Rust on wasmtime, in `native/` at the repository root rather than in this
package, because a crate inside `packages/` is a directory the test walkers have to be taught to
skip. It closed
[0087](../../issues/system/closed/0087-wacland-under-wasmtime-a-second-host-with-no-javascript.md).

**Nothing was reimplemented.** The `SharedArrayBuffer`, the `Atomics.wait`, the sequence counters
and the ring of slots have no counterpart there — a ticket is an entry in a table and a wait is a
condition variable — which is the design's own D9 assumption meeting a host that shares neither the
transport nor the concurrency model. What crosses between the hosts is an image and a set of
answers, and a session that changes nothing writes a byte-identical image on either.

Two of its properties are things the JavaScript hosts cannot offer. A child is a fresh `Store` on a
fresh thread built from an `Arc<World>`, and **nothing from the parent's store crosses** — the type
system says so, since a `Val` is not `Send` — so `spawn` is a confinement primitive here where a
Deno worker inherits the whole process's permissions. And the deadline of a wait lives in the
runtime's own table rather than inside a worker's memory, so a scheduler can see it: D12 and D13
have a seam rather than a mode, but the seam is in rather than retrofitted.

## What is not here yet

- **A service shape.** `main(Sys) -> i32` is the CLI application, and each *call* runs a program and
  returns — a worker will now serve several such calls, but that is the launcher's business
  and not a shape the application can see. A long-running *server*, which keeps state
  **between** requests, wants `onBytes(this, u8[]) -> Served`; `packages/server` already
  defines it and drives it from its own host, and folding that into the launcher is the next
  step. Note what 0076 established about it: repeated calls did not need this, so the case
  for it is state that outlives a call rather than the cost of starting one.
- **A page has no network at all.** No TCP, which is structural — `fetch` is not a socket, so
  `connect` is refused rather than approximated — but no `fetch` capability either, which is
  merely unwritten. It would be request/response rather than a stream, so it revives none of
  `http`, `tls`, `tor` or `ssh` in a page; the browser does that layer itself.
- **An element's event carries no pointer button.** Its modifiers are there, so Shift and `^C` can be
  read, but a left-drag and a right-click look alike. The first thing anyone drawing on a canvas with
  `pixels` will want next.
- **An OS process.** Deliberately not here, and not planned — see issues/system 0015,
  closed `wontfix`. Running arbitrary host programs is a non-goal: it makes every grant
  transitive, and the interesting artefact turned out to be the other one, where a child is
  a wac program with grants its parent chose.

Four things this section used to list are done: the browser provider (`--target browser`, and it
now runs in one, see `test/browser_live.test.ts`), outbound network (`connect`/`listen`/`accept`),
**the fourth host** — see below — and **`spawn` on every host**.

That last one is worth spelling out, because this section described the shape of the fix and then
kept claiming the fix had not happened. It read: "`spawn` on Node. Deno only. `host/children.ts`
takes `startWorld` as a parameter precisely so Node can follow without editing it, and nobody has
written that side. Browser is a separate question: `Worker` exists there, but a page has no
filesystem to read a bundle from, so what `spawn` should even take is undecided." Somebody wrote
that side. All three JavaScript hosts now spawn through the one `spawnChild`, differing only in how
a worker is made — `blobWorker` for Deno and the browser, an `eval`'d source string for Node — and
`test/spawn.test.ts`'s "Node spawns the same way, from the same code" builds a runner and a child
for Node and runs them. The browser question was answered rather than left undecided, and the answer
was **`spawnSelf`**: a tab still has no directory of bundles, so a program spawns *itself* with
different arguments — see [Children](#children) above. What is left of it is not a capability but a
filesystem: no page has a directory of worker bundles, so a `$WACPATH` program off a path does not
run in a tab. Nobody has asked for one.
