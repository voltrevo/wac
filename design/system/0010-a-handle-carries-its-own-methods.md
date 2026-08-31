# 0010 — a handle carries its own methods

- **Status:** decided, unbuilt — the rule is settled, no code has moved yet
- **Decided by:** the operator, 2026-08-31, while settling `vision/EXAMPLES.md`'s stream example
- **Spans:** `std/platform.wac`, `packages/sh`, `packages/tor`, `packages/quic`, `packages/server`,
  `packages/webrtc`, and whatever `Sys` turns out to be

## The rule

**wac does not write `sys.method(thing)` when the thing can hold the method.** Reading a socket is
`sock.recv()`, not `sys.recv(sock)`. The receiver is the thing being acted on.

That is the whole of it, and it applies to the library surface generally rather than to sockets in
particular.

## What the tree does today

The capability holds the verbs and the caller supplies a raw integer:

```wac
Pending<Read> outT = sh.cli.recv(j.handle);              // packages/sh/src/exec.wac
```

`Socket` is a struct — `handle`, `error`, `peer`, `port`, `fault`, and methods like `fromLoopback` —
so the type exists and the caller reaches past it to a field. **413 call sites** across the tree pass
a `handle`, `errHandle` or `fsHandle` to a method on something else. The heaviest are
`packages/server/test/wac/live_test.wac` (18), `packages/wac/src/counters.wac` (17),
`packages/webrtc/test/wac/dtlsserver_test.wac` and `packages/sh/src/exec.wac` (14 each).

A caller reaching past an abstraction is the tell that the abstraction is missing something. Here it
is missing the verbs.

## Why it is worth 413 call sites

**It is the authority argument, stated in a signature.** A function handed a `Socket` and no
capability can touch one connection and nothing else, and that is checkable by reading its first
line. Today the same function takes `Cli` — the whole system, every file and every socket — because
that is where `recv` lives, and the narrowing exists only in the author's intention.

`vision/EXAMPLES.md`'s stream example is the one-screen version:

```wac
async Result<u8[], string> readAll(Socket sock) { … await sock.recv() … }
```

**And a raw handle is a forgeable capability.** `cli.recv(4)` is a well-typed expression naming a
socket the caller may never have been given. `sock.recv()` cannot be written without a `Socket`, so
the type system carries what is currently a convention.

## What is not decided

- **Where the ambient verbs live.** `sys.listen(8080)`, `sys.readFile("a.txt")` and `sys.log(…)` take
  a value rather than a handle, so this rule does not reach them — but if a path ever becomes a type
  rather than a `string`, `readFile` becomes exactly the shape ruled out here.
- **Whether a handle knows its own scheduler.** `recv` is wired as `(i32 a0) => recv(a0).on(sched)`,
  so the ticket is linked by the capability that handed it out. A method on `Socket` needs that
  `sched` from somewhere, and "the socket remembers who made it" is a decision this note does not
  take.
- **Whether the rule reaches `Child` and `LoadedModule` too.** It reads like it should. Nobody has
  checked what breaks.
- **Migration.** Whether the free functions stay as the host boundary with methods delegating to
  them, or the boundary itself moves.

## Related

`answer(sys, sock)` in `vision/EXAMPLES.md`'s server keeps both parameters, and deliberately: a handler body
is likely to want more than the connection. The rule is about where a method lives, not a ban on
passing a capability.
