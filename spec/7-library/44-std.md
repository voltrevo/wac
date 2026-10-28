# 44 — Std

`std` is the package of capabilities: everything that reaches the world. Its central type is `Sys`, the authority a
program is handed on its `main` ([07](../1-programs/07-programs.md)). Like `core` it ships with the toolchain and cannot
be replaced.

```wac
// expect: prints
// hello
import { Sys } from "std";
import { Result } from "core";

export async Result<void> main(Sys sys) {
  try await sys.stdout().line("hello");
  return Result.Ok();
}
```

## A capability is a value

`Sys` is the only capability a program is given, and it holds no effects of its own: it hands out **handles**, one per
kind of authority, and every effect is a method of a handle. A function's parameters say what it may touch — a
function taking `Files` reads and writes files and does nothing else — and narrowing is a method on the handle.

```wac
// fragment — the surface this chapter specifies, from std
struct Sys {
  string[] args(this);

  Output stdout(this);
  Output stderr(this);
  Input stdin(this);

  Clock clock(this);
  Random random(this);
  Env env(this);
  Files files(this);
  Net net(this);
  Procs procs(this);
  Modules modules(this);

  never exit(const this, i32 code);
  async void drain(this);
  i32 drainFor(this, i32 millis);
}
```

`[§wac-std-sys-handles-2vwwqdr]` `Sys` has the methods listed above. `stdout`, `stderr`, `stdin`, `clock`, `random` and
`modules` need no grant. An operation of `env`, `files`, `net` or `procs` answers `NotGranted` when the program was not
given that authority ([45](../8-tooling/45-cli.md)'s `--allow-*`).

There is no other way to reach the world. A handle cannot be made from nothing, and a program cannot make a `Sys`: the
only one is the one `main` receives.

## Faults

A capability that can fail answers a `Result` whose error names **every way it can fail**, as a union of fault types.
Each fault is its own struct carrying the host's sentence:

```wac
// fragment — from std
struct NotFound    { string message; }   // no such file, directory or host
struct Denied      { string message; }   // the world refused: permissions, ownership
struct Exists      { string message; }
struct NotEmpty    { string message; }
struct IsDir       { string message; }
struct NotADir     { string message; }
struct ReadOnly    { string message; }
struct NameTooLong { string message; }
struct Loop        { string message; }   // too many symbolic links
struct NoSpace     { string message; }
struct NotRepresentable { string message; }   // a name this host cannot spell
struct Refused     { string message; }   // nothing listening
struct Unreachable { string message; }
struct TimedOut    { string message; }
struct OutputClosed { string message; }  // the reader of this program's output has gone
struct PeerClosed  { string message; }   // the other end of a socket has gone
struct NotGranted  { string message; }   // this program was not given that authority
struct Unsupported { string message; }   // this host does not provide the capability
struct Other       { string message; }   // a failure no category names
```

`[§wac-std-fault-union-k3p9wfe]` Every capability's error is a union of these. `Unsupported` is in every one: a host that
does not provide a capability answers it, and never traps. `Other` is in every one that reaches an operating system, and
holds whatever the host reported that no category covers.

The sets the handles share have names:

```wac
// fragment — from std
type ReadFault    = union<NotFound, Denied, IsDir, NotADir, NameTooLong, Loop, NotRepresentable, NotGranted,
                          Unsupported, Other>;
type WriteFault   = union<NotFound, Denied, IsDir, NotADir, NameTooLong, Loop, NotRepresentable, NoSpace,
                          ReadOnly, NotGranted, Unsupported, Other>;
type LookFault    = union<NotFound, Denied, NotADir, NameTooLong, Loop, NotRepresentable, NotGranted,
                          Unsupported, Other>;
type MkdirFault   = union<Exists, NotFound, Denied, NotADir, NameTooLong, Loop, NotRepresentable, NoSpace,
                          ReadOnly, NotGranted, Unsupported, Other>;
type MoveFault    = union<NotFound, Denied, IsDir, NotADir, NotEmpty, Exists, NameTooLong, Loop,
                          NotRepresentable, NoSpace, ReadOnly, NotGranted, Unsupported, Other>;
type ModeFault    = union<NotFound, Denied, NotADir, NameTooLong, Loop, NotRepresentable, ReadOnly,
                          NotGranted, Unsupported, Other>;
type OutputFault  = union<OutputClosed, NoSpace, Unsupported, Other>;
type ConnectFault = union<Refused, Unreachable, TimedOut, NotFound, NotGranted, Unsupported, Other>;
type BindFault    = union<Denied, Exists, NotGranted, Unsupported, Other>;
type SocketFault  = union<PeerClosed, TimedOut, Unsupported, Other>;
type SpawnFault   = union<NotGranted, Unsupported, Other>;
type GrantedFault = union<NotGranted, Unsupported, Other>;
type HostFault    = union<Unsupported, Other>;
```

So a caller sees in the type what can go wrong, a `match` on the error must cover it, and `try` passes it on into a
wider union ([26](../3-expressions/26-errors-and-results.md)):

```wac
// fragment — a program built with the read grant
async Result<string> firstLine(Files fs, string path) {
  u8[] bytes = match (await fs.readFile(path)) {
    Ok(b):  b,
    Err(e): match (e) {
      NotFound: return Result.Ok(""),       // an absent file is an empty answer here
      default:  return Result.Err(e),
    },
  };
  return Result.Ok(lineOf(bytes));
}
```

A ticket's own failure — nothing can settle it — is `wait()`'s, not the capability's
([35](../6-concurrency/35-tickets-and-await.md)). Synchronous code joins the two with `flatten`
([40](40-result.md)): `u8[] b = try flatten(fs.readFile(path).wait());`.

## Arguments

```wac
// expect (wac run main.wac first second): prints
// 2 arguments: first second
import { Sys } from "std";
import { Result } from "core";

export async Result<void> main(Sys sys) {
  string[] args = sys.args();
  try await sys.stdout().line("\{args.len()} arguments: \{args[0]} \{args[1]}");
  return Result.Ok();
}
```

Everything after the entry on the command line is the program's ([45](../8-tooling/45-cli.md)).

`[§wac-std-args-p4t8ken]` `sys.args()` answers the program's arguments, in order, not including the program's own name.
Reading them needs no grant: they are what the person running the program chose to tell it.

## Standard streams

```wac
// fragment — from std
struct Output {
  fn<Ticket<Result<void, OutputFault>>(u8[])> write;
  fn<Ticket<Result<void, OutputFault>>()> close;    // no more
  Ticket<Result<void, OutputFault>> line(const this, string text);   // text and a newline
}

struct Input {
  fn<Ticket<Result<Read, HostFault>>()> chunk;     // the next bytes, or the end
  fn<Ticket<Result<u8[], HostFault>>()> readAll;
  fn<Ticket<Result<void, HostFault>>()> close;     // done reading
}
```

`[§wac-std-output-closed-c9dspr3]` A write to an `Output` whose reader has gone answers `OutputClosed`. An `OutputClosed`
that reaches `main` — passed on with `try` and never handled — ends the program quietly with status 0, as `yes | head`
ends; every other error from `main` is reported and exits 1 ([07](../1-programs/07-programs.md)). A program that wants to
react matches it before it gets that far.

```wac
// expect: exits 0
import { Sys, OutputClosed, OutputFault } from "std";
import { Result } from "core";

export Result<void, OutputFault> main(Sys sys) {
  return Result.Err(OutputClosed("the output's reader has gone"));
}
```

Only that fault is quiet — the same error type with another member is an ordinary failure:

```wac
// expect: exits 1
import { Sys, Other, OutputFault } from "std";
import { Result } from "core";

export Result<void, OutputFault> main(Sys sys) {
  return Result.Err(Other("the disk is on fire"));
}
```

And it is the fault's type that is tested, not how `main`'s result spells it — here the error type is gathered from what
two `try`s pass on:

```wac
// expect: exits 0
import { Sys, OutputClosed } from "std";
import { Result } from "core";

struct Missing { string what; }

Result<i32, Missing> lookup(bool found) { return found ? Result.Ok(1) : Result.Err(Missing("x")); }
Result<void, OutputClosed> say(bool open) { return open ? Result.Ok() : Result.Err(OutputClosed("gone")); }

export Result<i32> main(Sys sys) {
  i32 n = try lookup(true);
  try say(false);
  return Result.Ok(n);
}
```

`[§wac-std-input-u7m2rjd]` `chunk` answers the next bytes as a `Read` ([41](41-read.md)), data or the end; a failure is
its `Err`, never `Read.Failed`. `readAll` answers everything up to the end.

`[§wac-std-close-r4v8ndq]` Closing an `Output` ends it: whoever reads it sees the end, a file holds what was written once
`close` answers, and a write after it answers `OutputClosed`. Closing `sys.stdout()` ends the program's output while the
program runs on; closing a child's `input()` ends the child's input. Closing an `Input` gives back what it held — a file
opened to read — and reading after it is not defined; the program's own input and a child's output hold nothing to give
back. Closing twice is not an error.

## Time and randomness

```wac
// expect: prints
// started
import { Sys, Clock } from "std";
import { Result } from "core";

export async Result<void> main(Sys sys) {
  try await sys.stdout().line("started");
  Clock clock = sys.clock();
  i64 t0 = try await clock.monotonicNanos();
  try await clock.sleepMillis(1);
  i64 t1 = try await clock.monotonicNanos();
  u8[] r = try await sys.random().bytes(4);
  if (t1 < t0 || r.len() != 4) { try await sys.stderr().line("impossible"); }
  return Result.Ok();
}
```

```wac
// fragment — from std
struct Clock {
  async Result<i64, union<Unsupported>> nowMillis(const this);
  async Result<i64, union<Unsupported>> monotonicNanos(const this);
  async Result<void, union<Unsupported>> sleepMillis(const this, i32 ms);
  async Result<A, union<E, TimedOut, Unsupported>> within<A, E>(this, Ticket<Result<A, E>> t, i32 millis);
}

struct Random {
  async Result<u8[], union<Unsupported>> bytes(const this, i32 n);
}
```

`[§wac-std-time-mzn6gvc]` `monotonicNanos` never decreases within a run; `nowMillis` is wall-clock time; `sleepMillis` settles
after at least that long; `bytes(n)` answers `n` random bytes.

A deadline belongs to the clock. `within` answers what a capability's ticket answers, or `TimedOut`:

```wac
// fragment
match (await sys.clock().within(sock.recv(), 30000)) {
  Ok(Data(bytes)): { … }
  Ok(End): { … }
  Err(TimedOut t): { sock.close(); }        // silent for thirty seconds
  Err(e): { … }
}
```

`[§wac-std-within-8mdio9r]` `clock.within(t, millis)` answers `t`'s answer, or `Err(TimedOut)` when `t` has not
answered within `millis` milliseconds; a negative `millis` sets no deadline. Whichever of `t` and the deadline loses
is cancelled (`§wac-ticket-cancel-6zeggqz`), so a deadline leaves nothing held at the host.

## The environment

```wac
// fragment — from std
struct Env {
  async Result<u8[]?, GrantedFault> get(const this, string name);   // Ok(null): not set
  async Result<string, HostFault> cwd(const this);
}
```

`[§wac-std-env-unset-r4c8tqb]` `get` answers `Ok(null)` for a variable that is not set, and `NotGranted` when the program may
not read the environment at all — so the two cannot be confused.

## Files

```wac
// fragment — from std
struct Files {
  fn<Ticket<Result<u8[], ReadFault>>(string)> readFile;
  fn<Ticket<Result<void, WriteFault>>(string, u8[])> writeFile;
  fn<Ticket<Result<Input, ReadFault>>(string)> openRead;         // to read a piece at a time
  fn<Ticket<Result<Output, WriteFault>>(string)> openWrite;      // created or emptied, to write a piece at a time
  fn<Ticket<Result<Output, WriteFault>>(string)> openAppend;     // created or added to
  fn<Ticket<Result<Stat, LookFault>>(string)> stat;
  fn<Ticket<Result<Stat, LookFault>>(string)> linkStat;          // a symbolic link itself
  fn<Ticket<Result<string[], LookFault>>(string)> readDir;
  fn<Ticket<Result<void, MkdirFault>>(string, bool)> mkdir;      // true: and its parents
  fn<Ticket<Result<void, MoveFault>>(string, bool)> remove;      // true: and everything under it
  fn<Ticket<Result<void, MoveFault>>(string, string)> rename;
  fn<Ticket<Result<void, ModeFault>>(string, i32)> chmod;
  fn<Ticket<Result<void, ModeFault>>(string, bool)> setExecutable;
  fn<Ticket<Result<void, ModeFault>>(string, string)> chown;     // root's to do; Unsupported on the host

  Files readOnly(this);                    // the same files, every change answering NotGranted
  Files relativeTo(this, string dir);      // a relative path starts at dir
  Files mounted(Mount[] mounts);           // each path to the longest mount that prefixes it
}

struct Mount { string at; Files files; }

struct MemoryStore {
  MemoryStore create(Clock clock);
  Files asUser(this, string user);         // the store as user sees it
  StoreEntry[] entries(this);              // each directory before what is in it
  Result<MemoryStore, Other> restore(Clock clock, StoreEntry[] entries);
}

struct StoreEntry { string path; bool isDir; u8[] data; i32 mode; string owner; i64 modifiedMillis; }
```

`[§wac-std-file-result-z28bp2x]` A missing file, a directory, or a change through a read-only `Files` is an `Err`, not a
trap.

`[§wac-std-files-compose-h6vq3ne]` `Files` is a value built from functions, so a backing is a constructor and nothing
branches on which backing it is: `sys.files()` is the host's, `readOnly` wraps any `Files`, and `mounted` routes each path
to the mount that owns it. A rename across two mounts is `Other`, as a rename across two devices is.

`[§wac-std-relative-files-c3n9vka]` `relativeTo(dir)` gives the same files with a relative path starting at `dir`, as a
shell's current directory does. `.` and `..` are taken out before a path reaches the files beneath, `..` at the root
stays there, and an absolute path is left alone.

`[§wac-std-memory-store-p4k7wzn]` A `MemoryStore` is one tree in the program's memory, and `asUser(user)` is a `Files`
acting as one person on it: what it creates is theirs — a file `0644`, a directory `0755` — and each operation is checked
against the mode of what it touches, the owner bits for its owner and the last three for anybody else. There are no
groups, the directories on the way are not checked, and `"root"` is exempt. `chmod` is the owner's or root's and `chown`
is root's; refusing is `Denied`. `Stat.owner` and `Stat.mode` answer what the store recorded. The host answers its own
mode bits, an owner of `""`, and `Unsupported` for `chown`, because its owners are numbers in a table that is not the
program's. `entries` and `restore` save a store and bring it back.

```wac
// fragment — two people on one store
async Result<void> share(Clock clock) {
  MemoryStore store = MemoryStore.create(clock);
  Files root = store.asUser("root");
  try await root.mkdir("/home/ada", true);
  try await root.chown("/home/ada", "ada");
  try await store.asUser("ada").writeFile("/home/ada/notes", "hi".toBytes());
  return Result.Ok();
}
```

```wac
// fragment — a program built with read and write grants
async Result<void> copy(Files fs, string from, string to) {
  u8[] bytes = try await fs.readFile(from);
  try await fs.writeFile(to, bytes);
  return Result.Ok();
}
```

`[§wac-std-file-stream-m6t2wqe]` `openRead`, `openWrite` and `openAppend` open a file as a stream of its own, so a program
holds as many as it likes and none has to fit in memory. Opening fails as reading or writing the whole file would — a
missing directory is `NotFound`, and opening to write through `readOnly` is `NotGranted`. `openWrite` empties a file that
exists; `openAppend` writes after what is there. Each creates a file that does not exist.

```wac
// fragment — the same copy, a piece at a time
async Result<void> copyStreaming(Files fs, string from, string to) {
  Input in = try await fs.openRead(from);
  Output out = try await fs.openWrite(to);
  bool more = true;
  while (more) {
    Read r = try await in.chunk();
    match (r) {
      Data(bytes): { try await out.write(bytes); }
      default: { more = false; }
    }
  }
  try await in.close();
  try await out.close();
  return Result.Ok();
}
```

## Sockets

```wac
// fragment — from std
struct Net {
  async Result<Socket, ConnectFault> connect(this, string host, i32 port);
  async Result<Listener, BindFault> listen(this, string addr, i32 port);       // addr: "127.0.0.1", "0.0.0.0"
  async Result<Datagrams, BindFault> bindDatagram(this, string addr, i32 port);
}

struct Listener {
  string addr;                 // "0.0.0.0:8080"
  i32 port;                    // what was bound, when 0 was asked for
  async Result<Socket, HostFault> accept(this);
  void close(this);
}

struct Socket {
  string peer;
  i32 port;
  async Result<Read, SocketFault> recv(this);
  async Result<void, SocketFault> send(this, u8[] bytes);
  void closeSend(this);        // no more from this side; reading goes on
  void close(this);
}

struct Datagrams {
  i32 port;
  async Result<Datagram, HostFault> receive(this);
  async Result<void, union<Unreachable, Unsupported, Other>> sendTo(this, string host, i32 port, u8[] bytes);
  void close(this);
}
```

```wac
// fragment — a program built with the net grant
async Result<never> main(Sys sys) {
  Listener listener = try await sys.net().listen("0.0.0.0", 8080);
  try await sys.stdout().line("listening on \{listener.addr}");

  while (true) {
    match (await listener.accept()) {
      Ok(sock): { echo(sock); }      // not awaited — the loop goes straight back to accept
      Err(why): {                    // the listener is short of something: wait, then try again
        try await sys.clock().sleepMillis(100);
      }
    }
  }
}

async void echo(Socket sock) {
  while (true) {
    match (await sock.recv()) {
      Ok(Data(bytes)): { if ((await sock.send(bytes)).isErr()) { sock.close(); return; } }
      Ok(End):         { sock.close(); return; }
      Err(why):        { sock.close(); return; }
    }
  }
}
```

The address `listen` takes is not optional: `"127.0.0.1"` is loopback and `"0.0.0.0"` every interface, so the one that is
reachable from elsewhere is something somebody typed.

`[§wac-std-socket-gs9parx]` A `Socket`'s `recv` answers a `Read` ([41](41-read.md)) — data or the end — and `send` answers
whether the bytes went; a peer that has gone is `PeerClosed`, an ordinary fault a server handles.

`[§wac-std-accept-tkafecv]` `accept` answers `Err` only when the listener itself cannot go on accepting — it has run out
of a resource, or become unusable. A connection that ends before it is accepted is never reported: `accept` goes on
waiting for the next one.

So an `Err` from `accept` is about the listener, not about any client, and it is usually worth waiting out rather than
ending the program — which is why the loop above matches it instead of passing it up with `try`. Failing to `listen`
at all is different, and `try` is right there.

## Processes

```wac
// fragment — from std
struct Procs {
  async Result<Child, SpawnFault> spawn(this, u8[] wasm, string[] args, Authority given, Launch how);
  async Result<Child, SpawnFault> spawnSelf(this, string[] args, Authority given, Launch how);
  async Result<Exec, SpawnFault> exec(this, string program, string[] args, u8[] input, ChildEnv env, Launch how);
}

struct Authority {             // what a child holds: each the parent's own or narrowed from it
  Files? files;
  Net? net;
  Env? env;
  Procs? procs;
}

struct ChildEnv {               // the environment exec gives a host program
  ChildEnv inherited();        // this program's own
  ChildEnv empty();            // none at all
  ChildEnv set(const this, string name, string value);   // with name set over it
}

struct Launch {
  string cwd;                  // where the child's relative paths resolve; "" for this program's own
  bool inheritIn;              // it reads this program's input rather than a queue
  bool inheritOut;             // it writes this program's output and diagnostic output rather than queues
  bool detached;               // dropping its Child does not stop it
}

struct Child {
  Input output(this);          // what it writes, unless inherited
  Input errors(this);          // what it writes to its diagnostic output, unless inherited
  Output input(this);          // what it reads, unless inherited; closing it ends its input and it goes on running
  async Result<i32, HostFault> exit(this);
  void stop(this);
}
```

`[§wac-std-spawn-grants-ykmq5tw]` A spawned child holds exactly the handles in its `Authority`, so it never holds more than
its parent. Spawning needs the program's own `procs` authority — another instance of itself included.

`[§wac-std-files-served-t5h2mzr]` A child handed a `Files` built in this program — a `MemoryStore` view, a `mounted` table,
a `relativeTo` over either — is served it: the child's `sys.files()` asks this program, which answers out of that
`Files` while it runs its scheduler, until the child ends, and the child's `exit` answers once the serving has ended
too. So the child's writes are this program's and it may do what that `Files` allows and nothing more; it is given no
host files. A child hands its served `Files` on to its own children in the same way. `sys.files()` and its `readOnly`
are granted to the child by the host instead, and a loaded module, which runs on this thread and so cannot be served,
is refused a composed `Files` with `Unsupported`.

`[§wac-std-child-env-k3w8tqa]` A host program started by `exec` gets the environment its `ChildEnv` describes: a base,
this program's own environment or an empty one, with each name `set` over it holding the last value it was set to. Nothing
else reaches the child's environment.

```wac
// fragment — git sees this program's PATH and HOME, and GIT_DIR as set here
Exec r = try await procs.exec("git", ["status"], u8[](), ChildEnv.inherited().set("GIT_DIR", dir), Launch.plain());
```

`[§wac-std-child-drop-n2r5vxe]` Dropping a `Child` that has not been waited for stops it, unless it was launched `detached`.

```wac
// fragment — the compiler is a library: compiling answers bytes and spawning takes them
async Result<i32> runSource(Sys sys, string src) {
  u8[] wasm = try compile("main.wac", src);
  Authority given = Authority(sys.files().readOnly(), null, null, null);
  Child child = try await sys.procs().spawn(wasm, [], given, Launch("", false, false, false));
  return Result.Ok(try await child.exit());
}
```

No file is written and no toolchain is looked up: the compiler is a library call.

## Modules

```wac
// fragment — from std
struct Modules {
  Result<Module, HostFault> load(this, u8[] wasm, Authority given);
  Result<void, HostFault> validate(this, u8[] wasm);
}

struct Module {
  Result<CallResult, HostFault> call(this, string name, i32 arg);   // a trap is an answer, CallResult.trapped
  void unload(this);
}
```

`[§wac-std-module-same-thread-q8d2kzm]` A loaded module runs on the caller's thread and holds exactly its `Authority`; `call`
returns when the export does.

## Ending, and the work left over

`sys.exit(n)` ends the program at once with status `n`. `sys.drain()` runs the continuations nobody awaited
([35](../6-concurrency/35-tickets-and-await.md)), and a program whose `main` returns while work remains exits 1
([07](../1-programs/07-programs.md)).

`[§wac-std-drain-for-wr24p09]` `sys.drainFor(millis)` runs the continuations nobody awaited until none remain or
`millis` milliseconds have passed, and answers how many it ran — none is how a server tells that nothing spoke. What
it did not run is still outstanding.

## Not yet given a form

- **The terminal's interrupt** (`^C` delivered to a program that owns the keyboard) has no handle while
  `issues/system/0363a` decides whether any host should offer it.
- **The page**, for a program running in a browser, is `packages/web`'s and not a capability of `Sys`.
