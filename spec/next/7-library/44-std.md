# 44 — Std

`std` is the package of capabilities: everything that reaches the world. Its central type is `Sys`, the authority a
program is handed on its `main` ([07](../1-programs/07-programs.md)). Like `core` it ships with the toolchain and cannot
be replaced, and it may import `core` and nothing else.

```wac
// expect: prints
// hello
import { Sys } from "std";

export void main(Sys sys) {
  sys.log("hello");
}
```

## A capability is a value

Every effect is a method reached through a `Sys`, or through a handle a `Sys` gave out. A socket reached through a
`Sys` is a socket and nothing more: its methods touch one connection, so handing one on hands on exactly that.

```wac
// fragment — the surface this chapter specifies, from std
struct Sys {
  void log(const this, string line);
  void warn(const this, string line);

  Ticket<i64> nowMillis(const this);
  Ticket<i64> monotonicNanos(const this);
  Ticket<void> sleepMillis(const this, i32 ms);
  Ticket<u8[]> randomBytes(const this, i32 n);

  async Result<u8[]> readFile(const this, string path);
  async Result<void> writeFile(const this, string path, u8[] bytes);

  async Result<Listener> listen(const this, i32 port);
  async Result<Child> spawn(const this, u8[] wasm, string[] args, Grant[] grants);

  i32 run(const this, fn<i32(Sys)> f, Grant[] grants);
  never exit(const this, i32 code);
  async void drain(this);
}

enum Grant { Read, Write, Listen, Spawn }

struct Listener {
  string addr;                 // "0.0.0.0:8080"
  i32 port;
  async Result<Socket> accept(this);
}

struct Socket {
  async Read recv(this);
  async Result<void> send(this, u8[] bytes);
  void close(this);
}

struct Child {
  async i32 exit(this);
}
```

`[§wac-std-sys-surface-2vwwqdr]` `Sys` has the methods listed above, with those signatures, and `Listener`, `Socket`, `Child`
and `Grant` are as declared.

## Files

File operations can fail, and say so in their type:

```wac
// fragment — a program built with read and write grants
async Result<void> copy(Sys sys, string from, string to) {
  u8[] bytes = try await sys.readFile(from);
  try await sys.writeFile(to, bytes);
  return Result.Ok();
}
```

`[§wac-std-file-result-z28bp2x]` `readFile` and `writeFile` answer tickets of `Result`s: a missing file, a directory, or a
missing grant is an `Err`, not a trap.

Code that consumes `Ticket.all` of several reads handles each result ([35](../6-concurrency/35-tickets-and-await.md)).

## Logging, time and randomness

```wac
// expect: prints
// started
import { Sys } from "std";

export async void main(Sys sys) {
  sys.log("started");
  i64 t0 = await sys.monotonicNanos();
  await sys.sleepMillis(1);
  i64 t1 = await sys.monotonicNanos();
  u8[] r = await sys.randomBytes(4);
  if (t1 < t0 || r.len() != 4) { sys.warn("impossible"); }
}
```

`[§wac-std-log-c9dspr3]` `log` writes a line to the program's output, and `warn` to its diagnostic output.

`[§wac-std-time-mzn6gvc]` `monotonicNanos` never decreases within a run; `nowMillis` is wall-clock time; `sleepMillis` settles
after at least that long; `randomBytes(n)` answers `n` random bytes.

## Sockets

```wac
// fragment — a program built with a listen grant
async Result<never> main(Sys sys) {
  Listener listener = try await sys.listen(8080);
  sys.log("listening on \{listener.addr}");

  while (true) {
    Socket sock = try await listener.accept();
    echo(sock);                // not awaited — the loop goes straight back to accept
  }
}

async void echo(Socket sock) {
  while (true) {
    match (await sock.recv()) {
      Data(bytes): { await sock.send(bytes); }
      End:         { sock.close(); return; }
      Failed(why): { sock.close(); return; }
    }
  }
}
```

`[§wac-std-socket-gs9parx]` A `Socket`'s `recv` answers a `Read` ([41](41-read.md)) — data, the end, or a failure — and `send`
answers whether the bytes went.

## Narrowing authority

`sys.run(f, grants)` calls `f` with a `Sys` holding at most `grants`, and `sys.spawn` starts a compiled module with at most
the grants given. A subsystem never holds more than its caller ([07](../1-programs/07-programs.md)):

```wac
// fragment — the compiler is a library: compiling answers bytes and spawning takes them
async Result<i32> runSource(Sys sys, string src) {
  u8[] wasm = try compile("main.wac", src);
  Child child = try await sys.spawn(wasm, [], [Grant.Read]);
  return Result.Ok(await child.exit());
}
```

`[§wac-std-spawn-grants-ykmq5tw]` A spawned child holds at most the grants passed to `spawn`, and never more than its parent
holds.

No file is written and no toolchain is looked up: the compiler is a library call ([48](../8-tooling/48-bindgen.md)).

## Ending, and the work left over

`sys.exit(n)` ends the program at once with status `n`. `sys.drain()` runs the continuations nobody awaited
([35](../6-concurrency/35-tickets-and-await.md)), and a program whose `main` returns while work remains exits 1
([07](../1-programs/07-programs.md)).

## Open

- **The rest of the host.** Directories and file metadata, processes and their output, the environment, the terminal,
  datagrams and the page are capabilities `std` provides today, through types not yet given their `Sys` form here.
  Their shape — methods on `Sys`, or handles a `Sys` hands out — is to be written down.
- **Whether `accept` can fail.** Written with `try` above.
