# 44 — Std

`std` is the package of capabilities: everything that reaches the world. Its central type is `Sys`, the authority a
program is handed on its `main` ([07](../1-programs/07-programs.md)). Like `core` it ships with the toolchain and cannot
be replaced.

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
  string[] args(const this);
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

## Arguments

```wac
// expect (wac run main.wac first second): prints
// 2 arguments: first second
import { Sys } from "std";

export void main(Sys sys) {
  string[] args = sys.args();
  sys.log("\{args.len()} arguments: \{args[0]} \{args[1]}");
}
```

Everything after the entry on the command line is the program's ([45](../8-tooling/45-cli.md)).

`[§wac-std-args-p4t8ken]` `sys.args()` answers the program's arguments, in order, not including the program's own name.
Reading them needs no grant: they are what the person running the program chose to tell it.

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
    match (await listener.accept()) {
      Ok(sock): { echo(sock); }      // not awaited — the loop goes straight back to accept
      Err(why): {                    // the listener is short of something: wait, then try again
        sys.warn("accept failed; retrying");
        await sys.sleepMillis(100);
      }
    }
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

`[§wac-std-accept-tkafecv]` `accept` answers `Err` only when the listener itself cannot go on accepting — it has run out
of a resource, or become unusable. A connection that ends before it is accepted is never reported: `accept` goes on
waiting for the next one.

So an `Err` from `accept` is about the listener, not about any client, and it is usually worth waiting out rather than
ending the program — which is why the loop above matches it instead of passing it up with `try`. Failing to `listen`
at all is different, and `try` is right there.

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

No file is written and no toolchain is looked up: the compiler is a library call.

## Ending, and the work left over

`sys.exit(n)` ends the program at once with status `n`. `sys.drain()` runs the continuations nobody awaited
([35](../6-concurrency/35-tickets-and-await.md)), and a program whose `main` returns while work remains exits 1
([07](../1-programs/07-programs.md)).

## Open

- **The rest of the host.** Directories and file metadata, processes and their output, the environment, the terminal,
  datagrams and the page are capabilities `std` provides today, through types not yet given their `Sys` form here.
  Their shape — methods on `Sys`, or handles a `Sys` hands out — is to be written down.
