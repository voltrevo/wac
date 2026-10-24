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

1. **Core:** `Stuck`, `Result.flatten`, and the `string`-error sweep in `core` (`number.wac`'s literal
   conversions), spec ch35 and ch40.
2. **The `string`-error sweep** across std and the packages.
3. **ch44 written whole**: the handles, their methods, the fault types, the output rules — the spec first, then
   std.
4. **std's handles over the host imports**, with the adapter as the only `Sys` constructor and `__wac` reserved;
   `Files` built from closures and `packages/fs` folded into it.
5. **Every caller moved** to the handles, family by family, each family's old `Cli` methods deleted in the same
   commit.
6. **Delete** `Core`, `Cli`, `Pending`, `Grant`, `FileResult`, `Change`, `Socket`'s fault fields and the exported
   `FAULT_*`; hosts lose their `capture`, `log` and `warn` arms.

Frames (`pushChild`/`popChild`) go under `design/system/0014`, after its measurement is shown to the operator.
