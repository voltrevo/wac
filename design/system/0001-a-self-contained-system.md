# 0001 — Wacland: a self-contained system

- **Status:** active
- **Opened:** 2026-08-05
- **Written by:** agent-a, from a decision with the operator
- **Extended:** 2026-08-06 by agent-c, folding in the frame from
  [voltrevo/wac-mono#38](https://github.com/voltrevo/wac-mono/issues/38)

## The name, and the external issue

The system is called **Wacland**. GitHub #38 states the same direction as this document in a wider
frame, and it was written four days later; the two are one plan and this is the authoritative copy.
GitHub is an independent external guide, read inward and not written back to — so what #38 adds is
folded in below rather than linked to, and where the two disagree this wins.

What #38 supplied and this did not: the name, the four hosts stated as a portability requirement, the
layering rule (D8), the boundaries, and the arrival test. What this has and #38 does not is the part
that makes it a plan — the decisions with their reasons, the eight steps, and the state of play.

## What we are aiming at

`packages/ssh`'s demo should present a machine. Log in over real OpenSSH, land in a shell, and find a
filesystem with `/etc/passwd`, a home directory, `/bin` full of programs, a process table you can
`ps` and `kill`, and a `^C` that interrupts — none of which touches the host it happens to be running
on. The browser terminal should be the *same system* in a tab rather than a second port of the idea,
and eventually a desktop over it.

What it is **not**: a Linux emulator. No ELF loading, no syscall emulation, no qemu. The userland is
`packages/box`'s applets and `packages/sh`, which are wac programs compared against GNU's behaviour;
the system underneath them is wac too. "Convincing" means the parts that exist are real, not that
everything a Linux has is present.

### The same system wherever it runs

One image, and the same users, files, programs, shell behaviour and services in each of:

- a browser;
- Deno, Node or Bun;
- the userland of a bootable system — a minimal Linux kernel and Wasmtime, no JavaScript at all.

The host supplies execution and the capabilities it is explicitly granted. Wacland supplies everything
the user experiences as the system. An image moves between hosts carrying its state; it does **not**
carry live processes or connections.

**The arrival test** (#38's "first convincing proof", and better than anything this document had): load
the same image in two substantially different hosts and demonstrate the same users, files, installed
programs, shell behaviour and system services in both, with no implicit access to either host.

> **Passed on 2026-08-08.** All five: files, installed programs and shell behaviour in
> `packages/platform/test/arrival.test.ts` — an image written under Deno is the same system under
> wasmtime and back again, all 817 of the shell's differential corpus agree across the two, and a
> session that changes nothing writes a byte-identical image on either host — and **users and system
> services** in `arrival_users_test.wac`: `packages/ssh`'s `sshd` under wasmtime serves the image the
> JavaScript host wrote, a real OpenSSH client logs in as each of two users, each lands in their own
> home, and neither can read the other's private file. The mode and the owner come out of the image;
> the whole thing is one file owned by whoever ran the process, so the operating system could not
> enforce it even if it tried.

Read "substantially different" as **one JavaScript host and one that is not** — D9. Two JavaScript
hosts satisfy the words and prove nothing, since they share the transport, the worker model and the
event loop.

### What it is not

Not a Linux emulator, and the boundary is worth stating in full because "self-contained system" invites
the assumption: no Linux syscall ABI, no ELF or arbitrary native binaries, no obligation to reproduce
Linux internals, and no dependence on a particular JavaScript or WebAssembly runtime. A graphical
desktop is step 8 rather than part of the definition, though the mechanisms under it should support one.

## Why this is a small architectural step

Nothing here needs a new host feature. It needs work, but the shape is already load-bearing:

- **A capability world is a struct of funcrefs.** `packages/sh/test/wac/probe.wac` already builds a
  whole `Cli` out of wac functions to fake a filesystem for the coverage probe. A kernel, in this
  design, is a wac program that *synthesises worlds for its children* — the same trick, kept.
- **Two process models exist.** `spawn`/`spawnSelf` give a real one (a worker, its own instance, its
  own grants); `pushChild`/`popChild` give an in-process one, which is what runs 65 applets in a
  browser tab. What is missing is that nobody keeps a table.
- **A userland exists.** 65 applets, a shell tested against bash script for script, `ssh`/`sshd`,
  `httpd`, `tar`, `gzip`, `zstd`, `json`.
- **Grants already narrow by construction**, which is a better answer than mode bits to "what may this
  session do". A session's world is built with what it is allowed and nothing else.

## Decisions

**D1 — the filesystem lives in wac.** A VFS in a wac package, not a host implementation. That is what
makes one system serve Deno, Node and the browser identically, and it is the only way a session can be
sealed off from the host filesystem while still being a *filesystem*.

> Landed as `packages/fs`, and the language narrowed the shape: no closures and static dispatch mean a
> filesystem cannot be a facade of funcrefs or an abstract base with two implementations. It is one
> concrete type with a **mount table**, which was going to be step-something-later and is in fact the
> natural shape from the start — a host mount is how D3 is expressed.

**D2 — two backings, both first-class: memory and a persisted image.** In-memory is the default for
tests — hermetic, fast, and no `/tmp` — and persistence is what makes the demo a machine rather than a
transcript. Neither is the "real" one: the same VFS with a different store.

**D3 — host access is an explicit mount, not the default.** Today a shell's capabilities are the host's
filesystem, and that stays available *by asking* — a mount, named in one place — rather than by being
what you get when you say nothing.

**D3a — two binaries** (operator, 2026-08-05). `wacsh` stays an ordinary shell over the real filesystem,
and a separate entry point boots an image and serves a system from it. Clearer than a flag for the demo —
what each one is for is in its name — at the cost of two entries to keep in step, which is what the
differential corpus is for: both run the same scripts.

**D4 — the kernel is a wac program that synthesises capability worlds.** A session gets a `Cli` whose
`readFile`, `writeFile`, `readDir`, `stat`, `remove` and `rename` are the VFS's, whose `arg`/`env` are
the session's, and whose `spawn` goes through the process table. No ambient anything, which is the
property the capability world already has and which this must not spend.

**D5 — users and permissions are data in the image.** `/etc/passwd` is a file the system reads, not a
host concept, and ownership is stored beside the inode. Host permissions are not consulted and cannot
be, since the image may be a single blob owned by whoever ran the process.

**D6 — nothing is faked to look complete.** A process table is a table or it is absent; `ps` printing
plausible rows would be the "wrong answer, quietly" shape this repo keeps removing. Where something is
not implemented, it says so in those words.

**D7 — differential testing stays the oracle.** The applets keep being compared against GNU coreutils
and the shell against bash. The VFS is an opportunity here rather than a threat: the same scripts can run
against a host mount *and* against an image, and any divergence between those two is a VFS bug with a
reference answer.

> Landed 2026-08-08, and it had not existed until then: `deno task corpus:backings` runs all 817 of
> `packages/sh`'s corpus through **three** backings — memory, an image, and a host mount — and
> `packages/box/test/wac/backingsprocess_test.wac` runs the gate's share. All 817 agree. The test that matters most
> is the third one, which checks the image *persists across processes* and the memory session does not:
> three identical things would agree perfectly, and a differential that cannot tell its subjects apart
> reports nothing while looking busy.

**D8 — POSIX is a personality over a native core, and the dependency runs one way** (#38). Wacland
should not treat POSIX or Unix abstractions as fundamental merely because they are familiar. The native
foundations are the ones this repo already reaches for — explicit capabilities, structured process
lifetimes, typed communication, supervised services, portable system objects — and POSIX and GNU
behaviour are a *compatibility personality* built over them.

> The POSIX personality may depend on the Wacland core, but the Wacland core must not depend on the
> POSIX personality.

The reason to write it down now, before there is a core to violate it: `packages/sh` and `packages/box`
are the userland and they are POSIX-shaped, so the natural drift is for the core to grow whatever they
happen to need. These abstractions are deliberately unstable while Wacland and wac are young.

**D9 — Wasmtime directly is the portability proof; bootable is packaging on top** (operator,
2026-08-06). The three hosts today are a browser, Deno and Node, and all three are JavaScript. Bun
would be a fourth JavaScript host and prove nothing new. **Wasmtime is the first host that is not**, so
it is the only one that tests D8's claim at all.

Running under `wasmtime` as an ordinary program comes *before* a bootable image, because bootable is
Wasmtime **and** no operating system **and** a kernel **and** `init` **and** a block device, and only
the first of those says anything about whether Wacland is portable. One variable at a time.

What that separates, and the distinction is the useful part:

- **the transport is JavaScript's** — the `SharedArrayBuffer`, `Atomics.wait`, the sequence counters,
  the responder. It exists to park a worker while an asynchronous host runs, and under a synchronous
  host it should not exist at all.
- **the interface is not** — a request returns a *ticket*, and `waitAny` takes a set of them and a
  deadline. That is the right shape whatever the host: asking for something external must not imply
  serialising on it, which is why the bridge went from one mailbox to a ring of slots in the first
  place. Two files at once, a relay between two sockets, several children.

So the second binding implements `Pending<T>` **properly**. A host that resolved every ticket
immediately would satisfy the types and quietly make every program that overlaps requests sequential —
D6's shape exactly, and worse than not having the host, because it would pass.

**D10 — the host is a native runtime, written in Rust on wasmtime** (operator, 2026-08-06). Not
`wasmtime run`, which cannot host this: a wasm module cannot instantiate another wasm module, so
`spawn` is impossible without an embedding, and the thirty-six capability funcrefs have to come from
somewhere. **Spawn is not optional** — it is what makes a pipeline concurrent (`pushChild` runs stages
one at a time, which is why `yes | head -1` does not terminate as bash's does) and it is step 3's
whole subject.

So this is a runtime binary whose job is to run wac programs: the peer of `deno.ts`, `node.ts` and
`browser.ts`, in the role Deno plays but Wasm-native and with no JavaScript in it. Rust rather than the
C API that `cc` could build today, because the runtime's job is *confinement* and the parts it needs —
a ticket table, a thread per child, message queues between them — are exactly what C makes
error-prone.

It is also the **simpler** host, which is the strongest evidence for D9's split. The
`SharedArrayBuffer`, `Atomics.wait`, the sequence counters, the ring of slots and the responder all
exist to park a worker while an asynchronous host runs. Native code blocks the calling wasm thread
directly and completes tickets from its own threads, so the whole transport collapses to a ticket
table and a condvar. The artifact simplifies too: no launcher, no bundle, no base64 — a `.wasm` and a
manifest of grants.

**D11 — no WASI, in either direction** (operator, 2026-08-06). A wac module built today imports
**forty-three functions, all of them `wac.cbN` callback dispatchers, and nothing else.** No ambient
namespace exists, and none is added:

- **the guest imports no WASI.** WASI is a namespace of syscalls a module declares and then has,
  narrowed afterwards by preopens and configuration. A capability struct is the inverse — exactly what
  was granted, and reading it tells you what the program can reach. With both present the second stops
  being true: `sealed.wac` is a session built with no filesystem grants at all, and a preopen is a
  mount nobody named, which is D3 undone. `Pending<T>` would not survive it either, since WASI preview
  1 blocks by default and half of a program's I/O would stop composing with `waitAny`.
- **the runtime does not use WASI internally.** It is native code; it has `std::fs`, `std::net` and
  threads. WASI is a way for *wasm* to reach the operating system and the runtime is not wasm.

That second point retires a constraint recorded here earlier: `poll_oneoff` subscribes only to
descriptor readiness and clocks, so a ticket for `render`, `nextEvent` or a child's exit would have had
no subscription. That was premised on WASI being the readiness mechanism. In a native host `waitAny` is
a condvar over a ticket table and readiness is whatever completes it — a socket, a timer, a child
exiting, an event queued by the embedder — uniformly.

**Where WASI would earn a place is later, and above rather than below.** If Wacland is ever to run wasm
it did not compile, those modules speak WASI, and the runtime should then implement WASI *over* the
capability world: `path_open` resolved through the VFS, preopens being mounts, `fd_read` becoming a
ticket. That is D8 one level down — WASI is to the runtime what POSIX is to the userland, a
compatibility personality over native foundations and never the foundation. Written down now so that
whoever wants it builds it that way round.

**D12 — a fully deterministic execution mode is a goal of the native runtime, and only partly reachable
before it** (operator, 2026-08-06). Everything hard about testing this system comes from interleaving: a
zero-length write ended a stream *only when a reader happened to be parked* (0078); a corpus hangs about
once in fifty runs *and only on an idle machine* (0082). The response so far has been to make the
semantics enumerable — the queue, the child lifecycle and the bridge protocol are pure transition
functions with every interleaving walked in `packages/platform/test/*_model.test.ts` — and that catches
design bugs, but it cannot reproduce a *run*.

Reproducing a run needs the schedule to be ours. **In the JavaScript hosts it can only be partly ours**,
and the boundary is worth stating precisely rather than discovering:

- **what we can own today.** A worker makes progress only when the host answers it, so a test-mode
  scheduler can let exactly one worker run at a time and choose the order answers are delivered in. When a
  program parks on `waitAny` with several tickets ready, which one it sees is *our* choice — the protocol
  permits either, and today it is decided by timing.
- **what we cannot.** Whether a real `readFile`, `accept` or child exit has completed is the kernel's
  business. So the *choice set* — which workers are unblockable right now — is not reproducible from a
  seed, even though the choice among them is. A worker parked on two OS-backed tickets, one of which will
  never complete until something else is unblocked, cannot be distinguished from one that is merely slow.
- **so the honest claim is "deterministic over a world the scheduler owns"**: an in-memory filesystem, a
  scripted network. `packages/fs`'s memory backing and `sealed.wac` already provide the first of those.
  Anything touching the real filesystem or a real socket gets improved reproducibility, not a guarantee,
  and the mode should say so rather than implying more.

**In Wacland the boundary moves.** The runtime owns the ticket table, the threads, the clock and the
syscalls, so nothing can complete except by its own doing: the choice set becomes ours, "nobody can
proceed" becomes a *proven* deadlock rather than an inference from frozen counters, and a seed really is
the whole schedule. That is a reason to build the ticket table and `waitAny` with a scheduler seam in them
from the start, rather than adding one later — the runtime should be able to answer "who is runnable?"
without asking the operating system.

**Until then, record rather than only generate.** A seed cannot carry what the kernel decided, but a log
of the choices actually made can: a run that wedges leaves its schedule behind, and replaying the log
reproduces it where replaying the seed might not. That is what would settle 0082, which has been observed
half a dozen times and never once with its interleaving in hand.

**D13 — virtual time: the clock is a scheduling decision, not a measurement** (agent-b, 2026-08-06,
prompted by the operator). D12 makes a run *reproducible*. It does not make a run *fast*, and those are
separate properties: a runtime can own the clock completely and still make every test wait eighteen
hours. Owning the clock buys replay; **advancing** it buys coverage, and nothing in D12 implies the
second.

The rule that makes it work is the one Shadow uses — tor's own discrete-event simulator, which exists
for exactly the problem below:

> Simulated time advances only when nothing is runnable. When every worker is blocked, the scheduler
> jumps the clock to the earliest deadline among them and settles precisely those waits.

That is not "mock `now()`". A mocked clock lets a test *state* a time; a scheduler-owned clock lets a
test *pass through* one. The difference is the whole feature.

**What it is worth, concretely.** Everything the tor stack has pinned is a steady state: given this
consensus, choose these directories; given these bytes, accept or refuse. Every **transition** is
untested, because each needs hours of wall clock:

- a descriptor published, the time period rolls, the service republishes — can a client still find it?
  `serviceStorePeriods` exists for precisely that boundary and has only ever been tested at two frozen
  instants.
- an introduction point expiring (18–24h, drawn) while an INTRODUCE2 is in flight.
- a consensus expiring mid-circuit; `refreshAt` picks a re-download time in a window and nothing has
  ever watched it fire.
- a revision counter's monotonicity across a service restart.

And one that is already costing accuracy rather than only coverage: `test/data/hsdir_vectors.json` has
`periodLength: 8` **minutes**, because chutney shrinks the voting interval to twenty seconds to make
rotation observable at all. Production is 1440. So `timePeriodLength(testingNetwork: true, …)` is the
branch under test and the production branch has never met a live network. Virtual time removes the
reason to shrink the interval, which is a correctness win and not a speed one.

**The obstacle is already in the interface, and it is small today.** `core.waitAny(ids, millis)` puts
the deadline inside `Atomics.wait`, in the worker's own memory. The scheduler can enumerate every
ticket and still cannot see *"this worker gives up in five seconds"* — so it cannot answer "who is
runnable?" honestly (a worker with a live deadline is runnable at a future time), and it cannot know
which time to advance to. `platform.wac` records that a timer **ticket** was the original design and was
replaced because "`Atomics.wait` already takes a timeout, so the deadline needs no ticket, no slot and
no cleanup at all". Both reasons are JavaScript's. `core.sleepMillis` is still a ticket, which is the
shape virtual time wants — so the inconsistency is confined to the deadline path, and D12's own argument
applies: this is where the seam goes, and retrofitting it later means touching every wait.

**Two modes, and they are not substitutes.** Naming them now matters more than building either, because
the temptation is to build the first and believe it covers the second:

- **closed world** — an in-memory filesystem, a scripted network, virtual time. Genuinely deterministic;
  a seed is the whole run. Answers *what happens when things interleave and time passes*.
- **open world** — a real C tor on the other end of a real socket. Our side reproducible, the peer's
  not. Answers *are we right*.

**The tension is fundamental: virtual time XOR a real peer.** A tor process has a real clock, so
anything it participates in runs at wall speed. Shadow escapes this only by simulating every node,
which for us would mean intercepting a real tor binary's syscalls — a larger project than the runtime
itself and probably never worth it.

**And the trap, which is worth stating in the same breath as the goal.** A closed world is the ultimate
symmetric oracle: our stack agreeing with itself, forever, at high speed. Determinism makes a wrong
answer *reliably* wrong. Every real defect found in the tor work this week came from C tor and none
would have been caught by a simulator — `HS_DESC_MAX_LEN` compared with `>=` rather than `>`, the
strictly-greater revision-counter rule, `crypto_rand_int_range` being half-open where its own comment
says inclusive, and every HSDir in a real consensus having `DirPort 0`. A deterministic mode should be
sold as a coverage and debugging multiplier, which is large, and not as an oracle, which it is not.

**It also turns hangs from an inference into an observation** (operator, 2026-08-06). D12 already notes
that under Wacland "nobody can proceed" becomes a *proven* deadlock; virtual time is what makes that
cheap and what separates it from the two states it is currently confused with. Under a real clock a
hang is only ever inferred — nothing happened for thirty seconds, so we call it stuck — which is why
0082 has been seen half a dozen times and diagnosed none. Under a scheduler-owned clock there are three
distinguishable states where there was one:

| the scheduler sees | what it means |
|---|---|
| nothing runnable, no deadlines pending | **deadlock** — there is nothing to advance the clock to, so nothing can ever happen. A proof, not a wait, reported in milliseconds with the blocked-on-what state attached |
| nothing runnable, a deadline pending | **quiescent** — advance to it. This is progress, and today it is indistinguishable from a hang whenever the deadline is far away |
| always runnable, clock never advances | **livelock** — busy and going nowhere. The polling hazard below is exactly this, which makes the hazard its own detector |

The strongest form of it: **in a closed world nothing is merely slow**, so a deadline that fires is
evidence of a stall. Today a five-second `waitAny` timeout *masks* a deadlock — the program takes its
fallback path, the test passes slowly, and nobody learns the primary path never completed. Under a
virtual clock the timeout still fires and still costs nothing, but the runtime can report that the run
advanced five seconds purely to satisfy a deadline, which where nothing is slow means something did not
happen that should have.

Two open issues are this shape. **0082** hangs about once in fifty runs and only on an idle machine.
**0091** — `relayd` holding more outstanding calls than the ring has slots — is annotated "not worth
doing this week" largely because reproducing it is expensive; under this it is a seed and a proof, with
the ring's state in the report.

The limit, so the claim is not oversold: this decides hangs *inside* the world the scheduler owns. A
peer that never answers on a real socket is open-world, and there a timeout genuinely is the mechanism
rather than a mask. And "nothing runnable, no deadlines" is decidable where "this will never progress"
is not — the livelock row stays a heuristic on a counter, not a proof.

**Two hazards it introduces**, both known from Shadow and neither obvious:

- **a program that polls instead of blocking hangs the simulation.** It stays runnable, so the clock
  never advances, so its poll never becomes true. `waitAny(ids, 0)` — "which is ready right now" — is
  exactly that shape, and a loop around it would spin forever in virtual time while working fine in
  real time. The runtime should be able to say so: *no progress, and no blocking wait* is a diagnosable
  state, not a hang.
- **timeout constants become load-bearing.** Today `waitAny(…, 5000)` is a safety net that rarely
  fires. Under virtual time it fires at exactly five simulated seconds, so which side of it a test lands
  on becomes deterministic — which is the point, and also means changing a timeout changes outcomes.

**The path, smallest first.** Each step is useful alone, which is the test of whether the staging is
honest:

1. **Make the deadline visible** — no semantic change. A worker records its deadline in shared memory
   before parking; `Atomics.wait` still implements it. Costs one store, and gives the scheduler
   "earliest deadline among blocked workers" for nothing. Everything else needs this and it is a few
   lines.
2. **A clock policy in the test scheduler.** `WAC_SCHED` already selects delivery order; add the clock
   beside it. Under a virtual clock, `nowMillis` and `monotonicNanos` read the scheduler's counter, and
   when nothing is runnable the scheduler advances to the earliest recorded deadline and settles exactly
   those waits.
3. **Ship it with the closed world.** D12's honest claim is "deterministic over a world the scheduler
   owns"; virtual time is only *useful* over the same world. `packages/fs`'s memory backing is half of
   it and a scripted network is the other half.
4. **Wacland re-decides timer-as-ticket** rather than inheriting the JavaScript answer. The runtime owns
   the ticket table and the threads, so a deadline can be a ticket without costing a ring slot or a
   cancellation path.
5. **First target is not a tor network.** `relayd` + `dird` + a client is the smallest system here with
   a real race — a circuit extend against an accept — and it is where run-to-run nondeterminism already
   bites. The demonstration that would settle the argument: publish a descriptor, cross a time-period
   boundary in simulated time, and fetch it as a client. Two hundred milliseconds, and today untestable
   at any speed.


## Order of work

Each step is an issue when it becomes actionable, and each references this document.

1. **The VFS, with both backings.** A package with directories, files, metadata (owner, mode, mtime),
   and a `Cli`-shaped facade a session can be handed. Done when a shell mounted on an in-memory image
   passes the same differential scripts it passes on the host filesystem.
2. **The image format.** Persist and reload. **A format of our own** (operator, 2026-08-05) rather than
   tar: cheaper incremental saves and exact metadata, at the price of nothing outside this repo being able
   to read it. Two things follow from that price, and both are part of the step rather than extras — a
   `dump` that prints an image's tree so a person can inspect one, and a round-trip property test, since
   there is no GNU tool to be the oracle. Done when a session's writes survive a restart and an image
   written by one build loads in the next.
2a. **A second host, with no JavaScript in it.** The native runtime, per D9, D10 and D11. Done when,
   with no JavaScript in the artifact and no WASI import in the module:
   - a program issues **two** capability requests that complete out of order, `waitAny`s over both, and
     observes them settle independently;
   - a `waitAny` with neither ready returns on its **timeout**;
   - and it **spawns a child** and `waitAny`s over one of its own tickets *and* the child's exit at the
     same time.

   That last clause is the one that exercises all three of D10's requirements at once, and the reason
   spawn is in the criteria rather than deferred to step 3: a runtime that cannot make a second
   instance is not a host for this system, and finding that out at step 3 would be finding it out
   after the design had been built on it. Deliberately *not* "runs a program against the VFS", which
   would pass without touching any of it. No shell and no services yet — those come later, and the
   process **table** is still step 3; this is the primitive underneath it.

3. **A process table.** Pids, parents, states, exit statuses; `ps`, `kill`, `jobs`. The processes are
   already there — spawned workers, or `pushChild` frames in a browser. Done when `ps` in the ssh demo
   shows the pipeline you are running and `kill` ends one.
4. **Users and login.** sshd authenticates a key already: map it to a user, set `HOME`/`USER`, and
   enforce ownership in the VFS. Done when two keys land in two homes and neither can read the other's
   private file.
5. **A line discipline.** Echo, backspace, `^C` → interrupt, `^D` → end of input, `^U`, and a `TERM`
   worth setting. One module for both the ssh channel and the browser's keydown loop. Done when `^C`
   ends a running `yes` in both, and interactive `read` behaves as bash's does.
6. **Synthesised files.** `/proc/self`, `/proc/<pid>`, `/dev/null`, `/dev/urandom`, `/dev/zero`. Cheap
   once the VFS exists and disproportionately convincing. Done when `cat /proc/self/cmdline` answers and
   `head -c 16 /dev/urandom | hex` works.
7. **`init`, and a system that boots.** Something owns the image, starts the daemons, and reaps. Done
   when the ssh demo is one program that boots an image and serves sessions from it.
8. **The desktop, in the browser.** `Page` has render, events and pixels; a window manager in wac over
   the same system, with the terminal as one window. Deliberately last: windows want something to show.

## State of play

Where each step stands, in a line. **The detail is in the section each row links to** — until now
every one of these was a single table cell, and step 5 had grown to fourteen hundred words inside
one: no renderer wraps that usefully, nothing could link to a part of it, and the reader who wanted
to know about `^C` had to find it inside a paragraph about line discipline, job control and the
browser. Nothing was rewritten in the move.

| step | state |
|---|---|
| [1. VFS with two backings](#step-1--vfs-with-two-backings) | **done.** `packages/fs`, threaded through `packages/sh` as a value the shell holds; `sealed.wac` is a session on `Fs.inMemory()` built with no filesystem grants at all. |
| [2. image format](#step-2--image-format) | **done.** `packages/fs/src/image.wac` — every memory mount walked from its root, exact metadata, a CRC over the whole thing, and the host mounts it could not write named rather than dropped. |
| [2a. a second host, no JavaScript](#step-2a--a-second-host-no-javascript) | **done, and it is the arrival test's other end.** |
| [3. process table](#step-3--process-table) | **done: `ps` shows the pipeline you are running, over ssh, on an image.** |
| [4. users and login](#step-4--users-and-login) | **done.** `/etc/passwd` is data in the image — `packages/fs/src/passwd.wac` reads it — and `packages/fs` **enforces** `mode` and `owner`, which it had recorded and ignored since step 1. |
| [5. line discipline](#step-5--line-discipline) | **done: `^C` ends a running command, on both halves.** |
| [6. synthesised files](#step-6--synthesised-files) | **done.** `Backing.Synth` — `/dev/null`, `/dev/zero`, `/dev/urandom`, `/bin`, `/proc/self/cmdline`, generated on read and carrying `randomBytes` and nothing else, so a *sealed* session has a real CSPRNG without a grant. |
| [7. init](#step-7--init) | **done, and it took a second pass to actually be.** |
| [8. desktop](#step-8--desktop) | **started, and it is a window manager rather than a picture of one.** |

### Step 1 — VFS with two backings

`packages/fs`, threaded through `packages/sh` as a value the shell holds; `sealed.wac` is a session on `Fs.inMemory()` built with no filesystem grants at all. Every script of `packages/sh`'s corpus — the whole of it, counted in [that package's README](../../packages/sh/README.md#the-oracle-is-bash) and nowhere else — answers identically on **three** backings — memory, image and host — and identically to bash. 0067 is where it started, at 57 on two

### Step 2 — image format

`packages/fs/src/image.wac` — every memory mount walked from its root, exact metadata, a CRC over the whole thing, and the host mounts it could not write named rather than dropped. `box fsdump` prints one. No GNU tool can be the oracle, so a round trip, a rewrite-is-identical check and an image committed on 2026-08-07 stand in for one. Incremental saves are not implemented and say so. `packages/box/src/bin/imaged.wac` is the restart the criterion asks for: two processes, nothing shared but the file

### Step 2a — a second host, no JavaScript

All three of [0087](../../issues/system/closed/0087-wacland-under-wasmtime-a-second-host-with-no-javascript.md)'s criteria are met and the whole of design/0001's arrival test passes across the two hosts — files, installed programs, shell behaviour, users and system services. This cell said *started* for as long after that as it took somebody to re-read it. `native/` — Rust on wasmtime, no JavaScript in the artifact and no WASI import in the module. A compiled wac program turned out to have **no imports of its own** beyond one dispatcher per funcref signature, so there is no bundle and no generated glue: `deno task app:native` emits a `.wasm` and a manifest, and the runtime reads the manifest. D9 survived its first contact — the `SharedArrayBuffer`, `Atomics.wait` and the ring of slots have no counterpart here and none was reimplemented.

The **ticket table** is in, with D12's policy seam and D13's visible deadline built in rather than retrofitted: when several tickets are ready, `waitAny` answers the first in the *caller's* list rather than the first to finish, so a program's behaviour does not depend on how the threads were scheduled. **Two of [0087](../../issues/system/closed/0087-wacland-under-wasmtime-a-second-host-with-no-javascript.md)'s three criteria are met** — two requests completing out of order, and a `waitAny` returning on its deadline. **`packages/sh` and all 65 applets run on it**: `sealedsh` boots, and the first 25 of the shell's differential corpus answer byte-for-byte what the Deno host answers (`deno task corpus:hosts` runs the whole of it). That is the arrival test in substance for *shell behaviour and installed programs*; what is left of it is an **image**, which needs the filesystem capabilities.

The **filesystem** is in, each call behind a grant check, so `imaged` boots an image on this host and **the arrival test passes for files, programs and shell behaviour**. **All three of 0087's criteria are met**: `spawnSelf` makes a second instance on its own thread, with grants intersected against the parent's and no route between the two stores — a confinement primitive, which it cannot be in a JavaScript host. **And the network, so the arrival test is met in full**: `arrival_users_test.wac` builds `sshd` for both hosts, has the JavaScript one write `/etc/passwd`, two homes, two `authorized_keys` and two private files into an image, and then serves that same file from the host with no JavaScript in it — where a real OpenSSH client logs in as each user, lands in their own home, reads their own secret and is refused the other's.

That is step 4's criterion met *across* hosts, out of the image, with the mode and the owner enforced by `packages/fs` rather than by either operating system

### Step 3 — process table

And **stopping a child now means the same thing on every host** — the half of "a signal to a stage" that was a host difference rather than a shell gap. `closeSocket` said it stopped a child; the JavaScript hosts terminated a worker and the native one finished the child's queues, which stops any child that *writes* and no child that only computes. `native/` runs on an engine with epoch interruption now, one ticker thread, and a per-store deadline callback that turns the flag `closeSocket` sets into a trap wherever the guest is ([0123](../../issues/system/closed/0123-closesocket-stops-a-child-outright-on-one-host-and-cooperatively-on-the-other.md), with `platform/example/stop.wac` as the two-host reproduction the issue said did not exist). The other half of the same operation came with it: **`exitCode` on a stopped child answers -1 rather than throwing**, on all four hosts, because every one of them dropped the child at `closeSocket` — two threw and took the parent down, and the native one read the unknown handle as the *other* meaning of `exitCode` and set the caller's own status to it.

Stopping something and finding out it is gone is what a supervisor does, and it needed both. What it waited on was not the table — it was [0116](../../issues/system/closed/0116-a-spawned-stage-gets-the-hosts-world-not-the-sessions.md), and the fix is that a spawned stage no longer *has* a filesystem: it holds a channel to its parent's, and every read and write is a question the session answers out of the one filesystem there is (`packages/fs/src/remote.wac`). So a session on an image spawns its stages, they run at once, and they are still sealed — `packages/ssh/test/wac/wacsshdimage_test.wac` asks for `seq 1 200000 | ps` over OpenSSH's own client and gets the session, `seq` and `ps`, and asks in the same session for `cat /etc/passwd | head -1` and gets nothing.

A question is answered **as the process that asked it**, which is what `/proc/self` means: `cat /proc/self/cmdline` in a spawned `cat` prints `cat\0/proc/self/cmdline\0`, as bash does, and printed the session's command line for as long as `procs.current` was the shell. The whole corpus agrees across memory, image and a host mount with the stages spawned. What is left is a signal to a stage of a running pipeline, which now *could* arrive — the stages are real children with handles — and does not: `kill` reaches the row this shell keeps, and a child has a process table of its own. The earlier state of this cell, for the record: `ps` over ssh on an image showed the session and itself, and **not the pipeline** — `sshd` is not a multi-call binary, so its session shell cannot set `externalSpawnable` (a spawn would start another server), so stages run one after another and the earlier ones have finished by the time `ps` does.

That is the gap — and it is **not** `sshd`'s shape, which was the guess. Making the server multi-call and its stages spawnable takes three lines and works, and it *unseals the session*: a spawned stage is a fresh instance with the host's filesystem, so it could not see the image it was sealed in and could read the machine it was running on. [0116](../../issues/system/closed/0116-a-spawned-stage-gets-the-hosts-world-not-the-sessions.md), and `packages/box/test/sealing.test.ts` now holds the line that a comment was holding. `kill` does not exist at all. Also `packages/fs/src/proc.wac` — pids never reused, parents, running and zombie states, exit statuses — and `/proc/<pid>/{cmdline,comm,status}` renders it in Linux's exact formats, checked against this machine's own `/proc` rather than against expectations.

The shell enters every command for the length of its run, so `ps` in a **sealed** session shows the tree it is running while the host knows of one process. **Signal delivery is in**, which is what "`kill` needs something that polls" was waiting for: `packages/sh` asks before every command and on every turn of a loop, `kill` is a builtin with bash's messages, statuses and `kill -l` table, `$$` answers this shell's pid and keeps it inside a subshell, and a shell now enters *itself* in the table — it was the one process this system did not know about, so `ps` showed every command and never the shell running them.

`kill $$` ends a script with 143 and `kill -INT $$` inside `while true` ends it with 130, both against bash. **And `kill` ends one**, which is the second half of the criterion: `kill %1` on a background job delivers by `closeSocket` rather than by the row, because a spawned child is a separate instance with a process table of its own — the row this shell keeps for it is one nothing over there will ever read, so `kill %1` reported success and did nothing until this. Measured by line count on both hosts, since a status alone cannot tell a killed job from a relabelled one: the first version drained the child's output before closing, so `seq 1 300000 & kill %1` printed all three hundred thousand lines and reported 143.

What is left of the criterion is a signal to a *stage of a running pipeline*, which cannot arrive: a stage is a function call inside the shell and nothing else is running to send one. `SIGKILL` is not special here and says so; the stopping signals are refused by name rather than treated as termination, since there is no job control. **`&` and `jobs` are in**: a background job is a real child through `spawnSelf` — its own instance, its own grants, its own thread on the host with no JavaScript in it — recorded in a job table the shell keeps beside the system's process table, because a job number is a user interface and a pid is not.

`jobs`, `wait` (bare, `$!`, `%n`), `kill %n` and bash's statuses, compared against bash. What `&` refuses by name: a list, a pipeline, and a redirection, all of which need a subshell to run in, and this shell's subshells run in this instance. A background job's output arrives when it is waited for rather than as it is produced — the shell owns the child's pipes and is not running while the child is — and outstanding jobs are waited for at the end of a script rather than discarded

### Step 4 — users and login

`/etc/passwd` is data in the image — `packages/fs/src/passwd.wac` reads it — and `packages/fs` **enforces** `mode` and `owner`, which it had recorded and ignored since step 1. `sshd` matches a client key against each user's own `~/.ssh/authorized_keys`, sets `Fs.user`, and starts the session in that user's home with `$USER` and `$HOME`. `packages/sh` grew `chmod` and `chown` as builtins, without which a session could not make a file private. The criterion is a test: two keys, two homes, and neither can read the other's private file — nor widen it first. **Traversal is not enforced**, and the tests say so: a private file is protected by its own mode rather than by the directory above it

**A key the image does not know is refused, as of 2026-08-11** — wac-mono 0126. The criterion above
is about two keys in two homes; the case it did not cover is a third key, named only in the server's
own `-a` file, which used to be served as `root` and had the run of every image that server offered.
With `-i`, users are data in the image (D5) and that file is not part of that data. The boundary is
the *user table* rather than the `-i` itself: an image with no `/etc/passwd` has nobody to outrank,
and that is how every image starts, so the server-wide key remains the whole policy until the first
user exists.

### Step 5 — line discipline

**Where this stands, because the paragraphs below were written on the days they were true.** `^C`
ends a running command on **both** hosts that can deliver one: in a page through `Core.askInterrupt`,
answered by the host that owns the keyboard and driven in a real Chromium; and over ssh through
`Shell.askInterrupt` and `Conn.ready`, driven by OpenSSH's own client with `$?` at 130. Everything
after this paragraph is the record of getting there, in the order it happened.

This cell existed to stop exactly the drift it then produced: it said the ssh half "needs concurrency
rather than a poll" while the paragraph immediately below it said the criterion was met, and named
the poll that met it. A summary that contradicts the record beneath it is worse than no summary,
because it is the part a reader trusts.

The criterion is met over ssh as well as in a page — `packages/ssh/test/wac/wacsshd_test.wac` runs `while true; do :; done` through OpenSSH's own client, sends `^C`, and gets a live session back with `$?` at 130. What it waited on was the design decision this cell had been carrying: **`Shell.askInterrupt`**, a funcref and an `anyref` context, so a shell that is *already busy* can ask its session whether a keystroke has arrived. The note here proposed "a funcref plus a token", which would have needed a registry to turn the token back into a connection; `anyref` carries the connection itself and the language has had it since the compiler grew abstract reference types.

`Conn.ready` is the other half — `waitAny(ids, 0)` over a read the connection already has outstanding, so a poll costs a look in the worker's own memory — and the shell asks on **every turn** of its relay rather than only when the wait expires, because a stage that is producing output never lets a deadline fire. **`^C` is not a signal to the shell**, which was the first thing tried: `procs.signal(pid, SIGINT)` makes `takeSignal` set `exiting` and the *session* ends, and bash does not exit when you press `^C`. A terminal interrupts the foreground group, so what ends is the command and the rest of the line, and the prompt comes back.

**Type-ahead is kept**: the poll takes bytes off the socket to look for `^C` and the discipline hands back whole lines as it goes, so those run in order at the next prompt — and an interrupt flushes them, which is what `ISIG` without `NOFLSH` does. The earlier state of this cell: **the module is done, `sshd` uses it, and a session now knows its terminal.** `pty-req` and `window-change` are read: `$TERM` is what the client said, `$COLUMNS` and `$LINES` follow a resize, and a session with *no* pty has no `$TERM` rather than a guessed one — so a program can tell "no terminal" from "a terminal I have never heard of".

*Superseded by the paragraph above, and kept because its reasoning is what the fix was built on.* The
criterion is still not met: `^C` cannot end a running `yes`, because the session loop blocks reading a keystroke while the shell runs a line, and the browser half wants a way for a page to claim a keystroke that `Page` has not got. `packages/tty` — echo, erase, `^U`, `^W`, `^C`, `^D`, `^V` — with every rule read off the kernel's own discipline through a pty, thirty-one sequences byte for byte. Three of them are not what anyone would write down: erasing `^A` takes two backspaces, `^H` is not erase, and `^W` goes back over letters and digits rather than to the previous space. `sshd` accepts `pty-req` now — it refused it for a year for want of exactly this — so `ssh -tt` gets a session where the server echoes, honours an erase the client never saw, and sends its output back with `\r\n`, driven in the tests by OpenSSH's own client.

**The browser's keydown loop now speaks the same vocabulary**: a `keydown` reaches a program as the bytes a terminal sends — `Ctrl-C` is 0x03, Backspace is DEL rather than BS, Enter is CR, an arrow is its escape sequence — where it used to arrive as the browser's `ev.key`, a vocabulary nothing else here speaks and one `packages/tty` could not consume, since a discipline reads bytes. `^C` at the prompt in a tab now throws the line away exactly as it does at an ssh prompt, driven in a real Chromium. What is left of that half is the *discipline* itself: the editing is still an `<input>` and the browser's, and taking it over means giving up the block caret, IME composition and paste, which over ssh are the client terminal's problem and here would become ours — written down in `term.wac` rather than left to whoever tries.

**`^C` ends a running `yes` in a page — the step's own criterion, met on one of the two halves.** `Core.askInterrupt` is the seam: a running applet is inside `dispatch`, so the shell's check points are not executing, and an applet holds `Core` and never a `Page`. Only a host that owns the keyboard answers yes, and a page is the one — its keydown listener and the code servicing the bridge are the same thread, so while the worker is parked *asking*, the page has already seen the keystroke. Deno, Node and wasmtime answer no, truthfully: their terminal belongs to whatever started the program, and over ssh to `sshd` behind an encrypted socket.

Driven in a real Chromium and canaried both ways. **The thing that made the first attempt answer no for every applet** was that a spawned child is given no `dom` — rightly, since a child that could draw would draw over its parent — and the interrupt had been bundled into that authority. Learning that the user pressed `^C` is not drawing, and it is *children* who need it, since every applet in the browser terminal is one. What is left is ssh, which needs concurrency: `runScript` blocks the session loop and the bytes are encrypted, so nothing but `Conn` can read them. The earlier shape of this note: `Core` gains an `askInterrupt` capability — a page's event queue belongs to the host, so it is the one host that can answer yes, while Deno, Node and wasmtime answer *no* truthfully because their terminal belongs to whatever started the program, and over ssh to `sshd` on the far side of an encrypted socket.

Two things were established by trying it. **Every opcode parks the worker** — `hostCall` is submit-then-collect and there is no non-parking op — so a poll costs a round trip and a caller must ask once per *block* of work rather than once per byte; `yes` already batches 4096 lines a write, so that is affordable. And that cost is exactly why it can work: while the worker is parked the main thread runs, and the main thread is where a keydown arrives. What is *not* settled, and is the next thing to establish rather than assume, is whether the flag belongs in `host/browser.ts` or `host/entryBrowser.ts` — which of the two sees the keydown and which services the ring.

**And the criterion is two blockers rather than one**, which is the design step before it: over ssh `^C` mid-command needs *concurrency*, because `runScript` blocks the session loop and the bytes are encrypted so nothing but `Conn` can read them; in a page it needs a **capability an applet can reach**, because the event queue is pollable — `Pending.isDone` is that, with no closures needed — but a running `yes` is inside `dispatch`, and an applet is handed `Core`, `Cli`, `Fs` and `Args` and never a `Page`. So the seam belongs on the capability rather than on the shell: giving `Shell` a `Page` and polling at its check points makes `^C` work at the prompt, which it already does, and does nothing for a running command.

**Terminal modes are in**: canonical, `ICANON` without `ECHO`, and cbreak, each compared against a pty in that setting — one `Line` with two flags rather than a second implementation of the rules, which is what the test asserts. The two rules worth knowing are the ones the names get wrong: echo off does not stop the editing, and `^R` stops reprinting and becomes a byte in the line. What was terminal *modes* (canonical with echo is the only arrangement, so no raw mode for an editor), and the step's own criterion — `^C` ends a running `yes`. **That criterion no longer waits on step 3**, which now delivers: it waits on this loop's shape.

`runScript` is a blocking call, so while a line runs nothing reads the channel and the `^C` sits in the socket until the command it was meant to end has finished. The machinery to fix it exists — `waitAny(ids, 0)` is "which is ready right now" and stdin has a handle so `waitAny` can watch it — but the channel belongs to the session loop rather than to the shell, and wac has no closures, so handing a busy shell a way to ask means a funcref plus a token. That is the next design decision on this step

### Step 6 — synthesised files

`Backing.Synth` — `/dev/null`, `/dev/zero`, `/dev/urandom`, `/bin`, `/proc/self/cmdline`, generated on read and carrying `randomBytes` and nothing else, so a *sealed* session has a real CSPRNG without a grant. The endless two refuse a whole read by name and point at the bounded one, which is what `head -c` uses. `/proc/<pid>` arrived with step 3, and `/proc/self` now names the *running command* rather than the program — which is what bash answers, and what this got wrong for as long as there was nothing else it could mean

### Step 7 — init

**Shutting down is when the last service stops** — the operator, 2026-08-12, answering the trigger
question this cell carried. A system is up for as long as something is running in it, and it ends
when the thing it was running for has ended. It needed no mechanism: `init` already reaps every
service and returns, and whoever owns the image writes it on the way out, so what a service wrote is
there at the next boot — asserted now rather than assumed (`init.test.ts`, "what a service wrote is
in the image the system left behind"). What it gained is the sentence: `init: all services have
stopped`, because a boot that finished and a boot that was killed part-way through read identically
in a log otherwise.

**The corollary is the half worth reading twice: a system whose services never exit never shuts
itself down.** `sshd -i image` is exactly that, and it is the intended shape rather than an oversight
— a machine sits there, and stopping it is whoever started it. So this answers *when a system ends*,
not *how to tell one to end*, and the second is a supervisor's question: a restart policy, a failing
service taking the rest down, a shutdown asked for from outside. Each needs `Cli.closeSocket` on a
child's handle, which stops it on every host since 0123 and which `init` holds for every service it
started. The supervision question stays open below and this does not settle it.

**What that cell claimed for a day and did not do:** a service had no filesystem at all, so an `/etc/init` saying `cat /etc/motd` started `cat`, which could not see the image the line was read out of, and exited 1 — every service that touched a file failed, silently, because `init` read each service's standard output and *never its error stream*. Both are fixed and both are tested: a service asks `init` over the channel [0116](../../issues/system/closed/0116-a-spawned-stage-gets-the-hosts-world-not-the-sessions.md) built, and `init` is itself a spawned applet whose filesystem is the session's, so the question travels the chain to whoever holds the image; grants stay `GRANT_NONE` precisely because a service asks rather than reaches.

The relay is a `waitAny` over every service's output, error stream and channel at once, for the reason `packages/sh` learned — a service blocked on a question nobody has answered writes nothing, so reading its output first waits for a service that is waiting for the loop. What runs at boot is a file you can `cat` and edit rather than a list compiled in, which is the whole of what makes it step 7. **Not a supervisor**: no restart policy, no dependency order, no health, no readiness, and no way to *stop* a service, since that needs step 3's delivery half. Those five are named in `init.wac` rather than approximated.

And `/bin` is real: `Fs.mountBin` lists the programs this build has — `boxNames()`, the same function the dispatcher and the README's count are tied to — and `/bin/wc -l` runs `wc`. Each entry is a real directory entry with a mode and a size whose contents are one sentence saying the program is built in, because there is no file on disk to point at and inventing one would be design/0001 D6's "plausible rows". `sshd -i` serves every session from an image *and* from `packages/box`'s 65 applets, which read that image rather than the host (wac-mono 0109, and wac 0076 for the compiler bug the edge tripped over). Before that: `sshd -i home.wacimg` boots an image and serves every session from it — three packages end to end, driven by OpenSSH's own client.

Concurrency stays open because connections are served one at a time, so one writer is true by construction

**Both, though — and that is the constraint rather than a stage.** The kernel-and-wasmtime stack is the core ambition, *and* running wac programs without it is paramount: Deno, Node and a browser stay first-class targets. So whatever rendering a full-stack desktop eventually gets has to **work in a browser too**, which rules out anything that only a framebuffer can do and points at the seam this layer already has — `drawPixels`, a pixel buffer, which every host can present. The price of going that way is a text stack of our own — layout, selection, caret, IME — which nobody has decided to pay, and which is plausibly its own project rather than something to start inside this step. Leaping at it early would be worse than the dependency (the operator, 2026-08-10).

So the honest statement of where step 8 sits: it is a real window manager over a borrowed renderer, the borrowing is *visible and localised* to `Page`'s eleven opcodes, and nothing in the arrival test touches a page — the shell, the filesystem, the process table, spawning, the image, ssh and `init` all run on the host with no JavaScript in it already. |

An applet reads the filesystem the **shell** is holding as of 2026-08-07 (wac-mono 0109): they take an
`Fs`, and `lib/input.wac` picks how to read it by mount — a host path still streams through `openInput`,
anything else is served from the bytes the filesystem hands over. `packages/box/src/bin/sealedsh.wac` is
a shell on `Fs.inMemory()` with all 65 applets and **no capabilities at all**, which is the shape
steps 7 and 8 both need and the first time D1's "the shell asks its filesystem" is true of the commands
as well as of the shell.

### Step 8 — desktop

`packages/box/example/desk.wac`: two windows over one system, driven in a real Chromium by `platform/test/browser_live.test.ts`. A window is **markup, not pixels** — `drawPixels` exists and a terminal drawn that way would mean reimplementing text layout, selection, the caret and IME to get something worse than the browser already does — so the manager owns `render` for the *frame* and `setText` for *content*, which is why typing does not rebuild the document. The terminal window is the whole terminal: the same `Session` the full-frame one uses, which is now one implementation in `box/src/lib/session.wac` with two presentations rather than a copy. **The assertion that makes it a system**: `cd /home/wac` typed in the terminal moves what the files window lists, and `echo hi > note` appears there without anything being told — two windows that each held their own world would pass every other check and be a drawing.

Raising carries the half-typed command across the re-render, which is the one thing a window manager must not do to a terminal. **Opening a window works**, which is the second pass: a launcher strip opens terminals and file panes, windows carry ids that are allocated once and never reused so closing one does not renumber the rest, and `exit` in a terminal closes its window rather than the desktop. The assertion that makes it a *system* rather than several: a second terminal is `Session.startOn` over the **same `Fs`**, so `echo from-the-first > /shared` in one is `cat /shared` in the other — two shells, one filesystem, one process table — and reverting that one call to `Session.start` fails the browser test.

**Dragging works, and the design question it was waiting on had an answer**: a `pointermove` is a *position, not an occurrence*, so the host keeps only the newest queued move for an element and a program reading one event per bridge round trip is never behind the pointer. Two other things had to be true first, and neither was. **`Page.setStyle`** — the third member of `render`/`setText`'s family, because a window being dragged changes neither the frame nor any content, and moving it through `render` would rebuild every terminal on the desktop for every pixel. And **`Event.x`/`y` had to mean what this document's capability says they mean**: "where in the element it happened" was `ev.offsetX`, which is relative to the deepest element under the pointer rather than to the one whose id is reported — a title bar holds a `<span>`, so a drag computed from it jumped the moment the pointer crossed into the text.

A window owns its position now rather than deriving it from its place in the stack, so closing one no longer moves the others. Driven in a real Chromium, with the half-typed line in another terminal asserted to survive the drag. **Still not implemented, and said rather than approximated:** resizing, which needs the same machinery from a corner and a minimum size that is a decision; and minimise, because there is no taskbar to minimise *to*. **What this step is waiting on is now written down**: [0004](0004-rendering-that-backs-a-desktop.md) proposes the surface a desktop would draw itself on — a pixel buffer, because that is the only seam a kernel and a tab both have — and says what it costs, chiefly a text stack.

Its own recommendation is to stage a fixed-cell grid inside this step and split scalable text out, on the grounds that beyond a grid the work stops being about a desktop and starts being about a font engine. **What the desktop is standing on, which this cell did not say.** The DOM is doing the text layout, selection, the caret and IME — the manager owns the frame and the browser owns the glyphs. That is worth stating because this document's aim opens with "the userland of a bootable system — a minimal Linux kernel and Wasmtime, no JavaScript at all", and a desktop on that stack has no DOM to borrow.

## Open questions

- ~~**Terminal modes have no oracle this repo can drive.**~~ **Answered on 2026-08-09, and the answer was that the question was wrong.** `packages/tty/tools/discipline.py` allocates a pty, sets `termios` on it before the child starts, and runs `cat` — canonical, `noecho` and `cbreak`. It reproduces `script -qec cat` byte for byte on the cases `line.test.ts` already compares, so it is a drop-in for the oracle already trusted rather than a second opinion. The blocker was recorded as a property of the problem and was a property of the *tool*: Deno cannot allocate a pty, and this repository has driven reference implementations from Python since `packages/tor/tools/capture-*.py`. Two rules fell straight out, neither of them what the names suggest — **`noecho` still edits** (`ab<DEL>c` delivers `ac`, it is simply not drawn), and **`^R` stops reprinting and becomes a byte in the line**, because reprint is an echo feature. What is left is the implementation in `Line`, which now has something to be written against. The paragraph this replaces: `packages/tty` exists because every rule in it
  was measured against Linux's own discipline through a pty, and modes are the module's own named next
  step — canonical off for an editor, echo off for a password. The comparison runs `script -qec cat`,
  and `script` will not hold an `stty`: `stty -echo; cat` echoes anyway, and `-icanon` leaves the
  oracle waiting for an EOF that raw mode does not deliver. Deno cannot allocate a pty itself, which is
  why `script` is there at all. So modes can be *written* but not measured, in a module whose entire
  claim is that it was measured — and adding them on reasoning alone would make the package's own
  argument untrue. Deciding what plays the oracle's part is the blocker, not the code.

- **The native core has no oracle** — and there is a ledger of how much of it is checked now. `packages/platform/test/wac/conformance_test.wac` derives the two-host surface (43 opcodes; 12 are page-only) and, for each, names the test that compares the two hosts or states what makes a comparison hard. It prints the number on every run: **31 of 43 compared, 12 named gaps** (measured 2026-08-19; it was 20 of 38 when written) — and the very first gap it named turned out to be hiding a real defect. Nothing compared a program *reading its input*, and under the native runtime every filter run by a shell that spawns — `cat`, `wc`, `head`, `sort`, `grep` — produced nothing at all, silently, while working in a sealed shell and when run directly. A child spawned with `inheritInput` has its parent-fed queue finished at once, and `readChunk` read *that*, saw empty, and answered end of input before reaching the process's own stdin; the comment beside the `finish` said the child reads the process's input and the read path never let it. So the ledger paid for itself in one tick. Three of the first entries were written from memory and were wrong — `OUTPUT_ERROR` and `READ_STDIN` had no comparison at all, and every two-host runner passes `stdin: "null"`, so a program reading its input is the one thing none of them exercises. That does not answer the question below; it makes the answer's cost visible, and a new capability now has to say how it is compared or say that it is not. The question itself: D7 makes differential testing the oracle, and the oracles are bash
  and GNU coreutils — which judge the *personality* only. Under D8 the native core is the first large
  subsystem here with nothing independent to check it against, in a repo whose rigour is mostly
  differential. What plays that role — a reference implementation of the same semantics, property tests
  over the capability algebra, something else — should be decided with the core rather than after it.
  This is the largest open risk in the direction.
- ~~The fourth host has no JavaScript.~~ Answered by D9, D10 and D11, and scheduled as step 2a.
  ~~Whether plain WASI can express the interface.~~ Answered: it cannot, and it is not used — D10 and
  D11. What remains is not a design question:
- **Where the native runtime lives.** Still an operator decision, now **taken provisionally** because
  0087 started: it is at the repo root, in `native/`. It was put in `packages/platform/host/native/`
  first, for the good reason that the interface it implements is defined beside it — and the suite
  found the problem within one run. `packages/box`'s applet comparison walks `packages/platform` with
  `find` and `du`, and cargo's `target/` is 567 MB that **changes while the build runs**: `du` disagreed
  with `du -sb` by 34 MB, and the walk went from a second to fourteen. A build directory inside a
  package is a cost every test that walks that package pays, and the third option — a top-level
  directory, next to `tools/` and `harness/` — has neither problem. What is lost is adjacency, and a
  README pointer covers it. The other arguments that decided this now: the differential test needs both
  hosts in one suite to be a test at all, and moving a cargo crate is a directory move. The
  arguments against stand — cargo is a second build system and `deno task test` reaches it only by
  shelling out — and the mitigation is that the test **skips loudly** when cargo is absent rather than
  reddening the suite. Worth confirming or overruling rather than letting the provisional answer set.
- ~~The toolchain is a precondition, not a detail.~~ Answered: `rustc` and `cargo` 1.97.1 are installed
  and crates.io is on the allowlist. This repo now has one compiled language, in one directory. Only
  whoever *builds* the runtime needs the toolchain; everyone else gets a binary, and the test that runs
  it skips loudly rather than failing when cargo is absent.
- **Supervised services are named in D8 and in none of the eight steps.** *What was the missing half is
  now available*: stopping a child is a real operation on every host, and asking what became of it
  answers rather than throwing ([0123](../../issues/system/closed/0123-closesocket-stops-a-child-outright-on-one-host-and-cooperatively-on-the-other.md)).
  So the question is no longer "with what" but "on what policy, and told by whom" — restart with what
  bound, shutdown on what signal, health by what test. Step 7 is `init`, which owns
  the image, starts daemons and reaps; supervision — restart policy, dependency order, health — is a
  different shape. Either it belongs in step 7's definition of done or it is a ninth step. **Still
  open, and now concrete**: `init` is written and does start-wait-report-reap, so what a decision here
  would add is a *policy*, and `init.wac` names the five things it does not do. The place they would go
  is one loop — the one that waits in start order — and a supervisor would wait with `waitAny` instead.
- **How much of a pty.** Full termios is a project of its own; the useful subset is echo, line editing,
  interrupt and EOF. Where the line is drawn should be decided when step 5 starts, not now.
- **Concurrency on one image.** Two sessions writing the same image at once needs a rule — one writer,
  or copy-on-write per session, or a lock. Step 4 forces the question.
- ~~What `wacsh` does by default.~~ Answered: two binaries, D3a.
- ~~Byte-exact paths.~~ Answered:
  [0065](../../issues/system/closed/0065-a-spawned-programs-arguments-are-not-byte-exact.md) is a *signature* problem
  — names and arguments are bytes, messages and source are text — and not something to solve with a codec
  in the compiler. `packages/fs` already pins the property on a mount, where no host API is involved.
