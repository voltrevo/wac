# server — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/server`: 326 lines over two files. `routes.wac` is not rewritten —
what it does is put six packages on one request path, and none of that changes.

---

## The sentence the rewrite deletes

`serve.wac` opens: *"wac has no sockets, so the host owns the accept loop and the buffers and this
owns every decision."* Everything in `main.wac` is what stops being true once a socket is a value
the program was handed. The accept loop, the connection lifetime, the pipelining buffer and the
shutdown are all in wac, and the host owns nothing.

**And `serve` stays pure anyway**, which is the point worth making. The boundary was drawn because
of a limitation, and it survives the limitation being lifted — a protocol as a pure function is
testable by calling it, and that was never about sockets. The rewrite adds a layer rather than
dissolving one.

**There is no framework in the added layer.** Concurrency is `handle(sys, conn);` with no `await`:
the call runs to its first suspension, hands its continuation to whoever is scheduling, and the loop
goes straight back to accepting. One slow client does not hold the door. Nothing mentions a task, a
pool or an executor, and `await sys.drain()` before returning is what makes *dangling work is an
error* have something to point at.

## Measured against a shipped async pump, not against the blocking loop

`serve.wac`'s header — *"wac has no sockets, so the host owns the accept loop"* — is the comparison
this file was written against, and it is the wrong one. `packages/tor/src/relayd.wac` already runs
an async accept pump in production, landed 2026-08-30 under `design/lang/0014` A6:

```wac
async void armAccept(Core core, Cli cli, Relay x, Socket listener) {
  while (x.accepting) {
    Socket fresh = await cli.accept(listener.handle);
    if (fresh.handle < 0) { core.warn("relayd: accept: " + fresh.error); x.accepting = false; return; }
    …
    armConn(core, cli, x, x.conns[x.live - 1]!);
  }
}
```

So `async`, `await`, a loop with a suspension in it, and fire-and-forget concurrency are **not** what
this package proposes — they ship, and `main.wac`'s `handle(…)` with no `await` is the same move
`armConn` already makes. Four differences remain, and they are the actual proposal:

| shipped | vision | what it buys |
|---|---|---|
| `while (x.accepting)` + a bool the body clears | `for (Socket conn in l.accepted())` | the loop ends because the listener did; no flag to forget to clear |
| `Socket fresh = await …; if (fresh.handle < 0)` and `fresh.error` | `Result<Socket, NotGranted>` | the failure is not a field on the success |
| `Core core, Cli cli` | `sys.out`, `sys.clock` | `handle` cannot open a second port |
| `x.conns[x.live]`, `x.live`, `MAX_CONNS` | `Vec<Conn>` | the counter and the array stop being two things |

**The middle two are the ones with weight.** A negative handle and an `error` string on the returned
struct is the sentinel pattern this whole exercise keeps finding, in the newest async code in the
repository — so it is not a legacy shape that async cleaned up on its way past.

## What changed in `serve.wac`

**`Served` became two cases.** It was `(bool ready, u8[] response, i32 consumed, bool keepAlive)`
where three fields mean nothing when `ready` is false — and the value a host would read out of
`consumed` in that state is `0`, which is a legal answer meaning something else. This is the third
hand-rolled sum in three packages, after json's `Canonical` and http's error codes.

**`code == ERR_TOO_LARGE()` became a `match`.** An `i32` compared against a function returning a
literal, in a file that also has integers meaning statuses and integers meaning byte positions.

**`MAX_BODY` is an `i64` constant rather than `i32 MAX_BODY() { return 1 << 20; }`.**

**`defer { conn.close(); }`** covers four exits — two `break`s and two `return`s — from one line.

## What could not be written

**`defer` has no entry on any page.** It is used here and in `Ticket.wait` and it is the whole
cleanup story next to `sys.atEnd`; `vision/QUESTIONS.md` already asks what example should capture
it, and this is now the second package that needed it before the question was answered.

**`try await for` again**, over `l.accepted()`. Third package, same construct — and the `await`
matters here more than anywhere: a listener hands over connections as they arrive, so a loop head
that did not say it suspends would be the most misleading line in the package.

**Whether `main` may match on a `Result` to pick an exit code** is the shape of `main` question, met
for real: `main` here matches `await sys.listen(7000)` and returns `1` from the `Err` arm, which
works but means every program that can fail to acquire a capability writes the same match.

**Nothing says what happens to `handle`'s continuation when `main` returns.** `await sys.drain()`
finishes the ones that exist, but a connection accepted *during* the drain would be scheduled onto a
queue that is being emptied. `drain` loops until `pending` is empty, so it terminates only if
accepting has stopped — and the loop that accepts is itself one of the machines being drained. That
is either fine or a hang, and this file cannot tell which.
