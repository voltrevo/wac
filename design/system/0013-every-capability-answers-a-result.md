# 0013 — `Sys` is the only capability, and every capability answers a result

- **Status:** agreed 2026-10-24 — every question below was put to the operator one at a time and answered
- **Raised by:** agent-a, 2026-10-22, implementing the operator's ruling on `issues/system/0330a`: *"Every
  capability answers a result, and 'this host does not provide it' is an error — a fault beside
  `FAULT_NOT_GRANTED`, never a trap."* It settles `issues/system/0261c` and `issues/system/0327a`, and does
  what `design/lang/0016` already ruled and was not done: *"`std`'s root exports `Sys`, which replaces
  `Cli`/`Core` as the capability."*
- **Spans:** `std/platform.wac`, `core/ticket.wac`, `packages/wacc/src/program.wac`, all four hosts,
  `packages/fs`, `packages/sh`, `packages/box`, spec ch07, ch35, ch40 and ch44, and every program

## Why this exists

`Sys` was added on 2026-10-02 *over* `Core` and `Cli` instead of in place of them. It covers arguments, log,
time, randomness, `readFile`, `writeFile` and grants; everything else — directories, metadata, processes, the
environment, the terminal, datagrams — was written into ch44's "Open" section as *to be written down*, so
programs reach past `Sys` to `sys.cli`. 760 files name `Cli` or `.cli.`. `Pending` survives behind a
`.ticket()` its own comment calls *"a bridge, and a temporary one"*, and the adapter builds the program's
`Sys` through a public `Sys.__wacOf` that holds everything. None of that structure has a reason: it is an
unfinished replacement. This note is the replacement.

## The shape

### `Sys` hands out handles; nothing else is a capability

```wac
Files fs  = sys.files();     // readFile, writeFile, readDir, stat, linkStat, the changes
Procs ps  = sys.procs();     // spawn, spawnSelf, exec
Net   net = sys.net();       // connect, listen, bindDatagram
Env   env = sys.env();       // get, cwd, args
// … the clock, randomness, the terminal and output, each a handle of its own

void indexer(const Files fs) { … }   // the type says what authority a function holds
indexer(fs.readOnly());              // narrowing is a method on the handle
```

Grants (`Grant`, `GRANT_*`, `Sys.run`'s mask, `held`) go: authority is the handle you hold. `Listener`,
`Socket` and `Child` already have this shape.

`Core`, `Cli` and `Pending` are deleted, not hidden. The host boundary stays where wasm puts it — imports —
and is private to std; the adapter in `program.wac` is the only constructor of a `Sys`, and the compiler
reserves `__wac` names so no program can call `__wacOf`, `__wacFailed` or `__wacSettle`.

### A handle is a struct of closures

`Files` is the model, and the mount table of `packages/fs` becomes it (`0327a`):

```wac
Files host  = sys.files();
Files mem   = Files.memory();
Files mixed = Files.mounted([("/", mem), ("/src", host.readOnly())]);   // a mount table is a Files
```

A new backing is a new constructor, not an edit to every operation. `Cli.capture` is deleted with `Cli`:
running a program and keeping its output is spawning it and reading its stream (`design/system/0014`).

### Each fault is a type, and an error is the union of them

```wac
export struct NotFound    { string message; }
export struct NotGranted  { string message; }
export struct Unsupported { string message; }   // this host does not provide it (FAULT_UNSUPPORTED today)
export struct Other       { string message; }   // a host error no category names
// … one per FAULT_* code, plus OutputClosed and PeerClosed below
```

```wac
async Result<u8[],  union<NotFound, Denied, IsDir, NotADir, NameTooLong, Loop, Unsupported, Other>> readFile(string path)
async Result<u8[]?, union<Unsupported>>                                                              get(string name)   // Env; Ok(null): not set
```

A `match` on the error must cover its members, and `try` widens a narrower union into a wider one — both
probed 2026-10-24. `Unsupported` is in every signature; `Other` in every one that reaches an OS, and a code
outside a capability's set maps to `Other`, never a trap. Hosts still answer an `i32` and a sentence; std turns
the code into the struct in one place per capability. The `FAULT_*` integers stop being exported.

### Output

- **`write`/`writeErr` answer `Result<void, union<OutputClosed, Unsupported, Other>>`.** The reader leaving is a
  fault, in the type.
- **An `OutputClosed` that reaches `main` exits quietly with status 0.** The adapter's `Err` arm, which already
  matches per member of the union (`program.wac`), gains one arm. A program that wants to react matches it
  itself; `unwrap()` on a write still traps, and a `main` that does not answer a `Result` must handle it. No
  status imitates a signal: wac has none, and `sh` does not report 141.
- **`send` on a socket answers `PeerClosed`**, an ordinary fault — a server must deal with a peer hanging up.
- **`log` and `warn` are deleted as capabilities.** They become std helpers over the output handle's `write`,
  answering its `Result`.

### Tickets

Every capability answers core's `Ticket<Result<T, union<…>>>`. `await` gives the `Result`; a synchronous
caller writes `wait()`, which keeps its own layer (ch35) because a ticket nothing can settle is a bug, not a
fault. Two changes to core:

- **`wait()` answers `Result<T, Stuck>`**, not `Result<T, string>`.
- **`Result.flatten()`** turns `Result<Result<A, X>, Y>` into `Result<A, union<X, Y>>`, so a synchronous call
  reads `try files.readFile(p).wait().flatten()` — a method if core can express the constraint on `T`, a core
  function if not.

### No `string` errors

`core`, `std` and every package stop using `string` as an error type (55 mentions in 23 files on 2026-10-24),
each error becoming a struct as faults do; spec examples change with them. The checker does not refuse it.

## Order of work

Each step is its own commit through the gate, with its breaking-change entry.

1. **Core** — done 2026-10-24: `Stuck`, `flatten`, the literal conversions' structs, ch09/35/40.
2. **The spec's examples** off `string` errors — done 2026-10-24. The packages' `string` errors move in step 5
   with their capabilities, because their error types become unions of those capabilities' faults.
3. **Done 2026-10-24.** **Std's answer structs renamed out of the way** (`Socket`, `Child`, `Listener` and the rest that a handle
   takes the name of), a mechanical rename across their callers, so the handles can be added beside them.
4. **Done 2026-10-24, with two pieces left to step 5:** `Procs` cannot hand a child a composed `Files` until
   `packages/fs`'s serving moves into std, and `Files.openRead`/`openWrite` wait for the hosts to give a stream per
   call (today's `openInput`/`openOutput` switch the program's one stream). `Grant` and `Sys.run` went with it, and
   std is now pruned like any file. Found on the way: `sigNoPair` sized apart from the signature table (a runaway
   past 16384 signatures), an `is` test against a type outside a union declined instead of `false`, and two import-
   alias faults — one fixed (case 0847), one filed (`issues/lang/0397a`). **Every handle in std**, with ch44 written whole beside it: `Sys`'s accessors, the fault types and their
   mapping, `Output`/`Input`, `Clock`, `Random`, `Env`, `Files` (from closures, `packages/fs` folded in), `Net`,
   `Procs` with `self` spawning, `Modules`. Built over `Core` and `Cli` for as long as step 5 runs.
5. **Callers, package by package** — each package's functions take the handles they use instead of `Core` and
   `Cli`, in one edit per function. `async` where a function reasonably can be, `flatten(….wait())` where not
   (operator, 2026-10-24). Frames go here: tests that ran a program in-process over `frame.wac` fake its
   handles with closures instead, and the shell always spawns. Also here: dead-code elimination over the built
   module (`issues/lang/0398a`), because `Sys` retained whole carries every handle into every program — a
   hello-world went from 392 KB to 727 KB. Reachability stays as chapter 5 has it; what a build checks and what it
   emits are separate (operator, 2026-10-24).
6. **Delete** `Core`, `Cli`, `Pending`, `Grant`, the old answer structs and the exported `FAULT_*`; the hosts build
   the handles' imports directly and lose `pushChild`, `popChild`, `capture`, `log` and `warn`.

**Spawning needs the `procs` grant, yourself included** (operator, 2026-10-24) — so a sealed session, `sshd` and
the browser terminal are granted it to run applets, and without it an applet is `NotGranted`.

### Settled before step 5 (operator, 2026-10-24)

- **Host tickets can be waited on together.** A host ticket carries its host id and the host's wait-for-any
  function, both set by std when it makes the ticket. When every part a `wait()` or `Ticket.any` must drive carries
  the same function, core calls it once over all their ids — so a deadline is a timer ticket in a race,
  `Ticket.anyWithIndex(sock.recv(), clock.sleepMillis(ms)).wait()`, and works the same synchronously and under
  `await`. No `__wac` hook: the function arrives as a value. This replaces `core.waitAny`.
- **A deadline belongs to `Clock`:** `clock.within(t, ms)` answers `Ticket<Result<A, union<E, TimedOut>>>` for a
  `Ticket<Result<A, E>>`, racing `t` against its own timer and cancelling the loser — so no caller can leak a slot.
  `core.waitAny`'s header records why: a timer ticket in the list *"worked, and every caller had to remember to
  cancel the loser or lose a slot for good"*. A negative `ms` sets no deadline.
- **`cancel()` on any ticket.** On a host ticket it releases the host's slot and discards the answer; the ticket
  never settles and a later `wait()` answers `Stuck`. On any other ticket it detaches interest and does not stop the
  machine. This replaces `Pending.cancel` and `core.cancel`.
- **`Sys.drainFor(i32 millis)`** answers how many continuations ran before the queue emptied or the budget ran out —
  tor's servers use it to tell idle. `dropAll` is deleted; `outstanding` stays internal to the adapter's exit check.
- **Writes to stderr may be discarded; writes to stdout are handled.** A convention, not a rule — a warning for a
  discarded `Result` is a possible later feature. So the ticket a write answers must be settled before the call
  returns: the host gives the reason for a failed write in the same call, rather than through `outputError`.

### Settled during step 5 (operator, 2026-10-25)

- **`Procs.exec` takes a `ChildEnv`**: `ChildEnv.inherited()` or `ChildEnv.empty()`, with `.set(name, value)` over it
  (ch44 `§wac-std-child-env-k3w8tqa`). Removing one name stays a shell's `unset` (`packages/wactest`'s `withoutEnv`).
- **`packages/fs` folds into `Files` now**, not after step 6. Box and sh take `Files`; each `Fs` backing is a `Files`
  constructor. What `Fs` held that is not a filesystem goes to the shell session: the current directory (a view,
  `files.relativeTo(cwd)`), the process table, the clock reading, and who is acting.
- **Users are a view of a memory store**: `MemoryStore.create(clock)`, `store.as(user)` a `Files` that creates files
  owned by `user` and checks against it, `"root"` exempt. `Files` gains `chown` (the host: `Unsupported`) and `Stat`
  gains `owner` and `mode`. `whoami` and `id` read the session's user and refuse where there is none.
- **Streams close**: `files.openWrite(path)` answers an `Output` and `files.openRead(path)` an `Input`, and both
  types gain `close`. `Child.endInput()` is `child.input().close()`; closing `stdout` ends the program's output. The
  host gives a stream per call, which retires `openInput`/`openOutput` switching the program's one stream and the
  `isHostPath` split in box (every path streams).
- **A composed `Files` handed to a child is served by std** over the parent channel while the parent drives its
  scheduler; the child's `sys.files()` is that remote `Files`. The wire protocol and serving move into std.
- **`packages/fs` keeps what is ours rather than general**: the image format, over `store.entries()` and
  `MemoryStore.restore(clock, entries)`; `passwd`; the process table, renamed `ProcTable`; and `/dev`, `/proc` and
  `/bin` as `Files` constructors (`devFiles`, `procFiles`, `binFiles`).
